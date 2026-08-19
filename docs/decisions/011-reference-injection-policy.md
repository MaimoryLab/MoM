# 011. Reference 注入策略配置化：timing × position 两个正交维度

**日期**：2026-08-07
**状态**：已决策
**关联 Issue**：ISS-069

## 背景

`mom_mode=always` 下每个上游请求（含 agent 工具循环里的每一次 tool iteration）都会走 aggregator，把 advisor references 拼进请求。原实现 `appendReferencesToLastUser` 把两件事写死：无条件注入（不区分是新 user turn 还是工具迭代），且位置固定为「最后一条消息尾部」。

工具迭代要不要重复注入、注入到哪，会显著影响 token 成本与 Anthropic prompt-cache 命中，且最优选择依赖具体 workload（agent loop 有多长），不存在单一正确答案。硬编码一种行为无法让使用者按场景取舍。

## 被否定的方案

### 方案 A：在 `appendReferencesToLastUser` 里加 if 分支按 trigger_reason 决定加不加
否定原因：属于在原函数上打补丁。注入「时机」和注入「位置」是两个正交维度，塞进一个函数会让分支随维度组合爆炸（2 timing × 2 position），且把编排层的 trigger 语义泄漏进纯拼接函数。违反 000README「二次核查-设计」的第一性原理约定。

### 方案 B：只做「加/不加」开关，位置继续写死
否定原因：位置本身就是 ISS-069 的核心权衡（位置A 优化单 loop 命中 vs 位置B 优化跨 loop 复用）。只做时机开关等于把一半问题留在硬编码里，用户仍无法为长 agent loop 选 context_tail。

### 方案 C：按请求来源（Claude Code / Codex / chat）自动选策略
否定原因：来源判定在无状态云端本身是未解决的难题（ISS-067 / ISS-068 待调研）。当前本地单客户端场景无从判定来源，强行做会引入无法验证的启发式。本期只做「用户显式配置」，来源自动分派留给 ISS-068。

## 最终决策

新增 `MoMConfig.reference_injection`，两个正交枚举维度：

- `timing: 'user_turn_only' | 'every_request'` —— 新 user turn 恒注入；工具迭代是否注入由此开关决定。
- `position: 'user_message_tail' | 'context_tail'` —— 位置A（拼到最后一条真实 user 消息尾部）/ 位置B（拼到整个消息序列末尾）。

抽出纯策略函数 `applyReferenceInjection({messages, references, isNewUserTurn, settings})`，是注入的唯一决策点：`timing` 门控是否注入，`position` 选择落点，返回 `{messages, injected, payload}`。编排层把已有的 `isNewUserTurn` 透传进来，调用方不再自行判断策略。

默认 `user_turn_only + user_message_tail`：新 user turn 的行为与改动前逐字节一致；工具迭代从「原来无条件注入」变为「默认跳过」。

## 已知代价

### 代价 1: 默认行为对工具迭代发生语义变化
改动前工具迭代也会注入 references，改动后默认 `user_turn_only` 会跳过。对依赖「每轮工具迭代都带 references」的既有部署，需显式改配置为 `every_request` 才能恢复。此变化是 ISS-069 明确想要的默认（references 已在 user turn 被模型内化，工具迭代重复注入是冗余），故作为新默认接受。
**Followup**: 暂不追踪（这是 ISS-069 主动选择的目标默认，非遗留问题）

### 代价 2: `references_appended` trace 字段在跳过时为空串
策略跳过注入时，`AggregatorResult.references_appended` 记为 `''`，与「注入了但内容为空」在 trace 上不可区分。判别可借同 gateway_request_id 的 `trigger_reason` 还原，故不额外加字段。
**Followup**: 暂不追踪（trigger_reason 已足够还原语义，加字段属过度设计）

### 代价 3: 位置选择与多引擎来源判定耦合未解
`position` 目前对所有来源一视同仁。云端多引擎下，同一 position 对非 Claude Code 客户端未必最优。
**Followup**: ISS-068

## 不在本期范围

### 按请求来源自动选择 timing/position
**Followup**: ISS-068

### Dashboard SettingsPage 暴露 reference_injection 编辑 UI
后端类型与校验已就位，前端 Settings 仍在 mock 阶段（见 decisions/008），本期不接线。
**Followup**: 暂不追踪（随 Dashboard Settings 整体接线时一并做，无独立价值）
