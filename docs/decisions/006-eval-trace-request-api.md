# 006. Eval Trace Request API：粒度=一次上游调用，pricing 请求时冻结，`GET /trace/requests` 独立命名空间

**日期**：2026-07-11
**状态**：已决策
**关联 Issue**：ISS-009 / ISS-010 / ISS-011

## 背景

Eval / Dashboard 侧提出对接需求：需要一个能按 session 查询 trace 明细的 HTTP 接口 `GET /trace/requests?session_id=<uuid>`，返回结构里含 `client_model` / `selected_model` / `usage`（细分 cache 命中 / reasoning）/ 请求时冻结的 `pricing` 单价 / `started_at` / `finished_at` 等字段。核心用途是：eval 侧给每个逻辑任务生成一个 UUID，任务内所有请求带同一个 `X-Session-ID` header；跑完后按 session_id 拉一次接口，在 eval 侧自行聚合成本、cache 命中率、模型分布、变体对比。

当前 Phase 3 落地的 `Trace` 类型（`src/types/mom.ts`）与 `traces` 表 schema（`src/storage/db.ts`）都是"以入口 HTTP 请求为单位的一条聚合记录"——把 MoM `always` 模式下的 N 个 advisor + 1 个 aggregator 压成一条 trace（`advisor_results: AdvisorResult[]` + `aggregator_result`）。这种结构：

1. **没有 session_id 字段**——eval 侧需要的关联键完全没落盘
2. **没有 `started_at` / `finished_at`**——只有 `timestamp` + `total_latency_ms`，粒度是入口聚合，无法回答"某个 advisor 用了多长时间"
3. **没有 `client_model` / `selected_model` 区分**——`request.model` 是客户端指定值，`aggregator_result.model` 是转发到的上游模型；但 advisor 侧的每个 slot 只在 `advisor_results[i].slot` 里，语义与 aggregator 不对称
4. **没有请求时冻结的 pricing 快照**——当前 `total_cost_usd` 用 `momConfig.pricing_table[model]` 当场算，`pricing_table` 变化后历史 trace 的成本无法复现
5. **粒度错配**：eval 侧需要"给这个任务里每个上游调用都各来一条明细"，才能算出"gpt-5.5 在该任务里被 advisor 调用了 3 次、aggregator 调用了 1 次；哪几次 cache 命中"——聚合到入口层就丢了这个信息

同时，Phase 3 沉淀期人工审阅现有 trace 落盘内容时也发现字段与后续 Dashboard / 分析需求不完全对齐（ISS-009 前身）；`pricing_table` 目前手工维护，每次新增模型都要人肉查价格，provider `/v1/models` 端点已暴露 `price` 字段，可作数据源（ISS-010 前身）。这三件事——粒度重构 / 接口交付 / pricing 数据源自动化——共享同一个 decision（本文），拆成三条 issue 独立追踪。

Phase 3 主链路刚合并（PR #6），trace 落盘代码路径此时**只被 orchestrator 一处消费**——修正 schema 的最佳时机就在动手接 eval 之前。

## 被否定的方案

### 方案 A：一条 trace = 一次入口 HTTP 调用（沿用当前聚合结构，加 session_id 列即可）

否定原因：eval 侧的核心用例是"任务内每个上游调用的成本 / cache / 模型对比"，聚合到入口层会永久丢失 advisor 级明细。当前 `Trace.advisor_results: AdvisorResult[]` 嵌套结构在 SQL 层不可查询（要 JSON 提取），Dashboard / eval 侧要重复解 JSON；且 `total_cost_usd` 是入口聚合值，无法回答"某个 slot 花了多少钱"这类问题。评测端需求文档里明确写"gateway 是观察的唯一真相源：只记录每个请求实际发生了什么"——聚合是解释，不是记录。

### 方案 B：既落一条 envelope（入口聚合）又落 N+1 条 upstream（每次上游），用 `kind` 字段区分

否定原因：需求文档明确说"一次 HTTP 调用 = 一条记录"，本方案会让 eval 侧收到 N+2 条记录、其中一条是 envelope、N+1 条是 upstream，父子关系需要额外规则拼合。信息最全但语义违背需求文档。若未来真需要入口聚合视图，可在 Phase 4 dashboard-api 层用 SQL 现算（按 upstream_request_id 或 gateway_request_id 分组），不必落盘冗余。

### 方案 C：pricing 不冻结，查 trace 时用当前 `pricing_table` 现算成本

否定原因：需求文档明确写"价格随请求冻结：每条记录内嵌当时使用的实际单价，即使日后价格变动，eval 的成本计算也可复现"。不冻结意味着 pricing_table 变动后所有历史 trace 的 `cost_usd` 都跟着变，eval 侧算出的"上周任务花了多少钱"随配置漂移，直接违反需求文档的核心约束。

### 方案 D：pricing 用外部快照表（`pricing_snapshots` 表 + `snapshot_id` 外键）替代 trace 内嵌

否定原因：eval 侧的目标是"一次 HTTP GET 拿到本任务全部信息"。快照表意味着 `GET /trace/requests` 要 JOIN 两张表，或者响应体外挂一份 pricing 索引让 eval 侧自己拼。徒增复杂度换来的收益（省几字节存储）在单机 SQLite MVP 场景下是无价值的——单条 trace 内嵌 4-5 个 pricing 字段每条多 100 字节左右，1 万条 trace 增加 1 MB。

### 方案 E：session_id 缺失时网关自动生成 uuid 回填响应 header

否定原因：需求文档明确"Session ID 是关联键，粒度由 eval 侧决定"。网关自动生成的 uuid 每次都不同，会破坏"同一任务多次请求共享 uuid"的核心语义——本质是网关越界替 eval 决定"没传时该怎么办"。eval 侧忘配 header 是 eval 侧的 bug，网关应该如实记录 null 而非静默补救。

### 方案 F：接口路径合并到 Phase 4 已规划的 `/api/traces?session_id=<uuid>`

否定原因：Phase 4 的 `/api/traces` 与 `/api/traces/:id` 是 dashboard 分页列表 + 单条明细语义，消费方是 dashboard 前端；`/trace/requests?session_id=...` 是 eval / benchmark 侧的批量查询语义，消费方是 eval pipeline。两者的"分页策略 / 排序默认值 / 空结果语义 / 错误响应格式"约束不同——合并意味着一个 endpoint 同时服务两种消费方，字段冗余与语义漂移只会累积。独立命名空间 `/trace/*` 与 `/api/*` 分开更清晰。

## 最终决策

### 粒度

**一条 TraceRequest = 一次网关→provider 的上游 HTTP 调用**。MoM `always` 模式下，eval 一次入口请求对应网关内部 N+1 次上游调用（N 个 advisor + 1 个 aggregator），落 N+1 条 TraceRequest，全部共享同一个 `session_id`。透传路径（`mom_mode !== 'always'`）落 1 条 TraceRequest。若客户端不传 `X-Session-ID`，`session_id = null`——不影响其他字段落盘，只是无法通过 `/trace/requests` 查询。

### 关系
- 每条 TraceRequest 独立成行、SQL 层直���可查（`session_id` 加索引）
- Eval 侧的所有聚合（成本 / cache 命中率 / 模型分布 / 变体对比）在 eval 侧根据 TraceRequest 列表现算
- 上游调用之间的"父子"关系（哪几条属于同一次入口请求）用 `gateway_request_id` 关联（网关侧生成的入口请求 uuid）。eval 侧不强依赖，但 Phase 4 dashboard / 后期 debug 需要

### TraceRequest schema（sqlite `traces` 表列 + JSON payload）

固定列（SQL 可查）：

| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | trace 自身 uuid（`req_<random>` 或 uuid） |
| `session_id` | TEXT NULL | eval 侧 header `X-Session-ID` 回显；缺失即 null；**加索引** |
| `gateway_request_id` | TEXT NOT NULL | 网关入口请求 uuid（同一入口请求下 N+1 条 upstream 共享此值） |
| `started_at` | INTEGER NOT NULL | 上游调用发起时间戳（epoch ms） |
| `finished_at` | INTEGER NOT NULL | 上游调用完成 / 失败时间戳（epoch ms） |
| `duration_ms` | INTEGER NOT NULL | `finished_at - started_at`（冗余便于查询） |
| `role` | TEXT NOT NULL | `advisor` / `aggregator` / `passthrough` — 上游调用在 MoM 流程中的角色 |
| `client_model` | TEXT NOT NULL | 客户端 `request.model`（eval 传进网关的原始 model 名） |
| `selected_model` | TEXT NOT NULL | 实际转发到 provider 的模型名（advisor slot / aggregator.model / passthrough=request.model） |
| `status` | TEXT NOT NULL | `success` / `error` / `cache_hit` |
| `data` | TEXT NOT NULL | 完整 JSON payload（含 `usage` / `pricing` / `error` / `request` / `response` 快照等） |

JSON payload（`data` 列）字段：

- `usage`：`{ input_tokens, cache_read_tokens, cache_creation_tokens, output_tokens, reasoning_tokens }`（reasoning_tokens 上游不报时为 0）
- `pricing`：请求时深拷贝的 `momConfig.pricing_table[selected_model]` +  `source` / `currency` 元字段
- `error`：`{ type, message, http_status }`（`status='error'` 时填，否则 null）
- `request_summary`：客户端 request 的元字段快照（不含完整 messages 数组，太大；只保留 `max_tokens` / `temperature` / `stream` / `tool_use_count` / `message_count`）
- `response_summary`：provider response 元字段（`stop_reason` / `stop_sequence` / `id`）
- `trigger_reason`：沿用 Phase 3 六种枚举；`role='passthrough'` 时为 `mom_off`
- `cache_hit`：布尔，专门给 advisor cache 命中场景（`role='advisor' AND status='cache_hit'` 时 true）
- `provider`：字符串，取 `PROVIDER_BASE_URL` host（如 `apiproxy.paigod.work`）

### `TraceRequest.pricing` 字段结构

```jsonc
{
  "currency": "USD",              // 项目默认；ISS-010 后可扩展 CNY / mixed
  "input_per_million": 13.39,     // 每 1_000_000 tokens
  "cache_read_per_million": 1.34, // null 表示无缓存折扣
  "cache_write_per_million": 16.74,
  "output_per_million": 80.37,
  "reasoning_per_million": null,  // 上游若不区分则 null
  "source": "mom.config.json@2026-07-11T03:12:44Z" // pricing_table 数据源
}
```

**冻结时机**：orchestrator 在每次上游调用**发起前**从 `momConfig.pricing_table[selected_model]` 深拷贝一份；调用完成 / 失败时把这份快照连同 usage / cost 一起写入 TraceRequest。若 `pricing_table` 里没有该 model 的条目，pricing 全字段 null + `source: null`，`cost_usd = 0`，log warn（沿用 Phase 3 `event=pricing_missing`）。

### `cost_usd`

TraceRequest 内嵌 `cost_usd` 字段（不是响应体计算），值 = 请求时 pricing × usage 现算并落盘。eval 侧读到该字段即成本，无需二次计算。

### HTTP 接口

`GET /trace/requests?session_id=<uuid>` — 独立 `/trace/*` 命名空间，与 Phase 4 `/api/*` 并行不合并。

- 查询参数：`session_id`（必填，UUID 格式）
- 响应：`{ session_id, requests: TraceRequest[] }`，按 `started_at` 升序
- 空数组不返回 404（eval 侧可能查到还没写入的 session；空数组是正常路径）
- `session_id` 参数缺失 / 非 UUID 格式 → 400 `invalid_request_error`
- 存储错误 → 500 `internal_error`（不吞掉）

### 与 Phase 4 `/api/traces` 的关系

`/api/traces` 与 `/api/traces/:id`（Phase 4 规划）**保留**，将来实现时作 dashboard 视角的分页列表 + 单条详情；`/trace/requests` 作 eval 视角批量查询。两条路径消费同一张 `traces` 表，语义不同。

### session_id 语义

- 只读 `X-Session-ID` HTTP header
- 缺失 → trace 落盘 `session_id = null`
- Body 里的 `metadata.session_id` **不读**（Anthropic 协议 metadata 是给 upstream 的 opaque 字段，不属于 gateway 语义）
- 网关不生成兜底 uuid（会破坏"任务内共享"语义）

### ISS-010 pricing 自动同步

本 decision **不做**自动同步的实现（沿用当前手工填 pricing_table 的路径）。但本 decision 明确了 pricing 的**冻结点**：请求时深拷贝 `momConfig.pricing_table[selected_model]`。这决定了未来 ISS-010 实现自动同步时的数据源边界——同步器只负责把 provider `/v1/models` 的价格落到 `data/mom.config.json.pricing_table`，orchestrator 侧读取路径不变。

## 已知代价

### 代价 1: 一次入口 HTTP 请求膨胀成 N+1 条 trace 记录

原 Phase 3 落盘：MoM `always` 模式下 eval 发 1 次请求 → 落 1 条 trace（含 N 个 advisor + 1 个 aggregator 嵌套）。新方案：落 N+1 条。100 次 eval 请求 × 3 个 advisor + 1 aggregator = 400 条 trace 记录（旧方案 100 条）。表膨胀 ~4x。

**Followup**: 暂不追踪。理由：SQLite 单表 400 万行也是 sub-100ms 查询（假设 `session_id` 索引存在）；MVP 单机场景 4x 膨胀对存储与查询性能无实际影响。且这是"信息完整性 vs 冗余"的必要成本，需求文档的核心目的就是让 eval 侧看到每次上游调用的独立记录。

### 代价 2: 一次 eval 请求触发 N+1 次 SQLite INSERT，写入压力 4x

原方案 orchestrator 在响应结束后写 1 次 INSERT；新方案要在**每次上游调用完成时**写 1 次 INSERT，一次入口请求内累积 N+1 次同步 IO。

**Followup**: 暂不追踪。理由：Node SQLite WAL 模式下每条 INSERT sub-ms；单机 MVP <10 rps 完全无压力。若 Phase 4 metrics 上线后监测到写入瓶颈，与 decision 005 代价 2 合并考虑 batch writer 演进路径。

### 代价 3: 现有 `Trace` 类型 + orchestrator 落盘代码要重构，与已合并 Phase 3 代码有 diff

`src/types/mom.ts.Trace` 现在是"入口聚合"结构（`advisor_results: AdvisorResult[]` + `aggregator_result`），本 decision 要求改为"上游调用列表 + 每条独立"。`src/orchestrator/orchestrator.ts` 的 `persistMoMTrace` / `persistPassthroughTrace` 逻辑要重写。

**Followup**: ISS-009（Trace schema 扩展）追踪。

### 代价 4: `Trace` 类型的旧字段（`total_cost_usd` / `total_latency_ms` / `advisor_results` 数组）在 MVP 单机场景下**直接删除**、不做双列并存

新 schema 与旧 schema 结构不兼容，双列并存意味着 orchestrator 同时写两份、代码里同时维护两套 Trace 概念。MVP 单机、目前尚无历史 trace 依赖方，直接切换更干净。

**Followup**: 暂不追踪。理由：Phase 3 主体刚合并 3 天，主 db 里只有开发过程中的少量测试 trace，无生产数据；Phase 4 dashboard-api 还没开工，无下游消费方；Phase 5 前端还没开工，无 UI 展示层依赖旧字段。此时切换代价最低。若未来 Phase 4-5 上线后需再改 trace schema，届时可能需要考虑迁移策略；本次不涉及。

### 代价 5: eval 侧要处理"advisor cache_hit 的 TraceRequest usage 为 0 但仍出现在列表里"

一个 cache 命中的 advisor 上游调用**未真正发起 HTTP** 到 provider，但仍落一条 TraceRequest（`status='cache_hit'` / `usage` 归零 / `duration_ms ≈ 0`）。eval 侧算 cache 命中率 / 实际调用次数时需按 `status` 字段区分。

**Followup**: 暂不追踪。理由：需求文档明确"gateway 是观察的唯一真相源：只记录每个请求实际发生了什么"——cache 命中虽然没打 HTTP，但确实发生了"advisor 结果被消费"这件事，落盘一条明确标注 `status='cache_hit'` 的记录比不落更符合"完整观察"。eval 侧的过滤规则是纯 SQL `WHERE status != 'cache_hit'`，无实现复杂度。

### 代价 6: `provider` 字段用 `PROVIDER_BASE_URL` host 推断，多 provider 时可能不准

当前 MVP 单一 provider（`PROVIDER_BASE_URL`），`provider` 字段直接取 host（`apiproxy.paigod.work`）。若未来支持多 provider 路由，同一条 TraceRequest 里的 `selected_model` 与 `provider` 可能需要独立标注。

**Followup**: 暂不追踪。理由：PLAN 阶段总览"讨论中否定的方案"第 11 条明确"多 provider 属远期"；MVP 单 provider 场景下 host 推断足够。多 provider 落地时会有独立 decision 讨论 provider 归属。

## 不在本期范围

### 项 1: pricing_table 自动同步（`scripts/sync-pricing.mjs`）

**Followup**: ISS-010 追踪。理由：pricing 冻结点已在本 decision 定死（请求时深拷贝 `momConfig.pricing_table[selected_model]`），冻结点与数据源填充路径正交——本 PR 先交付接口最小闭环，pricing 自动同步作为独立后续工作。

### 项 2: `/api/traces` / `/api/traces/:id` (Phase 4 dashboard 路径)

**Followup**: 暂不追踪。理由：属于 PLAN.md Phase 4 dashboard-api 计划性交付范畴（PLAN.md §Phase 4 已列出 4 组 API 路由），本 decision 只需明确"eval 视角 `/trace/requests` 独立命名空间，不合并到 dashboard `/api/*`"这条边界；Phase 4 起动时会随主 Phase 4 交付一起追踪，无需额外 issue。

### 项 3: Trace 索引扩展（`gateway_request_id` / `client_model` / `role` 加索引）

**Followup**: 暂不追踪。理由：本 decision 只对 `session_id` 加索引（eval 接口主查询路径）；其他字段的查询模式尚未清晰，加索引易过度。Phase 4-5 dashboard-api 落地后如有实际慢查询案例再补索引。

### 项 4: TraceRequest.pricing 支持多币种（CNY / mixed）

**Followup**: 暂不追踪。理由：当前 pricing_table 数据源（provider `/v1/models`）单位是 USD/token；`currency: "USD"` 硬编码符合当前数据源。若未来 ISS-010 自动同步接入多 provider 且价格单位不同，届时在同步器里做单位换算 / 币种字段随源标注更合理。

### 项 5: TraceRequest 的历史数据迁移

**Followup**: 暂不追踪。理由：代价 4 已说明，MVP 单机、Phase 3 刚合并、无生产历史数据，直接切换新 schema。若 Phase 4-5 上线后再改 schema，届时考虑迁移。
