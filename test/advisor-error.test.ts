import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runAdvisor } from '../src/advisor/advisor-runtime.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';
import type { MoMConfig, ProviderConfig } from '../src/types/mom.js';
import type { AnthropicMessage } from '../src/types/anthropic.js';

let server: Server;
let baseUrl = '';
let handler: ((req: any, res: any) => void) | null = null;

before(async () => {
  server = createServer((req, res) => {
    if (handler) handler(req, res);
    else {
      res.statusCode = 500;
      res.end('no handler');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const providerCfg = (): ProviderConfig => ({
  base_url: baseUrl,
  api_key: 'x',
  auth_style: 'bearer',
});

const momCfg = (): MoMConfig => ({
  ...DEFAULT_MOM_CONFIG,
  reference_max_tokens: 128,
});

const messages: AnthropicMessage[] = [{ role: 'user', content: 'hi' }];

describe('runAdvisor error path preserves provider http_status (regression: B)', () => {
  it('captures 502 into TraceError.http_status', async () => {
    handler = (_req, res) => {
      res.statusCode = 502;
      res.end('bad gateway');
    };
    const result = await runAdvisor('slot-a', messages, momCfg(), providerCfg());
    assert.equal(result.success, false);
    assert.ok(result.error, 'expected structured error');
    assert.equal(result.error!.type, 'provider_error');
    assert.equal(result.error!.http_status, 502);
    assert.match(result.error!.message, /bad gateway/);
  });

  it('captures 429 into TraceError.http_status', async () => {
    handler = (_req, res) => {
      res.statusCode = 429;
      res.end('rate limited');
    };
    const result = await runAdvisor('slot-b', messages, momCfg(), providerCfg());
    assert.equal(result.success, false);
    assert.equal(result.error!.http_status, 429);
    assert.equal(result.error!.type, 'provider_error');
  });

  it('marks non-provider errors as advisor_error with null http_status', async () => {
    const badProvider: ProviderConfig = {
      base_url: 'http://127.0.0.1:1',
      api_key: 'x',
      auth_style: 'bearer',
    };
    const result = await runAdvisor('slot-c', messages, momCfg(), badProvider);
    assert.equal(result.success, false);
    assert.equal(result.error!.type, 'advisor_error');
    assert.equal(result.error!.http_status, null);
  });

  it('returns error: null on success', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'slot-a',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      );
    };
    const result = await runAdvisor('slot-a', messages, momCfg(), providerCfg());
    assert.equal(result.success, true);
    assert.equal(result.error, null);
  });
});
