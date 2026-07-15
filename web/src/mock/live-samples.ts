// Live compare page presets — bilingual prompt library only.
//
// Phase 6 note: the mock MoM / Baseline / Judge scripts that used to live
// here (ISS-028 / ISS-029) retired when Live went full-stack (ISS-033).
// LivePage now fires a real /api/live/run and consumes SSE events; the only
// mock role left is "pre-canned prompts a demo host can click to run".

import type { Lang } from '../i18n/dict';

export type PresetKey = 'binarySearch' | 'cap' | 'refactor' | 'race' | 'urlShort';

// Kept exported so RankingChart / JudgeRadar can keep their types; scored by
// the real judge model at runtime and re-shaped into the same 5-dim struct.
export type JudgeScores = {
  correctness: number;
  completeness: number;
  depth: number;
  clarity: number;
  usefulness: number;
};

// Preset id → { zh prompt, en prompt }. Prompt text is what actually gets
// sent to /api/live/run when the user clicks a preset button. Titles for the
// buttons come from `i18n/dict.ts:presets` — same key set as PRESET_ORDER.
const PROMPTS: Record<PresetKey, { zh: string; en: string }> = {
  binarySearch: {
    zh: '用 Rust 写一个泛型 binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize>，加一段文档注释，并指出一个边界情况。',
    en: 'Write a generic Rust `binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize>`. Include a doc comment and call out one edge case.',
  },
  cap: {
    zh: '用 200 字以内向一位中级后端工程师解释 CAP 定理，每个 trade-off 举一个具体例子。',
    en: 'In under 200 words, explain the CAP theorem to a mid-level backend engineer. Give one concrete example per trade-off.',
  },
  refactor: {
    zh: '重构这段 Python 代码提高可读性并补上类型标注。def f(x,y,z):\n  r=[]\n  for i in range(len(x)):\n    if x[i]>y: r.append(x[i]*z)\n  return r',
    en: 'Refactor this Python for readability and add type hints:\ndef f(x,y,z):\n  r=[]\n  for i in range(len(x)):\n    if x[i]>y: r.append(x[i]*z)\n  return r',
  },
  race: {
    zh: '一个 Node.js worker 偶尔把同一条消息写两遍到 Redis。fan-out 队列有 N 个消费者，列出 3 个最可能的根因，以及各自的验证方式。',
    en: 'A Node.js worker occasionally writes the same message to Redis twice. The fan-out queue has N consumers. List the 3 most likely root causes and how to verify each.',
  },
  urlShort: {
    zh: '设计一个每秒处理 5k 写请求的短链服务，覆盖 ID 方案、存储、缓存，以及一个可能的故障模式。',
    en: 'Design a URL shortener that handles 5k writes per second. Cover ID scheme, storage, caching, and one likely failure mode.',
  },
};

export const PRESET_ORDER: PresetKey[] = ['binarySearch', 'cap', 'refactor', 'race', 'urlShort'];

export function getPresetPrompt(preset: PresetKey, lang: Lang): string {
  return PROMPTS[preset][lang];
}
