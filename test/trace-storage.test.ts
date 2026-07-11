import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDB, closeDB, getDB } from '../src/storage/db.js';
import {
  getRecentTraceRequests,
  getTraceRequestById,
  getTraceRequestsBySessionId,
  saveTraceRequest,
} from '../src/storage/traces.js';
import type { TraceRequest } from '../src/types/mom.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';

const SESSION_A = '0c2c668a-c3bf-4d78-8f00-000000000001';
const SESSION_B = '0c2c668a-c3bf-4d78-8f00-000000000002';

function baseTrace(overrides: Partial<TraceRequest>): TraceRequest {
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

before(() => {
  initDB(':memory:');
});
after(() => closeDB());
beforeEach(() => {
  getDB().exec('DELETE FROM traces');
});

describe('saveTraceRequest / getTraceRequestById', () => {
  it('round-trips a trace record', () => {
    const trace = baseTrace({ session_id: SESSION_A });
    saveTraceRequest(trace);
    const loaded = getTraceRequestById(trace.request_id);
    assert.deepEqual(loaded, trace);
  });

  it('returns null for unknown request_id', () => {
    assert.equal(getTraceRequestById('does-not-exist'), null);
  });
});

describe('getTraceRequestsBySessionId', () => {
  it('returns all traces for a session in started_at ascending order', () => {
    const t3 = baseTrace({
      session_id: SESSION_A,
      role: 'aggregator',
      started_at: 3000,
      finished_at: 3100,
    });
    const t1 = baseTrace({
      session_id: SESSION_A,
      role: 'advisor',
      selected_model: 'adv-a',
      started_at: 1000,
      finished_at: 1050,
    });
    const t2 = baseTrace({
      session_id: SESSION_A,
      role: 'advisor',
      selected_model: 'adv-b',
      started_at: 2000,
      finished_at: 2050,
    });
    // insert out of order to exercise sort
    saveTraceRequest(t3);
    saveTraceRequest(t1);
    saveTraceRequest(t2);

    const list = getTraceRequestsBySessionId(SESSION_A);
    assert.equal(list.length, 3);
    assert.deepEqual(
      list.map((t) => t.request_id),
      [t1.request_id, t2.request_id, t3.request_id],
    );
    assert.deepEqual(
      list.map((t) => t.role),
      ['advisor', 'advisor', 'aggregator'],
    );
  });

  it('returns [] for a session with no traces (never 404)', () => {
    saveTraceRequest(baseTrace({ session_id: SESSION_B }));
    const list = getTraceRequestsBySessionId(SESSION_A);
    assert.deepEqual(list, []);
  });

  it('excludes traces with session_id = null', () => {
    saveTraceRequest(baseTrace({ session_id: null }));
    saveTraceRequest(baseTrace({ session_id: null }));
    assert.deepEqual(getTraceRequestsBySessionId(SESSION_A), []);
  });

  it('isolates one session from another', () => {
    const a = baseTrace({ session_id: SESSION_A });
    const b = baseTrace({ session_id: SESSION_B });
    saveTraceRequest(a);
    saveTraceRequest(b);
    const listA = getTraceRequestsBySessionId(SESSION_A);
    const listB = getTraceRequestsBySessionId(SESSION_B);
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
    assert.equal(listA[0]!.request_id, a.request_id);
    assert.equal(listB[0]!.request_id, b.request_id);
  });
});

describe('getRecentTraceRequests', () => {
  it('returns traces in started_at descending order up to limit', () => {
    const t1 = baseTrace({ started_at: 1000 });
    const t2 = baseTrace({ started_at: 2000 });
    const t3 = baseTrace({ started_at: 3000 });
    saveTraceRequest(t1);
    saveTraceRequest(t2);
    saveTraceRequest(t3);
    const list = getRecentTraceRequests(2);
    assert.deepEqual(
      list.map((t) => t.request_id),
      [t3.request_id, t2.request_id],
    );
  });
});
