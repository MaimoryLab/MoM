// Dashboard API client — types + typed fetch wrappers.
//
// Phase 4 delivery boundary: this file exists so Phase 5.1 can replace
// `mock/*` imports one page at a time. Pages currently DO NOT import from
// here — the mock imports stay put. See decisions/008.
//
// Type definitions are duplicated from `src/types/dashboard-api.ts` (backend
// source of truth). Duplication is deliberate: web/ tsconfig `include` is
// scoped to `src/`, and pulling backend types across the workspace boundary
// requires either project references or symlink glue that this MVP does not
// need. If the contract changes on either side, keep both mirrors in sync.

// ---------------- Shared response types ----------------

export type MoMMode = 'off' | 'always' | 'auto';
export type FanoutMode = 'off' | 'user_turn' | 'per_iteration';
export type AggregationMode = 'concat' | 'judge';
export type AuthStyle = 'bearer' | 'x-api-key';
export type CacheTTLPreset = '5m' | '1h';

export interface ModelPricing {
  currency: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface MoMConfig {
  mom_mode: MoMMode;
  fanout_mode: FanoutMode;
  aggregation_mode: AggregationMode;
  reference_max_tokens: number;
  advisor: { slots: string[]; system_prompt?: string; tools_enabled: boolean };
  aggregator: { model: string };
  judge: { model: string; system_prompt?: string };
  cache: { ttl: CacheTTLPreset; max_entries: number };
  comparison: { enabled: boolean; baseline_model: string };
  pricing_table: Record<string, ModelPricing>;
  cost_tradeoff: { enabled: boolean };
}

export interface ProviderPublic {
  base_url: string;
  auth_style: AuthStyle;
  api_key_masked: string;
}

export interface ConfigResponse {
  mom: MoMConfig;
  provider: ProviderPublic;
  mom_config_source: string;
}

export interface SaveConfigResponse {
  mom: MoMConfig;
  mom_config_source: string;
}

export type TraceRole = 'advisor' | 'aggregator' | 'passthrough';
export type TraceStatus = 'success' | 'error' | 'cache_hit';
export type TriggerReason =
  | 'mom_off'
  | 'fanout_cache_off'
  | 'user_turn'
  | 'skipped_tool_iteration'
  | 'tool_iteration_cache_miss'
  | 'per_iteration'
  | 'fanout_cache_hit';

export interface TraceUsage {
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
}

export interface PricingSnapshot {
  currency: string;
  input_per_million: number;
  cache_read_per_million: number | null;
  cache_write_per_million: number;
  output_per_million: number;
  reasoning_per_million: number | null;
  source: string;
}

export interface TraceError {
  type: 'provider_error' | 'gateway_error' | 'advisor_error' | 'aggregator_error';
  message: string;
  http_status: number | null;
}

export interface TraceSummary {
  request_id: string;
  session_id: string | null;
  gateway_request_id: string;
  role: TraceRole;
  client_model: string;
  selected_model: string;
  provider: string;
  started_at: number;
  finished_at: number;
  duration_ms: number;
  status: TraceStatus;
  trigger_reason: TriggerReason;
  cache_hit: boolean;
  usage: TraceUsage;
  pricing: PricingSnapshot | null;
  error: TraceError | null;
}

// Full trace shape as returned by GET /api/traces/:request_id and by-gateway.
// Kept intentionally close to backend TraceRequest but without settings_snapshot's
// nested MoMConfig re-declaration — treat as an opaque object at this boundary.
export interface TraceRequestFull extends TraceSummary {
  request_summary: {
    max_tokens: number;
    temperature: number | null;
    stream: boolean;
    message_count: number;
    tool_use_count: number;
  };
  response_summary: {
    id: string | null;
    stop_reason: string | null;
    stop_sequence: string | null;
  } | null;
  settings_snapshot: unknown;
  /** Full text of the provider response (ISS-035). null on old rows / errors / cache_hit. */
  response_text?: string | null;
  /** For aggregator rows: byte-exact references text appended to the last user message. */
  references_appended?: string | null;
  /** Last user-message text on the incoming request. */
  last_user_text?: string | null;
}

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
  requests: TraceRequestFull[];
}

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

// ---------------- Client ----------------

export class ApiError extends Error {
  constructor(
    public status: number,
    public errorType: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return new ApiError(res.status, 'gateway_error', `HTTP ${res.status}`);
  }
  const envelope = body as
    | { type?: string; error?: { type?: string; message?: string } }
    | undefined;
  return new ApiError(
    res.status,
    envelope?.error?.type ?? 'gateway_error',
    envelope?.error?.message ?? `HTTP ${res.status}`,
  );
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'GET' });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

// ---------------- Wrappers ----------------

export function getConfig(): Promise<ConfigResponse> {
  return apiGet('/api/config');
}

export function saveConfig(mom: MoMConfig): Promise<SaveConfigResponse> {
  return apiPost('/api/config', { mom });
}

export function listTraces(query: TracesListQuery = {}): Promise<TracesListResponse> {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  if (query.role) params.set('role', query.role);
  if (query.status) params.set('status', query.status);
  if (query.gateway_request_id)
    params.set('gateway_request_id', query.gateway_request_id);
  const qs = params.toString();
  return apiGet(`/api/traces${qs ? `?${qs}` : ''}`);
}

export function getTrace(requestId: string): Promise<TraceRequestFull> {
  return apiGet(`/api/traces/${encodeURIComponent(requestId)}`);
}

export function getTracesByGateway(
  gatewayRequestId: string,
): Promise<TraceByGatewayResponse> {
  return apiGet(
    `/api/traces/by-gateway/${encodeURIComponent(gatewayRequestId)}`,
  );
}

export function getMetrics(
  window: MetricsWindow = 'all',
  limit?: number,
): Promise<MetricsResponse> {
  const params = new URLSearchParams({ window });
  if (limit != null) params.set('limit', String(limit));
  return apiGet(`/api/metrics?${params.toString()}`);
}

export function getBenchmarks(): Promise<BenchmarksResponse> {
  return apiGet('/api/benchmarks');
}

// ---------------- Phase 6 / ISS-035: Live Compare types + async job client ----------------

export type ComparisonStatus =
  | 'pending'
  | 'mom_done'
  | 'baseline_done'
  | 'judge_done'
  | 'error';

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

export interface LiveRunRequest {
  prompt: string;
  baseline_on: boolean;
  lang: 'zh' | 'en';
}

/** POST /api/live/run returns 202 with the freshly-minted gateway id. */
export interface LiveRunSubmitResponse {
  gateway_request_id: string;
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

export interface ComparisonResponse {
  gateway_request_id: string;
  session_id: string | null;
  lang: 'zh' | 'en';
  prompt: string;
  status: ComparisonStatus;
  started_at: number;
  updated_at: number;
  advisors_snapshot: string[] | null;
  aggregator_model: string | null;
  baseline_model_snapshot: string | null;
  mom: ComparisonMomSnapshot | null;
  mom_error: { message: string } | null;
  baseline: ComparisonBaselineSnapshot | null;
  baseline_error: { message: string } | null;
  judge: ComparisonJudgeSnapshot | null;
  judge_error: { message: string } | null;
}

/** GET /api/comparisons list item. */
export interface ComparisonListItem {
  gateway_request_id: string;
  lang: 'zh' | 'en';
  prompt: string;
  status: ComparisonStatus;
  started_at: number;
  updated_at: number;
  aggregator_model: string | null;
  baseline_model_snapshot: string | null;
}

export interface ComparisonListResponse {
  items: ComparisonListItem[];
  total: number;
  limit: number;
}

export interface PresetEntry {
  id: string;
  title_zh: string;
  title_en: string;
  zh: string;
  en: string;
}

export interface PresetsResponse {
  presets: PresetEntry[];
}

/**
 * Terminal statuses the frontend should stop polling on.
 * `judge_done` = full success. `baseline_done` = mom+baseline done but judge skipped/failed.
 * `error` = mom pipeline itself failed.
 */
export function isTerminalStatus(s: ComparisonStatus): boolean {
  return s === 'judge_done' || s === 'error';
}

export function getComparison(gwId: string): Promise<ComparisonResponse> {
  return apiGet(`/api/comparison/${encodeURIComponent(gwId)}`);
}

export function listComparisons(limit = 20): Promise<ComparisonListResponse> {
  return apiGet(`/api/comparisons?limit=${limit}`);
}

export function getPresets(): Promise<PresetsResponse> {
  return apiGet('/api/presets');
}

/**
 * POST /api/live/run — fire-and-return-id. Actual work runs on the server in
 * the background; callers poll `getComparison(gwId)` for status.
 */
export function submitLiveRun(body: LiveRunRequest): Promise<LiveRunSubmitResponse> {
  return apiPost('/api/live/run', body);
}

