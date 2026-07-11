import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { initDB, closeDB } from '../src/storage/db.js';
import { registerTraceAPI } from '../src/gateway/trace-api.js';

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

async function inject(sessionId: string): Promise<number> {
  const res = await app.inject({
    method: 'GET',
    url: `/trace/requests?session_id=${sessionId}`,
  });
  return res.statusCode;
}

describe('GET /trace/requests UUID acceptance', () => {
  it('accepts a UUIDv7 (time-ordered) session id', async () => {
    // v7 has version-nibble 7 and variant nibble 8-b — the old [1-5] regex rejected it.
    assert.equal(await inject('018f6dd0-0000-7abc-8def-000000000001'), 200);
  });

  it('accepts a UUIDv6 session id', async () => {
    assert.equal(await inject('018f6dd0-0000-6abc-8def-000000000001'), 200);
  });

  it('accepts the NIL UUID', async () => {
    assert.equal(await inject('00000000-0000-0000-0000-000000000000'), 200);
  });

  it('accepts an all-f UUID (max)', async () => {
    assert.equal(await inject('ffffffff-ffff-ffff-ffff-ffffffffffff'), 200);
  });

  it('rejects non-hex characters as invalid', async () => {
    assert.equal(await inject('zzzzzzzz-0000-0000-0000-000000000000'), 400);
  });

  it('rejects wrong hyphenation as invalid', async () => {
    assert.equal(await inject('0000000000000000000000000000000000000'), 400);
  });
});
