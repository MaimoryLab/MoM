import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AdvisorResult,
  MoMConfig,
  ProviderConfig,
  Usage,
} from '../src/types/mom.js';
import type { FanoutCache } from '../src/cache/fanout-cache.js';
import {
  cloneAsCacheHit,
  createFanoutCache,
  parseTTL,
} from '../src/cache/fanout-cache.js';
import { fanoutAdvisorsWithCache } from '../src/orchestrator/fanout.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

function makeResults(slots: string[]): AdvisorResult[] {
  return slots.map((slot) => ({
    slot,
    success: true,
    reference: `analysis-${slot}`,
    usage: { input_tokens: 100, output_tokens: 50 },
    latency_ms: 250,
    cache_hit: false,
  }));
}

describe('parseTTL', () => {
  it('converts 5m to 5*60*1000 ms', () => {
    assert.equal(parseTTL('5m'), 5 * 60 * 1000);
  });
  it('converts 1h to 60*60*1000 ms', () => {
    assert.equal(parseTTL('1h'), 60 * 60 * 1000);
  });
});

describe('createFanoutCache — basic get/set', () => {
  it('returns stored value on hit', () => {
    const cache = createFanoutCache({ max_entries: 10, ttl_ms: 60_000 });
    const results = makeResults(['a']);
    cache.set('k1', results);
    const got = cache.get('k1');
    assert.deepEqual(got, results);
  });

  it('returns undefined on miss', () => {
    const cache = createFanoutCache({ max_entries: 10, ttl_ms: 60_000 });
    assert.equal(cache.get('missing'), undefined);
  });
});

describe('createFanoutCache — TTL', () => {
  it('expires entries after ttl_ms', () => {
    let now = 1000;
    const cache = createFanoutCache({ max_entries: 10, ttl_ms: 5000, now: () => now });
    cache.set('k', makeResults(['a']));
    assert.ok(cache.get('k'));
    now = 6001;
    assert.equal(cache.get('k'), undefined);
    // 过期后 size 归零（懒清）
    assert.equal(cache.size(), 0);
  });
});

describe('createFanoutCache — LRU eviction', () => {
  it('evicts the oldest entry when max_entries exceeded', () => {
    const cache = createFanoutCache({ max_entries: 3, ttl_ms: 60_000 });
    cache.set('a', makeResults(['a']));
    cache.set('b', makeResults(['b']));
    cache.set('c', makeResults(['c']));
    cache.set('d', makeResults(['d'])); // 淘汰 a
    assert.equal(cache.get('a'), undefined);
    assert.ok(cache.get('b'));
    assert.ok(cache.get('c'));
    assert.ok(cache.get('d'));
  });

  it('touch on get refreshes LRU position', () => {
    const cache = createFanoutCache({ max_entries: 3, ttl_ms: 60_000 });
    cache.set('a', makeResults(['a']));
    cache.set('b', makeResults(['b']));
    cache.set('c', makeResults(['c']));
    // 访问 a → a 现在最新
    cache.get('a');
    cache.set('d', makeResults(['d'])); // 应该淘汰 b（最老）
    assert.equal(cache.get('b'), undefined);
    assert.ok(cache.get('a'));
    assert.ok(cache.get('d'));
  });
});

describe('cloneAsCacheHit', () => {
  it('sets cache_hit=true, usage=0, latency_ms=0; preserves reference and slot', () => {
    const original = makeResults(['a']);
    const cloned = cloneAsCacheHit(original);
    assert.equal(cloned[0]!.cache_hit, true);
    assert.deepEqual(cloned[0]!.usage, EMPTY_USAGE);
    assert.equal(cloned[0]!.latency_ms, 0);
    assert.equal(cloned[0]!.reference, 'analysis-a');
    // 原对象不动
    assert.equal(original[0]!.cache_hit, false);
    assert.equal(original[0]!.usage.input_tokens, 100);
  });

  it('preserves error on failed results', () => {
    const failed: AdvisorResult[] = [
      {
        slot: 'a',
        success: false,
        reference: '',
        usage: EMPTY_USAGE,
        latency_ms: 100,
        cache_hit: false,
        error: 'boom',
      },
    ];
    const cloned = cloneAsCacheHit(failed);
    assert.equal(cloned[0]!.success, false);
    assert.equal(cloned[0]!.error, 'boom');
  });
});

describe('fanoutAdvisorsWithCache — off mode', () => {
  it('does not read or write the cache', async () => {
    const momConfig: MoMConfig = {
      ...DEFAULT_MOM_CONFIG,
      fanout_mode: 'off',
      advisor: { slots: [], tools_enabled: false },
    };
    const provider: ProviderConfig = {
      base_url: 'http://unused.test',
      api_key: 'unused',
      auth_style: 'bearer',
    };
    const cache: FanoutCache = {
      get: () => { throw new Error('cache.get must not be called'); },
      set: () => { throw new Error('cache.set must not be called'); },
      delete: () => {},
      size: () => 0,
      clear: () => {},
    };

    const result = await fanoutAdvisorsWithCache([], momConfig, provider, cache, 'unused');
    assert.deepEqual(result, { results: [], cache_hit: false });
  });
});
