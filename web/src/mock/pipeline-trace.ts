// Pipeline page fixture — one canned turn describing the fan-out.
// Timing values (ms) drive the animation state machine.

import type { Lang } from '../i18n/dict';

export type PipelineNode = {
  id: 'user' | 'advisorA' | 'advisorB' | 'advisorC' | 'assembly' | 'aggregator' | 'final';
  startMs: number;   // when this node becomes active relative to Run
  endMs: number;     // when the streaming preview completes
  cacheHit?: boolean;
};

export const pipelineTimeline: PipelineNode[] = [
  { id: 'user',       startMs:    0, endMs:   200 },
  { id: 'advisorA',   startMs:  350, endMs:  1650, cacheHit: true },
  { id: 'advisorB',   startMs:  350, endMs:  2100 },
  { id: 'advisorC',   startMs:  350, endMs:  1900 },
  { id: 'assembly',   startMs: 2200, endMs:  2600 },
  { id: 'aggregator', startMs: 2700, endMs:  4900 },
  { id: 'final',      startMs: 4950, endMs:  5150 },
];

export type PipelineCopy = {
  userPrompt: string;
  advisor: {
    slot: string;    // A / B / C
    model: string;
    text: string;    // preview snippet
    tokens: number;
    latencyMs: number;
    costUsd: number;
  }[];
  aggregatorModel: string;
  aggregatorPreview: string;
  finalPreview: string;
  contextBefore: string;
  contextAfter: string;
};

const EN: PipelineCopy = {
  userPrompt: 'Write a generic binary_search<T: Ord> in idiomatic Rust with an edge-case note.',
  advisor: [
    { slot: 'A', model: 'kimi-k2',       text: 'Use `lo + (hi-lo)/2` to avoid overflow on large slices.', tokens: 214, latencyMs: 780,  costUsd: 0.00021 },
    { slot: 'B', model: 'deepseek-v3',   text: 'Return `Option<usize>` per Rust idioms; document empty-slice behaviour.', tokens: 286, latencyMs: 1650, costUsd: 0.00028 },
    { slot: 'C', model: 'qwen3-72b',     text: 'Match on `Ordering` to keep the loop total; avoid `==` on generic bounds.', tokens: 198, latencyMs: 1440, costUsd: 0.00019 },
  ],
  aggregatorModel: 'claude-sonnet-4-6',
  aggregatorPreview: 'Combining the guidance: overflow-safe midpoint, Option return, Ordering-matched arms, one doc line on empty slices…',
  finalPreview: '```rust\npub fn binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize> { … }\n```',
  contextBefore: [
    '{',
    '  "role": "user",',
    '  "content": [',
    '    {',
    '      "type": "text",',
    '      "text": "Write a generic binary_search<T: Ord> in idiomatic Rust with an edge-case note."',
    '    }',
    '  ]',
    '}',
  ].join('\n'),
  contextAfter: [
    '{',
    '  "role": "user",',
    '  "content": [',
    '    {',
    '      "type": "text",',
    '      "text": "Write a generic binary_search<T: Ord> in idiomatic Rust with an edge-case note.\\n',
    '\\n',
    '<references>\\n',
    '  <ref id=\\"A\\" model=\\"kimi-k2\\">Use `lo + (hi-lo)/2` to avoid overflow…</ref>\\n',
    '  <ref id=\\"B\\" model=\\"deepseek-v3\\">Return `Option<usize>`; document empty-slice…</ref>\\n',
    '  <ref id=\\"C\\" model=\\"qwen3-72b\\">Match on `Ordering`; avoid `==` on generic bounds…</ref>\\n',
    '</references>"',
    '    }',
    '  ]',
    '}',
  ].join('\n'),
};

const ZH: PipelineCopy = {
  userPrompt: '用 Rust 写一个泛型 binary_search<T: Ord>，代码要地道，并指出一个边界情况。',
  advisor: [
    { slot: 'A', model: 'kimi-k2',     text: '用 `lo + (hi-lo)/2` 避免大切片上的溢出。', tokens: 214, latencyMs: 780,  costUsd: 0.00021 },
    { slot: 'B', model: 'deepseek-v3', text: '按 Rust 风格返回 `Option<usize>`，文档里写清楚空切片的行为。', tokens: 286, latencyMs: 1650, costUsd: 0.00028 },
    { slot: 'C', model: 'qwen3-72b',   text: '用 `Ordering` 三路匹配，别在泛型约束上用 `==`。', tokens: 198, latencyMs: 1440, costUsd: 0.00019 },
  ],
  aggregatorModel: 'claude-sonnet-4-6',
  aggregatorPreview: '综合建议：不溢出的中点、Option 返回、Ordering 三路匹配、一句关于空切片的文档说明……',
  finalPreview: '```rust\npub fn binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize> { … }\n```',
  contextBefore: [
    '{',
    '  "role": "user",',
    '  "content": [',
    '    {',
    '      "type": "text",',
    '      "text": "用 Rust 写一个泛型 binary_search<T: Ord>，代码要地道，并指出一个边界情况。"',
    '    }',
    '  ]',
    '}',
  ].join('\n'),
  contextAfter: [
    '{',
    '  "role": "user",',
    '  "content": [',
    '    {',
    '      "type": "text",',
    '      "text": "用 Rust 写一个泛型 binary_search<T: Ord>，代码要地道，并指出一个边界情况。\\n',
    '\\n',
    '<references>\\n',
    '  <ref id=\\"A\\" model=\\"kimi-k2\\">用 `lo + (hi-lo)/2` 避免溢出……</ref>\\n',
    '  <ref id=\\"B\\" model=\\"deepseek-v3\\">按 Rust 风格返回 `Option<usize>`……</ref>\\n',
    '  <ref id=\\"C\\" model=\\"qwen3-72b\\">用 `Ordering` 三路匹配……</ref>\\n',
    '</references>"',
    '    }',
    '  ]',
    '}',
  ].join('\n'),
};

export function getPipelineCopy(lang: Lang): PipelineCopy {
  return lang === 'zh' ? ZH : EN;
}
