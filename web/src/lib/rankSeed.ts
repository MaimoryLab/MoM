// Deterministic pseudo-random helpers for the Ranking placeholder.
// Same seed → same sequence; used by getRankingSeries(gwId).

export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedPick<T>(r: number, options: Array<{ value: T; weight: number }>): T {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let acc = 0;
  const x = r * total;
  for (const opt of options) {
    acc += opt.weight;
    if (x < acc) return opt.value;
  }
  return options[options.length - 1].value;
}
