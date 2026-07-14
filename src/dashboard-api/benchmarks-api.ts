import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import type {
  BenchmarksResponse,
  BenchmarkRow,
  HeroStats,
  ParetoFrontierPoint,
  ParetoPoint,
} from '../types/dashboard-api.js';

const EMPTY_RESPONSE: BenchmarksResponse = {
  hero_stats: null,
  pareto_data: [],
  pareto_frontier: [],
  per_benchmark: [],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

// Non-throwing hero_stats validator: allow null, otherwise require all 3 numbers.
function normalizeHeroStats(v: unknown): HeroStats | null {
  if (v == null) return null;
  if (!isObject(v)) throw new Error('hero_stats must be an object or null');
  if (
    !isNumber(v.score_of_flagship_pct) ||
    !isNumber(v.cost_savings_vs_flagship_pct) ||
    !isNumber(v.latency_delta_sec)
  ) {
    throw new Error(
      'hero_stats requires numeric score_of_flagship_pct / cost_savings_vs_flagship_pct / latency_delta_sec',
    );
  }
  return {
    score_of_flagship_pct: v.score_of_flagship_pct,
    cost_savings_vs_flagship_pct: v.cost_savings_vs_flagship_pct,
    latency_delta_sec: v.latency_delta_sec,
  };
}

function normalizeParetoData(v: unknown): ParetoPoint[] {
  if (!Array.isArray(v)) throw new Error('pareto_data must be an array');
  return v.map((p, i) => {
    if (!isObject(p))
      throw new Error(`pareto_data[${i}] must be an object`);
    if (!isString(p.id)) throw new Error(`pareto_data[${i}].id must be string`);
    if (!isString(p.label_key))
      throw new Error(`pareto_data[${i}].label_key must be string`);
    if (!isNumber(p.score))
      throw new Error(`pareto_data[${i}].score must be number`);
    if (!isNumber(p.cost))
      throw new Error(`pareto_data[${i}].cost must be number`);
    const out: ParetoPoint = {
      id: p.id,
      label_key: p.label_key,
      score: p.score,
      cost: p.cost,
    };
    if (isBool(p.is_mom)) out.is_mom = p.is_mom;
    return out;
  });
}

function normalizeParetoFrontier(v: unknown): ParetoFrontierPoint[] {
  if (!Array.isArray(v)) throw new Error('pareto_frontier must be an array');
  return v.map((p, i) => {
    if (!isObject(p))
      throw new Error(`pareto_frontier[${i}] must be an object`);
    if (!isNumber(p.score) || !isNumber(p.cost))
      throw new Error(`pareto_frontier[${i}].{score,cost} must be numbers`);
    return { score: p.score, cost: p.cost };
  });
}

function normalizePerBenchmark(v: unknown): BenchmarkRow[] {
  if (!Array.isArray(v)) throw new Error('per_benchmark must be an array');
  const fields = [
    'mom_score',
    'agg_score',
    'flagship_score',
    'mom_cost',
    'agg_cost',
    'flagship_cost',
  ] as const;
  return v.map((r, i) => {
    if (!isObject(r))
      throw new Error(`per_benchmark[${i}] must be an object`);
    if (!isString(r.bench))
      throw new Error(`per_benchmark[${i}].bench must be string`);
    for (const f of fields) {
      if (!isNumber(r[f]))
        throw new Error(`per_benchmark[${i}].${f} must be number`);
    }
    return {
      bench: r.bench,
      mom_score: r.mom_score as number,
      agg_score: r.agg_score as number,
      flagship_score: r.flagship_score as number,
      mom_cost: r.mom_cost as number,
      agg_cost: r.agg_cost as number,
      flagship_cost: r.flagship_cost as number,
    };
  });
}

export function normalizeBenchmarks(raw: unknown): BenchmarksResponse {
  if (!isObject(raw)) throw new Error('benchmarks file root must be an object');
  return {
    hero_stats: normalizeHeroStats(raw.hero_stats),
    pareto_data: normalizeParetoData(raw.pareto_data),
    pareto_frontier: normalizeParetoFrontier(raw.pareto_frontier),
    per_benchmark: normalizePerBenchmark(raw.per_benchmark),
  };
}

function isNodeErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}

export function loadBenchmarksFromDisk(path: string): BenchmarksResponse {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      return EMPTY_RESPONSE;
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  return normalizeBenchmarks(parsed);
}

export interface BenchmarksAPIContext {
  benchmarksPath: string;
}

export function registerBenchmarksAPI(
  app: FastifyInstance,
  ctx: BenchmarksAPIContext,
): void {
  app.get('/api/benchmarks', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = loadBenchmarksFromDisk(ctx.benchmarksPath);
      reply.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'benchmarks_load_failed', error: message },
        'benchmarks load failed',
      );
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message },
      });
    }
  });
}
