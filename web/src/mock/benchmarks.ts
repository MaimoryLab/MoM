// Benchmark fixtures for Overview page.
// Numbers are intentionally *plausible*, not maximal:
// - MoM ≈ 96% of Fable 5 (not equal, not above)
// - MoM cost ≈ 32% of Fable 5 (the headline "-68%" savings)
// This lets us swap in real benchmark results later without visual whiplash.

export type ParetoPoint = {
  id: string;
  labelKey: 'momComposite' | 'aggregatorOnly' | 'flagship' | 'gpt5' | 'sonnet46' | 'haiku45';
  score: number;   // avg benchmark score 0..100
  cost: number;    // $ / 1M output token
  isMoM?: boolean;
};

export const paretoData: ParetoPoint[] = [
  { id: 'mom',        labelKey: 'momComposite',    score: 82.4, cost: 5.6,  isMoM: true },
  { id: 'aggOnly',    labelKey: 'aggregatorOnly',  score: 71.1, cost: 3.0  },
  { id: 'fable5',     labelKey: 'flagship',        score: 85.5, cost: 17.5 },
  { id: 'gpt5',       labelKey: 'gpt5',            score: 83.9, cost: 12.0 },
  { id: 'sonnet46',   labelKey: 'sonnet46',        score: 78.2, cost: 8.4  },
  { id: 'haiku45',    labelKey: 'haiku45',         score: 68.7, cost: 2.2  },
];

// Pareto frontier polyline (drawn behind points).
// Sorted by cost asc, only points that are non-dominated.
export const paretoFrontier: Array<{ score: number; cost: number }> = [
  { cost: 2.2,  score: 68.7 },  // haiku45
  { cost: 3.0,  score: 71.1 },  // aggOnly
  { cost: 5.6,  score: 82.4 },  // MoM
  { cost: 12.0, score: 83.9 },  // GPT-5
  { cost: 17.5, score: 85.5 },  // Fable5
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
