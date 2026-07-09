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
                          ┌──────┴──────┐
                          │  SQLite     │
                          │  mom.db     │
                          └─────────────┘
                                 ▲
                                 │
                         ┌───────┴────────┐
                         │  Dashboard     │
                         │  Vite + React  │
                         │  /dashboard/*  │
                         └────────────────┘
```

MoM 是位于 Claude Code 与 provider 之间的独立 HTTP 网关，入口协议与出口协议均为 Anthropic Messages API。Phase 1 只做请求透传，SQLite（通过 Node 内置 `node:sqlite`）用于持久化 settings。

---

## 2. 分层结构

```
┌────────────────────────────────────────────┐
│  Gateway 层（Fastify 路由 / 请求校验 / SSE）  │
│  src/gateway/*                              │
└────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│  Provider 层（HTTP 客户端 / 流式转发）        │
│  src/provider/*                             │
└────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│  Storage 层（node:sqlite / settings CRUD）  │
│  src/storage/*                              │
└────────────────────────────────────────────┘
```

前端 `web/` 是独立 Vite 子工程，构建产物由 Fastify 静态挂载在 `/dashboard/*`。

---

## 3. 调用方向约束

- Gateway 层只调用 Provider 层与 Storage 层，不感知 provider 的具体协议细节
- Provider 层只负责 HTTP 与 SSE 转发，不读 settings 表；`settings` 由调用方（gateway）通过参数传入
- Storage 层不感知 HTTP 与请求上下文，只暴露纯函数式 CRUD
- `src/config.ts` 是 Storage 层之上的组合模块，加载 settings 并执行启动期校验
- 前端 `web/` 不直接访问 SQLite，只通过 HTTP 与网关交互

---

## 4. 状态持久化分类

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| 全局 settings | SQLite `settings` 表（单行 id=1） | 通过 `loadSettings()` / `saveSettings()` 读写 |
| 请求 trace | SQLite `traces` 表（Phase 3 开始写入） | Phase 1 表已建、未落盘 |
| Metrics 缓存 | SQLite `metrics_cache` 表 | Phase 4 使用 |
| 网关运行时状态 | 无 | Fastify 无状态，重启不丢失业务数据 |

---

## 5. 核心运行时链路

**链路 A：非流式请求透传**
```
Claude Code POST /v1/messages
  → Fastify router
  → handleMessages()
  → validateMessagesRequest()
  → loadSettings()
  → passthroughCall() (undici)
  → provider POST /v1/messages
  → JSON response 直接 reply.send()
```

**链路 B：流式请求透传（SSE）**
```
Claude Code POST /v1/messages {stream:true}
  → handleMessages()
  → passthroughStream()
  → undici request()
  → reply.hijack() + res.body.pipe(reply.raw)
  → provider SSE 逐字节转发到 Claude Code
```

**链路 C：错误落地**
```
ProviderError → 原样透出 provider 的 statusCode 与响应 body（能 parse 就 parse）
ValidationError → 400 + Anthropic error JSON
其他 → 502 + gateway_error
Streaming 场景 → 错误编码为 SSE `event: error` 帧后 end()
```

---

## 6. 关键约定

- **入口协议**：完整 Anthropic Messages API（`POST /v1/messages`，支持 `stream: true` SSE）
- **出口协议**：Anthropic Messages（provider 侧兼容，网关不做协议转换）
- **Provider 认证**：`settings.provider.auth_style` 二选一
  - `bearer` → `Authorization: Bearer <api_key>`
  - `x-api-key` → `x-api-key: <api_key>` + `anthropic-version: 2023-06-01`
- **递归护栏**：启动时 `assertRecursionGuard()` 检查 `aggregator.model ∉ advisor.slots`，违反则进程退出（`ConfigError`）
- **Body 上限**：Fastify `bodyLimit: 10 MiB`
- **数据库路径**：环境变量 `MOM_DB_PATH`，默认 `./mom.db`
- **端口**：环境变量 `MOM_PORT`，默认 `3000`
- **Streaming 错误**：网关向客户端已开始 SSE 写入后，错误统一编码为 `event: error` 帧再 `end()`，不改协议
- **定价表**：不硬编码，作为 `settings.provider.pricing_table` 存 SQLite，Dashboard 可编辑（Phase 4 起）
- **AdvisorResult 语义**（Phase 2 起）：`usage` 是本次真实调用产生的 token 数；命中缓存时 `usage` 全部为 0、`cache_hit = true`、`latency_ms ≈ 0`
- **成本汇总语义**（Phase 3 起）：`trace.total_cost_usd` = advisor + aggregator + judge；`baseline_cost_usd` 独立字段
