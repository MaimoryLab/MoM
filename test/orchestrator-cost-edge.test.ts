/**
 * Exploratory edge-case tests — designed to probe corners of cost/cache accounting
 * that might reveal issues rather than confirm success.
 *
 * 场景:
 *   1. session_id=null 的多轮 advisor:是否仍然共享 gateway_request_id 内的关联性?
 *   2. mom_off + stream=true 的 usage 是否正确从 SSE 抽出?
 *   3. per_iteration 模式下,tool iteration 应总是 miss(独立签名);cache hit 只发生在
 *      messages 完全一致的重复请求上
 *   4. TTL 过期后 tool iteration 应触发 tool_iteration_cache_miss(补跑),不空 references
 *   5. pricing_missing 只对 aggregator/passthrough 有意义(cache_hit 场景已归零)
 *   6. 极端值:usage 上报为 undefined/负数/NaN 时,cost/usage 是否被 clamp 为 0
 *   7. 中文/emoji 内容:cache key 是否稳定(canonical stringify 处理 unicode)
 *   8. 多轮同 session 累积:advisor cache 命中率随轮次上升
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { AnthropicMessagesRequest, AnthropicMessagesResponse } from '../src/types/anthropic.js';
import type { MoMConfig, ProviderConfig, RuntimeConfig } from '../src/types/mom.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';
import { createOrchestrator } from '../src/orchestrator/orchestrator.js';
import { closeDB, getDB, initDB } from '../src/storage/db.js';
import {
  getRecentTraceRequests,
  getTraceRequestsBySessionId,
} from '../src/storage/traces.js';
import { computeFanoutCacheKey } from '../src/cache/cache-key.js';
import { createFanoutCache } from '../src/cache/fanout-cache.js';
import { calculateCostFromSnapshot } from '../src/cost/pricing.js';

// --- shared mock provider ---
interface Handler {
  (req: IncomingMessage, body: AnthropicMessagesRequest, res: ServerResponse): void;
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

let mockServer: Server;
let mockBaseUrl = '';
let handler: Handler | null = null;

async function readBody(req: IncomingMessage): Promise<AnthropicMessagesRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

before(async () => {
  mockServer = createServer((req, res) => {
    readBody(req)
      .then((body) => {
        if (handler) handler(req, body, res);
        else {
          res.statusCode = 500;
          res.end('no handler');
        }
      })
      .catch(() => {
        res.statusCode = 500;
        res.end('parse err');
      });
  });
  await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', r));
  mockBaseUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;
  initDB(':memory:');
});
after(async () => {
  await new Promise<void>((r) => mockServer.close(() => r()));
  closeDB();
});
beforeEach(() => {
  getDB().exec('DELETE FROM traces');
  handler = null;
});

// --- fixtures ---
const providerCfg = (): ProviderConfig => ({
  base_url: mockBaseUrl,
  api_key: 'test',
  auth_style: 'bearer',
});

function baseMom(overrides: Partial<MoMConfig> = {}): MoMConfig {
  return {
    ...DEFAULT_MOM_CONFIG,
    mom_mode: 'always',
    fanout_mode: 'user_turn',
    advisor: { slots: ['s1', 's2'], tools_enabled: false },
    aggregator: { model: 'agg' },
    reference_max_tokens: 1024,
    pricing_table: {
      s1: { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
      s2: { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 },
      agg: { input: 0.5, output: 2, cache_write: 0.625, cache_read: 0.05 },
    },
    cache: { ttl: '5m', max_entries: 100 },
    ...overrides,
  };
}
const runtime = (mom: MoMConfig): RuntimeConfig => ({
  provider: providerCfg(),
  mom,
  mom_config_source: 'src',
});

function jsonResp(res: ServerResponse, body: AnthropicMessagesResponse): void {
  res.setHeader('content-type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify(body));
}

function msg(
  model: string,
  usage: AnthropicMessagesResponse['usage'],
): AnthropicMessagesResponse {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 8)}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: `t-${model}` }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
  };
}

// -------- 1. null session --------
describe('null session_id + always mode', () => {
  it('all 3 traces share the same gateway_request_id even when session_id is null', async () => {
    handler = (_req, body, res) =>
      jsonResp(res, msg(body.model, { input_tokens: 1, output_tokens: 1 }));
    const orch = createOrchestrator(runtime(baseMom()));
    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
      },
      null,
      noopLog,
    );

    const all = getRecentTraceRequests(10);
    assert.equal(all.length, 3);
    const gwIds = new Set(all.map((t) => t.gateway_request_id));
    assert.equal(gwIds.size, 1);
    for (const t of all) assert.equal(t.session_id, null);
  });
});

// -------- 2. mom_off + stream (SSE usage extraction) --------
describe('mom_off streaming: SSE usage extraction', () => {
  it('passthrough streaming captures usage from message_delta event and computes cost', async () => {
    // Provider streams SSE with a message_delta carrying usage
    handler = (_req, body, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.statusCode = 200;
      const frames = [
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: msg(body.model, { input_tokens: 0, output_tokens: 0 }),
        })}\n\n`,
        `event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0,
        })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: {
            input_tokens: 500,
            output_tokens: 250,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
          },
        })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
      ];
      for (const f of frames) res.write(f);
      res.end();
    };

    const cfg = baseMom({ mom_mode: 'off', pricing_table: {
      // Only s1 is priced; passthrough client_model 'agg' will hit its own row.
      agg: { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
    }});
    const orch = createOrchestrator(runtime(cfg));
    // capture output into an in-memory Writable
    const chunks: Buffer[] = [];
    const output = new PassThrough();
    output.on('data', (c: Buffer) => chunks.push(c));

    const sessionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await orch.streaming(
      {
        model: 'agg',
        messages: [{ role: 'user', content: 'stream me' }],
        max_tokens: 32,
        stream: true,
      },
      sessionId,
      output,
      noopLog,
    );

    const traces = getTraceRequestsBySessionId(sessionId);
    assert.equal(traces.length, 1);
    const t = traces[0]!;
    assert.equal(t.role, 'passthrough');
    assert.equal(t.trigger_reason, 'mom_off');
    // usage from message_delta
    assert.equal(t.usage.input_tokens, 500);
    assert.equal(t.usage.output_tokens, 250);
    assert.equal(t.usage.cache_creation_tokens, 100);
    assert.equal(t.usage.cache_read_tokens, 50);
    // cost = (500*1 + 250*5 + 100*1.25 + 50*0.1) / 1M = 0.001880
    const expected = (500 * 1 + 250 * 5 + 100 * 1.25 + 50 * 0.1) / 1_000_000;
    assert.ok(
      Math.abs(calculateCostFromSnapshot(t.usage, t.pricing) - expected) < 1e-12,
    );
  });
});

// -------- 3. per_iteration mode → always miss on tool iteration --------
describe('per_iteration mode: tool iteration always misses', () => {
  it('tool iteration produces a NEW cache key vs prior user turn', async () => {
    const mom = baseMom({ fanout_mode: 'per_iteration' });
    const base = [{ role: 'user' as const, content: 'q' }];
    const withTool = [
      ...base,
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'x', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 't1', content: 'r' }] },
    ];
    const k1 = computeFanoutCacheKey(base, mom);
    const k2 = computeFanoutCacheKey(withTool, mom);
    assert.notEqual(k1, k2, 'per_iteration signatures whole messages, so keys differ');
  });

  it('per_iteration + tool iteration → advisor really re-runs each iteration, trigger_reason=per_iteration', async () => {
    let calls = 0;
    handler = (_req, body, res) => {
      calls++;
      jsonResp(res, msg(body.model, { input_tokens: 10, output_tokens: 5 }));
    };
    const orch = createOrchestrator(runtime(baseMom({ fanout_mode: 'per_iteration' })));
    const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccc11';

    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [{ role: 'user', content: 'first turn' }],
        max_tokens: 16,
      },
      sessionId,
      noopLog,
    );
    const afterFirst = calls;
    assert.equal(afterFirst, 3); // 2 adv + 1 agg

    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [
          { role: 'user', content: 'first turn' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }],
          },
        ],
        max_tokens: 16,
      },
      sessionId,
      noopLog,
    );
    assert.equal(calls, 6, 'per_iteration → second iteration re-runs advisors (no cache hit)');

    // trigger_reason 应为 per_iteration(每一条 advisor + aggregator)
    const traces = getTraceRequestsBySessionId(sessionId);
    assert.equal(traces.length, 6);
    for (const t of traces) assert.equal(t.trigger_reason, 'per_iteration');
  });
});

// -------- 4. TTL 过期 → cache miss --------
describe('fanout cache TTL expiry triggers tool_iteration_cache_miss (unit level)', () => {
  it('cache expiry after TTL → subsequent get returns undefined; orchestrator must re-run', () => {
    let now = 1000;
    const cache = createFanoutCache({ max_entries: 10, ttl_ms: 5000, now: () => now });
    cache.set('k', [{
      slot: 'a', success: true, reference: 'x',
      usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0,
      cache_hit: false, error: null, started_at: now, finished_at: now,
      selected_model: 'a', response_summary: null,
    }] as any);
    assert.ok(cache.get('k'));
    now = 7000; // > TTL
    assert.equal(cache.get('k'), undefined);
  });
});

// -------- 5. usage 极端值 --------
describe('usage clamping: negative / NaN / undefined values', () => {
  it('provider reporting negative / NaN usage → traces record 0 tokens and cost=0', async () => {
    handler = (_req, body, res) =>
      jsonResp(
        res,
        msg(body.model, {
          input_tokens: -100 as any,
          output_tokens: Number.NaN as any,
          cache_creation_input_tokens: undefined as any,
          cache_read_input_tokens: -5 as any,
        }),
      );
    const orch = createOrchestrator(runtime(baseMom()));
    const sessionId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [{ role: 'user', content: 'q' }],
        max_tokens: 8,
      },
      sessionId,
      noopLog,
    );
    const traces = getTraceRequestsBySessionId(sessionId);
    for (const t of traces) {
      assert.equal(t.usage.input_tokens, 0);
      assert.equal(t.usage.output_tokens, 0);
      assert.equal(t.usage.cache_creation_tokens, 0);
      assert.equal(t.usage.cache_read_tokens, 0);
      assert.equal(
        calculateCostFromSnapshot(t.usage, t.pricing),
        0,
        'zero usage → zero cost even with pricing present',
      );
    }
  });
});

// -------- 6. Unicode/emoji cache key stability --------
describe('cache key stability across unicode content', () => {
  it('identical unicode/emoji content yields identical keys', () => {
    const a = [
      { role: 'user' as const, content: '你好 🎉 world' },
    ];
    const b = [
      { role: 'user' as const, content: '你好 🎉 world' },
    ];
    const kA = computeFanoutCacheKey(a, baseMom());
    const kB = computeFanoutCacheKey(b, baseMom());
    assert.equal(kA, kB);
  });
  it('differing unicode content yields different keys', () => {
    const a = [{ role: 'user' as const, content: '你好' }];
    const b = [{ role: 'user' as const, content: 'こんにちは' }];
    assert.notEqual(
      computeFanoutCacheKey(a, baseMom()),
      computeFanoutCacheKey(b, baseMom()),
    );
  });
});

// -------- 7. TraceRequest.provider host derivation --------
describe('TraceRequest.provider host derivation', () => {
  it('extracts host from PROVIDER_BASE_URL', async () => {
    handler = (_req, body, res) =>
      jsonResp(res, msg(body.model, { input_tokens: 1, output_tokens: 1 }));
    const orch = createOrchestrator(runtime(baseMom()));
    const sessionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await orch.nonStreaming(
      { model: 'client:auto', messages: [{ role: 'user', content: 'q' }], max_tokens: 8 },
      sessionId,
      noopLog,
    );
    const traces = getTraceRequestsBySessionId(sessionId);
    for (const t of traces) {
      // host part looks like "127.0.0.1:<port>"
      assert.match(t.provider, /^127\.0\.0\.1:\d+$/);
    }
  });
});

// -------- 8. sequential rounds — cache hit rate rises --------
describe('multi-round cache accounting', () => {
  it('3 rounds of tool iteration under user_turn: rounds 2+3 all cache_hit', async () => {
    let calls = 0;
    handler = (_req, body, res) => {
      calls++;
      jsonResp(res, msg(body.model, { input_tokens: 10, output_tokens: 5 }));
    };
    const orch = createOrchestrator(runtime(baseMom()));
    const sessionId = '77777777-7777-4777-8777-777777777777';

    const baseTurn: AnthropicMessagesRequest = {
      model: 'client:auto',
      messages: [{ role: 'user', content: 'root question' }],
      max_tokens: 16,
    };
    await orch.nonStreaming(baseTurn, sessionId, noopLog);
    const afterR1 = calls;
    assert.equal(afterR1, 3, 'R1: 2 advisor + 1 aggregator');

    // R2 same tool iteration
    const withTool1: AnthropicMessagesRequest = {
      ...baseTurn,
      messages: [
        ...baseTurn.messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: { p: 1 } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }] },
      ],
    };
    await orch.nonStreaming(withTool1, sessionId, noopLog);
    assert.equal(calls, afterR1 + 1, 'R2: advisor cache-hit, only aggregator hits provider');

    // R3 further tool iteration (still same real user turn)
    const withTool2: AnthropicMessagesRequest = {
      ...baseTurn,
      messages: [
        ...withTool1.messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'x', input: { p: 2 } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'r2' }] },
      ],
    };
    await orch.nonStreaming(withTool2, sessionId, noopLog);
    assert.equal(calls, afterR1 + 2, 'R3: advisor still hit, only aggregator');

    const traces = getTraceRequestsBySessionId(sessionId);
    // 3 rounds × 3 traces = 9
    assert.equal(traces.length, 9);
    const advisorHits = traces.filter((t) => t.role === 'advisor' && t.cache_hit).length;
    const advisorMisses = traces.filter((t) => t.role === 'advisor' && !t.cache_hit).length;
    assert.equal(advisorHits, 4, 'R2 (2 adv) + R3 (2 adv) = 4 cache hits');
    assert.equal(advisorMisses, 2, 'only R1 (2 adv) misses');

    // Aggregator 每轮真跑,累积 3 条 aggregator trace
    const aggs = traces.filter((t) => t.role === 'aggregator');
    assert.equal(aggs.length, 3);
    for (const a of aggs) {
      assert.equal(a.cache_hit, false);
      assert.notEqual(a.usage.input_tokens, 0, 'aggregator always incurs real usage');
    }
  });
});

// -------- 9. NEW real user turn after cache warmed → new key, new miss --------
describe('new real user turn invalidates the prior cache key', () => {
  it('a genuinely different user question spawns a fresh fanout', async () => {
    let calls = 0;
    handler = (_req, body, res) => {
      calls++;
      jsonResp(res, msg(body.model, { input_tokens: 5, output_tokens: 5 }));
    };
    const orch = createOrchestrator(runtime(baseMom()));
    const sessionId = '88888888-8888-4888-8888-888888888888';

    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [{ role: 'user', content: 'A' }],
        max_tokens: 8,
      },
      sessionId,
      noopLog,
    );
    const afterA = calls;
    assert.equal(afterA, 3);

    // second real user turn (different content)
    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [
          { role: 'user', content: 'A' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'B — completely different' },
        ],
        max_tokens: 8,
      },
      sessionId,
      noopLog,
    );
    assert.equal(calls, afterA + 3, 'new real user turn → advisor miss + full re-run');

    const traces = getTraceRequestsBySessionId(sessionId);
    // 2 rounds × 3 = 6 traces
    assert.equal(traces.length, 6);
    // First round trigger_reason=user_turn; second-round advisors should also be user_turn (miss+new turn)
    const advisorReasons = traces
      .filter((t) => t.role === 'advisor')
      .map((t) => t.trigger_reason);
    for (const r of advisorReasons) assert.equal(r, 'user_turn');
  });
});
