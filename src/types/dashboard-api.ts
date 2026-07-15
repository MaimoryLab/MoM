import type {
  MoMConfig,
  TraceError,
  TraceRequest,
  TraceUsage,
  TriggerReason,
  PricingSnapshot,
} from './mom.js';

// GET /api/config, POST /api/config
export interface ProviderPublic {
  base_url: string;
  auth_style: 'bearer' | 'x-api-key';
  api_key_masked: string;
}

export interface ConfigResponse {
  mom: MoMConfig;
  provider: ProviderPublic;
  mom_config_source: string;
}

export interface SaveConfigRequest {
  mom: MoMConfig;
}

export interface SaveConfigResponse {
  mom: MoMConfig;
  mom_config_source: string;
}

// GET /api/traces
export interface TraceSummary {
  request_id: string;
  session_id: string | null;
  gateway_request_id: string;
  role: TraceRequest['role'];
  client_model: string;
  selected_model: string;
  provider: string;
  started_at: number;
  finished_at: number;
  duration_ms: number;
  status: TraceRequest['status'];
  trigger_reason: TriggerReason;
  cache_hit: boolean;
  usage: TraceUsage;
  pricing: PricingSnapshot | null;
  error: TraceError | null;
}

export type TraceRole = TraceRequest['role'];
export type TraceStatus = TraceRequest['status'];

export interface TracesListQuery {
  limit?: number;
  offset?: number;
  role?: TraceRole;
  status?: TraceStatus;
  gateway_request_id?: string;
}

export interface TracesListResponse {
  items: TraceSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface TraceByGatewayResponse {
  gateway_request_id: string;
  requests: TraceRequest[];
}

// GET /api/metrics
export type MetricsWindow = 'last_24h' | 'last_7d' | 'all';

export interface MetricsUsageLayer {
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
}

export interface MetricsSummary {
  request_count: number;
  mom_trigger_count: number;
  mom_trigger_rate: number;
  avg_latency_ms: number;
  total_cost_usd: number | null;
  total_baseline_cost_usd: number | null;
  cache_hit_rate: number;
  total_usage: {
    advisor: MetricsUsageLayer;
    aggregator: MetricsUsageLayer;
    judge: MetricsUsageLayer;
  };
}

export interface PerTurnRow {
  gateway_request_id: string;
  started_at: number;
  total_cost_usd: number | null;
  advisor_cost_usd: number | null;
  aggregator_cost_usd: number | null;
  total_latency_ms: number;
  trigger_reason: TriggerReason;
}

export interface ByRoleRow {
  role: TraceRole;
  cost_usd: number | null;
  request_count: number;
}

export interface CacheHitByModelRow {
  selected_model: string;
  role: TraceRole;
  hit_count: number;
  total_count: number;
  rate: number;
}

export interface TimelineRow {
  gateway_request_id: string;
  started_at: number;
  cost_usd: number | null;
}

export interface MetricsResponse {
  window: MetricsWindow;
  summary: MetricsSummary;
  per_turn: PerTurnRow[];
  by_role: ByRoleRow[];
  cache_hit_by_model: CacheHitByModelRow[];
  timeline: TimelineRow[];
}

// GET /api/benchmarks
export interface HeroStats {
  score_of_flagship_pct: number;
  cost_savings_vs_flagship_pct: number;
  latency_delta_sec: number;
}

export interface ParetoPoint {
  id: string;
  label_key: string;
  score: number;
  cost: number;
  is_mom?: boolean;
}

export interface ParetoFrontierPoint {
  score: number;
  cost: number;
}

export interface BenchmarkRow {
  bench: string;
  mom_score: number;
  agg_score: number;
  flagship_score: number;
  mom_cost: number;
  agg_cost: number;
  flagship_cost: number;
}

export interface BenchmarksResponse {
  hero_stats: HeroStats | null;
  pareto_data: ParetoPoint[];
  pareto_frontier: ParetoFrontierPoint[];
  per_benchmark: BenchmarkRow[];
}

// Shared error envelope (matches /trace/requests convention)
export interface ApiErrorEnvelope {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ---------------- POST /api/live/run — Phase 6 ----------------

export interface LiveRunRequest {
  prompt: string;
  baseline_on: boolean;
  lang: 'zh' | 'en';
}

/** 5-dim rubric shared with `src/types/mom.ts:JudgeScores`. */
export interface JudgeScoresApi {
  correctness: number;
  completeness: number;
  depth: number;
  clarity: number;
  usefulness: number;
}

export interface ComparisonUsage {
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
}

export interface ComparisonMomSnapshot {
  text: string;
  usage: ComparisonUsage;
  cost_usd: number | null;
  latency_ms: number;
}

export interface ComparisonBaselineSnapshot {
  model: string;
  text: string;
  usage: ComparisonUsage;
  cost_usd: number | null;
  latency_ms: number;
}

export interface ComparisonJudgeSnapshot {
  model: string;
  scores: { mom: JudgeScoresApi; baseline: JudgeScoresApi };
  verdict_summary: string | null;
  fallback: boolean;
}

export type ComparisonStatus =
  | 'pending'
  | 'mom_done'
  | 'baseline_done'
  | 'judge_done'
  | 'error';

/** GET /api/comparison/:gateway_request_id — one-shot snapshot. */
export interface ComparisonResponse {
  gateway_request_id: string;
  session_id: string | null;
  lang: 'zh' | 'en';
  prompt: string;
  status: ComparisonStatus;
  started_at: number;
  updated_at: number;
  mom: ComparisonMomSnapshot | null;
  baseline: ComparisonBaselineSnapshot | null;
  baseline_error: { message: string } | null;
  judge: ComparisonJudgeSnapshot | null;
  judge_error: { message: string } | null;
}

// POST /api/live/run SSE event payload types (event name = `type` here)
export type LiveRunEvent =
  | { type: 'created'; gateway_request_id: string; session_id: string }
  | { type: 'mom_delta'; text: string }
  | { type: 'mom_done'; text_full: string; usage: ComparisonUsage; cost_usd: number | null; latency_ms: number }
  | { type: 'mom_error'; message: string }
  | { type: 'baseline_done'; model: string; text: string; usage: ComparisonUsage; cost_usd: number | null; latency_ms: number }
  | { type: 'baseline_error'; message: string }
  | { type: 'judge_done'; model: string; scores: { mom: JudgeScoresApi; baseline: JudgeScoresApi }; verdict_summary: string | null; fallback: boolean }
  | { type: 'judge_error'; message: string }
  | { type: 'end'; status: ComparisonStatus };
