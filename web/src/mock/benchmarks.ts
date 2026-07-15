// Benchmark fixtures for Overview page.
// Numbers are intentionally *plausible*, not maximal:
// - MoM ≈ 96% of Fable 5 (not equal, not above)
// - MoM cost ≈ 32% of Fable 5 (the headline "-68%" savings)
// This lets us swap in real benchmark results later without visual whiplash.

export type ParetoPoint = {
  id: string;
  labelKey: 'momComposite' | 'aggregatorOnly' | 'flagship' | 'gpt5' | 'sonnet46' | 'haiku45';
  score: number;    // avg benchmark score 0..100
  costCny: number;  // 单次典型问答的总成本(¥) — 见文件顶部口径注释
  isMoM?: boolean;
};

// Pareto data — placeholder, real numbers will be filled in from a config
// once benchmarks are actually run. Order-of-magnitude picked so:
//   - MoM sits on the frontier (higher score than Aggregator-only, lower cost
//     than Fable5 / GPT-5 / Sonnet 4.6).
//   - Haiku 4.5 and Aggregator-only anchor the low-cost/low-score end.
// Costs are ¥/次问答 (per one typical Q&A round).
export const paretoData: ParetoPoint[] = [
  { id: 'mom',        labelKey: 'momComposite',    score: 82.4, costCny: 0.020, isMoM: true },
  { id: 'aggOnly',    labelKey: 'aggregatorOnly',  score: 71.1, costCny: 0.011 },
  { id: 'fable5',     labelKey: 'flagship',        score: 85.5, costCny: 0.063 },
  { id: 'gpt5',       labelKey: 'gpt5',            score: 83.9, costCny: 0.043 },
  { id: 'sonnet46',   labelKey: 'sonnet46',        score: 78.2, costCny: 0.030 },
  { id: 'haiku45',    labelKey: 'haiku45',         score: 68.7, costCny: 0.008 },
];

// Pareto frontier polyline (drawn behind points).
// Sorted by cost asc, only points that are non-dominated.
export const paretoFrontier: Array<{ score: number; costCny: number }> = [
  { costCny: 0.008, score: 68.7 },  // haiku45
  { costCny: 0.011, score: 71.1 },  // aggOnly
  { costCny: 0.020, score: 82.4 },  // MoM
  { costCny: 0.043, score: 83.9 },  // GPT-5
  { costCny: 0.063, score: 85.5 },  // Fable5
];

export type BenchRow = {
  bench: 'MMLU' | 'HumanEval' | 'GSM8K' | 'BBH' | 'MATH' | 'GPQA';
  momScore: number;
  aggScore: number;
  flagshipScore: number;
  momCost: number;       // $ / 1k output token per-run cost estimate
  aggCost: number;
  flagshipCost: number;
};

export const perBenchmark: BenchRow[] = [
  { bench: 'MMLU',      momScore: 84.2, aggScore: 74.6, flagshipScore: 87.8, momCost: 0.006, aggCost: 0.003, flagshipCost: 0.018 },
  { bench: 'HumanEval', momScore: 87.1, aggScore: 72.3, flagshipScore: 88.5, momCost: 0.005, aggCost: 0.003, flagshipCost: 0.017 },
  { bench: 'GSM8K',     momScore: 91.3, aggScore: 78.9, flagshipScore: 93.6, momCost: 0.004, aggCost: 0.002, flagshipCost: 0.015 },
  { bench: 'BBH',       momScore: 79.5, aggScore: 65.4, flagshipScore: 82.7, momCost: 0.007, aggCost: 0.003, flagshipCost: 0.019 },
  { bench: 'MATH',      momScore: 74.8, aggScore: 61.2, flagshipScore: 79.4, momCost: 0.008, aggCost: 0.004, flagshipCost: 0.022 },
  { bench: 'GPQA',      momScore: 78.0, aggScore: 64.5, flagshipScore: 80.9, momCost: 0.006, aggCost: 0.003, flagshipCost: 0.018 },
];

// Headline numbers derived from above (kept as constants so all pages agree).
// Overview hero cards use these directly.
export const heroStats = {
  scoreOfFlagshipPct: 96,   // ~ 82.4 / 85.5
  costSavingsVsFlagshipPct: 68, // ~ 1 - 5.6/17.5
  latencyDeltaSec: 1.2,     // honest trade-off
};
