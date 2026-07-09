import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  Usage,
} from './anthropic.js';

export type MoMMode = 'off' | 'always' | 'auto';
export type FanoutMode = 'user_turn' | 'per_iteration';
export type AggregationMode = 'concat' | 'judge';
export type AuthStyle = 'bearer' | 'x-api-key';
export type CacheTTLPreset = '5m' | '1h';

export interface ModelPricing {
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
}

export interface AdvisorResult {
  slot: string;
  success: boolean;
  reference: string;
  usage: Usage;
  latency_ms: number;
  cache_hit: boolean;
  error?: string;
}

export interface AggregatorResult {
  model: string;
  response: AnthropicMessagesResponse | null;
  usage: Usage;
  latency_ms: number;
  references_appended: string;
}

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
  cost_usd: number;
}

export interface BaselineResult {
  model: string;
  response: AnthropicMessagesResponse | null;
  usage: Usage;
  latency_ms: number;
}

export interface Trace {
  id: string;
  timestamp: number;
  request: AnthropicMessagesRequest;
  response: AnthropicMessagesResponse | null;
  mom_triggered: boolean;
  trigger_reason: string;
  advisor_results: AdvisorResult[];
  aggregator_result: AggregatorResult | null;
  judge_result: JudgeResult | null;
  baseline_result: BaselineResult | null;
  total_cost_usd: number;
  baseline_cost_usd: number | null;
  total_latency_ms: number;
  settings_snapshot: RuntimeConfig;
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
  total_cost_usd: number;
  baseline_cost_usd: number;
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
