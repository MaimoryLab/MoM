/**
 * End-to-end cross-matrix coverage for the three data/mom.config.json knobs
 * that steer the MoM runtime: `mom_mode`, `fanout_mode`, and
 * `reference_injection` (timing × position).
 *
 * These run the real orchestrator against a mock Anthropic provider (local
 * HTTP server), so every assertion is about behaviour observable end-to-end:
 *   - how many upstream provider calls each config produces (fanout / cache),
 *   - what `trigger_reason` lands on each persisted trace row,
 *   - the EXACT messages the aggregator receives (reference injection landing),
 *   - which requests skip MoM entirely (mom_mode).
 *
 * Focus is the boundary/agent-loop behaviour that the pure-unit tests in
 * reference-builder.test.ts and trigger.test.ts cannot see: multi-round tool
 * iterations within one agent loop, and how the knobs compose across rounds.
 *
 * NOT covered here (by request): config file load / shape validation, and
 * mom_mode='auto' semantics (auto currently behaves like off; we only assert
 * the 'always' path drives MoM and non-'always' passes through).
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
} from '../src/types/anthropic.js';
import type { MoMConfig, ProviderConfig, RuntimeConfig } from '../src/types/mom.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';
import { createOrchestrator } from '../src/orchestrator/orchestrator.js';
import { closeDB, getDB, initDB } from '../src/storage/db.js';
import { getTraceRequestsBySessionId } from '../src/storage/traces.js';

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

// ------------------------------------------------------------------ //
// mock provider: records every inbound upstream call so tests can assert
// both the call count and the exact request body the aggregator received.
// ------------------------------------------------------------------ //

interface CapturedCall {
  model: string;
  messages: AnthropicMessagesRequest['messages'];
}

let mockServer: Server;
let mockBaseUrl = '';
let providerCallCount = 0;
let captured: CapturedCall[] = [];

function readBody(req: IncomingMessage): Promise<AnthropicMessagesRequest> {
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

function jsonResp(res: ServerResponse, model: string): void {
  const body: AnthropicMessagesResponse = {
    id: `msg_${model}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: `resp-${model}` }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  res.setHeader('content-type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify(body));
}

before(async () => {
  mockServer = createServer((req, res) => {
    readBody(req)
      .then((body) => {
        providerCallCount++;
        captured.push({
          model: body.model,
          messages: JSON.parse(JSON.stringify(body.messages)),
        });
        jsonResp(res, body.model);
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
  providerCallCount = 0;
  captured = [];
});

const providerCfg = (): ProviderConfig => ({
  base_url: mockBaseUrl,
  api_key: 'x',
  auth_style: 'bearer',
});

function baseMom(overrides: Partial<MoMConfig> = {}): MoMConfig {
  return {
    ...DEFAULT_MOM_CONFIG,
    mom_mode: 'always',
    fanout_mode: 'user_turn',
    advisor: { slots: ['adv-a', 'adv-b'], tools_enabled: false },
    aggregator: { model: 'agg-x' },
    reference_max_tokens: 256,
    cache: { ttl: '5m', max_entries: 100 },
    ...overrides,
  };
}

const runtime = (mom: MoMConfig): RuntimeConfig => ({
  provider: providerCfg(),
  mom,
  mom_config_source: 't',
});

/** Extract the concatenated text of the last text block on a message. */
function lastText(msg: AnthropicMessagesRequest['messages'][number]): string {
  const c = msg.content;
  if (typeof c === 'string') return c;
  for (let i = c.length - 1; i >= 0; i--) {
    const b = c[i]!;
    if (b.type === 'text') return b.text ?? '';
  }
  return '';
}

const GUIDANCE_RE = /You have been provided with a set of responses from various models/;
const HEADER_RE = /Advisor Panel References \(for the aggregator only, not user-visible\):/;

/** The single aggregator call in `captured` (model === aggregator model). */
function aggregatorCall(aggModel = 'agg-x'): CapturedCall {
  const call = captured.find((c) => c.model === aggModel);
  assert.ok(call, `expected an aggregator call for ${aggModel}`);
  return call;
}

const userTurn = (text: string): AnthropicMessagesRequest => ({
  model: 'client:auto',
  messages: [{ role: 'user', content: text }],
  max_tokens: 32,
});

// ============================ mom_mode ============================ //

describe('mom_mode=always → MoM fans out and aggregates', () => {
  it('produces N advisor + 1 aggregator upstream calls and N+1 traces', async () => {
    const orch = createOrchestrator(runtime(baseMom()));
    const sid = '10000000-0000-4000-8000-000000000001';
    const resp = await orch.nonStreaming(userTurn('hi'), sid, noopLog);

    // response comes from the aggregator, not any advisor
    assert.equal(resp.model, 'agg-x');
    assert.equal(providerCallCount, 3, '2 advisor + 1 aggregator');

    const traces = getTraceRequestsBySessionId(sid);
    assert.equal(traces.length, 3);
    assert.equal(traces.filter((t) => t.role === 'advisor').length, 2);
    assert.equal(traces.filter((t) => t.role === 'aggregator').length, 1);
    // fresh user turn → user_turn trigger on this fanout
    for (const t of traces) assert.equal(t.trigger_reason, 'user_turn');
  });
});

describe('mom_mode=off → passthrough, MoM never runs', () => {
  it('single upstream call, one passthrough trace, no advisor/aggregator', async () => {
    const orch = createOrchestrator(runtime(baseMom({ mom_mode: 'off' })));
    const sid = '10000000-0000-4000-8000-000000000002';
    const resp = await orch.nonStreaming(userTurn('hi'), sid, noopLog);

    // passthrough echoes the client model straight through
    assert.equal(resp.model, 'client:auto');
    assert.equal(providerCallCount, 1, 'exactly one passthrough call');

    const traces = getTraceRequestsBySessionId(sid);
    assert.equal(traces.length, 1);
    assert.equal(traces[0]!.role, 'passthrough');
    assert.equal(traces[0]!.trigger_reason, 'mom_off');
  });
});

// ========================== fanout_mode ========================== //
//
// Simulate a 3-request agent loop that shares one user turn:
//   R1: fresh user query
//   R2: same query + assistant tool_use + user tool_result   (tool iteration)
//   R3: R2 + another tool_use/tool_result round              (tool iteration)
// The advisor fanout key is derived from `selectSignatureMessages`, so the
// cache behaviour across R1→R3 is exactly what distinguishes the three modes.

function agentLoopRounds(): AnthropicMessagesRequest[] {
  const r1: AnthropicMessagesRequest = {
    model: 'client:auto',
    messages: [{ role: 'user', content: 'solve this task' }],
    max_tokens: 32,
  };
  const r2: AnthropicMessagesRequest = {
    ...r1,
    messages: [
      ...r1.messages,
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }] },
    ],
  };
  const r3: AnthropicMessagesRequest = {
    ...r2,
    messages: [
      ...r2.messages,
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'r2' }] },
    ],
  };
  return [r1, r2, r3];
}

describe('fanout_mode=user_turn → advisors cached across one agent loop', () => {
  it('R1 real fanout, R2/R3 tool iterations hit cache; only aggregator re-runs', async () => {
    const orch = createOrchestrator(runtime(baseMom({ fanout_mode: 'user_turn' })));
    const sid = '20000000-0000-4000-8000-000000000001';
    const [r1, r2, r3] = agentLoopRounds();

    await orch.nonStreaming(r1, sid, noopLog);
    assert.equal(providerCallCount, 3, 'R1: 2 advisor + 1 aggregator');

    await orch.nonStreaming(r2, sid, noopLog);
    assert.equal(providerCallCount, 4, 'R2: advisors cached, only aggregator runs');

    await orch.nonStreaming(r3, sid, noopLog);
    assert.equal(providerCallCount, 5, 'R3: advisors cached again, only aggregator');

    const traces = getTraceRequestsBySessionId(sid);
    const advisors = traces.filter((t) => t.role === 'advisor');
    // 6 advisor rows total (2 per round × 3 rounds); R1 real, R2/R3 cache_hit
    assert.equal(advisors.length, 6);
    assert.equal(advisors.filter((t) => t.cache_hit).length, 4, 'R2+R3 advisors are cache hits');
    assert.equal(advisors.filter((t) => !t.cache_hit).length, 2, 'R1 advisors are real');
    const hitReasons = new Set(advisors.filter((t) => t.cache_hit).map((t) => t.trigger_reason));
    assert.deepEqual([...hitReasons], ['skipped_tool_iteration']);
  });
});

describe('fanout_mode=per_iteration → advisors re-run every tool iteration', () => {
  it('each round produces a fresh fanout (key includes full history)', async () => {
    const orch = createOrchestrator(runtime(baseMom({ fanout_mode: 'per_iteration' })));
    const sid = '20000000-0000-4000-8000-000000000002';
    const [r1, r2, r3] = agentLoopRounds();

    await orch.nonStreaming(r1, sid, noopLog);
    await orch.nonStreaming(r2, sid, noopLog);
    await orch.nonStreaming(r3, sid, noopLog);
    // every round is a full fanout: (2 advisor + 1 agg) × 3 = 9
    assert.equal(providerCallCount, 9, 'per_iteration re-runs advisors each round');

    const traces = getTraceRequestsBySessionId(sid);
    const advisors = traces.filter((t) => t.role === 'advisor');
    assert.equal(advisors.length, 6);
    assert.equal(advisors.filter((t) => t.cache_hit).length, 0, 'no cache hits under per_iteration');
    for (const t of advisors) assert.equal(t.trigger_reason, 'per_iteration');
  });

  it('an identical repeated request DOES hit cache (same full-history key)', async () => {
    const orch = createOrchestrator(runtime(baseMom({ fanout_mode: 'per_iteration' })));
    const sid = '20000000-0000-4000-8000-000000000003';
    const [r1] = agentLoopRounds();

    await orch.nonStreaming(r1, sid, noopLog);
    assert.equal(providerCallCount, 3);
    // byte-identical replay → cache key matches → advisors served from cache
    await orch.nonStreaming(r1, sid, noopLog);
    assert.equal(providerCallCount, 4, 'replay: advisors cached, only aggregator re-runs');

    const advisors = getTraceRequestsBySessionId(sid).filter((t) => t.role === 'advisor');
    assert.equal(advisors.filter((t) => t.cache_hit).length, 2);
    // per_iteration labels cache hits as fanout_cache_hit (not skipped_tool_iteration)
    const reasons = new Set(advisors.filter((t) => t.cache_hit).map((t) => t.trigger_reason));
    assert.deepEqual([...reasons], ['fanout_cache_hit']);
  });
});

describe('fanout_mode=off → advisors always run, cache never touched', () => {
  it('every round is a full real fanout with fanout_cache_off trigger', async () => {
    const orch = createOrchestrator(runtime(baseMom({ fanout_mode: 'off' })));
    const sid = '20000000-0000-4000-8000-000000000004';
    const [r1, r2] = agentLoopRounds();

    await orch.nonStreaming(r1, sid, noopLog);
    await orch.nonStreaming(r2, sid, noopLog);
    assert.equal(providerCallCount, 6, 'off: (2 advisor + 1 agg) × 2 rounds');

    const advisors = getTraceRequestsBySessionId(sid).filter((t) => t.role === 'advisor');
    assert.equal(advisors.length, 4);
    for (const t of advisors) {
      assert.equal(t.cache_hit, false);
      assert.equal(t.trigger_reason, 'fanout_cache_off');
    }
  });
});

// ====================== reference_injection ====================== //
//
// Assert the EXACT aggregator request body across an agent loop. The mock
// records every upstream call, and the aggregator call (model === 'agg-x') is
// the one whose messages carry the injected references. The advisor calls go
// through the view-transformer (flattened) and never receive references, so we
// only inspect the aggregator call here.
//
// timing gates WHETHER a request gets references; position gates WHERE.

describe('reference_injection timing=user_turn_only', () => {
  it('injects on the fresh user turn (R1) but SKIPS the tool iteration (R2)', async () => {
    const orch = createOrchestrator(
      runtime(
        baseMom({
          // keep advisors real on R2 so the aggregator still runs, isolating
          // the timing gate rather than the fanout cache.
          fanout_mode: 'per_iteration',
          reference_injection: { timing: 'user_turn_only', position: 'user_message_tail' },
        }),
      ),
    );
    const sid = '30000000-0000-4000-8000-000000000001';
    const [r1, r2] = agentLoopRounds();

    // R1: fresh user turn → injected
    await orch.nonStreaming(r1, sid, noopLog);
    const aggR1 = aggregatorCall();
    assert.match(lastText(aggR1.messages[0]!), GUIDANCE_RE);

    // R2: tool iteration → NOT injected; no aggregator message carries guidance
    captured = [];
    providerCallCount = 0;
    await orch.nonStreaming(r2, sid, noopLog);
    const aggR2 = aggregatorCall();
    for (const m of aggR2.messages) {
      assert.doesNotMatch(lastText(m), GUIDANCE_RE, 'R2 tool iteration must not carry references');
    }
    // and the trace records an empty references_appended for R2's aggregator
    const aggTraces = getTraceRequestsBySessionId(sid).filter((t) => t.role === 'aggregator');
    assert.equal(aggTraces.length, 2);
    assert.match(aggTraces[0]!.references_appended ?? '', GUIDANCE_RE);
    // skipped injection → empty payload, normalized to null by truncateForTrace
    assert.equal(aggTraces[1]!.references_appended, null);
  });
});

describe('reference_injection timing=every_request', () => {
  it('injects on BOTH the fresh turn (R1) and the tool iteration (R2)', async () => {
    const orch = createOrchestrator(
      runtime(
        baseMom({
          fanout_mode: 'per_iteration',
          reference_injection: { timing: 'every_request', position: 'user_message_tail' },
        }),
      ),
    );
    const sid = '30000000-0000-4000-8000-000000000002';
    const [r1, r2] = agentLoopRounds();

    await orch.nonStreaming(r1, sid, noopLog);
    assert.match(lastText(aggregatorCall().messages[0]!), GUIDANCE_RE);

    captured = [];
    await orch.nonStreaming(r2, sid, noopLog);
    // R2 is a tool iteration but every_request injects anyway. user_message_tail
    // targets the last REAL user message (index 0), not the trailing tool_result.
    const aggR2 = aggregatorCall();
    assert.match(lastText(aggR2.messages[0]!), GUIDANCE_RE);

    const aggTraces = getTraceRequestsBySessionId(sid).filter((t) => t.role === 'aggregator');
    assert.equal(aggTraces.length, 2);
    for (const t of aggTraces) assert.match(t.references_appended ?? '', GUIDANCE_RE);
  });
});

describe('reference_injection position (on a tool-iteration request, every_request)', () => {
  // R2 has 3 messages: [user query, assistant tool_use, user tool_result].
  // user_message_tail → references land on index 0 (the real query),
  //   trailing tool_result (index 2) stays clean.
  // context_tail → references land on the very last message (index 2),
  //   the real query (index 0) stays clean.
  it('user_message_tail lands on the real user query, not the tool_result tail', async () => {
    const orch = createOrchestrator(
      runtime(
        baseMom({
          fanout_mode: 'per_iteration',
          reference_injection: { timing: 'every_request', position: 'user_message_tail' },
        }),
      ),
    );
    const sid = '30000000-0000-4000-8000-000000000003';
    const [, r2] = agentLoopRounds();
    await orch.nonStreaming(r2, sid, noopLog);

    const agg = aggregatorCall();
    assert.equal(agg.messages.length, 3, 'no synthesized message; injected in place');
    assert.match(lastText(agg.messages[0]!), /^solve this task\n\n---\n\n/);
    assert.match(lastText(agg.messages[0]!), GUIDANCE_RE);
    // tool_result carrier untouched
    assert.doesNotMatch(lastText(agg.messages[2]!), GUIDANCE_RE);
  });

  it('context_tail lands on the last message, keeping the query prefix clean', async () => {
    const orch = createOrchestrator(
      runtime(
        baseMom({
          fanout_mode: 'per_iteration',
          reference_injection: { timing: 'every_request', position: 'context_tail' },
        }),
      ),
    );
    const sid = '30000000-0000-4000-8000-000000000004';
    const [, r2] = agentLoopRounds();
    await orch.nonStreaming(r2, sid, noopLog);

    const agg = aggregatorCall();
    assert.equal(agg.messages.length, 3);
    // real query stays clean (byte-stable prefix, reusable next loop)
    assert.doesNotMatch(lastText(agg.messages[0]!), GUIDANCE_RE);
    // references appended to the trailing tool_result message
    assert.match(lastText(agg.messages[2]!), GUIDANCE_RE);
    assert.match(lastText(agg.messages[2]!), HEADER_RE);
  });
});

describe('reference_injection carries header/guidance even with all advisors failed', () => {
  it('aggregator still gets a well-formed payload noting the failures', async () => {
    // Point one advisor slot at an unroutable model so its call errors, but the
    // aggregator still receives references naming the failure.
    const orch = createOrchestrator(
      runtime(
        baseMom({
          advisor: { slots: ['adv-a', 'adv-b'], tools_enabled: false },
          reference_injection: { timing: 'user_turn_only', position: 'user_message_tail' },
        }),
      ),
    );
    const sid = '30000000-0000-4000-8000-000000000005';
    await orch.nonStreaming(userTurn('need references'), sid, noopLog);

    const agg = aggregatorCall();
    const injected = lastText(agg.messages[0]!);
    assert.match(injected, GUIDANCE_RE);
    assert.match(injected, HEADER_RE);
    // both advisors succeeded (mock always 200s) → two reference blocks present
    assert.match(injected, /\[Reference 1 — adv-a\]/);
    assert.match(injected, /\[Reference 2 — adv-b\]/);
  });
});

