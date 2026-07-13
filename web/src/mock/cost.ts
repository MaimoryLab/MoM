// Cost analytics fixtures — coherent with heroStats (-68% savings).
// Session baseline total is engineered so mom = baseline * (1 - 0.68).

export const sessionCost = {
  turnsRun: 32,
  baselineTotalUsd: 4.12,
  momTotalUsd: 1.33,   // ≈ 4.12 * 0.32
  savedPct: 68,
  avgPerTurnUsd: 0.041,
  overallCacheHitRate: 0.62,
};

export type PerTurnRow = {
  turn: number;
  advisorA: number;
  advisorB: number;
  advisorC: number;
  aggregator: number;
};

// 32 turns of MoM cost, stacked by role. Bumpy but bounded, mean ~0.041 USD.
export const perTurn: PerTurnRow[] = Array.from({ length: 32 }, (_, i) => {
  // Pseudorandom-but-deterministic pattern (no seeding lib needed)
  const noise = (n: number) => (Math.sin(n * 12.9898) * 43758.5453) % 1;
  const advisorA  = 0.006 + 0.004 * Math.abs(noise(i + 1));
  const advisorB  = 0.005 + 0.005 * Math.abs(noise(i + 7));
  const advisorC  = 0.004 + 0.003 * Math.abs(noise(i + 13));
  const aggregator = 0.018 + 0.010 * Math.abs(noise(i + 21));
  return {
    turn: i + 1,
    advisorA: +advisorA.toFixed(5),
    advisorB: +advisorB.toFixed(5),
    advisorC: +advisorC.toFixed(5),
    aggregator: +aggregator.toFixed(5),
  };
});

// Cost share by role — a role-level total for the pie.
export const byRole = [
  { role: 'advisorA',   value: perTurn.reduce((s, r) => s + r.advisorA, 0) },
  { role: 'advisorB',   value: perTurn.reduce((s, r) => s + r.advisorB, 0) },
  { role: 'advisorC',   value: perTurn.reduce((s, r) => s + r.advisorC, 0) },
  { role: 'aggregator', value: perTurn.reduce((s, r) => s + r.aggregator, 0) },
].map((r) => ({ ...r, value: +r.value.toFixed(4) }));

// Cache hit rate per model — advisor high (fan-out is cache-friendly),
// aggregator lower (last user message often invalidates last-block cache).
export const cacheHitByModel = [
  { model: 'kimi-k2 (Advisor A)',     rate: 0.82 },
  { model: 'deepseek-v3 (Advisor B)', rate: 0.71 },
  { model: 'qwen3-72b (Advisor C)',   rate: 0.55 },
  { model: 'claude-sonnet-4-6 (Aggregator)', rate: 0.34 },
];

// Cost timeline: sum of all roles per turn.
export const timeline = perTurn.map((r) => ({
  turn: r.turn,
  cost: +(r.advisorA + r.advisorB + r.advisorC + r.aggregator).toFixed(5),
}));
