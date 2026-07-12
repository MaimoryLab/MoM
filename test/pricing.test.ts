import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Usage } from '../src/types/anthropic.js';
import type { ModelPricing } from '../src/types/mom.js';
import { calculateCost, sumUsage } from '../src/cost/pricing.js';

const TABLE: Record<string, ModelPricing> = {
  'model-a': { currency: 'CNY', input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'model-b': { currency: 'CNY', input: 0.5, output: 2, cache_write: 0.625, cache_read: 0.05 },
};

describe('calculateCost', () => {
  it('sums the four cost components divided by one million', () => {
    const usage: Usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    };
    const cost = calculateCost('model-a', usage, TABLE);
    // 3 + 15 + 3.75 + 0.3 = 22.05
    assert.equal(Math.round(cost * 100) / 100, 22.05);
  });

  it('handles missing cache fields as zero', () => {
    const usage: Usage = { input_tokens: 2_000_000, output_tokens: 500_000 };
    const cost = calculateCost('model-b', usage, TABLE);
    // 2 * 0.5 + 0.5 * 2 = 1 + 1 = 2
    assert.equal(cost, 2);
  });

  it('returns 0 and logs a warn when model missing from pricing table', () => {
    const warnCalls: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
    const log = {
      info: () => {},
      warn: (obj: Record<string, unknown>, msg?: string) => warnCalls.push({ obj, msg }),
      error: () => {},
    };
    const cost = calculateCost('unknown', { input_tokens: 100, output_tokens: 100 }, TABLE, log);
    assert.equal(cost, 0);
    assert.equal(warnCalls.length, 1);
    assert.equal(warnCalls[0]!.obj.event, 'pricing_missing');
    assert.equal(warnCalls[0]!.obj.model, 'unknown');
  });

  it('treats negative or NaN usage values as zero', () => {
    const usage: Usage = {
      input_tokens: -1000,
      output_tokens: Number.NaN,
    };
    const cost = calculateCost('model-a', usage, TABLE);
    assert.equal(cost, 0);
  });
});

describe('sumUsage', () => {
  it('aggregates all four fields across multiple usages', () => {
    const usages: Usage[] = [
      { input_tokens: 100, output_tokens: 50 },
      {
        input_tokens: 200,
        output_tokens: 60,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    ];
    const out = sumUsage(usages);
    assert.equal(out.input_tokens, 300);
    assert.equal(out.output_tokens, 110);
    assert.equal(out.cache_creation_input_tokens, 10);
    assert.equal(out.cache_read_input_tokens, 5);
  });

  it('returns zeros for empty input', () => {
    const out = sumUsage([]);
    assert.equal(out.input_tokens, 0);
    assert.equal(out.output_tokens, 0);
    assert.equal(out.cache_creation_input_tokens, 0);
    assert.equal(out.cache_read_input_tokens, 0);
  });
});
