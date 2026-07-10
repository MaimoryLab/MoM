# 005. Phase 3 触发判断与缓存复用解耦：cache miss 无条件补跑，`trigger_reason` 退化为标签

**日期**：2026-07-10
**状态**：已决策
**关联 Issue**：ISS-006

## 背景

PLAN Phase 3 初稿把 `fanout_mode: user_turn` 描述为"同一 turn 内的多次 tool iteration 复用同一批 references（不重跑 advisor）"，并给出一个 `shouldFanout(messages, fanoutMode): {trigger, reason}` 的决策函数。字面读法是：user_turn 模式下，当请求是 tool iteration（最后一条 user message 含 tool_result）时，直接**跳过 advisor**、`trigger_reason='skipped_tool_iteration'`。

这个字面语义有一个隐蔽的前提假设：**"每一次 tool iteration 都能从内存 cache 中读到上一次真实 user turn 时缓存下来的 references"**。这在三类真实场景下会破产：

1. **进程重启**：MoM 网关重启后内存 cache 全空；用户 Claude Code 侧 agent loop 还在继续，第一条打进来的可能已经是 tool iteration
2. **TTL 过期**：cache TTL 是 5m / 1h；一个 agent 完成一次长 tool_use（比如 `web_search` 花了 8 分钟）后返回结果，此时 5m 桶里的 references 已过期
3. **首请求即 tool iteration**：用户开一个新的 Claude Code session，直接粘贴一段"这是上次的执行结果，接着做"——第一条请求 messages 结构就是 user + tool_result

三种场景下，"跳过 advisor" 的分支会让 aggregator 拿到**空 references**，严重降级到 baseline 单模型行为，且用户无感知（`trigger_reason=skipped_tool_iteration` 看起来是正常的"缓存命中"）。这不是临时妥协，是"触发判断"与"缓存复用"两个正交概念被折叠成一个决策函数造成的语义空洞。

Phase 2 已经把 orchestrator / advisor / aggregator 三层的接口稳定下来，Phase 3 是第一次真正落地 cache + trigger 语义的地方——修正的最佳时机就在动手前。

## 被否定的方案

### 方案 A：严格按初稿实现，"user_turn tool iteration 直接跳过 advisor"

否定原因：如上"背景"三类真实场景下 aggregator 拿到空 references，严重降级。且用户没有观察窗口——`trigger_reason=skipped_tool_iteration` 与真正的缓存命中在 metrics/dashboard 上无法区分。核心问题是它把"是否新 turn"（一个描述性判断）和"是否要跑 fanout"（一个控制决策）绑定成同一个二值信号，而这两件事在缓存不可用时的正确答案是分歧的：即使不是新 turn，如果 cache miss，仍然应该跑 fanout。

### 方案 B：只对 tool_iteration_cache_miss 触发一个 warn log，不补跑 advisor

否定原因：把架构问题降级成告警问题。用户看不到 log，看到的是 aggregator 质量突然崩了；且警告没有自愈——直到用户手动重启网关或等到 TTL 让它自然恢复。这条路径与"整体 MVP 追求可用"的目标冲突。

### 方案 C：cache key 用 `sortedSlots` 让顺序调整也能命中

否定原因：aggregator 端 `buildConcatReferences` 按 `advisor.slots` 的**原顺序**编号 `[Reference 1 — <slot>]`。缓存复用旧顺序的 `AdvisorResult[]` 后，aggregator 会拼出 "[Reference 1 — slotA] {A 的分析} / [Reference 2 — slotB] {B 的分析}"——slot 标签跟随缓存的 slot 名（原顺序），但当前 `MoMConfig.advisor.slots` 已经变了顺序。用户当前配置的"引用 1"语义已经变化，但看到的内容还是旧顺序的推理。缓存必须承担"输入即输出"的强不变量，slot 顺序变化就是输入变化——cache miss 一次的代价可忽略（一次 fanout 而已），换来的是没有隐蔽的"复用即错位"风险。

### 方案 D：`passthroughStream` 复制出两套实现（透传版 + observer 版）

否定原因：SSE 分帧 + 主转发字节 pipe 两个能力应该在同一处出现；两套实现代码平行漂移的成本远高于"一个函数带可选参数"。且透传路径的"零消费"语义可以精确表达为"不传 onEvent"，无需两个函数签名。

## 最终决策

Phase 3 主链路的控制流规范化为：

```
orchestrate(req):
  if mom_mode != 'always':
    透传 → 落 trace(mom_triggered=false, trigger_reason='mom_off') → 返回
  isNewTurn = isNewUserTurn(messages)
  key = computeFanoutCacheKey(messages, momConfig)   // 内部按 fanout_mode 决定取样范围
  cached = fanoutCache.get(key)
  if cached:
    advisorResults = 复用 cached，每条 cache_hit=true / usage=0 / latency=0
    trigger_reason = 'skipped_tool_iteration' if fanout_mode=='user_turn' else 'fanout_cache_hit'
  else:
    advisorResults = fanoutAdvisors(messages, momConfig, provider)
    fanoutCache.set(key, advisorResults)
    if fanout_mode == 'user_turn':
      trigger_reason = 'user_turn' if isNewTurn else 'tool_iteration_cache_miss'
    else:
      trigger_reason = 'per_iteration'
  aggregator = runAggregator...(...)
  saveTrace({ mom_triggered: true, trigger_reason, ... })
```

配套结构变化：

- **`shouldFanout` 从 PLAN 中删除**——不再是"决策函数"。取而代之的是纯标签函数 `computeTriggerReason(fanoutMode, isNewTurn, cacheHit): TriggerReason`，只做叙述、不控制流程
- **cache key `slots` 用原顺序 hash**（`slots.join('\x00')`），不排序
- **`passthroughStream` 单一实现 + 可选 `onEvent` 参数**：透传路径不传、行为等价；MoM streaming 路径传、旁路解析 SSE 用于 trace 组装
- **透传路径也写 trace**（`mom_triggered=false / trigger_reason='mom_off'`），给 Phase 4 metrics `mom_trigger_rate` 一个正确的分母
- **`src/cost/` 目录职责收敛**：只放"计价 / usage 纯函数"，metrics 聚合永远归 storage / dashboard-api

## 已知代价

### 代价 1: `trigger_reason` 枚举从三种膨胀到六种

原 PLAN 措辞暗示三种：`user_turn` / `skipped_tool_iteration` / `per_iteration`。新枚举六种：`mom_off` / `user_turn` / `skipped_tool_iteration` / `tool_iteration_cache_miss` / `per_iteration` / `fanout_cache_hit`。Phase 4 metrics 页面与 Phase 5 dashboard 需要面对六个而非三个标签。

**Followup**: 暂不追踪。理由：六个标签是"触发粒度 × cache 命中"两个正交维度的笛卡尔积（2×3 = 6，`mom_off` 独立），是描述性完整的语义，不是复杂性膨胀。Phase 4 metrics 聚合时可按维度分组显示（mom_trigger_rate / cache_hit_rate 两个独立比率），不需要把六个标签平铺展示。

### 代价 2: 透传路径也写 trace，每请求多一次 SQLite 同步写入

`mom_mode !== 'always'` 时也要落一条 `mom_triggered=false` 的 trace，多一次 `INSERT INTO traces` 的同步 IO。在 MVP 单机低并发场景下（<10 rps）影响可忽略；高并发场景下可能成为瓶颈。

**Followup**: 暂不追踪。理由：MVP 单机部署、Node SQLite WAL 模式下小行 insert 亚毫秒级；Phase 4 metrics `mom_trigger_rate` 需要透传路径贡献分母，删除这条 trace 会让整个"触发占比"指标失去意义。若 Phase 4-5 上线后监测到 IO 瓶颈，Phase 6+ 时可引入 batch writer（buffer + N 秒 flush），届时才有具体性能数据决定 batch size。

### 代价 3: cache miss 场景比初稿多，实际 provider 调用量可能高于预期

初稿假设"user_turn 模式下，一个 tool loop N 次 iteration 只跑 1 次 fanout"；新语义下如果 TTL 过期或进程重启，同一个 tool loop 内可能跑 2+ 次 fanout（相当于额外一次 advisor 成本）。

**Followup**: 暂不追踪。理由：这个"多花的成本"换来的是 aggregator 正确性——空 references 导致的 baseline 降级是不可观察的质量崩塌，多跑一次 fanout 是可观察且可控的成本增加。且 TTL preset 是可配置项（5m / 1h），用户可按 tool loop 平均时长调整。

### 代价 4: `passthroughStream` 多一个可选参数，签名变化

Phase 2 的 `passthroughStream(req, reply, provider)` 三参签名变为 `passthroughStream(req, reply, provider, onEvent?)`。旧调用点（gateway 透传路径）不需要修改，新调用点（Phase 3 MoM streaming）传第 4 个参数。

**Followup**: 暂不追踪。理由：可选参数向后兼容，Phase 2 调用点零改动；且 provider 层内部消费 stream 是 provider 层职责本来的一部分，不构成分层破坏。

## 不在本期范围

### 项 1: 分布式共享 fanout cache（多进程 / 多机部署）

**Followup**: 暂不追踪。理由：MVP 定位是单机本地部署，PLAN 阶段总览"讨论中否定的方案"第 10 条明确"CLI / NPM 包 / Claude Code 插件形态属远期"，多进程部署更远。分布式 cache（Redis 等）等真正有多机需求时再启动方案设计。

### 项 2: Cache key 引入 `messages` 内容的语义指纹（而非 sha256 精确匹配）

**Followup**: 暂不追踪。理由：语义指纹意味着"近似匹配"，破坏"输入即输出"的强不变量，与本决议核心冲突。若未来真的想做"跨 turn references 复用"，那是一个完全不同的产品语义（更接近 RAG 而非 cache），不属于"缓存"范畴。
