import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Usage } from '../src/types/anthropic.js';
import type { ModelPricing, PricingSnapshot } from '../src/types/mom.js';
import {
  calculateCostFromSnapshot,
  snapshotPricing,
  toTraceUsage,
} from '../src/cost/pricing.js';

const TABLE: Record<string, ModelPricing> = {
  'model-a': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
};

describe('snapshotPricing', () => {
  it('deep-copies pricing entry and stamps source', () => {
    const snap = snapshotPricing('model-a', TABLE, 'mom.config.json@t');
    assert.ok(snap);
    assert.equal(snap.currency, 'USD');
    assert.equal(snap.input_per_million, 3);
    assert.equal(snap.output_per_million, 15);
    assert.equal(snap.cache_write_per_million, 3.75);
    assert.equal(snap.cache_read_per_million, 0.3);
    assert.equal(snap.reasoning_per_million, null);
    assert.equal(snap.source, 'mom.config.json@t');
  });

  it('returns null when model missing from pricing table', () => {
    assert.equal(snapshotPricing('unknown', TABLE, 'src'), null);
  });

  it('mutating the returned snapshot does not affect the table', () => {
    const snap = snapshotPricing('model-a', TABLE, 'src')!;
    snap.input_per_million = 999;
    assert.equal(TABLE['model-a']!.input, 3);
  });
});

describe('toTraceUsage', () => {
  it('maps Anthropic Usage to TraceUsage with cache split and reasoning=0', () => {
    const usage: Usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 20,
    };
    const trace = toTraceUsage(usage);
    assert.equal(trace.input_tokens, 100);
    assert.equal(trace.output_tokens, 50);
    assert.equal(trace.cache_creation_tokens, 30);
    assert.equal(trace.cache_read_tokens, 20);
    assert.equal(trace.reasoning_tokens, 0);
  });

  it('normalizes missing / negative / NaN values to zero', () => {
    const trace = toTraceUsage({
      input_tokens: -5,
      output_tokens: Number.NaN,
    } as unknown as Usage);
    assert.equal(trace.input_tokens, 0);
    assert.equal(trace.output_tokens, 0);
    assert.equal(trace.cache_creation_tokens, 0);
    assert.equal(trace.cache_read_tokens, 0);
    assert.equal(trace.reasoning_tokens, 0);
  });
});

describe('calculateCostFromSnapshot', () => {
  it('sums all five components divided by 1M', () => {
    const pricing: PricingSnapshot = {
      currency: 'USD',
      input_per_million: 10,
      cache_read_per_million: 1,
      cache_write_per_million: 12,
      output_per_million: 40,
      reasoning_per_million: 25,
      source: 't',
    };
    const cost = calculateCostFromSnapshot(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
        cache_creation_tokens: 1_000_000,
        reasoning_tokens: 1_000_000,
      },
      pricing,
    );
    // 10 + 40 + 1 + 12 + 25 = 88
    assert.equal(cost, 88);
  });

  it('treats null cache_read / reasoning per-million as zero', () => {
    const pricing: PricingSnapshot = {
      currency: 'USD',
      input_per_million: 10,
      cache_read_per_million: null,
      cache_write_per_million: 12,
      output_per_million: 40,
      reasoning_per_million: null,
      source: 't',
    };
    const cost = calculateCostFromSnapshot(
      {
        input_tokens: 100,
        output_tokens: 100,
        cache_read_tokens: 100,
        cache_creation_tokens: 100,
        reasoning_tokens: 100,
      },
      pricing,
    );
    // (100*10 + 100*40 + 100*0 + 100*12 + 100*0) / 1_000_000
    assert.equal(cost, (1000 + 4000 + 1200) / 1_000_000);
  });

  it('returns 0 when pricing is null', () => {
    const cost = calculateCostFromSnapshot(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        reasoning_tokens: 0,
      },
      null,
    );
    assert.equal(cost, 0);
  });
});
