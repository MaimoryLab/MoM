import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { initDB, closeDB, getDB } from '../src/storage/db.js';
import { saveTraceRequest } from '../src/storage/traces.js';
import { registerTraceAPI } from '../src/gateway/trace-api.js';
import type { TraceRequest } from '../src/types/mom.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';

const SESSION = '0c2c668a-c3bf-4d78-8f00-000000000042';

function baseTrace(overrides: Partial<TraceRequest>): TraceRequest {
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
  registerTraceAPI(app);
  await app.ready();
});
after(async () => {
  await app.close();
  closeDB();
});
beforeEach(() => {
  getDB().exec('DELETE FROM traces');
});

describe('GET /trace/requests', () => {
  it('400 when session_id missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/trace/requests' });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: { type: string } };
    assert.equal(body.error.type, 'invalid_request_error');
  });

  it('400 when session_id is not a valid UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/trace/requests?session_id=not-a-uuid',
    });
    assert.equal(res.statusCode, 400);
  });

  it('200 with empty array for a session with no traces (not 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trace/requests?session_id=${SESSION}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { session_id: string; requests: TraceRequest[] };
    assert.equal(body.session_id, SESSION);
    assert.deepEqual(body.requests, []);
  });

  it('200 with traces sorted by started_at ascending', async () => {
    const t2 = baseTrace({ session_id: SESSION, started_at: 2000 });
    const t1 = baseTrace({
      session_id: SESSION,
      role: 'advisor',
      selected_model: 'adv-a',
      started_at: 1000,
    });
    const t3 = baseTrace({
      session_id: SESSION,
      role: 'advisor',
      selected_model: 'adv-b',
      started_at: 3000,
    });
    // Insert out of chronological order
    saveTraceRequest(t2);
    saveTraceRequest(t1);
    saveTraceRequest(t3);

    const res = await app.inject({
      method: 'GET',
      url: `/trace/requests?session_id=${SESSION}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { session_id: string; requests: TraceRequest[] };
    assert.equal(body.session_id, SESSION);
    assert.equal(body.requests.length, 3);
    assert.deepEqual(
      body.requests.map((r) => r.request_id),
      [t1.request_id, t2.request_id, t3.request_id],
    );
  });

  it('does not leak traces from other sessions', async () => {
    const otherSession = '0c2c668a-c3bf-4d78-8f00-000000000099';
    saveTraceRequest(baseTrace({ session_id: otherSession }));
    saveTraceRequest(baseTrace({ session_id: null }));
    saveTraceRequest(baseTrace({ session_id: SESSION }));

    const res = await app.inject({
      method: 'GET',
      url: `/trace/requests?session_id=${SESSION}`,
    });
    const body = res.json() as { requests: TraceRequest[] };
    assert.equal(body.requests.length, 1);
    assert.equal(body.requests[0]!.session_id, SESSION);
  });
});
