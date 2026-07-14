import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDB } from '../storage/db.js';
import { calculateCostFromSnapshot } from '../cost/pricing.js';
import type { TraceRequest, TraceUsage } from '../types/mom.js';
import type {
  ByRoleRow,
  CacheHitByModelRow,
  MetricsResponse,
  MetricsSummary,
  MetricsUsageLayer,
  MetricsWindow,
  PerTurnRow,
  TimelineRow,
  TraceRole,
} from '../types/dashboard-api.js';

const VALID_WINDOWS: MetricsWindow[] = ['last_24h', 'last_7d', 'all'];
const DEFAULT_LIMIT = 32;
const MAX_LIMIT = 500;

interface Query {
  window?: string;
  limit?: string;
}

interface Row {
  data: string;
}

function windowFilter(window: MetricsWindow, now: number): { clause: string; params: number[] } {
  if (window === 'last_24h') {
    return { clause: 'WHERE started_at > ?', params: [now - 24 * 60 * 60 * 1000] };
  }
  if (window === 'last_7d') {
    return { clause: 'WHERE started_at > ?', params: [now - 7 * 24 * 60 * 60 * 1000] };
  }
  return { clause: '', params: [] };
}

function emptyLayer(): MetricsUsageLayer {
  return {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
  };
}

function addLayer(a: MetricsUsageLayer, u: TraceUsage): void {
  a.input_tokens += u.input_tokens;
  a.cache_read_tokens += u.cache_read_tokens;
  a.cache_creation_tokens += u.cache_creation_tokens;
  a.output_tokens += u.output_tokens;
  a.reasoning_tokens += u.reasoning_tokens;
}

function parsePositiveInt(v: string | undefined, fallback: number, max: number): number {
  if (typeof v !== 'string' || v.length === 0) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n <= 0) return NaN;
  return Math.min(n, max);
}

export interface ComputedMetrics extends MetricsResponse {}

// Pure function so unit tests can drive it without HTTP.
export function computeMetrics(
  window: MetricsWindow,
  limit: number,
  now: number = Date.now(),
): ComputedMetrics {
  const { clause, params } = windowFilter(window, now);
  const rows = getDB()
    .prepare(`SELECT data FROM traces ${clause}`)
    .all(...params) as unknown as Row[];
  const traces = rows.map((r) => JSON.parse(r.data) as TraceRequest);

  // Group by gateway_request_id
  const byGateway = new Map<string, TraceRequest[]>();
  for (const t of traces) {
    const arr = byGateway.get(t.gateway_request_id) ?? [];
    arr.push(t);
    byGateway.set(t.gateway_request_id, arr);
  }

  // Summary: request_count / mom_trigger_count / avg_latency / cache_hit_rate
  let momTriggerCount = 0;
  let totalGatewayLatency = 0;
  const requestCount = byGateway.size;

  for (const [, arr] of byGateway) {
    const anyMoMTrigger = arr.some(
      (t) => t.trigger_reason !== 'mom_off',
    );
    if (anyMoMTrigger) momTriggerCount++;
    const minStart = Math.min(...arr.map((t) => t.started_at));
    const maxFinish = Math.max(...arr.map((t) => t.finished_at));
    totalGatewayLatency += Math.max(0, maxFinish - minStart);
  }
  const avgLatencyMs = requestCount > 0 ? totalGatewayLatency / requestCount : 0;
  const momTriggerRate = requestCount > 0 ? momTriggerCount / requestCount : 0;

  // Advisor cache_hit_rate
  const advisorTraces = traces.filter((t) => t.role === 'advisor');
  const advisorHitCount = advisorTraces.filter((t) => t.cache_hit).length;
  const cacheHitRate =
    advisorTraces.length > 0 ? advisorHitCount / advisorTraces.length : 0;

  // total_usage by role
  const totalUsage = {
    advisor: emptyLayer(),
    aggregator: emptyLayer(),
    judge: emptyLayer(),
  };
  for (const t of traces) {
    if (t.role === 'advisor') addLayer(totalUsage.advisor, t.usage);
    else if (t.role === 'aggregator') addLayer(totalUsage.aggregator, t.usage);
    // passthrough is not part of the layered MoM usage rollup;
    // judge stays zero until Phase 6 introduces the role.
  }

  // total_cost_usd — sum across all traces, tracking whether any pricing was null
  // If every trace with usage has a pricing snapshot, we return a real number.
  // If ANY trace with non-zero usage lacks pricing, we return null (honest about
  // "we don't know the true total"). This mirrors PricingSnapshot's per-request
  // null semantics — see decision 008 known-cost #2.
  let totalCost = 0;
  let costIsNull = false;
  for (const t of traces) {
    if (t.pricing) {
      totalCost += calculateCostFromSnapshot(t.usage, t.pricing);
      continue;
    }
    const usageIsZero =
      t.usage.input_tokens === 0 &&
      t.usage.output_tokens === 0 &&
      t.usage.cache_read_tokens === 0 &&
      t.usage.cache_creation_tokens === 0;
    if (!usageIsZero) {
      costIsNull = true;
    }
  }

  const summary: MetricsSummary = {
    request_count: requestCount,
    mom_trigger_count: momTriggerCount,
    mom_trigger_rate: momTriggerRate,
    avg_latency_ms: avgLatencyMs,
    total_cost_usd: costIsNull ? null : totalCost,
    total_baseline_cost_usd: null, // Phase 6
    cache_hit_rate: cacheHitRate,
    total_usage: totalUsage,
  };

  // per_turn — 1 row per gateway_request_id, sorted by min(started_at) DESC
  const perTurnAll: PerTurnRow[] = [];
  for (const [gid, arr] of byGateway) {
    const minStart = Math.min(...arr.map((t) => t.started_at));
    const maxFinish = Math.max(...arr.map((t) => t.finished_at));
    let advisorCost = 0;
    let aggregatorCost = 0;
    let turnCostNull = false;
    for (const t of arr) {
      if (!t.pricing) {
        const usageZero =
          t.usage.input_tokens === 0 && t.usage.output_tokens === 0;
        if (!usageZero) turnCostNull = true;
        continue;
      }
      const c = calculateCostFromSnapshot(t.usage, t.pricing);
      if (t.role === 'advisor') advisorCost += c;
      else if (t.role === 'aggregator') aggregatorCost += c;
    }
    const totalCostTurn = turnCostNull ? null : advisorCost + aggregatorCost;
    perTurnAll.push({
      gateway_request_id: gid,
      started_at: minStart,
      total_cost_usd: totalCostTurn,
      advisor_cost_usd: turnCostNull ? null : advisorCost,
      aggregator_cost_usd: turnCostNull ? null : aggregatorCost,
      total_latency_ms: Math.max(0, maxFinish - minStart),
      trigger_reason: pickTriggerReason(arr),
    });
  }
  perTurnAll.sort((a, b) => b.started_at - a.started_at);
  const perTurn = perTurnAll.slice(0, limit);

  // by_role — cost + request count grouped by role
  const byRoleMap = new Map<TraceRole, { cost: number; count: number; hasNull: boolean }>();
  for (const t of traces) {
    const entry =
      byRoleMap.get(t.role) ?? { cost: 0, count: 0, hasNull: false };
    entry.count++;
    if (!t.pricing) {
      const usageZero =
        t.usage.input_tokens === 0 && t.usage.output_tokens === 0;
      if (!usageZero) entry.hasNull = true;
    } else {
      entry.cost += calculateCostFromSnapshot(t.usage, t.pricing);
    }
    byRoleMap.set(t.role, entry);
  }
  const byRole: ByRoleRow[] = [];
  for (const [role, entry] of byRoleMap) {
    byRole.push({
      role,
      cost_usd: entry.hasNull ? null : entry.cost,
      request_count: entry.count,
    });
  }

  // cache_hit_by_model — group by (selected_model, role)
  const cacheHitMap = new Map<
    string,
    { selected_model: string; role: TraceRole; hit: number; total: number }
  >();
  for (const t of traces) {
    const key = `${t.role}::${t.selected_model}`;
    const entry =
      cacheHitMap.get(key) ??
      { selected_model: t.selected_model, role: t.role, hit: 0, total: 0 };
    entry.total++;
    if (t.cache_hit) entry.hit++;
    cacheHitMap.set(key, entry);
  }
  const cacheHitByModel: CacheHitByModelRow[] = [...cacheHitMap.values()].map(
    (e) => ({
      selected_model: e.selected_model,
      role: e.role,
      hit_count: e.hit,
      total_count: e.total,
      rate: e.total > 0 ? e.hit / e.total : 0,
    }),
  );

  // timeline — same as perTurnAll but sorted ASC and only cost + started_at
  const timelineAll = perTurnAll
    .slice()
    .sort((a, b) => a.started_at - b.started_at);
  const timeline: TimelineRow[] = timelineAll.slice(0, limit).map((r) => ({
    gateway_request_id: r.gateway_request_id,
    started_at: r.started_at,
    cost_usd: r.total_cost_usd,
  }));

  return {
    window,
    summary,
    per_turn: perTurn,
    by_role: byRole,
    cache_hit_by_model: cacheHitByModel,
    timeline,
  };
}

// Pick a representative trigger reason for the gateway request: the first
// non-passthrough / non-mom_off reason if any (informative for Cost page), else
// whatever the first trace reported.
function pickTriggerReason(arr: TraceRequest[]): TraceRequest['trigger_reason'] {
  const informative = arr.find(
    (t) => t.trigger_reason !== 'mom_off' && t.trigger_reason !== 'fanout_cache_off',
  );
  return (informative ?? arr[0]!).trigger_reason;
}

function badRequest(reply: FastifyReply, message: string): void {
  reply.code(400).send({
    type: 'error',
    error: { type: 'invalid_request_error', message },
  });
}

export function registerMetricsAPI(app: FastifyInstance): void {
  app.get('/api/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Query;
    const windowRaw = typeof q.window === 'string' && q.window.length > 0 ? q.window : 'all';
    if (!VALID_WINDOWS.includes(windowRaw as MetricsWindow)) {
      badRequest(
        reply,
        `query "window" must be one of ${VALID_WINDOWS.join('|')}`,
      );
      return;
    }
    const window = windowRaw as MetricsWindow;
    const limit = parsePositiveInt(q.limit, DEFAULT_LIMIT, MAX_LIMIT);
    if (Number.isNaN(limit)) {
      badRequest(reply, 'query "limit" must be a positive integer');
      return;
    }
    try {
      const response = computeMetrics(window, limit);
      reply.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'metrics_compute_failed', error: message },
        'metrics compute failed',
      );
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message },
      });
    }
  });
}
