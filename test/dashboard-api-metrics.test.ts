import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { initDB, closeDB, getDB } from '../src/storage/db.js';
import { saveTraceRequest } from '../src/storage/traces.js';
import { registerMetricsAPI, computeMetrics } from '../src/dashboard-api/metrics-api.js';
import { DEFAULT_MOM_CONFIG, type PricingSnapshot, type TraceRequest } from '../src/types/mom.js';
import type { MetricsResponse } from '../src/types/dashboard-api.js';

function baseTrace(overrides: Partial<TraceRequest> = {}): TraceRequest {
  return {
    request_id: randomUUID(),
    session_id: null,
    gateway_request_id: randomUUID(),
    role: 'aggregator',
    client_model: 'modeless:auto',
    selected_model: 'agg-x',
    provider: 'apiproxy.paigod.work',
    started_at: 1_000_000,
    finished_at: 1_000_500,
    duration_ms: 500,
    status: 'success',
    usage: {
      input_tokens: 100,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      output_tokens: 50,
      reasoning_tokens: 0,
    },
    pricing: null,
    error: null,
    request_summary: {
      max_tokens: 4096,
      temperature: null,
      stream: false,
      message_count: 1,
      tool_use_count: 0,
    },
    response_summary: null,
    trigger_reason: 'user_turn',
    cache_hit: false,
    settings_snapshot: DEFAULT_MOM_CONFIG,
    ...overrides,
  };
}

function pricing(overrides: Partial<PricingSnapshot> = {}): PricingSnapshot {
  return {
    currency: 'USD',
    input_per_million: 1,
    cache_read_per_million: 0,
    cache_write_per_million: 1,
    output_per_million: 2,
    reasoning_per_million: null,
    source: 'test',
    ...overrides,
  };
}

let app: FastifyInstance;

before(async () => {
  initDB(':memory:');
  app = Fastify({ logger: false });
  registerMetricsAPI(app);
  await app.ready();
});
after(async () => {
  await app.close();
  closeDB();
});
beforeEach(() => {
  getDB().exec('DELETE FROM traces');
});

describe('computeMetrics — empty', () => {
  it('returns zero summary + empty arrays on empty DB', () => {
    const m = computeMetrics('all', 32);
    assert.equal(m.summary.request_count, 0);
    assert.equal(m.summary.mom_trigger_count, 0);
    assert.equal(m.summary.mom_trigger_rate, 0);
    assert.equal(m.summary.avg_latency_ms, 0);
    assert.equal(m.summary.cache_hit_rate, 0);
    assert.equal(m.summary.total_cost_usd, 0); // no traces → all pricing accounted → 0, not null
    assert.deepEqual(m.per_turn, []);
    assert.deepEqual(m.by_role, []);
    assert.deepEqual(m.cache_hit_by_model, []);
    assert.deepEqual(m.timeline, []);
  });
});

describe('computeMetrics — mixed traces', () => {
  it('groups by gateway_request_id + counts trigger rate + cost + cache_hit_rate', () => {
    const g1 = randomUUID();
    const g2 = randomUUID();
    const g3 = randomUUID();
    // Turn 1: 2 advisors (one hit) + 1 aggregator, all mom mode
    saveTraceRequest(baseTrace({
      gateway_request_id: g1, role: 'advisor', selected_model: 'adv-a',
      started_at: 1000, finished_at: 1200,
      trigger_reason: 'user_turn', cache_hit: false,
      pricing: pricing(), usage: { input_tokens: 100, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 40, reasoning_tokens: 0 },
    }));
    saveTraceRequest(baseTrace({
      gateway_request_id: g1, role: 'advisor', selected_model: 'adv-b',
      started_at: 1050, finished_at: 1250,
      trigger_reason: 'skipped_tool_iteration', cache_hit: true,
      pricing: pricing(), usage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 0, reasoning_tokens: 0 },
    }));
    saveTraceRequest(baseTrace({
      gateway_request_id: g1, role: 'aggregator', selected_model: 'agg',
      started_at: 1300, finished_at: 2000,
      trigger_reason: 'user_turn',
      pricing: pricing(), usage: { input_tokens: 200, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 80, reasoning_tokens: 0 },
    }));
    // Turn 2: also mom mode
    saveTraceRequest(baseTrace({
      gateway_request_id: g2, role: 'advisor', selected_model: 'adv-a',
      started_at: 3000, finished_at: 3100,
      trigger_reason: 'user_turn', cache_hit: false,
      pricing: pricing(), usage: { input_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 20, reasoning_tokens: 0 },
    }));
    saveTraceRequest(baseTrace({
      gateway_request_id: g2, role: 'aggregator', selected_model: 'agg',
      started_at: 3200, finished_at: 3500,
      trigger_reason: 'user_turn',
      pricing: pricing(), usage: { input_tokens: 80, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 40, reasoning_tokens: 0 },
    }));
    // Turn 3: passthrough (mom_off)
    saveTraceRequest(baseTrace({
      gateway_request_id: g3, role: 'passthrough', selected_model: 'client-model',
      started_at: 4000, finished_at: 4100,
      trigger_reason: 'mom_off',
      pricing: pricing(), usage: { input_tokens: 30, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 10, reasoning_tokens: 0 },
    }));

    const m = computeMetrics('all', 32);
    assert.equal(m.summary.request_count, 3);
    assert.equal(m.summary.mom_trigger_count, 2); // g1 + g2, g3 is mom_off
    assert.equal(m.summary.mom_trigger_rate, 2 / 3);
    // Advisor cache hit rate: 1 hit out of 3 advisor traces
    assert.equal(m.summary.cache_hit_rate, 1 / 3);
    // Latency: g1 = 2000-1000 = 1000; g2 = 3500-3000 = 500; g3 = 4100-4000 = 100 → avg = 533.33
    assert.equal(Math.round(m.summary.avg_latency_ms), 533);
    // total_cost_usd: sum over all traces via pricing.input=1 & pricing.output=2 per million
    // (100+0+200 + 50+80 + 30) / 1M * 1 = 460e-6 ; output: (40+0+80 + 20+40 + 10)*2 / 1M = 380e-6
    // total = 840e-6 = 0.00084
    assert.ok(m.summary.total_cost_usd !== null);
    assert.ok(Math.abs((m.summary.total_cost_usd as number) - 0.00084) < 1e-9);
    // total_usage layer sums (advisor + aggregator; passthrough not in the layered rollup)
    assert.equal(m.summary.total_usage.advisor.input_tokens, 100 + 0 + 50);
    assert.equal(m.summary.total_usage.aggregator.input_tokens, 200 + 80);
    assert.equal(m.summary.total_usage.judge.input_tokens, 0);

    // per_turn — 3 rows, sorted by started_at DESC → g3 (4000) > g2 (3000) > g1 (1000)
    assert.equal(m.per_turn.length, 3);
    assert.equal(m.per_turn[0]!.gateway_request_id, g3);
    assert.equal(m.per_turn[2]!.gateway_request_id, g1);

    // by_role — should have 3 entries
    const roles = m.by_role.map((r) => r.role).sort();
    assert.deepEqual(roles, ['advisor', 'aggregator', 'passthrough']);

    // cache_hit_by_model — advisor rows should have rate reflecting the hit
    const advA = m.cache_hit_by_model.find(
      (e) => e.selected_model === 'adv-a' && e.role === 'advisor',
    );
    assert.ok(advA);
    assert.equal(advA!.total_count, 2);
    assert.equal(advA!.hit_count, 0);
    const advB = m.cache_hit_by_model.find(
      (e) => e.selected_model === 'adv-b' && e.role === 'advisor',
    );
    assert.ok(advB);
    assert.equal(advB!.hit_count, 1);
  });
});

describe('computeMetrics — window filter', () => {
  it('last_24h excludes old traces', () => {
    const now = 10_000_000;
    // Old trace outside 24h
    saveTraceRequest(baseTrace({ started_at: now - 25 * 60 * 60 * 1000 }));
    // Fresh trace
    saveTraceRequest(baseTrace({ started_at: now - 60 * 1000 }));
    const m = computeMetrics('last_24h', 32, now);
    assert.equal(m.summary.request_count, 1);
  });
});

describe('computeMetrics — cost null semantics', () => {
  it('null total_cost_usd when a trace with usage has no pricing', () => {
    saveTraceRequest(baseTrace({
      pricing: null,
      usage: { input_tokens: 10, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 5, reasoning_tokens: 0 },
    }));
    const m = computeMetrics('all', 32);
    assert.equal(m.summary.total_cost_usd, null);
  });

  it('zero total_cost_usd when all traces have no usage AND no pricing', () => {
    saveTraceRequest(baseTrace({
      pricing: null,
      usage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 0, reasoning_tokens: 0 },
    }));
    const m = computeMetrics('all', 32);
    assert.equal(m.summary.total_cost_usd, 0);
  });
});

describe('HTTP /api/metrics', () => {
  it('400 when window invalid', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/metrics?window=bogus' });
    assert.equal(res.statusCode, 400);
  });

  it('200 with default window=all when unspecified', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as MetricsResponse;
    assert.equal(body.window, 'all');
    assert.equal(body.summary.request_count, 0);
  });
});
