import type { AnthropicMessage } from '../types/anthropic.js';
import type { AdvisorResult, MoMConfig, ProviderConfig } from '../types/mom.js';
import { runAdvisor } from '../advisor/advisor-runtime.js';
import type { FanoutCache } from '../cache/fanout-cache.js';
import { cloneAsCacheHit } from '../cache/fanout-cache.js';

const DEFAULT_FANOUT_CONCURRENCY = 8;

export async function promisePool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  async function run(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  }

  const runners: Promise<void>[] = [];
  for (let i = 0; i < width; i++) runners.push(run());
  await Promise.all(runners);
  return results;
}

export async function fanoutAdvisors(
  messages: AnthropicMessage[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
): Promise<AdvisorResult[]> {
  return promisePool(momConfig.advisor.slots, DEFAULT_FANOUT_CONCURRENCY, (slot) =>
    runAdvisor(slot, messages, momConfig, provider),
  );
}

export interface FanoutWithCacheResult {
  results: AdvisorResult[];
  cache_hit: boolean;
}

export async function fanoutAdvisorsWithCache(
  messages: AnthropicMessage[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
  cache: FanoutCache,
  key: string,
): Promise<FanoutWithCacheResult> {
  if (momConfig.fanout_mode === 'off') {
    return {
      results: await fanoutAdvisors(messages, momConfig, provider),
      cache_hit: false,
    };
  }
  const cached = cache.get(key);
  if (cached) {
    return { results: cloneAsCacheHit(cached), cache_hit: true };
  }
  const results = await fanoutAdvisors(messages, momConfig, provider);
  cache.set(key, results);
  return { results, cache_hit: false };
}
