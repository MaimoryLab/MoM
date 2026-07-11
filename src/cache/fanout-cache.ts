import type { AdvisorResult, CacheTTLPreset } from '../types/mom.js';

export interface FanoutCache {
  get(key: string): AdvisorResult[] | undefined;
  set(key: string, value: AdvisorResult[]): void;
  delete(key: string): void;
  size(): number;
  clear(): void;
}

interface Entry {
  value: AdvisorResult[];
  expires_at: number;
}

const TTL_TABLE: Record<CacheTTLPreset, number> = {
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

export function parseTTL(preset: CacheTTLPreset): number {
  return TTL_TABLE[preset];
}

export interface CreateFanoutCacheOptions {
  max_entries: number;
  ttl_ms: number;
  now?: () => number;
}

export function createFanoutCache(opts: CreateFanoutCacheOptions): FanoutCache {
  const max = Math.max(1, opts.max_entries);
  const ttl = opts.ttl_ms;
  const now = opts.now ?? (() => Date.now());
  const store = new Map<string, Entry>();

  function isExpired(entry: Entry): boolean {
    return entry.expires_at <= now();
  }

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (isExpired(entry)) {
        store.delete(key);
        return undefined;
      }
      // LRU: 触碰即刷新插入顺序
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      if (store.has(key)) store.delete(key);
      store.set(key, { value, expires_at: now() + ttl });
      while (store.size > max) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
    delete(key) {
      store.delete(key);
    },
    size() {
      return store.size;
    },
    clear() {
      store.clear();
    },
  };
}

export function cloneAsCacheHit(results: AdvisorResult[]): AdvisorResult[] {
  const consumedAt = Date.now();
  return results.map((r) => ({
    slot: r.slot,
    success: r.success,
    reference: r.reference,
    usage: { input_tokens: 0, output_tokens: 0 },
    latency_ms: 0,
    cache_hit: true,
    started_at: consumedAt,
    finished_at: consumedAt,
    selected_model: r.selected_model,
    response_summary: null,
    error: r.error,
  }));
}
