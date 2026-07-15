import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  Usage,
} from './anthropic.js';

export type MoMMode = 'off' | 'always' | 'auto';
export type FanoutMode = 'off' | 'user_turn' | 'per_iteration';
export type AggregationMode = 'concat' | 'judge';
export type AuthStyle = 'bearer' | 'x-api-key';
export type CacheTTLPreset = '5m' | '1h';

export interface ModelPricing {
  /** Currency code (ISO 4217, e.g. "CNY", "USD"). Data-source attribute — the sync script writes it from `--currency`, orchestrator surfaces it verbatim on the snapshot. */
  currency: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface ProviderConfig {
  base_url: string;
  api_key: string;
  auth_style: AuthStyle;
}

export interface AdvisorSettings {
  slots: string[];
  system_prompt?: string;
  tools_enabled: boolean;
}

export interface AggregatorSettings {
  model: string;
}

export interface JudgeSettings {
  model: string;
  system_prompt?: string;
}

export interface CacheSettings {
  ttl: CacheTTLPreset;
  max_entries: number;
}

export interface ComparisonSettings {
  enabled: boolean;
  baseline_model: string;
}

export interface CostTradeoffSettings {
  enabled: boolean;
}

export interface MoMConfig {
  mom_mode: MoMMode;
  fanout_mode: FanoutMode;
  aggregation_mode: AggregationMode;
  reference_max_tokens: number;
  advisor: AdvisorSettings;
  aggregator: AggregatorSettings;
  judge: JudgeSettings;
  cache: CacheSettings;
  comparison: ComparisonSettings;
  pricing_table: Record<string, ModelPricing>;
  cost_tradeoff: CostTradeoffSettings;
}

export interface RuntimeConfig {
  provider: ProviderConfig;
  mom: MoMConfig;
  /** Human-readable pointer to the pricing source, frozen into every TraceRequest.pricing.source. */
  mom_config_source: string;
}

export interface ResponseSummary {
  id: string | null;
  stop_reason: AnthropicMessagesResponse['stop_reason'];
  stop_sequence: string | null;
}

export interface AdvisorResult {
  slot: string;
  success: boolean;
  /** Advisor's full text response — used both to build aggregator references AND
   * as `response_text` on the trace row. Same content, different consumers. */
  reference: string;
  usage: Usage;
  latency_ms: number;
  cache_hit: boolean;
  error: TraceError | null;
  started_at: number;
  finished_at: number;
  selected_model: string;
  response_summary: ResponseSummary | null;
}

export interface AggregatorResult {
  model: string;
  response: AnthropicMessagesResponse | null;
  usage: Usage;
  latency_ms: number;
  references_appended: string;
  started_at: number;
  finished_at: number;
  error: TraceError | null;
  response_summary: ResponseSummary | null;
}

/** 5-dim rubric fixed by Phase 6; keys match the frontend JudgeRadar labels. */
export interface JudgeScores {
  correctness: number;
  completeness: number;
  depth: number;
  clarity: number;
  usefulness: number;
}

/** Comparative judge (MoM vs baseline) result — Phase 6 Live page consumer. */
export interface JudgeCompareResult {
  model: string;
  raw: string;
  scores: { mom: JudgeScores; baseline: JudgeScores } | null;
  verdict_summary: string | null;
  /** True when strict JSON.parse failed but regex-extract-and-parse succeeded. */
  fallback: boolean;
  /** True when both parse paths failed — scores/verdict_summary will be null. */
  parse_error: boolean;
  /** Anonymized mapping used in the prompt; kept for post-hoc bias analysis. */
  ab_mapping: { A: 'mom' | 'baseline'; B: 'mom' | 'baseline' };
  usage: Usage;
  latency_ms: number;
  started_at: number;
  finished_at: number;
  error: TraceError | null;
}

/** Structured-integration judge result — reserved for PLAN7-01 (aggregation_mode='judge'). */
export interface JudgeResult {
  model: string;
  raw: string;
  parsed: {
    consensus?: string[];
    disagreements?: string[];
    partial_coverage?: string[];
    unique_insights?: string[];
    blind_spots?: string[];
  } | null;
  fallback: boolean;
  usage: Usage;
  latency_ms: number;
}

export interface BaselineResult {
  model: string;
  response: AnthropicMessagesResponse | null;
  text: string;
  usage: Usage;
  latency_ms: number;
  started_at: number;
  finished_at: number;
  error: TraceError | null;
}

/**
 * A single upstream HTTP call to a provider — the atomic trace record.
 *
 * MoM `always` mode: one incoming gateway request → N advisor + 1 aggregator upstream calls → N+1 TraceRequests
 * sharing the same `session_id` and `gateway_request_id`. Passthrough mode: one TraceRequest per gateway request.
 */
export interface TraceRequest {
  /** Trace record identity (uuid). */
  request_id: string;
  /** Value of `X-Session-ID` header from the incoming gateway request; null if header absent. */
  session_id: string | null;
  /** Gateway-side uuid identifying the incoming request that spawned this upstream call. */
  gateway_request_id: string;
  /** Role of this upstream call in the MoM flow. */
  role: 'advisor' | 'aggregator' | 'passthrough' | 'baseline' | 'judge';
  /** Client-side `request.model` (what eval sent to the gateway). */
  client_model: string;
  /** Model actually forwarded to provider. For advisor = slot; for aggregator = aggregator.model; for passthrough = client_model. */
  selected_model: string;
  /** Provider host (from PROVIDER_BASE_URL). */
  provider: string;
  /** Epoch ms when the upstream call started. */
  started_at: number;
  /** Epoch ms when the upstream call finished (success or error). */
  finished_at: number;
  /** finished_at - started_at (redundant convenience). */
  duration_ms: number;
  /** Terminal status of this upstream call. */
  status: 'success' | 'error' | 'cache_hit';
  /** Token usage; all zero for cache_hit records. */
  usage: TraceUsage;
  /** Pricing snapshot deep-cloned from `momConfig.pricing_table[selected_model]` at the moment of dispatch. */
  pricing: PricingSnapshot | null;
  /** Populated only when status === 'error'. */
  error: TraceError | null;
  /** Snapshot of the incoming request metadata (not the full messages array). */
  request_summary: RequestSummary;
  /** Snapshot of the provider response metadata; null for cache_hit and errors. */
  response_summary: ResponseSummary | null;
  /** Trigger reason for this upstream call — reuses Phase 3 enum. */
  trigger_reason: TriggerReason;
  /** True only for advisor + cache_hit combination. */
  cache_hit: boolean;
  /** Business-config snapshot at dispatch time (MoMConfig only — never provider secrets). */
  settings_snapshot: MoMConfig;
  /**
   * Full text of the provider's response (extracted from `text` content blocks).
   * Truncated at TRACE_TEXT_MAX_BYTES with a `…[truncated]` suffix.
   * Populated for advisor / aggregator / passthrough success rows;
   * null for error, cache_hit, and old rows written before ISS-035.
   */
  response_text: string | null;
  /**
   * Byte-exact text appended to the final `user` message before the aggregator
   * call. Only meaningful for `role === 'aggregator'`; null otherwise.
   * Same 32 KB cap as `response_text`.
   */
  references_appended: string | null;
  /**
   * Text of the last `user` message on the incoming request (concatenated
   * content-blocks). Used by Pipeline page's "User" node. Same 32 KB cap.
   */
  last_user_text: string | null;
}

/** Byte cap for text fields on TraceRequest — larger values truncated with a marker. */
export const TRACE_TEXT_MAX_BYTES = 32_768;

export interface TraceUsage {
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
}

export interface PricingSnapshot {
  /** Currency code carried through from `ModelPricing.currency` — gateway does not assume; it echoes whatever the data source declared. */
  currency: string;
  input_per_million: number;
  cache_read_per_million: number | null;
  cache_write_per_million: number;
  output_per_million: number;
  reasoning_per_million: number | null;
  /** Human-readable pointer to the pricing source, e.g. "mom.config.json@<mtime iso>". */
  source: string;
}

export type TraceErrorType =
  | 'provider_error'
  | 'gateway_error'
  | 'advisor_error'
  | 'aggregator_error'
  | 'baseline_error'
  | 'judge_error';

export interface TraceError {
  type: TraceErrorType;
  message: string;
  http_status: number | null;
}

export interface RequestSummary {
  max_tokens: number;
  temperature: number | null;
  stream: boolean;
  message_count: number;
  tool_use_count: number;
}

export interface UsageBreakdown {
  advisor: Usage;
  aggregator: Usage;
  judge: Usage;
}

export interface Metrics {
  window: string;
  request_count: number;
  mom_trigger_count: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
  total_usage: UsageBreakdown;
}

export interface FanoutCacheKey {
  raw: string;
}

export interface FanoutCacheValue {
  results: AdvisorResult[];
  created_at: number;
}

export type TriggerReason =
  | 'mom_off'
  | 'fanout_cache_off'
  | 'user_turn'
  | 'skipped_tool_iteration'
  | 'tool_iteration_cache_miss'
  | 'per_iteration'
  | 'fanout_cache_hit';

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const DEFAULT_MOM_CONFIG: MoMConfig = {
  mom_mode: 'off',
  fanout_mode: 'user_turn',
  aggregation_mode: 'concat',
  reference_max_tokens: 4096,
  advisor: {
    slots: [],
    tools_enabled: false,
  },
  aggregator: {
    model: '',
  },
  judge: {
    model: '',
  },
  cache: {
    ttl: '5m',
    max_entries: 1000,
  },
  comparison: {
    enabled: false,
    baseline_model: '',
  },
  pricing_table: {},
  cost_tradeoff: {
    enabled: false,
  },
};
