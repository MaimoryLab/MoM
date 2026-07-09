# 003. Trace.settings_snapshot 只快照 MoMConfig，不快照 provider 秘钥/端点

**日期**：2026-07-09
**状态**：已决策
**关联 Issue**：ISS-003

## 背景

Phase 1 拆分 `MoMSettings → ProviderConfig + MoMConfig` 时，`Trace.settings_snapshot` 类型改成了 `RuntimeConfig`（`= { provider, mom }`），但 `ProviderConfig` 含 `api_key`。Phase 3 计划的 `saveTrace()` 一旦启用，每条 trace 都会把明文 `api_key` 写进 SQLite `traces` 表。

这与 decisions/002 拍板的"秘钥永不写 SQLite / config.json，只活在 .env 里"直接冲突，且以更严重形式重现 ISS-002 的"秘钥旅行"（Phase 1 全库一份，Phase 3 每条 trace 一份）。

Phase 2 是修的最佳时机：此时 orchestrator 首次开始在内存流转 advisor/aggregator 结果，Phase 3 才落盘；现在改类型一处，Phase 3 落盘代码直接安全。

## 被否定的方案

### 方案 B：`settings_snapshot: { mom: MoMConfig; provider: Pick<ProviderConfig, 'base_url' | 'auth_style'> }`

否定原因：保留 `base_url`/`auth_style` 是为多环境对照（例如切了 OpenRouter → DeepSeek），但这个能力本质上是"给 trace 打环境 tag"，而不是"把 provider 配置整块搬进来"。前者用一个独立的 `env_tag: string` 字段（Phase 4+ 引入）表达更显式、更小暴露面。方案 B 让类型层继续背 `ProviderConfig` 的名空间——未来 `ProviderConfig` 一旦扩字段（如轮询多 endpoint 的凭证），trace 又会把新秘钥快照进去。边界防御要放在类型层，不能靠字段级 `Pick`。

### 方案 C：类型不动，`saveTrace` 序列化时黑名单 `api_key`

否定原因：把安全边界下沉到"每一处序列化"是防御的错位。将来任何新增字段（多 endpoint 秘钥、代理凭证）都要记得加进黑名单——「记得」是可失效的假设。类型层直接不承载秘钥，静态就能保证下游代码写不出漏点。

## 最终决策

`Trace.settings_snapshot` 类型改为 `MoMConfig`——只快照业务配置（触发模式、slot 组合、pricing_table、reference_max_tokens 等真正决定"这条 trace 为什么长这样"的字段）。修复前置到 Phase 2，避免 Phase 3 落盘代码再改一遍。

## 已知代价

### 代价 1: 多环境对照能力暂时缺失

Trace 里不再有 `provider.base_url` / `provider.auth_style` 字段，无法直接从 trace 判断这条请求走了哪个 provider。

**Followup**: 暂不追踪。理由：MVP 单一 provider baseURL（PLAN 阶段总览"讨论中否定的方案"第 11 条明确写"多 provider 属远期"）；单一 baseURL 场景下这条 trace 元信息价值为零。等到多 provider 需求真正落地时，用独立 `env_tag: string` 字段承接即可，与 `settings_snapshot` 类型不再耦合。
