import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerBenchmarksAPI,
  loadBenchmarksFromDisk,
  normalizeBenchmarks,
} from '../src/dashboard-api/benchmarks-api.js';
import type { BenchmarksResponse } from '../src/types/dashboard-api.js';

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mom-bench-api-'));
});
after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const VALID = {
  hero_stats: {
    score_of_flagship_pct: 96,
    cost_savings_vs_flagship_pct: 68,
    latency_delta_sec: 1.2,
  },
  pareto_data: [
    { id: 'mom', label_key: 'momComposite', score: 82.4, cost: 5.6, is_mom: true },
    { id: 'agg', label_key: 'aggregatorOnly', score: 71.1, cost: 3.0 },
  ],
  pareto_frontier: [{ score: 68.7, cost: 2.2 }],
  per_benchmark: [
    {
      bench: 'MMLU',
      mom_score: 84.2,
      agg_score: 74.6,
      flagship_score: 87.8,
      mom_cost: 0.006,
      agg_cost: 0.003,
      flagship_cost: 0.018,
    },
  ],
};

async function makeApp(path: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerBenchmarksAPI(app, { benchmarksPath: path });
  await app.ready();
  return app;
}

describe('normalizeBenchmarks', () => {
  it('accepts a fully valid file', () => {
    const parsed = normalizeBenchmarks(VALID);
    assert.equal(parsed.hero_stats?.score_of_flagship_pct, 96);
    assert.equal(parsed.pareto_data.length, 2);
    assert.equal(parsed.pareto_data[0]!.is_mom, true);
    assert.equal(parsed.pareto_data[1]!.is_mom, undefined);
  });

  it('accepts hero_stats: null', () => {
    const parsed = normalizeBenchmarks({ ...VALID, hero_stats: null });
    assert.equal(parsed.hero_stats, null);
  });

  it('rejects hero_stats missing latency_delta_sec', () => {
    assert.throws(() => normalizeBenchmarks({
      ...VALID,
      hero_stats: { score_of_flagship_pct: 1, cost_savings_vs_flagship_pct: 1 },
    }));
  });

  it('rejects pareto_data with non-string id', () => {
    assert.throws(() => normalizeBenchmarks({
      ...VALID,
      pareto_data: [{ id: 42, label_key: 'x', score: 1, cost: 1 }],
    }));
  });
});

describe('loadBenchmarksFromDisk', () => {
  it('returns empty response when file missing (ENOENT)', () => {
    const missing = join(tmpDir, 'missing.json');
    const result = loadBenchmarksFromDisk(missing);
    assert.deepEqual(result, {
      hero_stats: null,
      pareto_data: [],
      pareto_frontier: [],
      per_benchmark: [],
    });
  });

  it('parses a valid file', () => {
    const path = join(tmpDir, 'valid.json');
    writeFileSync(path, JSON.stringify(VALID), 'utf8');
    const result = loadBenchmarksFromDisk(path);
    assert.equal(result.hero_stats?.cost_savings_vs_flagship_pct, 68);
  });

  it('throws on malformed JSON', () => {
    const path = join(tmpDir, 'malformed.json');
    writeFileSync(path, '{ not json', 'utf8');
    assert.throws(() => loadBenchmarksFromDisk(path));
  });
});

describe('HTTP /api/benchmarks', () => {
  it('200 with empty response when file missing', async () => {
    const app = await makeApp(join(tmpDir, 'nope.json'));
    try {
      const res = await app.inject({ method: 'GET', url: '/api/benchmarks' });
      assert.equal(res.statusCode, 200);
      const body = res.json() as BenchmarksResponse;
      assert.equal(body.hero_stats, null);
      assert.deepEqual(body.pareto_data, []);
    } finally {
      await app.close();
    }
  });

  it('200 with data when file present', async () => {
    const path = join(tmpDir, 'present.json');
    writeFileSync(path, JSON.stringify(VALID), 'utf8');
    const app = await makeApp(path);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/benchmarks' });
      assert.equal(res.statusCode, 200);
      const body = res.json() as BenchmarksResponse;
      assert.equal(body.hero_stats?.score_of_flagship_pct, 96);
      assert.equal(body.pareto_data.length, 2);
    } finally {
      await app.close();
    }
  });

  it('500 with internal_error when file malformed', async () => {
    const path = join(tmpDir, 'bad.json');
    writeFileSync(path, '{ garbage', 'utf8');
    const app = await makeApp(path);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/benchmarks' });
      assert.equal(res.statusCode, 500);
      const body = res.json() as any;
      assert.equal(body.error.type, 'internal_error');
    } finally {
      await app.close();
    }
  });
});
