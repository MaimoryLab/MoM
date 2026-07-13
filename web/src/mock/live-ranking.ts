// Dynamic ranking fixtures for the Live Compare page.
// A rolling window of the last 10 turns; each turn stores the judge's
// relative ranking of the three modes (1 = best, 3 = worst). The chart
// on LivePage plots these three rank lines turn-by-turn — the story is
// that for an unbounded / open-ended question, absolute scores aren't
// comparable across prompts, but *relative* rank is. That's why we
// show rank, not raw score.

import type { PresetKey } from './live-samples';

export type RankRow = {
  turn: number;               // 1..10 (10 = the most recent prompt)
  labelZh: string;            // short prompt label for the tooltip
  labelEn: string;
  mom: 1 | 2 | 3;
  aggregatorOnly: 1 | 2 | 3;
  flagship: 1 | 2 | 3;
};

// Base history — 9 past prompts. Turn 10 is filled in per-preset below,
// so the tail of the chart reflects "the prompt the user is asking now".
const HISTORY: RankRow[] = [
  { turn: 1, labelEn: 'Python typing question', labelZh: 'Python 类型标注', mom: 2, aggregatorOnly: 3, flagship: 1 },
  { turn: 2, labelEn: 'SQL window function',    labelZh: 'SQL 窗口函数',     mom: 1, aggregatorOnly: 3, flagship: 2 },
  { turn: 3, labelEn: 'Go context cancel',      labelZh: 'Go context 取消',  mom: 1, aggregatorOnly: 2, flagship: 3 },
  { turn: 4, labelEn: 'K8s pod eviction',       labelZh: 'K8s pod 驱逐',     mom: 2, aggregatorOnly: 3, flagship: 1 },
  { turn: 5, labelEn: 'gRPC vs REST',           labelZh: 'gRPC vs REST',     mom: 1, aggregatorOnly: 3, flagship: 2 },
  { turn: 6, labelEn: 'Rust lifetime error',    labelZh: 'Rust 生命周期',    mom: 1, aggregatorOnly: 2, flagship: 3 },
  { turn: 7, labelEn: 'Kafka consumer lag',     labelZh: 'Kafka 消费延迟',   mom: 2, aggregatorOnly: 3, flagship: 1 },
  { turn: 8, labelEn: 'React memo pitfall',     labelZh: 'React memo 陷阱',  mom: 1, aggregatorOnly: 3, flagship: 2 },
  { turn: 9, labelEn: 'TLS handshake trace',    labelZh: 'TLS 握手排查',     mom: 2, aggregatorOnly: 3, flagship: 1 },
];

// Turn 10 comes from whichever preset the user picked on the shelf.
// Numbers are consistent with the mock/live-samples.ts judge scores
// (MoM > Baseline on every preset, aggregator-only sits below Baseline).
const CURRENT_BY_PRESET: Record<PresetKey, Omit<RankRow, 'turn'>> = {
  binarySearch: { labelEn: 'Rust binary search', labelZh: 'Rust 二分查找', mom: 1, aggregatorOnly: 3, flagship: 2 },
  cap:          { labelEn: 'CAP theorem',        labelZh: 'CAP 定理',      mom: 1, aggregatorOnly: 3, flagship: 2 },
  refactor:     { labelEn: 'Refactor snippet',   labelZh: '重构代码片段',  mom: 2, aggregatorOnly: 3, flagship: 1 },
  race:         { labelEn: 'Debug race',         labelZh: '排查竞态问题',  mom: 1, aggregatorOnly: 3, flagship: 2 },
  urlShort:     { labelEn: 'URL shortener',      labelZh: '设计短链服务',  mom: 1, aggregatorOnly: 3, flagship: 2 },
};

export function getRankingSeries(preset: PresetKey): RankRow[] {
  return [...HISTORY, { turn: 10, ...CURRENT_BY_PRESET[preset] }];
}
