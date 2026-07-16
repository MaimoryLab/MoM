import type { Lang } from './dict';

export function formatCost(v: number, lang: Lang): string {
  // both langs use $, but zh uses no space before number
  const abs = Math.abs(v);
  const digits = abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
  const s = `¥${v.toFixed(digits)}`;
  return lang === 'zh' ? s : s;
}

export function formatPct(v: number): string {
  // v is 0..1
  return `${Math.round(v * 100)}%`;
}

export function formatLatency(ms: number, lang: Lang): string {
  if (ms >= 1000) {
    const s = (ms / 1000).toFixed(1);
    return lang === 'zh' ? `${s} 秒` : `${s}s`;
  }
  return `${Math.round(ms)}${lang === 'zh' ? ' 毫秒' : 'ms'}`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export function formatSigned(v: number, digits = 0, suffix = ''): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}${suffix}`;
}
