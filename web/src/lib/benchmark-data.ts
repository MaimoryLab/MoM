import type { BenchmarkRow as ApiBenchmarkRow } from './api';

export interface ChartBenchmarkRow {
  bench: string;
  momScore: number;
  aggScore: number;
  flagshipScore: number;
  momCost: number;
  aggCost: number;
  flagshipCost: number;
}

export type BenchmarkRowInput = ApiBenchmarkRow | ChartBenchmarkRow;

function isApiBenchmarkRow(row: BenchmarkRowInput): row is ApiBenchmarkRow {
  return 'mom_score' in row;
}

export function normalizeBenchmarkRows(
  rows: readonly BenchmarkRowInput[],
): ChartBenchmarkRow[] {
  return rows.map((row) => {
    if (!isApiBenchmarkRow(row)) return row;

    return {
      bench: row.bench,
      momScore: row.mom_score,
      aggScore: row.agg_score,
      flagshipScore: row.flagship_score,
      momCost: row.mom_cost,
      aggCost: row.agg_cost,
      flagshipCost: row.flagship_cost,
    };
  });
}
