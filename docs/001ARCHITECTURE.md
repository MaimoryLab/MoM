# MoM 整体架构

> 风格约束（依 `000README.md`）：陈述句描述当前事实，不写历史、不写优缺点、不写"未来可以考虑"、不写被否定的方案、不放目录树。详细推理见 `decisions/`，目录树见 `002STRUCTURE.md`。

---

## 1. 系统拓扑

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Claude Code │          │  MoM 网关     │          │  Provider    │
│  (client)    │◀──HTTP──▶│  Fastify     │◀──HTTP──▶│  Anthropic   │
│              │          │  :3000       │          │  兼容 API     │
└──────────────┘          └──────┬───────┘          └──────────────┘
                                 │
             ┌───────────────────┼───────────────────┐
             │                   │                   │
       ┌─────┴─────┐    ┌────────┴────────┐    ┌────┴─────┐
       │  .env     │    │ data/           │    │  SQLite  │
       │ (L1 部署) │    │ mom.config.json │    │  mom.db  │
       │ provider  │    │ (L2 业务配置)   │    │ (L3 数据) │
       └───────────┘    └────────┬────────┘    └──────────┘
                                 ▲
                                 │
                         ┌───────┴────────┐
                         │  Dashboard     │
                         │  Vite + React  │
                         │  /dashboard/*  │
                         └────────────────┘
```

MoM 是位于 Claude Code 与 provider 之间的独立 HTTP 网关，入口协议与出口协议均为 Anthropic Messages API。Phase 1 只做请求透传。配置按读者与生命周期分三层：L1 部署配置（`.env`）承载 provider 秘钥与运行时端口；L2 业务配置（`data/mom.config.json`）承载模型选择、触发模式、定价表等；L3 运行时数据（`mom.db` via node:sqlite）承载 traces 与 metrics 缓存。Dashboard 编辑对象只是 L2，秘钥编辑走 `.env`。

---

## 2. 分层结构

```
┌────────────────────────────────────────────────┐
│  Gateway 层（Fastify 路由 / 请求校验 / SSE header + hijack） │
│  src/gateway/* + src/dashboard-api/*（Phase 4）+ src/gateway/live-api.ts（Phase 6）+ src/gateway/presets-api.ts（ISS-035） │
│    — /v1/messages          → messages-handler → OrchestratorHolder                 │
│    — /trace/*              → registerTraceAPI（ISS-011）                            │
│    — /api/config|traces|metrics|benchmarks → Phase 4 dashboard-api                  │
│    — /api/live/run         → live-api.submitLiveTurn → 202 + 后台 runLiveTurn（ISS-035）│
│    — /api/comparisons      → live-api → listRecentComparisons（ISS-035）            │
│    — /api/comparison/:gwId → live-api → live-store（Phase 6）                       │
│    — /api/presets          → presets-api（读 data/presets.json，ISS-035）           │
└────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────┐
│  Orchestrator 层（主调度 / trigger / fanout / cache / references / cost / trace） │
│  src/orchestrator/*  src/advisor/*  src/aggregator/*  src/cache/*  src/cost/* │
│  Phase 6 追加：src/live/*（Live 编排 / comparisons 存储）+ src/judge/*（judge compare 引擎）│
│    — 只依赖 RuntimeConfig + Logger 接口，不直连 Fastify / SQLite 前端 / config.json │
│    — OrchestratorHolder（Phase 4）持有 runtime 引用，POST /api/config 后 rebuild；Phase 6 起 getRuntime() 暴露给 live-runtime │
└────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────┐
│  Provider 层（HTTP 客户端 / 流式转发 + 可选 SSE 观察者）    │
│  src/provider/*  — 只依赖 ProviderConfig + NodeJS.WritableStream │
└────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────┐
│  Config 层（env 加载 / config.json 加载 / 护栏）  │
│  src/config.ts + src/config/*                   │
└────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────┐
│  Storage 层（node:sqlite / traces & metrics）    │
│  src/storage/*  — 不承载配置                     │
└────────────────────────────────────────────────┘
```

前端 `web/` 是独立 Vite 子工程，构建产物由 Fastify 静态挂载在 `/dashboard/*`。

---

## 3. 调用方向约束

- Gateway 层只调用 Orchestrator 层与 Config 层；不感知 provider 协议细节
- Orchestrator 层（`src/orchestrator/*` + `src/advisor/*` + `src/aggregator/*` + `src/cache/*` + `src/cost/*`）以 `RuntimeConfig` + 最小 `Logger` 接口为唯一依赖入口，读取 Storage 层 `saveTraceRequest` 落 trace；不依赖 Fastify、不读 config.json
- Provider 层只负责 HTTP 与 SSE 转发，签名接 `NodeJS.WritableStream` + 可选 `onEvent` 观察者，只依赖 `ProviderConfig`；不依赖 Fastify、不读 SQLite、不读 config.json
- Config 层：`src/config/provider-env.ts` 从 `process.env` 加载；`src/config/mom-config-file.ts` 从 `data/mom.config.json` 加载并原子写回；`src/config.ts` 组装 `RuntimeConfig` 并跑护栏（`assertModeRequirements`）
- Storage 层只负责 traces / metrics_cache 表的 CRUD，与配置完全解耦
- **SDK 边界**（Phase 3 起）：`Fastify` 仅出现在 `src/gateway/*`；`src/orchestrator/*` + `src/advisor/*` + `src/aggregator/*` + `src/cache/*` + `src/cost/*` + `src/provider/*` 全体业务层可作为独立 SDK 被外部项目 import
- 前端 `web/` 不直接访问 SQLite 与 config.json，只通过 HTTP 与网关交互（Dashboard 编辑 L2 走 `POST /api/config`，Phase 4+）

---

## 4. 状态持久化分类

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| L1 部署配置（provider 秘钥 / 端口 / 路径） | `.env` | Node 22 原生 `--env-file=.env` 加载；`.env` gitignore，`.env.example` 提交 |
| L2 业务配置（MoMConfig 全字段） | `data/mom.config.json` | `loadMoMConfig()` / `saveMoMConfig()` 原子读写；首次启动写入 `DEFAULT_MOM_CONFIG` |
| L3 请求 trace | SQLite `traces` 表（Phase 3 开始写入） | Phase 1 表已建、未落盘 |
| L3 Metrics 缓存 | SQLite `metrics_cache` 表 | Phase 4 使用 |
| L3 Live 对比 | SQLite `comparisons` 表（Phase 6） | 一行一 turn，PK = gateway_request_id；mom_text / baseline_text / judge JSON 存于此，元数据仍走 `traces` 表 |
| 网关运行时状态 | 无 | Fastify 无状态，重启不丢失业务数据 |

---

## 5. 核心运行时链路

**链路 0：启动装配**
```
process.env (via --env-file=.env)
  → loadProviderConfig() → ProviderConfig
data/mom.config.json (首次 ENOENT → 写入 DEFAULT_MOM_CONFIG)
  → loadMoMConfig() → MoMConfig
assertModeRequirements(MoMConfig)
  → RuntimeConfig = { provider, mom }
  → startServer(port, runtime)
```

**链路 A：非流式请求（`mom_mode !== 'always'`）— 透传**
```
Claude Code POST /v1/messages（可带 X-Session-ID header）
  → Fastify router
  → createMessagesHandler(runtime) 闭包（内含 createOrchestrator(runtime)）
  → validateMessagesRequest()
  → extractSessionId(req) 从 X-Session-ID header 读；缺失即 null
  → orchestrator.nonStreaming(body, sessionId, log) 判 mom_mode !== 'always'
  → gateway_request_id = randomUUID()
  → passthroughCall(req, provider) (undici)
  → provider POST /v1/messages
  → persistPassthroughTrace 落一条 role='passthrough' TraceRequest（session_id / gateway_request_id / started_at / finished_at / status / pricing 快照 / error 全字段落盘）
  → JSON response 直接 reply.send()
```

**链路 B：流式请求（`mom_mode !== 'always'`）— 透传 SSE**
```
Claude Code POST /v1/messages {stream:true}（可带 X-Session-ID header）
  → messages-handler.handleStreaming()：SSE header + reply.hijack()
  → orchestrator.streaming(body, sessionId, reply.raw, log) 判 mom_mode !== 'always'
  → gateway_request_id = randomUUID()
  → passthroughStream(req, reply.raw, provider, {onEvent: StreamCollector, log})
  → undici request()
  → res.body.on('data') 手动 write 到 reply.raw（字节级转发）+ 旁路喂 onEvent
  → provider SSE 逐字节转发到 Claude Code
  → persistPassthroughTrace 落一条 role='passthrough' TraceRequest（响应汇总由 StreamCollector 抽取；status 视 response 是否成型判定）
```

**链路 C：错误落地**
```
ConfigError / ProviderConfigError / MoMConfigFileError → 启动期直接 exit 1，不进请求循环
ProviderError → 原样透出 provider 的 statusCode 与响应 body（能 parse 就 parse）
ValidationError → 400 + Anthropic error JSON
其他 → 502 + gateway_error
Streaming 场景 → 错误编码为 SSE `event: error` 帧后 end()
```

**链路 D：非流式请求（`mom_mode === 'always'`）— MoM 主链路**
```
Claude Code POST /v1/messages（可带 X-Session-ID header）
  → messages-handler.handleNonStreaming()
  → extractSessionId(req) → sessionId (or null)
  → orchestrator.nonStreaming(body, sessionId, log)  // 由 createOrchestrator(runtime) 构造，闭包持有 FanoutCache
      → gateway_request_id = randomUUID()
      → isNewUserTurn(messages) + computeFanoutCacheKey(messages, mom)
      → cache.get(key)：
          HIT  → advisorResults = cloneAsCacheHit(cached)（usage=0、cache_hit=true）
          MISS → advisorResults = fanoutAdvisors(messages, mom, provider)
                   → 对每个 slot：convertToAdvisorView(messages)
                     → applyAdvisorCacheControl(system_and_3 marker 布局)
                     → passthroughCall(request, provider)
                     → AdvisorResult（含 started_at / finished_at / selected_model / response_summary）；失败以 [Reference N failed] 占位继续，绝不抛
                 cache.set(key, advisorResults)
      → computeTriggerReason(fanout_mode, isNewTurn, cacheHit) → TriggerReason（6 种标签之一）
      → persistAdvisorTraces 落 N 条 role='advisor' TraceRequest（每个 slot 一条；status=success/error/cache_hit；pricing 快照）
  → runAggregatorNonStreaming(body, advisorResults, mom, provider)
      → buildConcatReferences → appendReferencesToLastUser（仅改最后一条 message，前缀引用不变）
      → passthroughCall(aggregator request, provider)
  → persistAggregatorTrace 落 1 条 role='aggregator' TraceRequest（同 gateway_request_id 共享 session_id）
  → 若 aggregator 抛错：在 orchestrator catch 中先落一条 status='error' 的 aggregator TraceRequest 再重抛，保证 N 条 advisor + 1 条 aggregator 记录完整
  → saveTraceRequest 抛错则 log.error 吞掉，不影响响应
  → reply.send(response)
```

**链路 E：流式请求（`mom_mode === 'always'`）— MoM 主链路 + SSE 转发**
```
Claude Code POST /v1/messages {stream:true}（可带 X-Session-ID header）
  → messages-handler.handleStreaming()：设置 SSE header + reply.hijack()
  → orchestrator.streaming(body, sessionId, reply.raw, log)
      → 同链路 D 的 fanout stage（触发标签 + cache 查询 + 补跑）+ persistAdvisorTraces
      → runAggregatorStreaming(body, advisorResults, mom, provider, output, {onEvent, log})
          → 构造 aggregator request（stream=true）
          → passthroughStream(req, output, provider, {onEvent, log})
             主链路：res.body.on('data') 手动 write 到 output（字节级转发）
             旁路（onEvent 非空时）：同一 data 喂给 SSE 增量分帧器 → JSON.parse → StreamCollector
          → 内部 catch 错误后仍 return timing（started_at / finished_at / error?）
      → StreamCollector 累积 message_start / content_block_delta / message_delta 组装 AnthropicMessagesResponse
      → persistAggregatorTrace（此时 reply 已 end，落盘完全异步；response=null 时 status='error'）
```

**链路 F：透传路径 TraceRequest 落盘（`mom_mode !== 'always'`）**
```
非流式：runPassthroughNonStreaming → try { passthroughCall } catch (throw 前落 error TraceRequest) → persistPassthroughTrace(role='passthrough', trigger_reason='mom_off')
流式：  runPassthroughStreaming → try { passthroughStream } finally { persistPassthroughTrace }
        （SSE header/hijack 在 messages-handler 层已上提，透传/主链路统一）
```

**链路 G：Dashboard config 热重建（Phase 4 起）**
```
POST /api/config { mom: MoMConfig }
  → Fastify router
    → registerConfigAPI 处理
      → assertMoMConfigShape（手写 typeguard，字段级校验）
      → assertModeRequirements（always 模式非空校验）
      → saveMoMConfig(path, mom) —— 原子写盘（写 .tmp + rename）
      → runtime.mom 就地替换；runtime.mom_config_source = stampMoMConfigSource(path)
      → orchestratorHolder.rebuild() —— 用最新 runtime 重造 Orchestrator（旧 fanout cache 释放）
    → 返回 { mom, mom_config_source }

下一次 /v1/messages 请求
  → messages-handler.holder.get() 拿最新 orchestrator
  → 走 fresh advisor slots / aggregator model / pricing_table
```

**链路 H：Dashboard 观察 API（Phase 4 起，无副作用）**
```
GET /api/config                         → 返 runtime 快照（provider api_key 走 maskApiKey）
GET /api/traces?limit&offset&role&status → SELECT ... FROM traces WHERE ... LIMIT/OFFSET → 剥 settings_snapshot 返 TraceSummary[]
GET /api/traces/:request_id             → getTraceRequestById → TraceRequest 全量 / 404
GET /api/traces/by-gateway/:gid         → SELECT ... WHERE gateway_request_id = ? ORDER BY started_at ASC
GET /api/metrics?window&limit            → computeMetrics 纯函数：SELECT * FROM traces （窗口过滤）→ 内存分组 + calculateCostFromSnapshot → 5 段响应
GET /api/benchmarks                     → readFileSync data/benchmarks.json → normalizeBenchmarks；ENOENT 200 + 全空
```

**链路 I：Live Compare 一次 Run（Phase 6 起 / ISS-035 起改为异步 job）**
```
Live 页 POST /api/live/run { prompt, baseline_on, lang }
  → registerLiveAPI 校验 body
  → submitLiveTurn(input, { runtime, log })
       ├─ createComparison(gwId, sid, {advisors_snapshot, aggregator_model, baseline_model_snapshot})
       │    → INSERT INTO comparisons (status='pending', 快照 3 个模型 id)
       └─ queueMicrotask(() => runLiveTurn(input, deps, gwId, sid))
  → reply 202 { gateway_request_id }（客户端立即拿到 gwId 并开始 3s 轮询）

（后台执行）
runLiveTurn(...)
  ├─ orchestrator.nonStreaming(anthropicReq, sid, log)      // MoM 主链路
  │    ⇢ fanout advisor → aggregator，N+1 TraceRequest 落库（advisor.response_text 落 reference 全文；aggregator 落 response_text + references_appended + last_user_text）
  ├─ (并发) runBaselineCall(anthropicReq, baseline_model, provider)
  │    ⇢ 单模型 non-streaming，落 role='baseline' TraceRequest（含 response_text）
  ├─ Promise.all([mom, baseline]) 归拢
  ├─ runJudgeCompare({ momText, baselineText, lang, judge, provider })
  │    ⇢ 匿名 A/B + temperature=0 + JSON-only + safeJsonParse
  │    ⇢ 落 role='judge' TraceRequest
  ├─ MoM 失败 → updateComparisonMomError（status='error'）
  ├─ Baseline 失败 → updateComparisonBaselineError
  └─ Judge 失败 → updateComparisonJudgeError

GET /api/comparisons?limit=20                   → listRecentComparisons → ComparisonListItem[]（Live 页 Jobs 列表）
GET /api/comparison/:gateway_request_id         → getComparisonById → ComparisonRecord | 404（Live 页 3s 轮询）
DELETE /api/comparison/:gateway_request_id      → BEGIN → deleteTracesByGatewayRequestId + deleteComparison → COMMIT | ROLLBACK → DeleteComparisonResponse / 404（ISS-055）
GET /api/presets                                → 读 data/presets.json → PresetsResponse（Live 页预置按钮）
```

---

## 6. 关键约定

- **入口协议**：完整 Anthropic Messages API（`POST /v1/messages`，支持 `stream: true` SSE）
- **出口协议**：Anthropic Messages（provider 侧兼容，网关不做协议转换）
- **Provider 认证**：`.env` 中的 `PROVIDER_AUTH_STYLE` 二选一
  - `bearer` → `Authorization: Bearer <PROVIDER_API_KEY>`
  - `x-api-key` → `x-api-key: <PROVIDER_API_KEY>` + `anthropic-version: 2023-06-01`
- **配置边界**：秘钥（`PROVIDER_*`）只来自 `.env`，永不写入 `data/mom.config.json` 与 SQLite；业务配置只来自 `data/mom.config.json`；Dashboard 只编辑 L2，只只读展示 provider 状态摘要
- **模式护栏**：启动时 `assertModeRequirements()` 在 `mom_mode==='always'` 下检查 `advisor.slots` 非空且 `aggregator.model` 非空，违反则 `ConfigError` 退出
- **秘钥缺失护栏**：`.env` 中 `PROVIDER_BASE_URL` / `PROVIDER_API_KEY` 缺失或空 → `ProviderConfigError`，进程退出
- **Body 上限**：Fastify `bodyLimit: 10 MiB`
- **环境变量默认值**：`MOM_PORT=3000` / `MOM_DB_PATH=mom.db` / `MOM_CONFIG_PATH=data/mom.config.json`
- **Streaming 错误**：网关向客户端已开始 SSE 写入后，错误统一编码为 `event: error` 帧再 `end()`，不改协议
- **定价表**：不硬编码，作为 `MoMConfig.pricing_table` 存于 `data/mom.config.json`，Dashboard 可编辑（Phase 4 起）
- **Aggregator 字节级透传原则**（Phase 2 起）：`appendReferencesToLastUser` 只克隆最后一条 user message，前缀所有 message 保持原对象引用不变，保证 Claude Code 侧 cache_control 前缀命中；请求 `system` 字段亦字节级透传 Claude Code 原始 system 不动。Aggregator 侧的使用说明（`AGGREGATOR_GUIDANCE` + `AGGREGATOR_REFERENCES_HEADER`，ISS-031）走**最后一条 user 尾部注入**这一条路径，与 references 拼在同一个 text block 里，不进 `system`
- **Advisor 失败容忍**（Phase 2 起）：单个 advisor 失败以 `[Reference N — slot failed: reason]` 占位符继续拼接，aggregator 请求不中断；aggregator 自身失败按 handler 层的 ProviderError 走原样透出
- **Trace 快照范围**（Phase 2 起）：`TraceRequest.settings_snapshot: MoMConfig`——不快照 `provider.api_key` / `base_url` / `auth_style`（避免秘钥旅行到 SQLite）
- **AdvisorResult 语义**（Phase 2 起）：`usage` 是本次真实调用产生的 token 数；命中缓存时 `usage` 全部为 0、`cache_hit = true`、`latency_ms ≈ 0`
- **Trace 粒度**（ISS-009 起）：一条 `TraceRequest` = 一次网关→provider 上游 HTTP 调用。MoM `always` 模式下 1 次入口请求 = N advisor + 1 aggregator = N+1 条 TraceRequest，共享同一 `session_id` + `gateway_request_id`；透传模式 1 条
- **Session 关联键**（ISS-011 起）：`X-Session-ID` HTTP header（由 eval 侧生成 UUID 保证任务内共享）；缺失即 `session_id = null`；不读 body.metadata，不生成兜底 uuid
- **Pricing 请求时冻结**（ISS-009 起）：每条 TraceRequest 内嵌 `pricing: PricingSnapshot` — 是发起上游调用瞬间从 `momConfig.pricing_table[selected_model]` 深拷贝的快照。ISS-010 起 `pricing.currency` 从 `ModelPricing.currency` 忠实带出（网关不假设币种、不做汇率换算）；成本由 eval / dashboard 层用 `pricing × usage` 现算，网关不再落盘 `cost_usd` 字段。pricing_table 变动后历史成本可复现
- **Trigger 语义**（Phase 3 起）：`trigger_reason` 是叙述性标签，六种枚举——`mom_off` / `user_turn` / `skipped_tool_iteration` / `tool_iteration_cache_miss` / `per_iteration` / `fanout_cache_hit`；主链路控制流永远"cache 查询 → 命中即复用、未命中就补跑"，无"跳过 advisor"分支
- **Fanout cache key**（Phase 3 起）：`sha256(settings)|sha256(slots-in-original-order)|sha256(canonicalJSON(signatureMessages))`；user_turn 模式下 signatureMessages 截到最后一条真实 user message（含）；per_iteration 模式下签名全 messages；slot 顺序改变即 key 变
- **Fanout cache 结构**（Phase 3 起）：Map-based TTL + LRU（`get`/`set` 时先 delete 再 set 利用 Map 插入顺序），懒过期检查；TTL preset `5m` / `1h`
- **Advisor cache_control 布局**（Phase 3 起）：system_and_3——`system` 转 `SystemBlock[]` 挂第 1 个 `cache_control: ephemeral`，倒数 3 条非合成 ADVISORY_INSTRUCTION marker 的 message 各挂 1 个（在其最后一个 content block 上）
- **Streaming trace observer**（Phase 3 起）：`passthroughStream` 可选 `onEvent(evt: SSEEvent) => void`；主链路仍字节级 pipe 到 output，旁路增量分帧 + JSON.parse 后回调；observer 内部异常一律 `log.warn` 吞掉，不影响主转发
- **透传路径也写 trace**（Phase 3 起）：`mom_mode !== 'always'` 请求也落一条 `role='passthrough' / trigger_reason='mom_off'` 的 TraceRequest，给 Phase 4 metrics `mom_trigger_rate` 一个分母
- **Trace 落盘失败容忍**（Phase 3 起）：`saveTraceRequest` 抛错一律 `log.error` 后吞掉，不打断响应
- **Provider 错误信号双通道**（ISS-012 起）：`passthroughStream` 遇 provider 非 2xx / 网络错误时——(1) 副作用：向 output 写一条 SSE `error` 帧供客户端观察；(2) 主信号：仍抛 `ProviderError` / 原始 `Error` 让 orchestrator 层落 `status='error'` TraceRequest。写帧不吞信号，两条通道独立
- **TraceError 结构化传递**（ISS-012 起）：`AdvisorResult.error` / `AggregatorResult.error` / `TraceRequest.error` 统一为 `TraceError | null`（`type` 收窄为 `provider_error | gateway_error | advisor_error | aggregator_error`）；`toTraceError(err, fallbackType)` 位于 provider-client，四条路径（advisor / aggregator / passthrough / stream-forward）共用一个转换器，`ProviderError.statusCode` 一路带进 `TraceError.http_status`
- **Pricing source stamping**（ISS-012 起）：`RuntimeConfig.mom_config_source` 在 `getConfig(momConfigPath)` 时读文件 mtime 拼 `basename@<iso>`（stat 失败 fallback 到 basename）；orchestrator 每次 `snapshotPricing` 用此值填 `PricingSnapshot.source`
- **Dashboard API 生效方式**（Phase 4 起）：`POST /api/config` 成功后就地替换 `runtime.mom` + `runtime.mom_config_source`，调 `OrchestratorHolder.rebuild()` 重造 Orchestrator（旧 fanout cache 释放）。`messages-handler` 每次 handle 时走 `holder.get()` 拿最新实例，无需重启进程；provider 秘钥字段（`.env`）**永远不可通过 API 修改**
- **Dashboard API 命名空间**（Phase 4 起）：`/api/*` = dashboard 消费方（Config / Traces list+detail+by-gateway / Metrics 聚合 / Benchmarks 静态 / Comparison-501 占位）；`/trace/*` = eval / 客户端消费方（按 session_id 批量查）；两个命名空间并行不合并，语义与消费方不同
- **Metrics 实时聚合**（Phase 4 起）：`GET /api/metrics` 每次请求走 SQL SELECT + 内存分组，不写入 `metrics_cache` 表（schema 存在但暂未启用）
- **api_key mask 形状**（Phase 4 起）：`GET /api/config` 中 `api_key_masked = 前3 + '****' + 后2`；短 key（<5 字符）退化为 `<首字> + ****`；秘钥长度不泄漏
- **Live 入口边界**（Phase 6 起）：Live Compare 走**独立入口** `POST /api/live/run`，与 `/v1/messages` 完全解耦。`comparison.enabled` 只影响 `/api/live/run`，Claude Code 主客户端调用 `/v1/messages` 不会被 baseline+judge 拖累
- **Live turn 组合**（Phase 6 起）：一次 `POST /api/live/run` = MoM 主链路（advisor N + aggregator 1）+ baseline（可选，non-streaming）+ judge_compare（两者均产文时）。四阶段调用节奏：MoM streaming 与 baseline non-streaming **并发**发起，`Promise.all` 归拢后 **串行** judge compare
- **Live 存储切分**（Phase 6 起）：baseline / judge 的**元数据**（usage / pricing / latency / status / error）落 `traces` 表（`role='baseline'` / `role='judge'`），MoM / baseline **正文** + judge **5 维分与 A/B 映射** 落 `comparisons` 表；两者 join key = `gateway_request_id`
- **Live gwId 单源约定**（ISS-062 起）：`submitLiveTurn` 创建 `gateway_request_id` 后一路穿透 `orchestrator.nonStreaming(..., gatewayRequestIdOverride)`，让 orchestrator 内部 advisor / aggregator / baseline / judge 的所有 `saveTraceRequest` 与 `createComparison` / `updateComparisonXxx` 共享同一 gwId。此前 orchestrator 会在每次调用时内部 `randomUUID()`，导致 comparisons 与 traces 分家、Pipeline 页 `getTracesByGateway(gwId)` 永远拿不到 aggregator trace。Anthropic gateway 路径（`messages-handler.ts`）不传 override，orchestrator 自己 mint 保持"最上游"语义
- **Live 删除原子性**（ISS-055 起）：`DELETE /api/comparison/:gwId` 用一段 `BEGIN / COMMIT / ROLLBACK` 事务同时删掉两张表的记录；`metrics_cache` 不主动清（按窗口自然重建）；kiosk 轮播队列由 `useKiosk.invalidateQueue(gwId)` 事后同步，`useLiveRun.tick` 遇 404 停轮询——三者共同保证"comparison 存在 / traces 缺失"或反过来的僵尸态不出现
- **Judge 匿名 A/B**（Phase 6 起）：judge prompt 中 MoM 与 baseline 匿名为 Response A / Response B，服务端在 dispatch 前随机映射，parse 后再回填 mom / baseline 标签；`comparisons.judge_ab_mapping_json` 记录本次分配供 bias 分析
- **Judge JSON 解析降级**（Phase 6 起）：`parseJudgeCompare` 二阶段——strict `JSON.parse` → 失败退到正则抽首个 `{...}` 块再 parse，两条都失败则 `parse_error=true` + 5 维全 0 + `judge_error` 事件。regex-fallback 走通时 `fallback=true` 标记落库供 Dashboard 展示
- **Live SSE 8 事件**（Phase 6 起）：`created / mom_delta / mom_done / mom_error / baseline_done / baseline_error / judge_done / judge_error / end`；SSE `event:` 名与 payload `type` 一致；同一连接单流推完关闭

---

## 7. Dashboard 前端

Vite + React + TS 独立子工程（`web/`），构建产物挂在网关 `/dashboard/*`。Phase 5.0 交付**预览版**：数据全部走 `web/src/mock/*`，未接入后端 API 与 SSE。Phase 4 起后端 `/api/*` 命名空间已就位（`web/src/lib/api.ts` 提供 typed fetch 骨架），Page 引用切换是 Phase 5.1 的工作，`mock/*` 仍是当前 Page 的唯一数据源。

### 页面结构

五页，通过左侧固定 Sidebar 切换：

- **Overview** `pages/OverviewPage.tsx` — 4 KPI（Fable 5 / GPT 5.6 sol / MoM / Aggregator-only 平均分，数字与柱图同色）+ per-benchmark 得分柱图（`ScoreBarChart`）+ per-benchmark 成本柱图（`CostBarChart`）+ Pareto 效果-成本散点（同四家；ISS-044 起 combo 图退休、Pareto 剔除 opus47/deepseekV4Pro/kimiK26）
- **Live Compare** `pages/LivePage.tsx` — 顶部 5 个预置 prompt shelf（click 立即 Run）+ textarea 自定义输入 + Baseline checkbox + Run/Cancel 主 CTA + MoM 真 SSE 增量流出（Phase 7 起 `MarkdownBody` 渲染，支持代码块 / 表格 / 列表） + Baseline 到达后打字机播放（同样走 markdown）+ Judge 5 维雷达（correctness/completeness/depth/clarity/usefulness，Phase 6 起真调用）+ 成本对比条 + "→ 查看请求流程" 按钮（Phase 7 起，`live.gatewayRequestId` 就绪后带 gwId 跳 Pipeline 页）+ 底部相对排名图（Phase 7 起 seed=gwId 伪随机 + MoM 偏置 rank 1/2）
- **Pipeline** `pages/PipelinePage.tsx` — Phase 7 起接真 trace 数据：页顶 TurnSelect 拉 `/api/traces?limit=20&role=aggregator` 下拉 + URL `?turn=<gwId>` 双入口；选中拉 `/api/traces/by-gateway/:gwId` 得 N+1 上游 trace；节点时序从每条 trace 的 `started_at / finished_at` 反演（`compressTimeline`），总时长 > 5s 自动等比压缩；`FanoutFlow` 视图展示 user → N advisor 并行 → assembly → aggregator → final，Speed toggle 0.5x/1x/2x 与 Replay 按钮工作；`DiffModal` 从 aggregator trace `request_summary` + advisor previews 组装；passthrough turn 走 `PassthroughFlow` 单节点视图
- **Cost** `pages/CostPage.tsx` — 会话节省 banner + 4 KPI（total / per-turn / cache_hit / advisor:aggregator:judge 占比）+ 每轮堆叠柱（advisor slots + aggregator + judge）+ 组成饼图 + 5 角色 cache_read/write/miss 横向条 + 累计成本时间线（MoM vs Flagship-only）
- **Settings** `pages/SettingsPage.tsx` — 语言切换（中/EN，`localStorage` 持久化） + Provider 遮罩摘要（只读，秘钥编辑走 `.env`） + Aggregator / Advisor slots / Judge / Comparison / Pricing 表单

### 双语（i18n）

自研，未引入 i18next：`i18n/dict.ts`（中英字典）+ `i18n/context.tsx`（`I18nProvider` + `useI18n()`）+ `i18n/format.ts`（成本 / 延迟 / token 数按 locale 格式化）。默认语言取 `navigator.language`（`zh-*` → zh，其他 → en）。**术语保留英文**：token / cache hit / latency / SSE / Aggregator / Advisor / Judge；叙述性文字本地化。切换语言同步切换 `mock/live-samples.ts` 里预置 prompt 与回复的语言。

### 数据源

Phase 5.0 起 mock 逐 Phase 退休：

- `mock/benchmarks.ts` — Pareto 三点 + per-benchmark combo（当前仍 mock，未挪到 `/api/benchmarks`；后端接口已就位）
- `mock/live-samples.ts` — Phase 6 起精简为 5 个预置 prompt 的中英文本（`getPresetPrompt(preset, lang)`）；MoM/Baseline/Judge 回复已退休，改由 `/api/live/run` 真调用产生
- `mock/pipeline-trace.ts` — Phase 7 起退休：pipeline 页数据源改走 `/api/traces?role=aggregator` + `/api/traces/by-gateway/:gwId`；文件保留 `PipelineCopy` 类型定义与 Diff modal fallback 空态字符串（本轮尚未清理，Phase 8+ 可删）
- `mock/live-ranking.ts` — Phase 7 起改为 `getRankingSeries(seed)` 纯函数：MoM rank 分布 70%/30%（rank 1/2）+ 其余两家均匀分配剩余 rank；seed=gwId 时视觉每次 Run 变
- `mock/cost.ts` — 32 turns session 成本 + cache 命中（Phase 8 接 `/api/metrics`）
- `mock/config.ts` — Settings 初值 + 模型下拉候选（Phase 8 接 `/api/config`）

`hooks/useTypewriter.ts` 前端播放假流式；`hooks/useEventSource.ts` 空壳，签名与未来 SSE 一致。
Phase 7 起 `App.tsx` 用 hash-based 路由 (`#pipeline?turn=<gwId>`)，`navigateTo(page, turn?)` 由 App 导出供 LivePage 跳转；`lib/timing.ts` 与 `lib/rankSeed.ts` 提供两个纯函数库（时序压缩 + 决定性伪随机）；`components/primitives/MarkdownBody.tsx` 是 react-markdown + remark-gfm 封装，供 LivePage 输出栏与未来其他 markdown 场景共用。

### 视觉体系

- 底色 `#FBF7EE`（奶油色）+ 卡片浅描边 `#EADFC7` + 大留白
- 主色 clay orange `#C96442`（MoM 本身与主动作按钮）
- 图表三色带：MoM = clay / Baseline = slate `#7A8A99` / Flagship = moss `#5F8C6B`；辅助色 `#B8A175`（judge）/ `#9C8CB3`（cache）
- 字体：`ui-serif`（标题）+ `ui-sans-serif`（正文）+ `ui-monospace`（token/代码）
- 圆角 14px，阴影 `0 1px 2px rgba(50,30,10,.04), 0 8px 24px rgba(50,30,10,.05)`
- 图表库 Recharts；不做暗色主题
