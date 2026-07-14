/**
 * End-to-end cost / cache-token accounting tests for the orchestrator.
 *
 * 目的:验证在 mock provider 下,每一条 TraceRequest 的 cost_usd / usage / pricing 字段
 * 与"实际发生的上游调用"一一对应,尤其是:
 *   1. advisor 侧 cache_creation_input_tokens / cache_read_input_tokens 是否被正确映射
 *      到 TraceUsage.cache_creation_tokens / cache_read_tokens 并计入 cost
 *   2. MoM fanout cache 命中时,advisor 一律 usage=0 / cost=0 / status='cache_hit',
 *      但 pricing 快照仍然保留(方便 eval 反演单价)
 *   3. 同一 session 多轮请求下,session_id / gateway_request_id / N+1 粒度是否满足文档承诺
 *   4. passthrough 路径的 selected_model 与 pricing 命中逻辑
 *   5. reasoning_tokens 端到端固定为 0(implementation known-limit)
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AnthropicMessagesRequest, AnthropicMessagesResponse } from '../src/types/anthropic.js';
import type { MoMConfig, ProviderConfig, RuntimeConfig, TraceRequest } from '../src/types/mom.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';
import { createOrchestrator } from '../src/orchestrator/orchestrator.js';
import { registerTraceAPI } from '../src/gateway/trace-api.js';
import { closeDB, getDB, initDB } from '../src/storage/db.js';
import {
  getRecentTraceRequests,
  getTraceRequestsBySessionId,
} from '../src/storage/traces.js';

// --------------- mock provider --------------- //

interface ProviderHandler {
  (req: IncomingMessage, body: AnthropicMessagesRequest, res: ServerResponse): void | Promise<void>;
}

let mockServer: Server;
let mockBaseUrl = '';
let currentHandler: ProviderHandler | null = null;

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

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

function setHandler(h: ProviderHandler): void {
  currentHandler = h;
}

before(async () => {
  mockServer = createServer((req, res) => {
    if (!currentHandler) {
      res.statusCode = 500;
      res.end('no handler configured');
      return;
    }
    readBody(req).then((body) => currentHandler!(req, body, res)).catch(() => {
      res.statusCode = 500;
      res.end('body parse err');
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
  currentHandler = null;
});

// --------------- fixtures --------------- //

function providerCfg(): ProviderConfig {
  return { base_url: mockBaseUrl, api_key: 'test', auth_style: 'bearer' };
}

function momCfg(overrides: Partial<MoMConfig> = {}): MoMConfig {
  return {
    ...DEFAULT_MOM_CONFIG,
    mom_mode: 'always',
    fanout_mode: 'user_turn',
    advisor: { slots: ['adv-a', 'adv-b', 'adv-c'], tools_enabled: false },
    aggregator: { model: 'agg-x' },
    reference_max_tokens: 4096,
    pricing_table: {
      'adv-a': { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
      'adv-b': { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 },
      'adv-c': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
      'agg-x': { input: 0.5, output: 2, cache_write: 0.625, cache_read: 0.05 },
    },
    cache: { ttl: '5m', max_entries: 100 },
    ...overrides,
  };
}

function runtime(mom: MoMConfig): RuntimeConfig {
  return { provider: providerCfg(), mom, mom_config_source: 'test' };
}

function jsonResponse(
  res: ServerResponse,
  body: AnthropicMessagesResponse,
): void {
  res.setHeader('content-type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify(body));
}

function messageResponse(
  model: string,
  text: string,
  usage: AnthropicMessagesResponse['usage'],
): AnthropicMessagesResponse {
  return {
    id: `msg_${model}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
  };
}

// --------------- tests --------------- //

describe('cost accounting: MoM always non-streaming', () => {
  it('N advisor + 1 aggregator → N+1 traces, cost = sum(pricing × usage) per trace', async () => {
    const requestBody: AnthropicMessagesRequest = {
      model: 'client:auto',
      messages: [{ role: 'user', content: 'compute 2+2 with cache' }],
      max_tokens: 100,
    };
    setHandler((_req, body, res) => {
      // advisor slots each return their own model, aggregator returns agg-x
      const model = body.model;
      const usage =
        model === 'agg-x'
          ? {
              input_tokens: 400,
              output_tokens: 80,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 200,
            }
          : {
              // provider reports mixed cache split for each advisor
              input_tokens: 50,
              output_tokens: 30,
              cache_creation_input_tokens: 40,
              cache_read_input_tokens: 10,
            };
      jsonResponse(res, messageResponse(model, `analysis-${model}`, usage));
    });

    const orch = createOrchestrator(runtime(momCfg()));
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const resp = await orch.nonStreaming(requestBody, sessionId, noopLog);
    assert.equal(resp.model, 'agg-x');

    const traces = getTraceRequestsBySessionId(sessionId);
    assert.equal(traces.length, 4, 'expected 3 advisor + 1 aggregator = 4 traces');

    const advisors = traces.filter((t) => t.role === 'advisor');
    const agg = traces.find((t) => t.role === 'aggregator')!;
    assert.equal(advisors.length, 3);
    assert.ok(agg);

    // 1) 每个 advisor 的 usage 完整保留 4 段 token
    for (const a of advisors) {
      assert.equal(a.status, 'success');
      assert.equal(a.cache_hit, false);
      assert.equal(a.usage.input_tokens, 50);
      assert.equal(a.usage.output_tokens, 30);
      assert.equal(a.usage.cache_creation_tokens, 40);
      assert.equal(a.usage.cache_read_tokens, 10);
      assert.equal(a.usage.reasoning_tokens, 0, 'reasoning_tokens always 0 by design');
    }

    // 2) 每个 advisor 的 cost 严格等于 pricing × usage
    for (const a of advisors) {
      const p = momCfg().pricing_table[a.selected_model]!;
      const expected =
        (50 * p.input + 30 * p.output + 40 * p.cache_write + 10 * p.cache_read) /
        1_000_000;
      assert.ok(
        Math.abs(a.cost_usd - expected) < 1e-12,
        `advisor ${a.selected_model} cost mismatch: got ${a.cost_usd}, want ${expected}`,
      );
    }

    // 3) aggregator cost = 400*0.5 + 80*2 + 100*0.625 + 200*0.05 / 1M
    const aggExpected =
      (400 * 0.5 + 80 * 2 + 100 * 0.625 + 200 * 0.05) / 1_000_000;
    assert.ok(Math.abs(agg.cost_usd - aggExpected) < 1e-12);
    assert.equal(agg.usage.cache_creation_tokens, 100);
    assert.equal(agg.usage.cache_read_tokens, 200);

    // 4) session + gateway_request_id 关联
    const gwIds = new Set(traces.map((t) => t.gateway_request_id));
    assert.equal(gwIds.size, 1, 'all traces share one gateway_request_id');
    for (const t of traces) {
      assert.equal(t.session_id, sessionId);
      assert.equal(t.client_model, 'client:auto');
    }

    // 5) trigger_reason 全体一致
    for (const t of traces) assert.equal(t.trigger_reason, 'user_turn');
  });
});

describe('cost accounting: MoM fanout cache hit', () => {
  it('cache hit → advisor traces status=cache_hit, usage=0, cost=0, but pricing snapshot preserved', async () => {
    const cfg = momCfg();
    const orch = createOrchestrator(runtime(cfg));
    const sessionId = '22222222-2222-4222-8222-222222222222';

    // 首轮:所有 advisor 真跑 → cache set
    let providerCallCount = 0;
    setHandler((_req, body, res) => {
      providerCallCount++;
      jsonResponse(
        res,
        messageResponse(body.model, `first-${body.model}`, {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 5,
        }),
      );
    });
    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [{ role: 'user', content: 'hello cache probe' }],
        max_tokens: 64,
      },
      sessionId,
      noopLog,
    );
    const firstRoundCalls = providerCallCount;
    assert.equal(firstRoundCalls, 4, 'first round: 3 advisor + 1 aggregator = 4 provider calls');

    // 第二轮:tool iteration,同一 gateway 进程,同一 sessionId,cache 应命中
    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [
          { role: 'user', content: 'hello cache probe' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't1', name: 'probe', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
          },
        ],
        max_tokens: 64,
      },
      sessionId,
      noopLog,
    );

    // provider 只多被调用了 1 次(aggregator);advisor 全部命中 cache
    assert.equal(providerCallCount, firstRoundCalls + 1);

    const traces = getTraceRequestsBySessionId(sessionId);
    assert.equal(traces.length, 8, '2 rounds × (3 advisor + 1 aggregator) = 8 traces');

    // 第二轮的 advisor traces:usage=0, cost=0, status=cache_hit, cache_hit=true, pricing snapshot 保留
    const secondRoundAdvisors = traces
      .filter((t) => t.role === 'advisor')
      .filter((t) => t.cache_hit === true);
    assert.equal(secondRoundAdvisors.length, 3);
    for (const a of secondRoundAdvisors) {
      assert.equal(a.status, 'cache_hit');
      assert.equal(a.cache_hit, true);
      assert.equal(a.usage.input_tokens, 0);
      assert.equal(a.usage.output_tokens, 0);
      assert.equal(a.usage.cache_creation_tokens, 0);
      assert.equal(a.usage.cache_read_tokens, 0);
      assert.equal(a.cost_usd, 0);
      assert.equal(a.trigger_reason, 'skipped_tool_iteration');
      // pricing 快照仍保留,便于反演单价
      assert.ok(a.pricing, `cache_hit advisor should still preserve pricing snapshot; got null for ${a.selected_model}`);
      assert.equal(a.pricing!.input_per_million, cfg.pricing_table[a.selected_model]!.input);
    }
  });
});

describe('cost accounting: passthrough path', () => {
  it('passthrough uses client_model as selected_model, falls back to cost=0 when pricing missing', async () => {
    const cfg: MoMConfig = { ...momCfg(), mom_mode: 'off' };
    const orch = createOrchestrator(runtime(cfg));
    const sessionId = '33333333-3333-4333-8333-333333333333';

    setHandler((_req, body, res) => {
      jsonResponse(
        res,
        messageResponse(body.model, 'passthrough reply', {
          input_tokens: 111,
          output_tokens: 22,
          cache_creation_input_tokens: 33,
          cache_read_input_tokens: 44,
        }),
      );
    });

    // client_model 是路由 alias,pricing_table 里没有条目
    await orch.nonStreaming(
      {
        model: 'modeless:auto',
        messages: [{ role: 'user', content: 'passthrough hi' }],
        max_tokens: 64,
      },
      sessionId,
      noopLog,
    );

    const traces = getTraceRequestsBySessionId(sessionId);
    assert.equal(traces.length, 1);
    const t = traces[0]!;
    assert.equal(t.role, 'passthrough');
    assert.equal(t.trigger_reason, 'mom_off');
    assert.equal(t.client_model, 'modeless:auto');
    assert.equal(t.selected_model, 'modeless:auto', 'passthrough sets selected = client');
    // usage 完整落盘(4 段)
    assert.equal(t.usage.input_tokens, 111);
    assert.equal(t.usage.output_tokens, 22);
    assert.equal(t.usage.cache_creation_tokens, 33);
    assert.equal(t.usage.cache_read_tokens, 44);
    // pricing 缺失 → cost=0
    assert.equal(t.pricing, null);
    assert.equal(t.cost_usd, 0);
  });

  it('passthrough hits pricing when client_model is directly in table', async () => {
    const cfg: MoMConfig = {
      ...momCfg(),
      mom_mode: 'off',
      pricing_table: {
        'adv-a': { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
      },
    };
    const orch = createOrchestrator(runtime(cfg));
    const sessionId = '44444444-4444-4444-8444-444444444444';

    setHandler((_req, body, res) => {
      jsonResponse(
        res,
        messageResponse(body.model, 'ok', {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 100,
        }),
      );
    });

    await orch.nonStreaming(
      { model: 'adv-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 32 },
      sessionId,
      noopLog,
    );

    const t = getTraceRequestsBySessionId(sessionId)[0]!;
    // (1000*1 + 500*5 + 200*1.25 + 100*0.1) / 1M
    const expected = (1000 * 1 + 500 * 5 + 200 * 1.25 + 100 * 0.1) / 1_000_000;
    assert.ok(Math.abs(t.cost_usd - expected) < 1e-12);
  });
});

describe('advisor & aggregator context scope (answering user Q)', () => {
  it('advisor receives ALL messages (flattened); aggregator receives ALL messages (original) + references appended to last user', async () => {
    const captured: { model: string; messages: unknown; system: unknown; last_user: string }[] = [];
    setHandler((_req, body, res) => {
      const lastMsg = body.messages[body.messages.length - 1]!;
      const lastText =
        typeof lastMsg.content === 'string'
          ? lastMsg.content
          : lastMsg.content.map((b) => (b.type === 'text' ? b.text : `<${b.type}>`)).join('|');
      captured.push({
        model: body.model,
        messages: JSON.parse(JSON.stringify(body.messages)),
        system: body.system,
        last_user: lastText,
      });
      jsonResponse(
        res,
        messageResponse(body.model, `resp-${body.model}`, {
          input_tokens: 10,
          output_tokens: 5,
        }),
      );
    });

    const orch = createOrchestrator(runtime(momCfg()));
    const sessionId = '55555555-5555-4555-8555-555555555555';

    // 构造多轮上下文:2 轮真实对话 + 1 轮 tool iteration
    const messages: AnthropicMessagesRequest['messages'] = [
      { role: 'user', content: 'question 1: what is X?' },
      { role: 'assistant', content: 'answer 1: X is foo' },
      { role: 'user', content: 'question 2: what about Y?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup', input: { q: 'Y' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Y is bar' }] },
    ];

    await orch.nonStreaming(
      { model: 'client:auto', messages, max_tokens: 64 },
      sessionId,
      noopLog,
    );

    // 3 advisor + 1 aggregator = 4 calls
    assert.equal(captured.length, 4);
    const advisorCalls = captured.filter((c) => c.model.startsWith('adv-'));
    const aggCall = captured.find((c) => c.model === 'agg-x')!;

    // ---- Advisor 视图断言 ----
    // 每个 advisor 收到 5 条 messages(flattened;tool_use / tool_result 被压成 text)
    // 最后一条是 tool_result(角色 user)——因为末尾非 assistant,不追加 marker
    for (const call of advisorCalls) {
      const msgs = call.messages as { role: string; content: unknown }[];
      assert.equal(msgs.length, 5, 'advisor sees ALL 5 turns');
      assert.equal(msgs[0]!.role, 'user');
      // tool_result flattened into text block containing "[tool result: ..."
      const last = msgs[4]!;
      assert.equal(last.role, 'user');
      const lastContent = last.content as { type: string; text?: string }[];
      assert.equal(lastContent[0]!.type, 'text');
      assert.match(lastContent[0]!.text!, /\[tool result: Y is bar\]/);
      // system prompt 是数组形式(cache_control)
      assert.ok(Array.isArray(call.system));
    }

    // ---- Aggregator 视图断言 ----
    // aggregator 收到全 5 条 messages(结构未 flatten,tool_use/tool_result 保留)
    const aggMsgs = aggCall.messages as { role: string; content: unknown }[];
    assert.equal(aggMsgs.length, 5, 'aggregator sees ALL 5 turns unmodified in prefix');

    // 前 4 条应该与原 messages 完全一致
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(aggMsgs[i], messages[i], `prefix[${i}] must be identical`);
    }
    // 最后一条(user + tool_result)被 clone,尾部追加 aggregator guidance + Advisor Panel References
    const aggLast = aggMsgs[4]!;
    assert.equal(aggLast.role, 'user');
    const aggLastContent = aggLast.content as {
      type: string;
      tool_use_id?: string;
      content?: string;
      text?: string;
    }[];
    // 应该有原 tool_result block + 新增 text block(附加 references)
    assert.ok(aggLastContent.length >= 1);
    const appended = aggLastContent[aggLastContent.length - 1]!;
    assert.equal(appended.type, 'text');
    assert.match(appended.text!, /You are the aggregator in a Mixture-of-Models process\./);
    assert.match(appended.text!, /Advisor Panel References \(for the aggregator only, not user-visible\):/);
    assert.match(appended.text!, /\[Reference 1 — adv-a\]/);
    assert.match(appended.text!, /\[Reference 2 — adv-b\]/);
    assert.match(appended.text!, /\[Reference 3 — adv-c\]/);
  });
});

describe('cost accounting: TraceRequest end-to-end via /trace/requests API', () => {
  let app: FastifyInstance;
  before(async () => {
    app = Fastify({ logger: false });
    registerTraceAPI(app);
    await app.ready();
  });
  after(async () => {
    await app.close();
  });

  it('/trace/requests returns identical rows as getTraceRequestsBySessionId', async () => {
    setHandler((_req, body, res) => {
      jsonResponse(
        res,
        messageResponse(body.model, `r-${body.model}`, {
          input_tokens: 8,
          output_tokens: 4,
        }),
      );
    });
    const orch = createOrchestrator(runtime(momCfg()));
    const sessionId = '66666666-6666-4666-8666-666666666666';

    await orch.nonStreaming(
      { model: 'client:auto', messages: [{ role: 'user', content: 'q' }], max_tokens: 16 },
      sessionId,
      noopLog,
    );

    const res = await app.inject({
      method: 'GET',
      url: `/trace/requests?session_id=${sessionId}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { session_id: string; requests: TraceRequest[] };
    assert.equal(body.requests.length, 4);
    // API 结果与直接查库一致
    const direct = getTraceRequestsBySessionId(sessionId);
    assert.deepEqual(body.requests, direct);
    // ORDER BY started_at ASC → 3 advisor 先于 aggregator(实际上 fanout 并发,started_at 差异极小,
    // 但 aggregator 一定在最后)
    assert.equal(body.requests[body.requests.length - 1]!.role, 'aggregator');
  });
});

describe('multi-session isolation', () => {
  it('same messages under two different sessionIds produce independent traces + share fanout cache', async () => {
    setHandler((_req, body, res) => {
      jsonResponse(
        res,
        messageResponse(body.model, 'x', {
          input_tokens: 10,
          output_tokens: 5,
        }),
      );
    });
    const orch = createOrchestrator(runtime(momCfg()));
    const sA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const msg: AnthropicMessagesRequest = {
      model: 'client:auto',
      messages: [{ role: 'user', content: 'shared question' }],
      max_tokens: 16,
    };

    await orch.nonStreaming(msg, sA, noopLog);
    await orch.nonStreaming(msg, sB, noopLog);

    const tracesA = getTraceRequestsBySessionId(sA);
    const tracesB = getTraceRequestsBySessionId(sB);
    assert.equal(tracesA.length, 4);
    assert.equal(tracesB.length, 4);

    // sA advisor traces 应是 real; sB advisor traces 应命中 fanout cache(相同 messages + settings)
    const advA = tracesA.filter((t) => t.role === 'advisor');
    const advB = tracesB.filter((t) => t.role === 'advisor');
    for (const a of advA) assert.equal(a.cache_hit, false);
    for (const b of advB) {
      assert.equal(b.cache_hit, true, 'session B advisors should hit fanout cache (same key)');
      assert.equal(b.cost_usd, 0);
    }
  });
});

describe('null session_id survives orchestrator but is excluded from /trace/requests', () => {
  it('X-Session-ID missing → trace still saved with session_id=null but not queryable', async () => {
    setHandler((_req, body, res) => {
      jsonResponse(
        res,
        messageResponse(body.model, 'x', {
          input_tokens: 5,
          output_tokens: 3,
        }),
      );
    });
    const orch = createOrchestrator(runtime(momCfg()));
    // sessionId = null
    await orch.nonStreaming(
      {
        model: 'client:auto',
        messages: [{ role: 'user', content: 'no session id' }],
        max_tokens: 16,
      },
      null,
      noopLog,
    );

    // 全库查得到
    const all = getRecentTraceRequests(10);
    const nullSessionTraces = all.filter((t) => t.session_id === null);
    assert.equal(nullSessionTraces.length, 4);

    // 无法通过 session_id 查询
    const bogusSession = '00000000-0000-0000-0000-000000000000';
    const q = getTraceRequestsBySessionId(bogusSession);
    assert.equal(q.length, 0);
  });
});
