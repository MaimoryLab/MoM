import type { JudgeScores } from '../types/mom.js';

export interface JudgeCompareParsed {
  a: JudgeScores;
  b: JudgeScores;
  verdict_summary: string | null;
  /** True when strict JSON.parse failed but regex-extract-and-parse succeeded. */
  fallback: boolean;
}

const DIM_KEYS: (keyof JudgeScores)[] = [
  'correctness',
  'completeness',
  'depth',
  'clarity',
  'usefulness',
];

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pickScores(obj: Record<string, unknown> | null): JudgeScores | null {
  if (!obj) return null;
  const out: Partial<JudgeScores> = {};
  for (const k of DIM_KEYS) {
    const raw = obj[k];
    if (!isNum(raw)) return null;
    out[k] = clampScore(raw);
  }
  return out as JudgeScores;
}

function toRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function fromParsedObject(
  parsed: unknown,
): { a: JudgeScores; b: JudgeScores; verdict: string | null } | null {
  const root = toRecord(parsed);
  if (!root) return null;
  const a = pickScores(toRecord(root.response_a));
  const b = pickScores(toRecord(root.response_b));
  if (!a || !b) return null;
  const rawVerdict = root.verdict_summary;
  const verdict = typeof rawVerdict === 'string' ? rawVerdict : null;
  return { a, b, verdict };
}

/**
 * Parse a judge-compare response. Two-stage:
 *   1. Strict `JSON.parse` on the trimmed raw string.
 *   2. If (1) fails or shape mismatches, extract the first `{...}` block via
 *      regex and parse that.
 * Returns null if both paths fail.
 */
export function parseJudgeCompare(raw: string): JudgeCompareParsed | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\n?/i, '').replace(/```$/i, '').trim();

  // Path 1: strict.
  try {
    const strict = fromParsedObject(JSON.parse(trimmed));
    if (strict) {
      return {
        a: strict.a,
        b: strict.b,
        verdict_summary: strict.verdict,
        fallback: false,
      };
    }
  } catch {
    /* fall through */
  }

  // Path 2: regex-extract first {...} block, greedy so nested objects survive.
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const extracted = fromParsedObject(JSON.parse(match[0]));
    if (extracted) {
      return {
        a: extracted.a,
        b: extracted.b,
        verdict_summary: extracted.verdict,
        fallback: true,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}
