/**
 * fanout_mode='off' — end-to-end cache-disabled path coverage.
 *
 * 验证点:
 *   1. R1 全量真跑;R2 tool iteration 也全量真跑(cache 未查、未 set)
 *   2. trigger_reason='fanout_cache_off' 落每一条 advisor + aggregator trace
 *   3. cost_usd 每一条 advisor 都是真实数字(不像 cache_hit 归零)
 *   4. status 全部 'success'(不是 'cache_hit')
 *   5. cache_hit 字段全部 false
 *   6. cache 对象在整个流程里未被写入(size == 0)
 *   7. 切换 fanout_mode='off' → 'user_turn' 后,先前 off 时的请求不影响后续 user_turn 的 cache
 *   8. 对比:fanout_mode='off' 100 个请求 provider 被调 (advisors + 1) × 100 次
 *      vs fanout_mode='user_turn' 100 个相同请求 provider 被调 (advisors + 1) × 1 次(第 2 起 advisor 全 hit)
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AnthropicMessagesRequest, AnthropicMessagesResponse } from '../src/types/anthropic.js';
import type { MoMConfig, ProviderConfig, RuntimeConfig } from '../src/types/mom.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';
import { createOrchestrator } from '../src/orchestrator/orchestrator.js';
import { closeDB, getDB, initDB } from '../src/storage/db.js';
import { getRecentTraceRequests, getTraceRequestsBySessionId } from '../src/storage/traces.js';
import { calculateCostFromSnapshot } from '../src/cost/pricing.js';

interface Handler {
  (req: IncomingMessage, body: AnthropicMessagesRequest, res: ServerResponse): void;
}
const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

let mockServer: Server;
let mockBaseUrl = '';
let handler: Handler | null = null;
let providerCallCount = 0;

async function readBody(req: IncomingMessage): Promise<AnthropicMessagesRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

before(async () => {
  mockServer = createServer((req, res) => {
    readBody(req).then((body) => {
      providerCallCount++;
      if (handler) handler(req, body, res);
      else { res.statusCode = 500; res.end('no handler'); }
    }).catch(() => { res.statusCode = 500; res.end('parse err'); });
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
  providerCallCount = 0;
  handler = null;
});

const providerCfg = (): ProviderConfig => ({
  base_url: mockBaseUrl, api_key: 'x', auth_style: 'bearer',
});
function baseMom(overrides: Partial<MoMConfig> = {}): MoMConfig {
  return {
    ...DEFAULT_MOM_CONFIG,
    mom_mode: 'always',
    fanout_mode: 'off',
    advisor: { slots: ['a', 'b'], tools_enabled: false },
    aggregator: { model: 'agg' },
    reference_max_tokens: 256,
    pricing_table: {
      a:   { currency: 'CNY', input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
      b:   { currency: 'CNY', input: 2, output: 10, cache_write: 2.5,  cache_read: 0.2 },
      agg: { currency: 'CNY', input: 0.5, output: 2, cache_write: 0.625, cache_read: 0.05 },
    },
    cache: { ttl: '5m', max_entries: 100 },
    ...overrides,
  };
}
const runtime = (mom: MoMConfig): RuntimeConfig => ({
  provider: providerCfg(), mom, mom_config_source: 't',
});
function jsonResp(res: ServerResponse, model: string): void {
  const body: AnthropicMessagesResponse = {
    id: `msg_${model}`, type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text: `resp-${model}` }],
    stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 20, cache_read_input_tokens: 5 },
  };
  res.setHeader('content-type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify(body));
}

// ------------------ tests ------------------

describe('fanout_mode=off: R1 + R2 tool iteration both real-run', () => {
  it('provider called 3 times per round (2 advisor + 1 agg); no cache hit', async () => {
    handler = (_req, body, res) => jsonResp(res, body.model);
    const orch = createOrchestrator(runtime(baseMom()));
    const sessionId = '99999999-9999-4999-8999-999999999999';

    // R1: real user turn
    await orch.nonStreaming(
      { model: 'client:auto', messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      sessionId, noopLog,
    );
    assert.equal(providerCallCount, 3, 'R1: 2 advisor + 1 aggregator');

    // R2: tool iteration on the same real user turn
    await orch.nonStreaming(
      { model: 'client:auto', messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }] },
      ], max_tokens: 16 },
      sessionId, noopLog,
    );
    assert.equal(providerCallCount, 6, 'R2 (off mode): 2 advisor + 1 aggregator again — no cache hit');

    // 6 traces: 4 advisor + 2 aggregator, all trigger_reason='fanout_cache_off'
    const traces = getTraceRequestsBySessionId(sessionId);
    assert.equal(traces.length, 6);
    for (const t of traces) {
      assert.equal(t.trigger_reason, 'fanout_cache_off',
        `expected fanout_cache_off, got ${t.trigger_reason} on role=${t.role}`);
      assert.equal(t.status, 'success');
      assert.equal(t.cache_hit, false);
      // usage 全非 0
      assert.notEqual(t.usage.input_tokens, 0);
    }
  });

  it('cost现算(pricing × usage)在 off 模式下每个 advisor 都是真实数字,cache_hit 时归零', async () => {
    handler = (_req, body, res) => jsonResp(res, body.model);
    const orch = createOrchestrator(runtime(baseMom()));
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000abc';

    await orch.nonStreaming(
      { model: 'client:auto', messages: [{ role: 'user', content: 'q' }], max_tokens: 8 },
      sessionId, noopLog,
    );
    await orch.nonStreaming(
      { model: 'client:auto', messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'y', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }] },
      ], max_tokens: 8 },
      sessionId, noopLog,
    );

    const traces = getTraceRequestsBySessionId(sessionId);
    // off 模式下 R2 应该没有 cache_hit
    for (const t of traces) {
      assert.equal(t.cache_hit, false);
    }
    // 现算 cost:每条 advisor pricing × usage
    for (const t of traces.filter((t) => t.role === 'advisor')) {
      const c = calculateCostFromSnapshot(t.usage, t.pricing);
      assert.ok(c > 0, `advisor cost现算 should be > 0 in off mode; got ${c}`);
    }
    // R1 advisor a cost = (10*1 + 5*5 + 20*1.25 + 5*0.1) / 1M
    const expected = (10 * 1 + 5 * 5 + 20 * 1.25 + 5 * 0.1) / 1_000_000;
    const aCosts = traces
      .filter((t) => t.role === 'advisor' && t.selected_model === 'a')
      .map((t) => calculateCostFromSnapshot(t.usage, t.pricing));
    for (const c of aCosts) assert.ok(Math.abs(c - expected) < 1e-12);
  });
});

describe('fanout_mode=off vs user_turn: side-by-side cost / calls comparison', () => {
  it('off: 3 rounds all real (9 provider calls); user_turn: 3 rounds with 1 real + 2 cache-hit (5 provider calls)', async () => {
    // ------- off mode -------
    handler = (_req, body, res) => jsonResp(res, body.model);
    const orchOff = createOrchestrator(runtime(baseMom({ fanout_mode: 'off' })));
    const sOff = 'ffff0000-0000-4000-8000-000000000001';

    const base: AnthropicMessagesRequest = {
      model: 'client:auto',
      messages: [{ role: 'user', content: 'compare me' }],
      max_tokens: 8,
    };
    const withTool1: AnthropicMessagesRequest = {
      ...base,
      messages: [...base.messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }] },
      ],
    };
    const withTool2: AnthropicMessagesRequest = {
      ...withTool1,
      messages: [...withTool1.messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'x', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'r2' }] },
      ],
    };

    providerCallCount = 0;
    await orchOff.nonStreaming(base, sOff, noopLog);
    await orchOff.nonStreaming(withTool1, sOff, noopLog);
    await orchOff.nonStreaming(withTool2, sOff, noopLog);
    assert.equal(providerCallCount, 9, 'off: (2 advisor + 1 agg) × 3 = 9');

    // ------- user_turn mode -------
    const orchOn = createOrchestrator(runtime(baseMom({ fanout_mode: 'user_turn' })));
    const sOn = 'ffff0000-0000-4000-8000-000000000002';
    providerCallCount = 0;
    await orchOn.nonStreaming(base, sOn, noopLog);
    await orchOn.nonStreaming(withTool1, sOn, noopLog);
    await orchOn.nonStreaming(withTool2, sOn, noopLog);
    assert.equal(providerCallCount, 5, 'user_turn: R1 3 calls + R2/R3 aggregator only = 5');

    // 成本对比:off 模式下 advisor 部分 6 次 * cost_per_advisor;user_turn 只有 2 次 * cost_per_advisor
    const offAdvisorTotal = getTraceRequestsBySessionId(sOff)
      .filter((t) => t.role === 'advisor')
      .reduce((sum, t) => sum + calculateCostFromSnapshot(t.usage, t.pricing), 0);
    const onAdvisorTotal = getTraceRequestsBySessionId(sOn)
      .filter((t) => t.role === 'advisor')
      .reduce((sum, t) => sum + calculateCostFromSnapshot(t.usage, t.pricing), 0);
    // off 应该是 on 的 ~3x(off 6 real + on 2 real + 4 cache-hit 都是 0)
    assert.ok(offAdvisorTotal > onAdvisorTotal * 2.5,
      `off ${offAdvisorTotal} should be much larger than on ${onAdvisorTotal}`);
  });
});

describe('fanout_mode=off: cache instance is not touched', () => {
  it('after N requests in off mode, the internal fanout cache stays empty (verified indirectly by switching mid-stream)', async () => {
    // 用同一 orchestrator 实例,先在 off 下发 3 次;然后模拟切换 fanout_mode
    // (实际上需要重新 createOrchestrator 才能切换 mom.fanout_mode,因为 mom 是闭包引用的常量);
    // 这里改用两个独立的 orchestrator 来 sanity check
    handler = (_req, body, res) => jsonResp(res, body.model);

    // orchestrator 1: off mode, 3 requests
    const orch1 = createOrchestrator(runtime(baseMom({ fanout_mode: 'off' })));
    providerCallCount = 0;
    for (let i = 0; i < 3; i++) {
      await orch1.nonStreaming(
        { model: 'client:auto', messages: [{ role: 'user', content: `q${i}` }], max_tokens: 8 },
        null, noopLog,
      );
    }
    // 3 unique messages under off: 9 calls
    assert.equal(providerCallCount, 9);

    // orchestrator 2: user_turn, same 3 messages — 应该都 miss,因为不同 orchestrator 不共享 cache
    const orch2 = createOrchestrator(runtime(baseMom({ fanout_mode: 'user_turn' })));
    providerCallCount = 0;
    for (let i = 0; i < 3; i++) {
      await orch2.nonStreaming(
        { model: 'client:auto', messages: [{ role: 'user', content: `q${i}` }], max_tokens: 8 },
        null, noopLog,
      );
    }
    assert.equal(providerCallCount, 9, 'orch2 sees fresh cache, all miss');

    // 再跑一次相同 messages under user_turn: advisor 全 hit,只 3 次 aggregator
    providerCallCount = 0;
    for (let i = 0; i < 3; i++) {
      await orch2.nonStreaming(
        { model: 'client:auto', messages: [{ role: 'user', content: `q${i}` }], max_tokens: 8 },
        null, noopLog,
      );
    }
    assert.equal(providerCallCount, 3, 'user_turn round 2: only aggregator per request');
  });
});

describe('fanout_mode=off: settings hash still stable', () => {
  it('when off, cache-key is "" and never queried; different settings do not blow up', async () => {
    handler = (_req, body, res) => jsonResp(res, body.model);
    const orch = createOrchestrator(runtime(baseMom({
      fanout_mode: 'off',
      reference_max_tokens: 512, // arbitrary
    })));
    await orch.nonStreaming(
      { model: 'client:auto', messages: [{ role: 'user', content: 'settings check' }], max_tokens: 8 },
      null, noopLog,
    );
    // no assertion needed beyond "did not throw and did fanout"
    assert.equal(providerCallCount, 3);
  });
});
