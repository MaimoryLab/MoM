# 008. Phase 4 Dashboard 后端 API 形状与生效方式

**日期**：2026-07-14
**状态**：已决策
**关联 Issue**：ISS-032

## 背景

Phase 3 已经把每次上游调用落成 `TraceRequest` 到 SQLite `traces` 表（含 session_id / gateway_request_id 索引），Phase 5.0 也交付了五页 mock-first 预览版；Dashboard 与真实数据之间隔着一整层未实现的 `/api/*` REST API。用户在 2026-07-14 明确要求"Phase 4 完成，供前端 dashboard 使用"，同时立了两条硬约束——"从第一性原理实现"、"不在旧基础上打补丁"。

进入设计前，四个"决定长期形状"的分叉先与用户对齐（AskUserQuestion 两轮共 7 题），全部取推荐项，等价于把方案 A 系一次性锁定。核心分叉与决策如下：

| # | 分叉 | 决策 |
|---|---|---|
| 1 | 执行边界（8 端点全落 vs 只做 config vs 命名空间合并） | 只做后端 API + 前端类型骨架，前端 mock 引用不动（Phase 5.1 再替换） |
| 2 | `POST /api/config` 生效方式（hot reload / 落盘要重启 / 分级 hot） | Hot reload：整个 orchestrator rebuild，旧 fanout cache 丢弃 |
| 3 | Pipeline diff 数据来源（保 canned / trace schema 加 messages 全量 / 只对最近 N 条落全量） | 保 canned mock，trace schema 不动（不加 `messages_before/after` 字段） |
| 4 | Metrics 端点粒度（合一个大对象 / 拆 4 个 REST 子路径） | 合并成一个大对象（`{ summary, per_turn, by_role, cache_hit_by_model, timeline }`） |
| 5 | Cost 页 turn 语义（每 `/v1/messages` = 1 turn / 按 real user message / 按 session） | 每次 `/v1/messages` = 1 turn，`GROUP BY gateway_request_id` |
| 6 | Benchmarks 数据源（只读静态 JSON / 前端保 mock / 后端支持读写） | 只读静态 `data/benchmarks.json`；缺失文件 200 + 空态 |
| 7 | `api_key_masked` 长度策略（固定 mask / 前 3 + 后 4 + 中间真长度） | 固定 mask（前 3 + `****` + 后 2），秘钥长度不泄漏 |
| 8 | traces 为空时 API 行为（空态 / fallback demo / 前端 fallback） | 后端返空态；前端不做 fallback demo |
| 9 | Metrics 聚合何时算（实时 SQL / metrics_cache 表 60s TTL / 最近 N 条） | 每次请求实时 SQL 聚合（MVP QPS 不高） |
| 10 | Dashboard 前端如何访问 `/api/*`（Vite dev proxy / Fastify 开 CORS / 开发也走静态） | Vite dev proxy + 生产同域，Fastify 不开 CORS |

## 被否定的方案

### 方案 A：只做 `/api/config` 一个端点，其余端点留 Phase 5.1

否定原因：Cost / Pipeline 两页真数据观察缺口不解决——展会现场调 slots 后想看效果只能 `sqlite3 mom.db 'SELECT ...'`；`future-plans/001-dashboard-api-shape-reconciliation.md` 明确 Phase 4 是 Phase 5.1 前置项，切走一半 = 前置项没完成。

### 方案 B：`/api/*` 与 `/trace/*` 合并为同一命名空间

否定原因：违反 decision 006 方案 F。`/trace/requests` 是 eval / 客户端视角的批量查询（按 session_id），`/api/traces` 是 dashboard 视角的分页 + 单条 detail + gateway 组合查；消费方语义不同、错误映射不同、验证参数不同。合并后接口签名同时承载两组语义，长期形状不稳。

### 方案 C：`POST /api/config` 保存后要求人工重启进程

否定原因：展会现场调 aggregator / advisor slots / pricing 是主用例，"改 → 重启 → 再演示"打断动线；Node 22 + Fastify 不支持热重载但 orchestrator 本身是 pure factory（`createOrchestrator(runtime)`），rebuild 成本 < 10ms，不需要重启进程。

### 方案 D：`POST /api/config` 只 hot 一部分字段（pricing hot / mom_mode 需重启）

否定原因：分级白名单会引入"pricing 已生效但 fanout cache 复用了旧 slots 结果"的隐性 bug 面。全 rebuild + 丢 cache 更纯净，代价是主动清一次缓存——展会 QPS 下影响 < 1s 冷启动。

### 方案 E：TraceRequest 加 `messages_before/after` 字段以支持 Pipeline diff 从真 trace 反演

否定原因：一次 100k token 的 tool iteration turn 会让每条 trace 占几 MB，`traces` 表膨胀速度倍增（Phase 3 每请求 N+1 条）；且 Pipeline 页 diff 展示"references 拼接位置"是叙事需要，用 canned mock 完全够用。真需要"任意 turn 都可回放"再另开 issue。

### 方案 F：Metrics 拆 4 个 REST 子路径

否定原因：Cost 页需要 summary + per_turn + by_role + cache_hit_by_model + timeline 五段同步 render，拆 4 个端点等于前端要并发 fetch + 合并 loading 状态，SQLite 侧要么共用 CTE（抽公共聚合层）要么 4 次全表扫描；一次响应聚合 <100 KiB，走一个大对象是净收益。

### 方案 G：`api_key_masked` 保留真长度（前 3 + 后 4 + 中间真长度星号）

否定原因：泄漏 key 长度信息（37 星号 vs 45 星号 vs 51 星号大概能猜出是哪家 provider 的秘钥格式）。固定 mask 简单、安全、够用。

### 方案 H：traces 为空时后端返回内置 demo 数据

否定原因：违反"从第一性原理实现，不打补丁"的用户约束。行为骗用户、代码里有 fallback 分支永远长在那儿。空态就是空态——展会前先跑几个真请求就有数据。

### 方案 I：GET /api/metrics 走 metrics_cache 表 60s TTL

否定原因：Phase 4 是 MVP，`traces` 表量 < 10k 行时 SQLite 一次 SELECT + GROUP BY 就完事，metrics_cache 引入的 invalidate 复杂度、和 pricing / trace schema 变动时的一致性维护成本，收益太低。SQLite schema 里 `metrics_cache` 表还保留（`db.ts` schema 里 Phase 1 就建了），等真出现性能瓶颈再启用。

### 方案 J：Fastify 开 `@fastify/cors`，前后端不同源

否定原因：CLI 本地场景不需要跨域；生产 Fastify 静态挂 `web/dist` 到 `/dashboard/*`，前端 `fetch('/api/...')` 走同域 relative path；开发时 Vite `server.proxy` 已经把 `/api → :3000` 转发（`web/vite.config.ts` Phase 5.0 已配好）。开 CORS 反而增加安全面。

### 方案 K：Dashboard 前端 dev 也走 Fastify 静态

否定原因：开发时每次改 tsx 都要 `npm run build:web` 无法接受，Vite HMR 才是开发体验。已有 vite.config.ts 的 proxy 配置就是为这个场景设计。

## 最终决策

### 目录与文件

新增：
- `src/dashboard-api/config-api.ts` — `GET /api/config` / `POST /api/config`
- `src/dashboard-api/traces-api.ts` — `GET /api/traces` / `GET /api/traces/:request_id` / `GET /api/traces/by-gateway/:gateway_request_id`
- `src/dashboard-api/metrics-api.ts` — `GET /api/metrics`
- `src/dashboard-api/benchmarks-api.ts` — `GET /api/benchmarks`
- `src/types/dashboard-api.ts` — 前后端共享的响应类型（`ConfigResponse` / `TraceSummary` / `TracesListResponse` / `MetricsResponse` / `BenchmarksResponse`）
- `data/benchmarks.json` — 评测组维护，仓库提交（不含秘钥或 traces）
- `web/src/lib/api.ts` — 只出 TS 类型 re-export + 类型化 fetch 骨架（不改 Page 引用）

修改：
- `src/gateway/server.ts` — 挂载 `/api/*` 路由 + 引入 `OrchestratorHolder`（mutable holder，POST /api/config 后 rebuild）
- `src/gateway/messages-handler.ts` — 签名从 `orchestrator` 改为 `getOrchestrator: () => Orchestrator`，每次 handle 时读最新
- `src/types/mom.ts` — 已有类型不动；新增 dashboard-api 专用类型全放 `src/types/dashboard-api.ts`

### API 契约

**Config**：

```
GET /api/config
→ 200 {
    mom: MoMConfig,                   // data/mom.config.json 全量（永不含秘钥）
    provider: {
      base_url: string,               // .env 回显
      auth_style: 'bearer' | 'x-api-key',
      api_key_masked: string,         // 固定 "前3 + '****' + 后2"，长度 8-12 字符
    },
    mom_config_source: string,        // "mom.config.json@<mtime iso>"
  }

POST /api/config
Body: { mom: MoMConfig }              // 只接受 mom；provider / mom_config_source 拒绝
→ 200 { mom: MoMConfig, mom_config_source: string }  // 回显新的 source
→ 400 { type: 'error', error: { type: 'invalid_request_error', message: '...' } }
  - 缺 mom 字段 / 类型不匹配 / assertModeRequirements 失败 / MoMConfig 字段校验失败

副作用（成功时）：
1. saveMoMConfig(path, cfg) 原子写盘
2. runtime.mom 就地替换 + runtime.mom_config_source 用 stampMoMConfigSource 重算
3. orchestratorHolder.rebuild()（新 fanout cache）
```

**Traces**：

```
GET /api/traces?limit=100&offset=0&role=&status=
→ 200 {
    items: TraceSummary[],            // 轻结构：request_id / session_id / gateway_request_id / role / selected_model / provider / started_at / duration_ms / status / trigger_reason / cache_hit / usage / pricing_snapshot / error?
    total: number,
    limit: number,
    offset: number,
  }

GET /api/traces/:request_id
→ 200 TraceRequest                    // 全量，含 settings_snapshot
→ 404 { type: 'error', error: { type: 'not_found', message: '...' } }

GET /api/traces/by-gateway/:gateway_request_id
→ 200 { gateway_request_id: string, requests: TraceRequest[] }  // 按 started_at ASC，全量
```

**Metrics**：

```
GET /api/metrics?window=last_24h|last_7d|all&limit=32
→ 200 {
    window: 'last_24h' | 'last_7d' | 'all',
    summary: {
      request_count: number,          // 入口请求数（distinct gateway_request_id）
      mom_trigger_count: number,      // 触发 fanout 的入口请求数
      mom_trigger_rate: number,       // mom_trigger_count / request_count
      avg_latency_ms: number,         // 入口请求平均耗时（gateway_request 层，MAX(finished_at) - MIN(started_at)）
      total_cost_usd: number | null,  // 汇总所有 trace 的 usage × pricing_snapshot；缺 pricing 的 trace 记 null 参与
      total_baseline_cost_usd: null,  // Phase 6 才有，Phase 4 永为 null
      cache_hit_rate: number,         // advisor cache_hit 率（advisor 层，分子 = cache_hit=true，分母 = role='advisor' 的 trace 数）
      total_usage: {                  // 全窗口 usage 分层
        advisor:    { input_tokens, cache_read_tokens, cache_creation_tokens, output_tokens, reasoning_tokens },
        aggregator: { ... },
        judge:      { ... },         // 永为 0（Phase 6 才有）
      },
    },
    per_turn: [{                      // 每个 gateway_request_id 一行，按 min(started_at) DESC，取前 limit 条
      gateway_request_id: string,
      started_at: number,
      total_cost_usd: number | null,
      advisor_cost_usd: number | null,
      aggregator_cost_usd: number | null,
      total_latency_ms: number,
      trigger_reason: TriggerReason,
    }],
    by_role: [{ role: 'advisor'|'aggregator'|'passthrough', cost_usd: number | null }],
    cache_hit_by_model: [{ selected_model: string, role, hit_count, total_count, rate }],
    timeline: [{ gateway_request_id: string, started_at: number, cost_usd: number | null }],
  }
```

**Benchmarks**（静态 JSON）：

```
GET /api/benchmarks
→ 200 {
    hero_stats: { score_of_flagship_pct, cost_savings_vs_flagship_pct, latency_delta_sec } | null,
    pareto_data: ParetoPoint[],
    pareto_frontier: Array<{ score, cost }>,
    per_benchmark: BenchRow[],
  }
    - 文件缺失 / 空文件时返 200 + 全字段空数组 + hero_stats: null（前端处理 empty state）
```

**Comparison**（Phase 6 占位）：

```
GET /api/comparison/:trace_id
→ 501 { type: 'error', error: { type: 'not_implemented', message: 'comparison endpoint arrives in Phase 6' } }
```

**错误响应格式**：与 `/trace/requests` 一致——`{ type: 'error', error: { type: string, message: string } }`。所有 `4xx`/`5xx` 严格遵循。

### 生效机制

- Fastify 启动时 `createServer(runtime)` 构造 `OrchestratorHolder`：
  ```ts
  const holder = createOrchestratorHolder(runtime);
  app.post('/v1/messages', createMessagesHandler(runtime, holder));
  registerConfigAPI(app, runtime, holder);  // holder 传下去
  ```
- `createOrchestratorHolder` 内部 `{ current: createOrchestrator(runtime) }`，暴露 `.get()` 和 `.rebuild()`
- `POST /api/config` 落盘成功后调 `holder.rebuild()`，rebuild 时用当前 runtime 重建（runtime.mom 已就地替换）；老 orchestrator 及其 fanout cache 引用被释放
- `messages-handler` 每次 handle 时 `holder.get()` 拿最新（此处代价 = 1 次属性读，可忽略）

### 空态与静态数据

- traces 为空：`GET /api/metrics` 返 `{ summary: { request_count: 0, ... }, per_turn: [], by_role: [], ... }`；`GET /api/traces` 返 `{ items: [], total: 0, ... }`
- benchmarks 文件缺：`GET /api/benchmarks` 返所有数组为空 + `hero_stats: null`
- 前端不做 mock fallback（Phase 5.1 才接进 Page），Phase 4 只保证响应形状可用

### 前端骨架（不改 Page）

- 新增 `web/src/lib/api.ts`：
  - re-export `src/types/dashboard-api.ts` 里的所有响应类型（Phase 5.1 前端消费时不再重复定义）
  - 提供 `apiGet<T>(path)` / `apiPost<T>(path, body)`：类型化 `fetch` 包装 + 统一错误映射
  - 提供 5 个具体端点的 wrapper：`getConfig()` / `saveConfig(mom)` / `listTraces(query)` / `getTrace(id)` / `getMetrics(window)` / `getBenchmarks()`
  - **不改任何 Page 的引用**——Page 继续读 `mock/*`，`lib/api.ts` 只是"随时可切换"的备胎（引用切换是 Phase 5.1 的事）

前端此期只有 `web/src/lib/api.ts` 一个新文件；`vite.config.ts` 的 `server.proxy` 已在 Phase 5.0 配好 `/api → :3000`，本次不改。

## 已知代价

### 代价 1: `POST /api/config` 后旧 fanout cache 丢弃 → 短暂 cache miss 集中
所有正在缓存内的 advisor 结果被释放，rebuild 后前几个请求都会走真 fanout（比正常 hit 慢 500-2000ms）。
**Followup**: 暂不追踪（展会现场 QPS 极低，冷启动 1-2s 不敏感；如果实测明显，Phase 5.1 再评估"pricing-only hot 不清 cache"的分级方案）

### 代价 2: traces 表实时 SQL 聚合，量大时可能慢
`traces` 表 > 50k 行时 metrics 端点响应会到几百 ms（都是 GROUP BY + SUM），未走 index 的分组字段可能全表扫。
**Followup**: 未来 pipe 到 metrics_cache 表（schema Phase 1 已建，此期未启用）；也可以给 `role` 加索引。用户实际负载观察后再决定。

### 代价 3: 前端 mock 与后端 API 字段命名不完全一致
mock 里的 `momComposite / aggregatorOnly / flagship` labelKey 是前端 i18n 用，后端 API 走 domain 字段（`role: 'advisor'|'aggregator'`）；Phase 5.1 替换时需要写映射层。
**Followup**: `future-plans/001-dashboard-api-shape-reconciliation.md`（本次不解决，仅记录）

### 代价 4: `settings_snapshot` 仍留在每条 TraceRequest 里
ISS-013 已识别 settings_snapshot 冗余的技术债（Phase 4 metrics 用不到），本次 API 也不消费它，但为了保持 trace schema 稳定不清理；`/api/traces/:id` 返回时会带上，前端可自行忽略。
**Followup**: ISS-013（暂缓，与本次 Phase 4 无直接冲突）

### 代价 5: `POST /api/config` 不做字段级 diff / 变更历史
前端每次 save 会送来整个 MoMConfig，后端整份写盘 + rebuild orchestrator；用户回滚需要自行保存 diff。
**Followup**: 暂不追踪（decision 002 定的"data/mom.config.json 由 Dashboard 或手工编辑"，git 上生产不追踪该文件；用户想要历史可以自己 git track）

## 不在本期范围

### 项 1: 前端 Page 引用真 API（`mock/*` → `lib/api.ts`）
Phase 5.1 的核心工作。本期只把 API 与 lib/api.ts 类型骨架落地，前端消费方式不动。
**Followup**: PLAN Phase 5.1；future-plans/001

### 项 2: `GET /api/comparison/:trace_id` 真实数据
Phase 6 事项。本期返 501，占位。
**Followup**: PLAN Phase 6

### 项 3: metrics_cache 表启用
未来 traces 量大后再评估。schema 存在但不写。
**Followup**: 暂不追踪

### 项 4: 长期 pricing sync（`scripts/sync-pricing.mjs` 触发方式）
sync 脚本已存在（ISS-010），Dashboard 不做"点击同步 pricing"按钮；用户仍手动跑 `npm run sync-pricing`。
**Followup**: 暂不追踪

### 项 5: SSE 端点接进 Dashboard（真流式效果播放）
Phase 5.1 才做（`hooks/useEventSource.ts` 目前是空壳）。本期 `/v1/messages` 支持 stream 依然只对 Claude Code 客户端有效，Dashboard 不消费。
**Followup**: PLAN Phase 5.1；future-plans/001

### 项 6: 认证 / 授权
Phase 4 假定本地运行、无认证；上线远期版本再加（会一并覆盖 `/v1/messages` 与 `/api/*`）。
**Followup**: 未新开 issue，`docs/006API.md §1.3` 早已记录
