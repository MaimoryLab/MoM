import type { Usage } from '../types/anthropic.js';
import type {
  Logger,
  ModelPricing,
  PricingSnapshot,
  TraceUsage,
} from '../types/mom.js';

const MILLION = 1_000_000;

function nonNegativeInt(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export function snapshotPricing(
  model: string,
  pricingTable: Record<string, ModelPricing>,
  source: string,
): PricingSnapshot | null {
  const rate = pricingTable[model];
  if (!rate) return null;
  return {
    currency: rate.currency,
    input_per_million: rate.input,
    cache_read_per_million: rate.cache_read,
    cache_write_per_million: rate.cache_write,
    output_per_million: rate.output,
    reasoning_per_million: null,
    source,
  };
}

export function toTraceUsage(usage: Usage): TraceUsage {
  return {
    input_tokens: nonNegativeInt(usage.input_tokens),
    cache_read_tokens: nonNegativeInt(usage.cache_read_input_tokens),
    cache_creation_tokens: nonNegativeInt(usage.cache_creation_input_tokens),
    output_tokens: nonNegativeInt(usage.output_tokens),
    reasoning_tokens: 0,
  };
}

export function calculateCostFromSnapshot(
  usage: TraceUsage,
  pricing: PricingSnapshot | null,
): number {
  if (!pricing) return 0;
  const cacheReadPerM = pricing.cache_read_per_million ?? 0;
  const reasoningPerM = pricing.reasoning_per_million ?? 0;
  return (
    (usage.input_tokens * pricing.input_per_million +
      usage.cache_read_tokens * cacheReadPerM +
      usage.cache_creation_tokens * pricing.cache_write_per_million +
      usage.output_tokens * pricing.output_per_million +
      usage.reasoning_tokens * reasoningPerM) /
    MILLION
  );
}

export function calculateCost(
  model: string,
  usage: Usage,
  pricingTable: Record<string, ModelPricing>,
  log?: Logger,
): number {
  const rate = pricingTable[model];
  if (!rate) {
    log?.warn(
      { event: 'pricing_missing', model },
      `no pricing entry for model "${model}" — counting cost as 0`,
    );
    return 0;
  }
  const input = nonNegativeInt(usage.input_tokens);
  const output = nonNegativeInt(usage.output_tokens);
  const cacheWrite = nonNegativeInt(usage.cache_creation_input_tokens);
  const cacheRead = nonNegativeInt(usage.cache_read_input_tokens);
  return (
    (input * rate.input +
      output * rate.output +
      cacheWrite * rate.cache_write +
      cacheRead * rate.cache_read) /
    MILLION
  );
}

export function sumUsage(usages: readonly Usage[]): Usage {
  const out: Usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  for (const u of usages) {
    out.input_tokens += nonNegativeInt(u.input_tokens);
    out.output_tokens += nonNegativeInt(u.output_tokens);
    out.cache_creation_input_tokens =
      (out.cache_creation_input_tokens ?? 0) +
      nonNegativeInt(u.cache_creation_input_tokens);
    out.cache_read_input_tokens =
      (out.cache_read_input_tokens ?? 0) +
      nonNegativeInt(u.cache_read_input_tokens);
  }
  return out;
}
