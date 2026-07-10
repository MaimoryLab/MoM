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
│  Gateway 层（Fastify 路由 / 请求校验 / SSE）      │
│  src/gateway/*                                  │
└────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────┐
│  Orchestrator 层（主调度 / fanout / references）  │
│  src/orchestrator/*  src/advisor/*  src/aggregator/* │
│    — 只依赖 RuntimeConfig，不直连 SQLite / config.json │
└────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────┐
│  Provider 层（HTTP 客户端 / 流式转发）            │
│  src/provider/*  — 只依赖 ProviderConfig         │
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
- Orchestrator 层（`src/orchestrator/*` + `src/advisor/*` + `src/aggregator/*`）以 `RuntimeConfig` 为唯一依赖入口，调用 Provider 层完成 advisor fan-out 与 aggregator 请求；不读 SQLite、不读 config.json
- Provider 层只负责 HTTP 与 SSE 转发，只依赖启动时装配好的 `ProviderConfig`；不读 SQLite、不读 config.json
- Config 层：`src/config/provider-env.ts` 从 `process.env` 加载；`src/config/mom-config-file.ts` 从 `data/mom.config.json` 加载并原子写回；`src/config.ts` 组装 `RuntimeConfig` 并跑护栏（`assertRecursionGuard` + `assertModeRequirements`）
- Storage 层只负责 traces / metrics_cache 表的 CRUD，与配置完全解耦
- 前端 `web/` 不直接访问 SQLite 与 config.json，只通过 HTTP 与网关交互（Dashboard 编辑 L2 走 `POST /api/config`，Phase 4+）

---

## 4. 状态持久化分类

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| L1 部署配置（provider 秘钥 / 端口 / 路径） | `.env` | Node 22 原生 `--env-file=.env` 加载；`.env` gitignore，`.env.example` 提交 |
| L2 业务配置（MoMConfig 全字段） | `data/mom.config.json` | `loadMoMConfig()` / `saveMoMConfig()` 原子读写；首次启动写入 `DEFAULT_MOM_CONFIG` |
| L3 请求 trace | SQLite `traces` 表（Phase 3 开始写入） | Phase 1 表已建、未落盘 |
| L3 Metrics 缓存 | SQLite `metrics_cache` 表 | Phase 4 使用 |
| 网关运行时状态 | 无 | Fastify 无状态，重启不丢失业务数据 |

---

## 5. 核心运行时链路

**链路 0：启动装配**
```
process.env (via --env-file=.env)
  → loadProviderConfig() → ProviderConfig
data/mom.config.json (首次 ENOENT → 写入 DEFAULT_MOM_CONFIG)
  → loadMoMConfig() → MoMConfig
assertRecursionGuard(MoMConfig) + assertModeRequirements(MoMConfig)
  → RuntimeConfig = { provider, mom }
  → startServer(port, runtime)
```

**链路 A：非流式请求（`mom_mode !== 'always'`）— 透传**
```
Claude Code POST /v1/messages
  → Fastify router
  → createMessagesHandler(runtime) 闭包
  → validateMessagesRequest()
  → orchestrate() 判 mom_mode !== 'always'
  → passthroughCall(req, provider) (undici)
  → provider POST /v1/messages
  → JSON response 直接 reply.send()
```

**链路 B：流式请求（`mom_mode !== 'always'`）— 透传 SSE**
```
Claude Code POST /v1/messages {stream:true}
  → orchestrate() 判 mom_mode !== 'always'
  → passthroughStream(req, reply, provider)
  → undici request()
  → reply.hijack() + res.body.pipe(reply.raw)
  → provider SSE 逐字节转发到 Claude Code
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
Claude Code POST /v1/messages
  → orchestrate() 判 mom_mode === 'always'
  → fanoutAdvisors(body.messages, mom, provider)
      → 对每个 slot：convertToAdvisorView(messages)
        → passthroughCall(request with system=ADVISOR_SYSTEM_PROMPT, stream=false, provider)
        → AdvisorResult；失败以占位符返回，绝不抛
      → promisePool 并发 8，保 slots 顺序
  → runAggregatorNonStreaming(body, advisorResults, mom, provider)
      → buildConcatReferences → appendReferencesToLastUser（仅改最后一条 message，前缀引用不变）
      → passthroughCall(aggregator request, provider)
  → reply.send(response)；fastify logger 打 fanout / aggregator 事件
```

**链路 E：流式请求（`mom_mode === 'always'`）— MoM 主链路 + SSE 转发**
```
Claude Code POST /v1/messages {stream:true}
  → orchestrate() 判 mom_mode === 'always'
  → fanoutAdvisors(...) 同链路 D（advisor 侧非流式）
  → runAggregatorStreaming(body, advisorResults, mom, provider, reply)
      → 构造 aggregator request（stream=true）
      → passthroughStream(...)：res.body.pipe(reply.raw) 字节级转发
      （Phase 2 不 tee/parse；Phase 3 引入 trace 落盘时再加 SSE observer）
```

---

## 6. 关键约定

- **入口协议**：完整 Anthropic Messages API（`POST /v1/messages`，支持 `stream: true` SSE）
- **出口协议**：Anthropic Messages（provider 侧兼容，网关不做协议转换）
- **Provider 认证**：`.env` 中的 `PROVIDER_AUTH_STYLE` 二选一
  - `bearer` → `Authorization: Bearer <PROVIDER_API_KEY>`
  - `x-api-key` → `x-api-key: <PROVIDER_API_KEY>` + `anthropic-version: 2023-06-01`
- **配置边界**：秘钥（`PROVIDER_*`）只来自 `.env`，永不写入 `data/mom.config.json` 与 SQLite；业务配置只来自 `data/mom.config.json`；Dashboard 只编辑 L2，只只读展示 provider 状态摘要
- **递归护栏**：启动时 `assertRecursionGuard()` 检查 `momConfig.aggregator.model ∉ momConfig.advisor.slots`，违反则进程退出（`ConfigError`）
- **模式护栏**：启动时 `assertModeRequirements()` 在 `mom_mode==='always'` 下检查 `advisor.slots` 非空且 `aggregator.model` 非空，违反则 `ConfigError` 退出
- **秘钥缺失护栏**：`.env` 中 `PROVIDER_BASE_URL` / `PROVIDER_API_KEY` 缺失或空 → `ProviderConfigError`，进程退出
- **Body 上限**：Fastify `bodyLimit: 10 MiB`
- **环境变量默认值**：`MOM_PORT=3000` / `MOM_DB_PATH=mom.db` / `MOM_CONFIG_PATH=data/mom.config.json`
- **Streaming 错误**：网关向客户端已开始 SSE 写入后，错误统一编码为 `event: error` 帧再 `end()`，不改协议
- **定价表**：不硬编码，作为 `MoMConfig.pricing_table` 存于 `data/mom.config.json`，Dashboard 可编辑（Phase 4 起）
- **Aggregator 字节级透传原则**（Phase 2 起）：`appendReferencesToLastUser` 只克隆最后一条 user message，前缀所有 message 保持原对象引用不变，保证 Claude Code 侧 cache_control 前缀命中
- **Advisor 失败容忍**（Phase 2 起）：单个 advisor 失败以 `[Reference N — slot failed: reason]` 占位符继续拼接，aggregator 请求不中断；aggregator 自身失败按 handler 层的 ProviderError 走原样透出
- **Trace 快照范围**（Phase 2 起）：`Trace.settings_snapshot: MoMConfig`——不快照 `provider.api_key` / `base_url` / `auth_style`（避免秘钥旅行到 SQLite）
- **AdvisorResult 语义**（Phase 2 起）：`usage` 是本次真实调用产生的 token 数；命中缓存时 `usage` 全部为 0、`cache_hit = true`、`latency_ms ≈ 0`
- **成本汇总语义**（Phase 3 起）：`trace.total_cost_usd` = advisor + aggregator + judge；`baseline_cost_usd` 独立字段
