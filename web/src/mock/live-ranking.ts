// Ranking placeholder — Phase 7. Seeded by gateway_request_id so each new
// Live Run reshuffles all 10 turns while keeping visuals stable within a run.
// MoM is biased toward rank 1/2; the other two shuffle across remaining slots.
// Replaced by real 3-way judge scoring in Phase 8-02.

import { mulberry32, hashSeed, weightedPick } from '../lib/rankSeed';

export type RankRow = {
  turn: number;
  labelZh: string;
  labelEn: string;
  mom: 1 | 2 | 3;
  aggregatorOnly: 1 | 2 | 3;
  flagship: 1 | 2 | 3;
};

const TURN_LABELS: Array<{ zh: string; en: string }> = [
  { zh: 'Python 类型标注',   en: 'Python typing question' },
  { zh: 'SQL 窗口函数',      en: 'SQL window function' },
  { zh: 'Go context 取消',   en: 'Go context cancel' },
  { zh: 'K8s pod 驱逐',      en: 'K8s pod eviction' },
  { zh: 'gRPC vs REST',      en: 'gRPC vs REST' },
  { zh: 'Rust 生命周期',     en: 'Rust lifetime error' },
  { zh: 'Kafka 消费延迟',    en: 'Kafka consumer lag' },
  { zh: 'React memo 陷阱',   en: 'React memo pitfall' },
  { zh: 'TLS 握手排查',      en: 'TLS handshake trace' },
  { zh: '当前 Run',          en: 'Current run' },
];

export function getRankingSeries(seed: string): RankRow[] {
  const rng = mulberry32(hashSeed(seed || 'preview'));
  return TURN_LABELS.map((label, i) => {
    const momRank = weightedPick(rng(), [
      { value: 1 as 1 | 2 | 3, weight: 0.7 },
      { value: 2 as 1 | 2 | 3, weight: 0.3 },
    ]);
    const remaining: Array<1 | 2 | 3> = ([1, 2, 3] as Array<1 | 2 | 3>).filter((r) => r !== momRank);
    const aggFirst = rng() < 0.5;
    const aggregatorOnly = aggFirst ? remaining[0] : remaining[1];
    const flagship = aggFirst ? remaining[1] : remaining[0];
    return {
      turn: i + 1,
      labelZh: label.zh,
      labelEn: label.en,
      mom: momRank,
      aggregatorOnly,
      flagship,
    };
  });
}
