// Live compare page fixtures — bilingual scripted "runs" per preset prompt.
// Each preset has:
//   - MoM final answer (long-form)
//   - Baseline final answer (long-form; intentionally slightly less nuanced)
//   - Judge scores across 5 dimensions (MoM > Baseline by a modest margin)
//   - cost / latency / token counts
//   - 3 advisor preview snippets (short, for the Pipeline preview cards)

import type { Lang } from '../i18n/dict';

export type PresetKey = 'binarySearch' | 'cap' | 'refactor' | 'race' | 'urlShort';

export type JudgeScores = {
  correctness: number;
  completeness: number;
  depth: number;
  clarity: number;
  usefulness: number;
};

export type LiveSample = {
  mom: {
    text: string;
    tokens: number;
    latencyMs: number;
    costUsd: number;
    advisorPreviews: [string, string, string]; // short snippets for Pipeline
  };
  baseline: {
    text: string;
    tokens: number;
    latencyMs: number;
    costUsd: number;
  };
  judge: {
    mom: JudgeScores;
    baseline: JudgeScores;
  };
};

// Placeholder content used until specific presets fill in. Kept separate so
// unimplemented presets still render something sensible.
const PLACEHOLDER_EN =
  'This is a preview placeholder response. In a real turn, the aggregator would fold in each advisor’s guidance before answering.';
const PLACEHOLDER_ZH =
  '这是预览版占位内容。真实调用时，aggregator 会先综合三个 advisor 的建议再作答。';

// ---------------- English samples ----------------

const EN_SAMPLES: Record<PresetKey, LiveSample> = {
  binarySearch: {
    mom: {
      text: [
        '```rust',
        '/// Binary search over a sorted slice. Returns Some(index) on hit, None otherwise.',
        '///',
        '/// Edge case: on an empty slice the loop condition is false immediately, so we',
        '/// return None without ever indexing — no panic path.',
        'pub fn binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize> {',
        '    let (mut lo, mut hi) = (0usize, slice.len());',
        '    while lo < hi {',
        '        let mid = lo + (hi - lo) / 2; // overflow-safe midpoint',
        '        match slice[mid].cmp(target) {',
        '            std::cmp::Ordering::Less    => lo = mid + 1,',
        '            std::cmp::Ordering::Greater => hi = mid,',
        '            std::cmp::Ordering::Equal   => return Some(mid),',
        '        }',
        '    }',
        '    None',
        '}',
        '```',
      ].join('\n'),
      tokens: 1180,
      latencyMs: 3400,
      costUsd: 0.0081,
      advisorPreviews: [
        'Use `(lo+hi)/2` — but that overflows on huge slices; prefer `lo + (hi-lo)/2`.',
        'Return `Option<usize>` per Rust idioms; std’s slice::binary_search returns Result but we match the signature the caller asked for.',
        'Add a doc comment noting empty-slice behaviour explicitly — reviewers ask for it every time.',
      ],
    },
    baseline: {
      text: [
        '```rust',
        'pub fn binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize> {',
        '    let mut lo = 0;',
        '    let mut hi = slice.len();',
        '    while lo < hi {',
        '        let mid = (lo + hi) / 2;',
        '        if &slice[mid] == target { return Some(mid); }',
        '        else if &slice[mid] < target { lo = mid + 1; }',
        '        else { hi = mid; }',
        '    }',
        '    None',
        '}',
        '```',
      ].join('\n'),
      tokens: 720,
      latencyMs: 2100,
      costUsd: 0.0243,
    },
    judge: {
      mom:      { correctness: 92, completeness: 88, depth: 84, clarity: 90, usefulness: 89 },
      baseline: { correctness: 84, completeness: 68, depth: 62, clarity: 78, usefulness: 74 },
    },
  },

  cap: {
    mom: {
      text: [
        'CAP says that under a network partition (P), a distributed system must choose between availability (A) and consistency (C). "P" isn’t optional in practice — networks fail — so CAP is really a run-time choice between AP and CP when a partition happens.',
        '',
        '• CP example: a leader-based DB (e.g. etcd) will refuse writes on the minority side of a partition rather than diverge. You keep consistency; the minority side is unavailable.',
        '• AP example: Cassandra with quorum-relaxed writes keeps accepting both sides; you get availability, but readers may see stale or conflicting values until reconciliation.',
        '• "CA" example (no partition): a single-node Postgres. Fine in theory, but a single node is not a distributed system.',
        '',
        'Practical takeaway: pick AP for stuff where "eventually right" is fine (metrics, feeds); pick CP for stuff where "wrong is worse than down" (payments, inventory).',
      ].join('\n'),
      tokens: 780,
      latencyMs: 3100,
      costUsd: 0.0064,
      advisorPreviews: [
        'Nail the "P is not optional" framing first — juniors miss it.',
        'One concrete DB per branch (etcd for CP, Cassandra for AP) beats abstract talk.',
        'Close with a decision heuristic — "eventually right vs wrong-is-worse-than-down".',
      ],
    },
    baseline: {
      text: [
        'CAP theorem says a distributed system can only guarantee two of Consistency, Availability, and Partition tolerance. Since partitions happen in real networks, systems trade off between C and A.',
        '',
        'CP systems favour consistency and may become unavailable during partitions. AP systems favour availability and may return stale data. Examples include HBase (CP) and DynamoDB (AP).',
      ].join('\n'),
      tokens: 380,
      latencyMs: 1900,
      costUsd: 0.0128,
    },
    judge: {
      mom:      { correctness: 90, completeness: 87, depth: 82, clarity: 91, usefulness: 88 },
      baseline: { correctness: 82, completeness: 66, depth: 58, clarity: 80, usefulness: 71 },
    },
  },

  refactor: {
    mom: {
      text: [
        '```python',
        'from collections.abc import Sequence',
        '',
        'def scale_above_threshold(values: Sequence[float], threshold: float, factor: float) -> list[float]:',
        '    """Return each value greater than `threshold`, scaled by `factor`."""',
        '    return [v * factor for v in values if v > threshold]',
        '```',
        '',
        'Changes: descriptive name, type hints via `Sequence[float]`, a list comprehension in place of the index-based loop, and a one-line docstring. Runtime is the same O(n); the win is readability and static-check friendliness.',
      ].join('\n'),
      tokens: 640,
      latencyMs: 2900,
      costUsd: 0.0052,
      advisorPreviews: [
        'The loop is really "filter + map" — a list comprehension is the idiomatic form.',
        'Type-hint with `Sequence[float]` so callers can pass tuples/np arrays too.',
        'Name should describe intent, not shape — `scale_above_threshold`, not `f`.',
      ],
    },
    baseline: {
      text: [
        '```python',
        'def f(x: list, y: float, z: float) -> list:',
        '    r = []',
        '    for i in range(len(x)):',
        '        if x[i] > y:',
        '            r.append(x[i] * z)',
        '    return r',
        '```',
        '',
        'Added type hints. Kept the loop structure.',
      ].join('\n'),
      tokens: 200,
      latencyMs: 1500,
      costUsd: 0.0086,
    },
    judge: {
      mom:      { correctness: 91, completeness: 85, depth: 78, clarity: 92, usefulness: 90 },
      baseline: { correctness: 80, completeness: 60, depth: 52, clarity: 74, usefulness: 68 },
    },
  },

  race: {
    mom: {
      text: [
        'Three root causes worth checking, in order of likelihood:',
        '',
        '1. **At-least-once delivery + missing idempotency key.** The consumer pulls a job, the ack times out on Redis, the broker redelivers, a second worker processes the same message. Verify by logging (message_id, worker_id, timestamp) at write time and grepping for duplicates.',
        '2. **Ack after side-effect instead of before commit.** If the RPUSH/XADD happens *before* the ack, a crash between write and ack causes redelivery. Verify by injecting a kill -9 between the two lines and confirming the duplicate on restart.',
        '3. **Consumer group rebalance mid-processing.** During a rebalance, a partially-processed message may be reassigned. Verify by correlating duplicate timestamps with consumer join/leave events in the broker log.',
        '',
        'Fix once you know which: add an idempotency key + SETNX, or move the ack before the side-effect, or use a transactional broker feature (Redis Streams XCLAIM with min-idle).',
      ].join('\n'),
      tokens: 920,
      latencyMs: 3600,
      costUsd: 0.0074,
      advisorPreviews: [
        'Almost always at-least-once + non-idempotent handler. Ordering matters — check that first.',
        'Ack timing is the second-most-common trap. Instrument the exact ack-vs-side-effect ordering.',
        'Rebalance mid-processing is rarer but nasty; correlate with join/leave events.',
      ],
    },
    baseline: {
      text: [
        'Possible causes:',
        '- Message being delivered twice by the queue.',
        '- Race between two workers picking up the same job.',
        '- Bug in the writer code.',
        '',
        'To verify, add logging and reproduce locally.',
      ].join('\n'),
      tokens: 260,
      latencyMs: 1700,
      costUsd: 0.0104,
    },
    judge: {
      mom:      { correctness: 89, completeness: 90, depth: 87, clarity: 88, usefulness: 92 },
      baseline: { correctness: 74, completeness: 58, depth: 50, clarity: 72, usefulness: 65 },
    },
  },

  urlShort: {
    mom: {
      text: [
        '**High-level design — 5k writes/sec URL shortener**',
        '',
        '- **ID scheme:** 64-bit Snowflake-style ID → base62 encoded to a 7–8 char slug. Keeps IDs monotonic-ish, avoids DB round-trip for a UUID lookup.',
        '- **Storage:** primary in a KV store (e.g. DynamoDB or FoundationDB) keyed by slug → `{long_url, created_at, owner}`. 5k writes/sec is trivial for these; the load pattern is write-once, read-many.',
        '- **Cache:** put Redis in front of reads. Slug → long_url with a 24h TTL; write-through on creation to warm the cache. Expected hit rate > 95% after warm-up.',
        '- **CDN edge:** the redirect handler is a pure lookup — put it at the CDN edge (Cloudflare Workers KV, Lambda@Edge) so 90% of traffic never hits origin.',
        '',
        '**Failure mode to plan for:** Redis primary loss during a viral link spike. Mitigation: async replica promotion + fallback to KV store on cache miss (already the design), plus a per-slug rate limit at the edge to protect origin from thundering-herd on cache rebuild.',
      ].join('\n'),
      tokens: 1050,
      latencyMs: 3500,
      costUsd: 0.0089,
      advisorPreviews: [
        'Snowflake+base62 is the standard — mention monotonicity because it helps cache locality.',
        'CDN edge redirect is the highest-leverage decision; call it out explicitly.',
        'For the failure mode, cache stampede on viral link is way more interesting than "DB down".',
      ],
    },
    baseline: {
      text: [
        'A URL shortener needs:',
        '- An ID generator (auto-increment or hash-based).',
        '- A database mapping short → long URL.',
        '- A cache layer.',
        '- A redirect handler.',
        '',
        'Failure mode: database going down.',
      ].join('\n'),
      tokens: 260,
      latencyMs: 1800,
      costUsd: 0.0117,
    },
    judge: {
      mom:      { correctness: 88, completeness: 90, depth: 86, clarity: 89, usefulness: 91 },
      baseline: { correctness: 75, completeness: 55, depth: 48, clarity: 70, usefulness: 62 },
    },
  },
};

// ---------------- Chinese samples ----------------

const ZH_SAMPLES: Record<PresetKey, LiveSample> = {
  binarySearch: {
    mom: {
      text: [
        '```rust',
        '/// 对有序切片做二分查找。命中返回 Some(index)，否则 None。',
        '///',
        '/// 边界情况：空切片时 while 条件直接不成立，所以不会走到下标访问，也不会 panic。',
        'pub fn binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize> {',
        '    let (mut lo, mut hi) = (0usize, slice.len());',
        '    while lo < hi {',
        '        let mid = lo + (hi - lo) / 2; // 避免 (lo+hi) 溢出',
        '        match slice[mid].cmp(target) {',
        '            std::cmp::Ordering::Less    => lo = mid + 1,',
        '            std::cmp::Ordering::Greater => hi = mid,',
        '            std::cmp::Ordering::Equal   => return Some(mid),',
        '        }',
        '    }',
        '    None',
        '}',
        '```',
      ].join('\n'),
      tokens: 1180,
      latencyMs: 3400,
      costUsd: 0.0081,
      advisorPreviews: [
        '`(lo+hi)/2` 在大切片上会溢出，写成 `lo + (hi-lo)/2` 才稳。',
        '按 Rust 风格返回 `Option<usize>`；标准库那版返回 Result，但调用者要的就是 Option。',
        '文档注释里显式写空切片的行为——评审必问。',
      ],
    },
    baseline: {
      text: [
        '```rust',
        'pub fn binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize> {',
        '    let mut lo = 0;',
        '    let mut hi = slice.len();',
        '    while lo < hi {',
        '        let mid = (lo + hi) / 2;',
        '        if &slice[mid] == target { return Some(mid); }',
        '        else if &slice[mid] < target { lo = mid + 1; }',
        '        else { hi = mid; }',
        '    }',
        '    None',
        '}',
        '```',
      ].join('\n'),
      tokens: 720,
      latencyMs: 2100,
      costUsd: 0.0243,
    },
    judge: {
      mom:      { correctness: 92, completeness: 88, depth: 84, clarity: 90, usefulness: 89 },
      baseline: { correctness: 84, completeness: 68, depth: 62, clarity: 78, usefulness: 74 },
    },
  },

  cap: {
    mom: {
      text: [
        'CAP 说的是：网络分区（P）发生时，分布式系统必须在可用性（A）和一致性（C）之间二选一。P 在现实里不是选项——网络就是会挂——所以 CAP 实际上是"分区来了要走 AP 还是 CP"的运行时决策。',
        '',
        '• CP 例子：leader 型 DB（比如 etcd）在少数派侧会直接拒写而不让状态分叉。你保住一致性，代价是少数派侧不可用。',
        '• AP 例子：Cassandra 用宽松 quorum 写入，两侧都继续接请求。你保住可用性，代价是读到的值可能过期甚至冲突，需要事后 reconcile。',
        '• "CA" 例子（无分区）：单机 Postgres。理论上成立，但单机本来就不是分布式系统。',
        '',
        '实操结论：能接受"最终对"的场景（指标、feed）走 AP；"错了比宕了更严重"的场景（支付、库存）走 CP。',
      ].join('\n'),
      tokens: 780,
      latencyMs: 3100,
      costUsd: 0.0064,
      advisorPreviews: [
        '先立"P 不是可选项"这个框架，新手最容易漏。',
        '每条分支给一个具体 DB（etcd 对 CP，Cassandra 对 AP），比空谈抽象强。',
        '收尾给一个决策启发式——"最终对 vs 错了比宕了更严重"。',
      ],
    },
    baseline: {
      text: [
        'CAP 定理说分布式系统只能同时保证 Consistency、Availability、Partition tolerance 里的两个。现实网络会分区，所以要在 C 和 A 之间权衡。',
        '',
        'CP 系统偏向一致性，分区时可能不可用；AP 系统偏向可用性，可能返回过期数据。HBase 是 CP，DynamoDB 是 AP。',
      ].join('\n'),
      tokens: 380,
      latencyMs: 1900,
      costUsd: 0.0128,
    },
    judge: {
      mom:      { correctness: 90, completeness: 87, depth: 82, clarity: 91, usefulness: 88 },
      baseline: { correctness: 82, completeness: 66, depth: 58, clarity: 80, usefulness: 71 },
    },
  },

  refactor: {
    mom: {
      text: [
        '```python',
        'from collections.abc import Sequence',
        '',
        'def scale_above_threshold(values: Sequence[float], threshold: float, factor: float) -> list[float]:',
        '    """筛出大于 threshold 的元素，按 factor 缩放后返回。"""',
        '    return [v * factor for v in values if v > threshold]',
        '```',
        '',
        '改动：语义化命名、用 `Sequence[float]` 打类型、把索引循环换成列表推导、加一句 docstring。复杂度还是 O(n)，收益是可读性和静态检查友好。',
      ].join('\n'),
      tokens: 640,
      latencyMs: 2900,
      costUsd: 0.0052,
      advisorPreviews: [
        '这个循环本质就是"filter + map"——列表推导才是 Python 的地道写法。',
        '类型用 `Sequence[float]` 更宽——tuple 和 numpy 数组都能传进来。',
        '命名要说"做什么"而不是"长什么样"——`scale_above_threshold` 明显好过 `f`。',
      ],
    },
    baseline: {
      text: [
        '```python',
        'def f(x: list, y: float, z: float) -> list:',
        '    r = []',
        '    for i in range(len(x)):',
        '        if x[i] > y:',
        '            r.append(x[i] * z)',
        '    return r',
        '```',
        '',
        '加了类型标注，循环结构保留。',
      ].join('\n'),
      tokens: 200,
      latencyMs: 1500,
      costUsd: 0.0086,
    },
    judge: {
      mom:      { correctness: 91, completeness: 85, depth: 78, clarity: 92, usefulness: 90 },
      baseline: { correctness: 80, completeness: 60, depth: 52, clarity: 74, usefulness: 68 },
    },
  },

  race: {
    mom: {
      text: [
        '按可能性从高到低排，三个值得先查的根因：',
        '',
        '1. **at-least-once 投递 + 缺 idempotency key。** consumer 拉走任务后，Redis 的 ack 超时，broker 重投，第二个 worker 又跑一遍。验证方法：写入时打 (message_id, worker_id, timestamp)，然后 grep 重复。',
        '2. **ack 排在 side-effect 之后而不是 commit 之前。** 如果 RPUSH/XADD 在 ack *之前*，写完还没 ack 就崩，重启会重投。验证方法：在两行之间注入 kill -9，看重启后是否复现重复。',
        '3. **处理过程中发生 consumer group rebalance。** rebalance 期间，处理到一半的消息可能被重新分配。验证方法：把重复的时间戳与 broker 里的 consumer join/leave 事件对照。',
        '',
        '定位到具体是哪一个之后再修：加 idempotency key 配合 SETNX，或者把 ack 挪到 side-effect 之前，或者用 broker 自带的事务能力（比如 Redis Streams 的 XCLAIM min-idle）。',
      ].join('\n'),
      tokens: 920,
      latencyMs: 3600,
      costUsd: 0.0074,
      advisorPreviews: [
        '基本都是 at-least-once + 处理函数不幂等。顺序很关键，先查这个。',
        'ack 时机是第二个常见坑，把 ack 和 side-effect 的先后顺序打点打出来。',
        'rebalance 中处理这种少见但恶心，跟 consumer join/leave 事件对照能定位。',
      ],
    },
    baseline: {
      text: [
        '可能的原因：',
        '- 队列把消息投递了两次。',
        '- 两个 worker 竞争抢到了同一个任务。',
        '- 写入代码有 bug。',
        '',
        '验证方法：加日志然后本地复现。',
      ].join('\n'),
      tokens: 260,
      latencyMs: 1700,
      costUsd: 0.0104,
    },
    judge: {
      mom:      { correctness: 89, completeness: 90, depth: 87, clarity: 88, usefulness: 92 },
      baseline: { correctness: 74, completeness: 58, depth: 50, clarity: 72, usefulness: 65 },
    },
  },

  urlShort: {
    mom: {
      text: [
        '**整体设计——5k 写请求/秒的短链服务**',
        '',
        '- **ID 方案：** 64 位 Snowflake 风格 ID → base62 编码成 7–8 字符 slug。ID 保持近似递增，避免 UUID 查询绕库一圈。',
        '- **存储：** 主存放在 KV 存储（DynamoDB 或 FoundationDB）里，key 是 slug，value 是 `{long_url, created_at, owner}`。5k 写/秒对它们不算什么，负载模式本来就是"写一次读多次"。',
        '- **缓存：** 读路径前面挂 Redis，slug → long_url，TTL 24h，创建时 write-through 预热。稳定期命中率能到 95% 以上。',
        '- **CDN 边缘：** 跳转 handler 本质就是一次查表——直接部到 CDN 边缘（Cloudflare Workers KV、Lambda@Edge），90% 流量根本不落到源站。',
        '',
        '**要提前规划的失败模式：** 病毒式链接爆火时 Redis 主节点挂了。缓解方式：异步 replica 提升 + 缓存 miss 时回退到 KV 存储（设计里已经有了），再加上一层"每 slug 边缘限流"，防止缓存重建时的雪崩打穿源站。',
      ].join('\n'),
      tokens: 1050,
      latencyMs: 3500,
      costUsd: 0.0089,
      advisorPreviews: [
        'Snowflake + base62 是标准做法，顺带提一下"近似单调"有利于缓存局部性。',
        'CDN 边缘做跳转是杠杆最高的一步，一定要点出来。',
        '失败模式选"病毒式链接下的缓存雪崩"比"数据库挂了"有意思得多。',
      ],
    },
    baseline: {
      text: [
        '短链服务需要：',
        '- 一个 ID 生成器（自增或哈希）。',
        '- 一个数据库存 short → long 的映射。',
        '- 一层缓存。',
        '- 一个跳转处理器。',
        '',
        '失败模式：数据库挂了。',
      ].join('\n'),
      tokens: 260,
      latencyMs: 1800,
      costUsd: 0.0117,
    },
    judge: {
      mom:      { correctness: 88, completeness: 90, depth: 86, clarity: 89, usefulness: 91 },
      baseline: { correctness: 75, completeness: 55, depth: 48, clarity: 70, usefulness: 62 },
    },
  },
};

// ---------------- Public API ----------------

export const PRESET_ORDER: PresetKey[] = ['binarySearch', 'cap', 'refactor', 'race', 'urlShort'];

export function getLiveSample(preset: PresetKey, lang: Lang): LiveSample {
  return (lang === 'zh' ? ZH_SAMPLES : EN_SAMPLES)[preset];
}

// Silence unused-warnings for placeholders — kept for future fallback path.
void PLACEHOLDER_EN;
void PLACEHOLDER_ZH;
