import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { initDB, closeDB, getDB } from '../src/storage/db.js';
import { saveTraceRequest } from '../src/storage/traces.js';
import { registerTracesAPI } from '../src/dashboard-api/traces-api.js';
import { DEFAULT_MOM_CONFIG, type TraceRequest } from '../src/types/mom.js';
import type { TracesListResponse, TraceSummary } from '../src/types/dashboard-api.js';

function baseTrace(overrides: Partial<TraceRequest> = {}): TraceRequest {
  return {
    request_id: randomUUID(),
    session_id: null,
    gateway_request_id: randomUUID(),
    role: 'aggregator',
    client_model: 'modeless:auto',
    selected_model: 'agg-x',
    provider: 'apiproxy.paigod.work',
    started_at: 1000,
    finished_at: 1500,
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

let app: FastifyInstance;

before(async () => {
  initDB(':memory:');
  app = Fastify({ logger: false });
  registerTracesAPI(app);
  await app.ready();
});
after(async () => {
  await app.close();
  closeDB();
});
beforeEach(() => {
  getDB().exec('DELETE FROM traces');
});

describe('GET /api/traces', () => {
  it('200 with empty items + total=0 when table is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/traces' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as TracesListResponse;
    assert.deepEqual(body, { items: [], total: 0, limit: 100, offset: 0 });
  });

  it('returns TraceSummary without settings_snapshot / request_summary', async () => {
    saveTraceRequest(baseTrace());
    const res = await app.inject({ method: 'GET', url: '/api/traces' });
    const body = res.json() as TracesListResponse;
    assert.equal(body.items.length, 1);
    const summary = body.items[0]!;
    assert.ok(!('settings_snapshot' in summary), 'summary should not include settings_snapshot');
    assert.ok(!('request_summary' in summary), 'summary should not include request_summary');
    assert.ok(!('response_summary' in summary), 'summary should not include response_summary');
    // Fields we DO expect:
    assert.equal(typeof summary.request_id, 'string');
    assert.equal(typeof summary.gateway_request_id, 'string');
    assert.equal(summary.role, 'aggregator');
    assert.equal(summary.cache_hit, false);
    assert.deepEqual(summary.usage, {
      input_tokens: 100,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      output_tokens: 50,
      reasoning_tokens: 0,
    });
  });

  it('sorts by started_at DESC', async () => {
    const a = baseTrace({ started_at: 1000 });
    const b = baseTrace({ started_at: 2000 });
    const c = baseTrace({ started_at: 3000 });
    saveTraceRequest(a);
    saveTraceRequest(b);
    saveTraceRequest(c);
    const res = await app.inject({ method: 'GET', url: '/api/traces' });
    const body = res.json() as TracesListResponse;
    assert.deepEqual(
      body.items.map((s: TraceSummary) => s.request_id),
      [c.request_id, b.request_id, a.request_id],
    );
  });

  it('applies limit + offset', async () => {
    for (let i = 0; i < 5; i++) saveTraceRequest(baseTrace({ started_at: 1000 + i }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/traces?limit=2&offset=1',
    });
    const body = res.json() as TracesListResponse;
    assert.equal(body.items.length, 2);
    assert.equal(body.total, 5);
    assert.equal(body.limit, 2);
    assert.equal(body.offset, 1);
  });

  it('filters by role', async () => {
    saveTraceRequest(baseTrace({ role: 'advisor', selected_model: 'a1' }));
    saveTraceRequest(baseTrace({ role: 'aggregator', selected_model: 'agg' }));
    saveTraceRequest(baseTrace({ role: 'passthrough', selected_model: 'p' }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/traces?role=advisor',
    });
    const body = res.json() as TracesListResponse;
    assert.equal(body.items.length, 1);
    assert.equal(body.total, 1);
    assert.equal(body.items[0]!.role, 'advisor');
  });

  it('filters by gateway_request_id', async () => {
    const gid = randomUUID();
    saveTraceRequest(baseTrace({ gateway_request_id: gid, role: 'advisor' }));
    saveTraceRequest(baseTrace({ gateway_request_id: gid, role: 'aggregator' }));
    saveTraceRequest(baseTrace({ gateway_request_id: randomUUID() }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/traces?gateway_request_id=${gid}`,
    });
    const body = res.json() as TracesListResponse;
    assert.equal(body.items.length, 2);
    assert.equal(body.total, 2);
    for (const it of body.items) assert.equal(it.gateway_request_id, gid);
  });

  it('400 for invalid role', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/traces?role=quantumdrive',
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('GET /api/traces/:request_id', () => {
  it('200 with full TraceRequest including settings_snapshot', async () => {
    const t = baseTrace();
    saveTraceRequest(t);
    const res = await app.inject({ method: 'GET', url: `/api/traces/${t.request_id}` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as TraceRequest;
    assert.equal(body.request_id, t.request_id);
    assert.ok('settings_snapshot' in body);
    assert.ok('request_summary' in body);
  });

  it('404 when id does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/traces/does-not-exist',
    });
    assert.equal(res.statusCode, 404);
    const body = res.json() as any;
    assert.equal(body.error.type, 'not_found');
  });
});

describe('GET /api/traces/by-gateway/:gateway_request_id', () => {
  it('200 with empty array when no traces (not 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/traces/by-gateway/${randomUUID()}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { gateway_request_id: string; requests: TraceRequest[] };
    assert.deepEqual(body.requests, []);
  });

  it('returns full TraceRequest[] sorted by started_at ASC', async () => {
    const gid = randomUUID();
    const t2 = baseTrace({ gateway_request_id: gid, role: 'aggregator', started_at: 2000 });
    const t1 = baseTrace({ gateway_request_id: gid, role: 'advisor', started_at: 1000 });
    const t3 = baseTrace({ gateway_request_id: gid, role: 'advisor', started_at: 3000 });
    // Insert out of order
    saveTraceRequest(t2);
    saveTraceRequest(t1);
    saveTraceRequest(t3);
    // Also insert an unrelated trace
    saveTraceRequest(baseTrace({ gateway_request_id: randomUUID() }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/traces/by-gateway/${gid}`,
    });
    const body = res.json() as { gateway_request_id: string; requests: TraceRequest[] };
    assert.equal(body.requests.length, 3);
    assert.deepEqual(
      body.requests.map((r) => r.request_id),
      [t1.request_id, t2.request_id, t3.request_id],
    );
  });
});
