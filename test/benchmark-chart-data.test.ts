import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeBenchmarkRows } from '../web/src/lib/benchmark-data.js';
import { perBenchmark as mockBenchmarkRows } from '../web/src/mock/benchmarks.js';

const expected = [{
  bench: 'Academic',
  momScore: 75.9281,
  aggScore: 62.8275,
  flagshipScore: 65.659,
  momCost: 5.460141,
  aggCost: 1.138145,
  flagshipCost: 67.806673,
}];

describe('normalizeBenchmarkRows', () => {
  it('converts API/JSON snake_case rows to chart camelCase rows', () => {
    const rows = [{
      bench: 'Academic',
      mom_score: 75.9281,
      agg_score: 62.8275,
      flagship_score: 65.659,
      mom_cost: 5.460141,
      agg_cost: 1.138145,
      flagship_cost: 67.806673,
    }];

    assert.deepEqual(normalizeBenchmarkRows(rows), expected);
  });

  it('accepts existing mock camelCase rows unchanged', () => {
    assert.deepEqual(normalizeBenchmarkRows(mockBenchmarkRows), mockBenchmarkRows);
  });
});
