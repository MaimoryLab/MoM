import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { passthroughStream } from '../src/provider/stream-forward.js';
import { ProviderError } from '../src/provider/provider-client.js';
import type { AnthropicMessagesRequest } from '../src/types/anthropic.js';
import type { ProviderConfig } from '../src/types/mom.js';

type Handler = (req: Parameters<Server['listeners']>[0] extends unknown ? any : never, res: any) => void;
let handler: Handler | null = null;
let server: Server;
let baseUrl = '';

before(async () => {
  server = createServer((req, res) => {
    if (handler) handler(req, res);
    else {
      res.statusCode = 500;
      res.end('no handler configured');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function setHandler(h: Handler): void {
  handler = h;
}

const provider = (): ProviderConfig => ({
  base_url: baseUrl,
  api_key: 'test',
  auth_style: 'bearer',
});

const req = (): AnthropicMessagesRequest => ({
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 32,
  stream: true,
});

function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    stream.on('data', (chunk: Buffer) => (buf += chunk.toString('utf8')));
    stream.on('end', () => resolve(buf));
  });
}

describe('passthroughStream error propagation', () => {
  it('throws ProviderError with statusCode on provider non-2xx (regression: A/C)', async () => {
    setHandler((_req, res) => {
      res.statusCode = 502;
      res.end('upstream is down');
    });
    const out = new PassThrough();
    const collected = collect(out);

    await assert.rejects(
      passthroughStream(req(), out, provider()),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError, 'expected ProviderError');
        assert.equal((err as ProviderError).statusCode, 502);
        assert.match((err as ProviderError).providerBody, /upstream is down/);
        return true;
      },
    );

    const sseText = await collected;
    assert.match(sseText, /event: error/);
    assert.match(sseText, /"type":"provider_error"/);
  });

  it('throws underlying error on network failure (regression: A)', async () => {
    // Bad base_url → undici throws ETIMEDOUT / ECONNREFUSED / EAI_AGAIN etc.
    const badProvider: ProviderConfig = {
      base_url: 'http://127.0.0.1:1',
      api_key: 'x',
      auth_style: 'bearer',
    };
    const out = new PassThrough();
    const collected = collect(out);

    await assert.rejects(passthroughStream(req(), out, badProvider), (err: unknown) => {
      assert.ok(err instanceof Error, 'expected Error');
      return true;
    });

    const sseText = await collected;
    assert.match(sseText, /event: error/);
    assert.match(sseText, /"type":"gateway_error"/);
  });
});
