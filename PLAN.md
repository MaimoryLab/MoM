# MoM (Mixture of Models) — 分阶段实施计划

## Context

MoM 是位于 Claude Code 与 provider 之间的独立 HTTP 网关，对标 OpenRouter Fusion，实现"多个廉价模型组合逼近旗舰模型能力"。第一版只面向 Claude Code（Anthropic Messages API 协议），只对接一个 provider baseURL（该 provider 侧配多个 model 名），不实现成本权衡功能（另有独立项目后期合并）。目标交付三件事：统一数据结构、MoM 网关本体、可反映效果的 Dashboard（含展示层 / 设置层 / 日志调试层 / 用户展示层）。

---

## 阶段总览

| 阶段 | 名称 | 状态 | 一句话说明 |
|------|------|------|-----------|
| Phase 1 | 骨架 + 协议透传（含 Streaming） | ✅ 已完成 | Node/TS 单进程服务、Anthropic Messages 端点、SSE 流式透传、node:sqlite、Vite 前端骨架 |
| Phase 2 | Advisor 视图 + Fan-out + Concat 拼接 | 📋 待开始 | MoM 核心流程，always 触发、无缓存 |
| Phase 3 | 触发粒度 + Fanout 缓存 + Cache 装饰 + 成本分账 | 📋 待开始 | user_turn / per_iteration 双模式、advisor 缓存、system_and_3 marker、Trace 落盘 |
| Phase 4 | Dashboard 后端 API | 📝 略写 | traces / metrics / settings / comparison 四组 API |
| Phase 5 | Dashboard 前端三层 | 📝 略写 | 设置层 / 日志调试层 / 用户展示层 |
| Phase 6 | Judge 模式 + 对比展示层 | 📝 略写 | 五类 JSON 结构化整合、并排 baseline 对比 |

> 依赖链：Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5，Phase 6 可与 4/5 并行。

---

## 架构概览

### 技术栈
- 运行时：Node.js ≥ 22.13 + TypeScript 5.x（node:sqlite 从 v22.13.0 起脱离 experimental，无需 `--experimental-sqlite` flag）
- 网关框架：Fastify（原生 SSE 支持优于 Express）
- 前端：Vite + React 18 + TypeScript（独立子工程 `web/`，构建产物由 Fastify 静态挂载）
- 数据库：node:sqlite（Node 内置模块，同步 API、embedded，零第三方依赖、零 native 编译）
- HTTP 客户端：undici（原生流式支持，避免 axios stream 的坑）
- 包管理：npm workspaces

### 关键约定

- **入口协议**：完整 Anthropic Messages API（`POST /v1/messages`，支持 `stream: true` SSE）
- **出口协议**：Anthropic Messages（provider 侧兼容，网关不做协议转换）
- **Provider 认证**：支持两种 auth style —— `bearer`（`Authorization: Bearer <key>`，兼容 OpenRouter/DeepSeek/Kimi 等）和 `x-api-key`（`x-api-key: <key>`，Anthropic 官方）；通过 `settings.provider.auth_style` 配置，默认 `bearer`
- **Aggregator 侧字节级透传原则**：aggregator 请求的 messages 数组，除了最后一条 user message 之外的所有 message 一律**逐字节**保持原样，Claude Code 自己打的 `cache_control` marker 全部保留；references guidance 只追加到最后一条 user message 的最后一个 text block 尾部，可接受"最后一条 message 的 cache 失效、前面所有 message cache 依然命中"这个 trade-off
- **Advisor 视图不透传 cache marker**：advisor 视图是网关重构产物，Claude Code 的 marker 已经不在，由网关按 system_and_3 布局（system + 倒数 3 条非合成 marker）自主装饰 4 个 `cache_control` breakpoints
- **失败容忍**：单个 advisor 失败以 `[Advisor {slot} failed: {reason}]` 占位继续，不打断 turn
- **递归护栏**：`aggregator.model` 与 `advisor.slots` 中任一条相同 → 启动时报错
- **定价表**：不硬编码，作为 `settings.provider.pricing_table` 存储，Dashboard 可编辑
- **AdvisorResult 语义**：`usage` 是本次真实调用产生的 token 数；命中缓存时 `usage` 所有字段为 0 且 `cache_hit = true`、`latency_ms ≈ 0`
- **成本汇总语义**：`trace.total_cost_usd` = advisor 成本 + aggregator 成本 + judge 成本（Phase 6 后引入）；`baseline_cost_usd` 独立字段（对比参考，不算进 total_cost_usd）

### 目录结构

```
mom/
├── src/                          # 网关服务
│   ├── index.ts                  # 主入口
│   ├── config.ts                 # 配置加载 + 递归护栏检查
│   ├── gateway/
│   │   ├── server.ts             # Fastify 实例 + 路由挂载
│   │   ├── messages-handler.ts   # POST /v1/messages 主入口
│   │   ├── sse.ts                # SSE 编解码工具
│   │   └── validator.ts          # 请求校验
│   ├── orchestrator/
│   │   ├── orchestrator.ts       # 主调度
│   │   ├── trigger.ts            # user_turn / per_iteration 判断
│   │   ├── fanout.ts             # advisor 并发 fan-out
│   │   └── aggregation.ts        # concat / judge 拼接分发
│   ├── advisor/
│   │   ├── advisor-runtime.ts    # 单 advisor 调用
│   │   ├── view-transformer.ts   # Anthropic → advisor 视图转换
│   │   └── prompts.ts            # ADVISOR_SYSTEM_PROMPT / ADVISORY_INSTRUCTION
│   ├── aggregator/
│   │   ├── aggregator-runtime.ts # aggregator 调用（含 streaming）
│   │   └── reference-builder.ts  # references 拼接、追加到最后 user
│   ├── judge/                    # Phase 6
│   │   ├── judge-runtime.ts
│   │   └── judge-prompt.ts
│   ├── provider/
│   │   ├── provider-client.ts    # undici POST + non-streaming
│   │   └── stream-forward.ts     # SSE 流式转发
│   ├── cache/
│   │   ├── cache-key.ts          # fanout cache key 计算
│   │   ├── fanout-cache.ts       # LRU + TTL
│   │   └── cache-decorator.ts    # system_and_3 marker 装饰
│   ├── storage/
│   │   ├── db.ts                 # node:sqlite 初始化（DatabaseSync 单例、内联 SCHEMA 常量）
│   │   ├── traces.ts             # trace CRUD
│   │   ├── metrics.ts            # metrics 计算
│   │   └── settings.ts           # settings CRUD
│   ├── dashboard-api/            # Phase 4
│   │   ├── traces-api.ts
│   │   ├── metrics-api.ts
│   │   ├── settings-api.ts
│   │   └── comparison-api.ts
│   ├── cost/
│   │   └── pricing.ts            # 基于 settings.pricing_table 的成本计算
│   └── types/
│       ├── anthropic.ts          # Anthropic Messages API 类型
│       ├── mom.ts                # MoMSettings / Trace / Metrics / AdvisorResult 等
│       └── index.ts
├── web/                          # Dashboard 前端（Vite 独立子工程）
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── TracesPage.tsx
│   │   │   ├── MetricsPage.tsx
│   │   │   └── ComparisonPage.tsx
│   │   └── lib/api.ts
│   ├── index.html
│   └── vite.config.ts
├── package.json                  # npm workspaces 根（含 "workspaces": ["web"]）
├── tsconfig.json
└── mom.db                        # 运行时生成
```

---

## Phase 1: 骨架 + 协议透传（含 Streaming）

### 目标
Node/TS 单进程服务启动后，暴露 `POST /v1/messages`（支持 `stream: true` SSE）和 `/dashboard/*` 静态资源；不做任何 MoM 逻辑，来什么请求原样转发到 provider，返回响应原样透出。SQLite（node:sqlite）初始化并可持久化 settings。前端 Vite 骨架跑通、访问 `/dashboard` 能看到"Hello MoM"。

### 组件改动

**类型定义**（Phase 1 的核心交付物之一，Phase 2/3 会扩展使用）

- **新增** `src/types/anthropic.ts`：完整定义 Anthropic Messages API 的请求/响应/SSE 事件类型
  - `AnthropicMessagesRequest` / `AnthropicMessage` / `ContentBlock`（联合类型：`TextBlock` / `ImageBlock` / `ToolUseBlock` / `ToolResultBlock`）
  - `SystemBlock` / `Tool` / `CacheControl`
  - `AnthropicMessagesResponse` / `Usage`
  - SSE 事件类型：`MessageStartEvent` / `ContentBlockStartEvent` / `ContentBlockDeltaEvent` / `ContentBlockStopEvent` / `MessageDeltaEvent` / `MessageStopEvent` / `PingEvent` / `ErrorEvent`
- **新增** `src/types/mom.ts`：MoM 内部类型
  - `MoMSettings`（含 `mom_mode` / `fanout_mode` / `aggregation_mode` / `reference_max_tokens` / `advisor` / `aggregator` / `judge` / `cache` / `comparison` / `provider`（含 `auth_style` / `pricing_table`） / `cost_tradeoff`（保留字段））
    - `pricing_table: Record<string, ModelPricing>`，其中 `ModelPricing = {input: number, output: number, cache_write: number, cache_read: number}`，单位 USD per million tokens
  - `AdvisorResult` / `JudgeResult` / `AggregatorResult` / `BaselineResult`
  - `Trace`（一次请求一条，字段：`id` / `timestamp` / `request` / `response` / `mom_triggered` / `trigger_reason` / `advisor_results` / `aggregator_result` / `judge_result?` / `baseline_result?` / `total_cost_usd` / `baseline_cost_usd?` / `total_latency_ms` / `settings_snapshot`）
  - `Metrics`（聚合，含 `total_usage`（含 advisor + judge + aggregator 汇总，非仅 aggregator）等）
  - `FanoutCacheKey` / `FanoutCacheValue`
  - `DEFAULT_SETTINGS` 常量

**网关骨架**

- **新增** `src/gateway/server.ts`
  - `createServer(): FastifyInstance` — 建 fastify 实例、注册 body-parser（10MB）、注册路由、静态挂载 `web/dist` 到 `/dashboard/*`
  - `startServer(port)` — 监听端口
- **新增** `src/gateway/validator.ts`
  - `validateMessagesRequest(body): AnthropicMessagesRequest` — 校验 `model` / `messages` / `max_tokens` 必填
- **新增** `src/gateway/sse.ts`
  - `parseSSELine(line: string): {event?: string, data?: string}` — SSE 单行解析
  - `formatSSEEvent(event: string, data: unknown): string` — 编码 SSE 事件
- **新增** `src/gateway/messages-handler.ts`
  - `handleMessages(req, reply)` — 入口。Phase 1 只做透传：读 `stream` 字段，non-streaming 直接 `passthroughCall()`，streaming 走 `passthroughStream()` 把 provider 的 SSE 逐块 pipe 到 reply。异常统一转成 Anthropic error JSON

**Provider 客户端**

- **新增** `src/provider/provider-client.ts`
  - `buildAuthHeaders(settings): Record<string, string>` — 根据 `settings.provider.auth_style` 构造：`bearer` → `{Authorization: "Bearer <key>"}`；`x-api-key` → `{"x-api-key": "<key>", "anthropic-version": "2023-06-01"}`
  - `passthroughCall(req): Promise<AnthropicMessagesResponse>` — undici `request()` POST 到 `provider.base_url + /v1/messages`；**非 2xx 状态码**读取 body 后抛出 `ProviderError`（含 statusCode / body / model 供上层构造 Anthropic error JSON）；成功返回解析后的 response
  - `ProviderError extends Error` — 带 `statusCode` / `providerBody` / `model` 字段
- **新增** `src/provider/stream-forward.ts`
  - `passthroughStream(req, reply)` — undici stream 模式：非 2xx 先读 body 转成 `error` SSE 事件写入 reply 后 close；2xx 时 `response.body.pipe(reply.raw)` 原样转发；网络异常 catch 后同样发 `error` SSE 事件

**存储**

- **新增** `src/storage/db.ts`
  - 内联 `const SCHEMA = \`...\`` 常量，覆盖 `settings` / `traces` / `metrics_cache` 三张表的 DDL（DDL 短小、Phase 1 无演进负担，不再拆独立 `schema.sql` 文件——避免运行时 `readFileSync` + `import.meta.url` 依赖）
  - `initDB(path)` — `new DatabaseSync(path, { enableForeignKeyConstraints: true })` 打开数据库，`db.exec('PRAGMA journal_mode = WAL')` 启用 WAL，随后 `db.exec(SCHEMA)` 建表
  - `getDB()` — 单例
- **新增** `src/storage/settings.ts`
  - `loadSettings(): MoMSettings` — 无记录时插入 `DEFAULT_SETTINGS`
  - `saveSettings(settings)`
- **新增** `src/config.ts`
  - `getConfig(): MoMSettings` — 包 `loadSettings()`，启动时校验递归护栏（aggregator model ∉ advisor.slots）

**主入口**

- **新增** `src/index.ts` — `initDB()` → `getConfig()`（校验失败即退出）→ `startServer(port)`

**前端骨架**

- **新增** `web/package.json` / `web/vite.config.ts` / `web/index.html` / `web/src/main.tsx` / `web/src/App.tsx`
  - `App.tsx` 显示 `Hello MoM`，验证 Vite 构建
  - `vite.config.ts` 配置 `base: '/dashboard/'`、开发时 proxy `/api` 和 `/v1` 到 backend
- **新增** `package.json`（根） — 通过 `"workspaces": ["web"]` 声明 npm workspace
- **新增** `tsconfig.json`（根） — backend 用；`web/tsconfig.json` 独立

### 验证方式

1. `npm install && npm run build --workspace=web && npm run dev` → 期望终端输出 `MoM gateway listening on 3000`
2. `curl http://localhost:3000/dashboard/` → 期望返回 HTML，浏览器看到 "Hello MoM"
3. `node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('mom.db').prepare('SELECT data FROM settings WHERE id = 1').get())"` → 期望打印 `DEFAULT_SETTINGS` 的 JSON（或改用 `sqlite3 mom.db` CLI 若已安装）
4. 配置 provider（用上面同款 `node -e` 脚本执行 `UPDATE settings SET data = json_set(data, '$.provider.base_url', 'https://...', '$.provider.api_key', 'sk-...', '$.provider.auth_style', 'bearer') WHERE id = 1`）
5. Non-streaming 请求：
   ```
   curl -X POST http://localhost:3000/v1/messages -H 'content-type: application/json' \
     -d '{"model":"<某模型>","messages":[{"role":"user","content":[{"type":"text","text":"Hello"}]}],"max_tokens":100}'
   ```
   → 期望返回 provider 的响应，字段结构符合 `AnthropicMessagesResponse`
6. Streaming 请求（加 `"stream":true`）→ 期望 `Content-Type: text/event-stream`，可看到 `event: message_start` / `event: content_block_delta` / `event: message_stop` 依次输出
7. Claude Code 端把 `ANTHROPIC_BASE_URL` 指向 `http://localhost:3000`，发一句对话 → 期望正常收到回复（此时 MoM 尚无 MoM 逻辑，等于直连 provider）
8. 递归护栏：手动把 `settings.data.aggregator.model` 改成 `advisor.slots[0]`，重启 → 期望进程报错退出

---

## Phase 2: Advisor 视图 + Fan-out + Concat 拼接

### 目标
`mom_mode: always` 时，每次请求都 fan-out 全部 advisor、拿到 references、以 concat 方式拼到 aggregator 请求最后一条 user 尾部，用 aggregator 模型调用 provider 返回。支持 streaming（aggregator 侧流式返回，advisor 侧非流式）。暂不做缓存、不做触发粒度判断、不做 trace 落盘（异常打 log 即可）。

### 前置条件
- Phase 1 的 `passthroughCall()` / `passthroughStream()` 可用
- Phase 1 的 `AnthropicMessagesRequest` / `ContentBlock` 类型齐全

### 组件改动

**Advisor 视图转换**

- **新增** `src/advisor/prompts.ts`
  - `ADVISOR_SYSTEM_PROMPT` — 借鉴 Hermes `_REFERENCE_SYSTEM_PROMPT`：明确"你是 advisor，不能调工具，不要道歉，直接给分析"
  - `ADVISORY_INSTRUCTION` — 结尾合成 user marker 用文本
- **新增** `src/advisor/view-transformer.ts`
  - `convertToAdvisorView(messages: AnthropicMessage[]): AnthropicMessage[]` — 主入口。规则：
    - 遍历 message，assistant 侧把 `tool_use` block 展平成 `[called tool: {name}({JSON.stringify(input)})]` 文本、与该 message 内其他 `text` block 合并成单个 text block
    - user 侧把 `tool_result` block（content 可能是 string 或 ContentBlock[]）折叠成 `[tool result: {truncatedHead2000}...{truncatedTail2000}]`、与该 message 内 text block 合并
    - `image` block 丢弃（advisor MVP 不接受图片）
    - 遍历结束若最后一条是 assistant，追加合成 `{role: "user", content: [{type: "text", text: ADVISORY_INSTRUCTION}]}`
  - `truncateToolResult(text: string, budget = 4000): string` — head 2000 + `\n[... {n} chars omitted ...]\n` + tail 2000
  - `renderToolUse(block: ToolUseBlock): string`

**Advisor 调用**

- **新增** `src/advisor/advisor-runtime.ts`
  - `runAdvisor(slot: string, messages: AnthropicMessage[], settings: MoMSettings): Promise<AdvisorResult>`
    - 视图转换 → 构造请求（`model=slot`、`system=ADVISOR_SYSTEM_PROMPT`、不传 `tools`、`max_tokens=settings.reference_max_tokens ?? 4096`、`stream=false`）→ 调 `passthroughCall`
    - 抽取 response 里所有 `type:"text"` block 的 text 拼接为 `reference`
    - 记录 `usage` / `latency_ms`；异常场景 catch 后返回 `{success:false, error, latency_ms}`，绝不抛

**并发 fan-out**

- **新增** `src/orchestrator/fanout.ts`
  - `fanoutAdvisors(messages: AnthropicMessage[], settings: MoMSettings): Promise<AdvisorResult[]>` — `p-limit(8)` 并发，保持 slots 顺序返回

**References 拼接**

- **新增** `src/aggregator/reference-builder.ts`
  - `buildConcatReferences(results: AdvisorResult[], settings: MoMSettings): string`
    - 每个 result：成功 → `[Reference {i} — {slot}]\n{truncated_reference}`；失败 → `[Reference {i} — {slot} failed: {error}]`
    - 每个 reference 按 `settings.reference_max_tokens * 4` 字符截断（简单估算 1 token ≈ 4 chars）
    - 用 `\n\n` 连接
  - `appendReferencesToLastUser(messages: AnthropicMessage[], references: string): AnthropicMessage[]`
    - 深拷贝 messages 数组的最后一条，其余保持同引用
    - 定位最后一条 user message 的最后一个 `type:"text"` block（若无则新加一个 text block）
    - 在其 text 尾部追加 `\n\n---\n\nExpert Panel References:\n{references}`
    - 返回新数组
    - **关键约束**：这个函数只修改最后一条 message，前面所有 message 保持原对象引用不变（保证 aggregator 侧字节级透传）

**Aggregator 调用**

- **新增** `src/aggregator/aggregator-runtime.ts`
  - `runAggregatorNonStreaming(original: AnthropicMessagesRequest, results: AdvisorResult[], settings): Promise<AggregatorResult>`
    - `buildConcatReferences` → `appendReferencesToLastUser` → 用 `settings.aggregator.model` 替换 `model` 字段 → `passthroughCall`
    - 返回含 `response` / `usage` / `latency_ms` / `references_appended`
  - `runAggregatorStreaming(original, results, settings, reply, onComplete): Promise<void>`
    - 同上构造 request 但 `stream=true`，向 provider 发起 undici 流式请求
    - **双消费者分流实现**：拿到 `response.body`（Readable stream）后用 `stream.PassThrough` tee 出两路 —— 一路直接 `pipe(reply.raw)` 转发给 Claude Code、另一路走 `SSEParser`（Transform stream）解析累计 usage（从 `message_delta.usage` 和 `message_stop.usage`）和 output text（从 `content_block_delta.delta.text`）
    - SSE parser 收到 `message_stop` 事件时调 `onComplete(AggregatorResult)` 触发 trace 落盘
    - `latency_ms` 从请求发出到 `message_stop` 结束
    - 函数返回时机：`reply.raw` end 后（不等 onComplete 完成，异步落盘）

**主调度**

- **新增** `src/orchestrator/orchestrator.ts`
  - `orchestrate(req, reply)`
    - `loadSettings()` → 若 `mom_mode !== "always"` 走透传（Phase 1 已有逻辑）
    - `fanoutAdvisors(req.messages, settings)` 拿到 advisorResults
    - `stream` → `runAggregatorStreaming` 直接 pipe；否则 `runAggregatorNonStreaming` 返回 JSON
- **修改** `src/gateway/messages-handler.ts`：把透传逻辑替换成 `orchestrate(req, reply)`

### 验证方式

1. 在 provider 侧至少配 3 个可用模型（写到 `settings.advisor.slots` 和 `settings.aggregator.model`）
2. Non-streaming 请求 → 期望在日志里看到 3 条 advisor 调用（并发）、1 条 aggregator 调用，返回符合 `AnthropicMessagesResponse`
3. 在 `runAggregatorNonStreaming` 里 dump 最终发给 provider 的 messages → 验证：
   - `messages` 除最后一条外，与原始 `req.messages` **逐对象引用相等**（即前缀字节稳定）
   - 最后一条 user message 尾部含 `Expert Panel References:` 段落
   - 所有 references 顺序与 `settings.advisor.slots` 顺序一致
4. Streaming 请求 + Claude Code 实测 → 期望正常流式渲染回复
5. 视图转换单测：构造一条含 `tool_use` + 后续 `tool_result` 的 messages → `convertToAdvisorView` 输出：
   - assistant text 尾部有 `[called tool: bash({"cmd":"ls"})]`
   - 下一条 user 尾部有 `[tool result: ...]`
   - 若原始最后是 assistant，输出末尾追加了合成 user marker
6. 故意杀一个 advisor slot（改成不存在的模型名）→ 期望 aggregator 收到 `[Reference N — slot failed: ...]` 字符串，请求不中断

---

## Phase 3: 触发粒度 + Fanout 缓存 + Cache 装饰 + 成本分账

### 目标
支持 `fanout_mode: user_turn | per_iteration` 双模式。`user_turn` 模式下同一 turn 内的多次 tool iteration 复用同一批 references（不重跑 advisor）。Advisor 请求侧按 system_and_3 布局装 4 个 `cache_control` marker。每次请求写一条 `Trace` 到 SQLite（node:sqlite），含 advisor + aggregator + judge（predefined 0） 三层 usage 汇总和成本分账（advisor 各自 slot 单价、aggregator 单价）。

### 前置条件
- Phase 2 的 `orchestrate` 骨架、`fanoutAdvisors` 已实现
- `settings.cache.ttl` / `settings.fanout_mode` / `settings.provider.pricing_table` 字段已在 Phase 1 定义

### 组件改动

**触发判断**

- **新增** `src/orchestrator/trigger.ts`
  - `isNewUserTurn(messages: AnthropicMessage[]): boolean` — **严格规则**：最后一条 user message 的 content blocks 里只要存在**任何一个** `type:"tool_result"` block（不管是否同时含 text）就返回 false；否则 true
  - `shouldFanout(messages, fanoutMode): {trigger: boolean, reason: string}` — user_turn 时委托 `isNewUserTurn`；per_iteration 时永远 true；返回值供 trace 记录 `trigger_reason`

**Fanout 缓存**

- **新增** `src/cache/cache-key.ts`
  - `computeFanoutCacheKey(messages, settings): string` — 组成：
    - `sig` = sha256 of stable JSON stringify（下面的 signatureMessages）
    - user_turn 模式：signatureMessages = messages 截到最后一个 `isRealUserMessage` 为止（`isRealUserMessage` = user role 且 content 无 tool_result）
    - per_iteration 模式：signatureMessages = 完整 messages
    - 最终 key = JSON({settingsHash, sig, sortedSlots})
    - `settingsHash` 只哈希影响 advisor 视图/输出的字段（`advisor.system_prompt` / `advisor.tools_enabled` / `reference_max_tokens`），不哈希全部 settings（避免无关字段变动破坏缓存）
- **新增** `src/cache/fanout-cache.ts`
  - 基于 `lru-cache`，`max: 1000`，TTL 从 `settings.cache.ttl` 读（5m/1h）
  - `get(key): FanoutCacheValue | null` / `set(key, results, ttlMs)`
- **修改** `src/orchestrator/fanout.ts`：进入前查缓存、命中直接返回并给每条 result 打 `cache_hit: true`；MISS 时正常跑再 set；HIT 时不把 usage/cost 二次记账（返回时把 usage 置 0、latency 保留 0）

**Cache 装饰**

- **新增** `src/cache/cache-decorator.ts`
  - `applyAdvisorCacheControl(system: string, messages: AnthropicMessage[]): {system: SystemBlock[], messages: AnthropicMessage[]}` — **system_and_3 布局**：
    - `system` 转成 `[{type:"text", text: system, cache_control:{type:"ephemeral"}}]`（第 1 个 marker）
    - 遍历 messages 找**最后 3 条非 ADVISORY_INSTRUCTION 合成 marker** 的 message，在各自最后一个 content block 上加 `cache_control`（第 2/3/4 个 marker）
    - 不足 3 条时能加几个加几个
    - 合成 marker（内容 === `ADVISORY_INSTRUCTION`）跳过，因为每次可能位置漂移
- **修改** `src/advisor/advisor-runtime.ts`：在调 `passthroughCall` 前先过 `applyAdvisorCacheControl`；request 的 `system` 字段类型从 `string` 升级为 `SystemBlock[]`（Anthropic Messages API 的 `system` 字段本就是 `string | SystemBlock[]` union，切到数组形式才能承载 `cache_control`）

**成本分账**

- **新增** `src/cost/pricing.ts`
  - `calculateCost(model: string, usage: Usage, pricingTable): number` — 从 settings 里的 `pricing_table[model]` 读四段单价（input / output / cache_write / cache_read），缺项 → warn + 返回 0
  - `sumUsage(usages: Usage[]): Usage` — 汇总多次调用的 usage（供 metrics 用）

**Trace 持久化**

- **新增** `src/storage/traces.ts`
  - `saveTrace(trace: Trace): void`
  - `getTraceById(id): Trace | null`
  - `getRecentTraces(limit): Trace[]`
  - `deserializeTraceRow(row): Trace` — 内部工具
- **修改** `src/storage/schema.sql`：确保 `traces` 表列齐（对应 `Trace` 类型每个字段）
- **修改** `src/orchestrator/orchestrator.ts`：
  - 组装 `Trace` 记录（含 `mom_triggered` / `trigger_reason` / 全量 advisor_results / aggregator_result 全量 usage / `total_cost_usd` = advisor 各自成本 + aggregator 成本 / `total_latency_ms`）
  - Non-streaming 场景：返回 response 前同步调 `saveTrace(trace)`
  - Streaming 场景：把 `onComplete` 回调传给 `runAggregatorStreaming` —— 回调在 SSE parser 收到 `message_stop` 事件时触发，回调内组装 `Trace` 并 `saveTrace`（此时 reply 可能已 end，落盘异步不阻塞客户端）
  - `saveTrace` 内部异常 catch 后 log，不打断请求或响应

### 验证方式

1. 打开 `fanout_mode: user_turn`，用 Claude Code 发一条会引发 tool 调用的请求（比如"读一下 README"）
2. 观察日志：第 1 个请求（纯 user）→ advisor MISS + 跑 3 个 slot；第 2 个请求（含 tool_result）→ advisor HIT + 0 次 provider 调用
3. 查询 traces（任选其一）：
   - `node -e "const {DatabaseSync}=require('node:sqlite');console.table(new DatabaseSync('mom.db').prepare('SELECT id, trigger_reason FROM traces ORDER BY timestamp DESC LIMIT 3').all())"`
   - 或 `sqlite3 mom.db 'SELECT id, trigger_reason FROM traces ORDER BY timestamp DESC LIMIT 3'`
   期望：新 turn 那条 `trigger_reason = "user_turn"`，tool iteration 那条 `trigger_reason = "skipped_tool_iteration"`
4. 切到 `fanout_mode: per_iteration`，同样场景 → 期望每次请求都 MISS + 每次都跑 3 个 slot
5. 验证 cache 装饰生效：在 `advisor-runtime` 请求发出前 dump messages，观察前 3 条非合成 marker 的 message 最后 content block 是否含 `cache_control: {type:"ephemeral"}`；system 是否已转成 `SystemBlock[]` 形式带 `cache_control`
6. 观察 provider 返回的 `usage.cache_read_input_tokens` 逐渐变大（第二次相同前缀的 advisor 调用命中）
7. `node -e "const {DatabaseSync}=require('node:sqlite');console.table(new DatabaseSync('mom.db').prepare('SELECT id, total_cost_usd FROM traces ORDER BY timestamp DESC LIMIT 5').all())"` → 期望 `total_cost_usd` 是 advisor 各自 slot 单价 + aggregator 单价 的总和，非零
8. 修改 `settings.provider.pricing_table` 里某个 slot 的价格 → 新请求的成本按新价格计算

---

## Phase 4: Dashboard 后端 API（略写）

### 目标
Dashboard 前端所需 REST API 全部就位。

### 初步构想
- `GET /api/settings` / `POST /api/settings` — 直接读写 `settings` 表
- `GET /api/traces?limit=100&offset=0` — 分页返回 trace summary（不含全量 request/response，避免大 body）
- `GET /api/traces/:id` — 单条 trace 全量
- `GET /api/metrics?window=last_24h|last_7d` — 从 traces 聚合，含 total_usage 分层（advisor / aggregator / judge），成本 / 延迟 / cache 命中率
- `GET /api/comparison/:trace_id` — 见 Phase 6

### 待讨论的问题
- Metrics 是否需要预聚合到 `metrics_cache` 表？MVP 数量少可以直接实时算，量大后再引入
- 是否需要认证？MVP 假定本地运行、无认证；上线远期版本需要加

---

## Phase 5: Dashboard 前端三层（略写）

### 目标
Vite + React + TS，实现设置层、日志调试层、用户展示层三个页面；对比展示层（Phase 6）留位。

### 初步构想
- **设置层** `web/src/pages/SettingsPage.tsx` — 表单绑定 `MoMSettings` 所有字段（含 `pricing_table` 编辑器、`advisor.slots` 列表增删、`aggregator.model` / `judge.model` / `comparison.baseline_model` 下拉选择）；保存调 `POST /api/settings`；`cost_tradeoff` 字段占位 + "coming soon" disabled
- **日志调试层** `web/src/pages/TracesPage.tsx` — 列表 + 详情视图。详情视图分四栏展示：
  - 左：advisor 输出（每 slot 一列，含全文、usage、latency、cache_hit 标记）
  - 中：references guidance 拼接后全文（判断字段 `mom_triggered` / `trigger_reason` 显式展示）
  - 右上：aggregator 请求 messages 快照（可折叠展开每条 message）
  - 右下：aggregator 响应 + usage + latency + 命中率
- **用户展示层** `web/src/pages/MetricsPage.tsx` — 时间窗口切换（24h / 7d）、KPI 卡片（total_cost / avg_latency / cache_hit_rate / mom_trigger_rate）、简单折线图（可用 Recharts 或 uPlot；本阶段先只列数字，图后加）

### 待讨论的问题
- 图表库选型：Recharts 好写、uPlot 快
- 需不需要暗色主题（展厅演示要看现场大屏）

---

## Phase 6: Judge 模式 + 对比展示层（略写）

### 目标
`aggregation_mode: judge` 生效：所有 advisor 跑完后额外一次 judge 调用（temperature=0），输出 5 类 JSON（consensus / disagreements / partial_coverage / unique_insights / blind_spots），把结构化摘要而非原文塞到 aggregator。同时实现 Dashboard 的对比展示层（同一 messages 输入，MoM aggregator vs baseline 单模型并排展示）。

### 初步构想
- **Judge 调用** `src/judge/judge-runtime.ts` `runJudge(results, settings): Promise<JudgeResult>` — 构造 messages（把成功的 advisor references 编号后拼进 user message），system=`JUDGE_SYSTEM_PROMPT`（要求严格输出 JSON），`temperature=0`；response 用 `safeJsonParse` 解析
- **`safeJsonParse` fallback**：`JSON.parse` 失败 → 用 `/\{[\s\S]*\}/` 正则抽取第一个 `{...}` 段再 parse → 仍失败 → 降级到 concat 模式（把原文按 Phase 2 逻辑拼），标记 `judge_result.fallback = true`
- **成本归属**：
  - `total_cost_usd += judge_result.cost_usd`（judge 是 MoM 流程内部成本）
  - `trace.judge_result = JudgeResult` 存下 5 类 JSON 全量供 Dashboard 展示
- **对比展示层**：
  - `settings.comparison.enabled = true` 时，每次 MoM turn 结束后异步发一次 `baseline_model` 的调用（同 messages、不含 references）
  - 结果存到 `trace.baseline_result`，成本单独记 `trace.baseline_cost_usd`（**不算进 total_cost_usd**，baseline 是对比参考）
  - `GET /api/comparison/:trace_id` 返回 mom_result + baseline_result 供前端并排展示
  - Baseline 调用失败不影响主流程，`baseline_result` 缺失即前端隐藏对比栏
- **JUDGE_SYSTEM_PROMPT** — 借鉴 Fusion 文档的 5 类语义：consensus / disagreements / partial_coverage / unique_insights / blind_spots

### 待讨论的问题
- Judge 模型选谁默认（Sonnet 4 vs Kimi vs …）
- Judge 失败降级到 concat 时是否要通知用户 / trace 里加显式 flag
- 对比模式下 baseline call 是否也用 streaming（若是，需要额外一路 SSE 消费）

---

## 改动点总结

### 讨论中否定的方案
1. **advisor 侧协议不做 OpenAI Chat Completions**：MVP 只支持 Anthropic Messages，advisor 与 aggregator 走同一协议（避免协议转换的实现复杂度）
2. **对比粒度不做 session 级分叉**：MoM 与 baseline 两个 session 独立跑 agent loop 会走成两棵不可比的树、成本翻倍；只做"同一 messages 输入的单次 aggregator call 对比"
3. **触发不做 manual 触发**：不加 `/mom on|off` 之类的手动指令；用户对 MoM 触发无感，由 `mom_mode` / `fanout_mode` 配置项决定
4. **触发不做 auto 模式**：MVP 只做 `always`；`auto` 模式（网关自动判断问题值不值得触发）留字段远期，因为间歇性触发会破坏缓存前缀连续性，实现代价高
5. **advisor 工具权限 MVP 不开**：`advisor.tools_enabled` 字段保留默认 false；远期开启也只考虑 web_search/web_fetch 类幂等工具
6. **不实现 Hermes 的一次性 `/moa <prompt>` 路径**：产品定位是网关，Claude Code 无感触发，不需要单次 shortcut
7. **成本计算不硬编码定价表**：定价通过 `settings.provider.pricing_table` 配置，Dashboard 可编辑
8. **前端不用 CDN + inline Babel**：一律 Vite + React + TS 正规工程，`web/` 作为独立 workspace
9. **Streaming 不推到后期**：Phase 1 就实现 SSE passthrough；Phase 2 的 aggregator 一并支持 streaming（advisor 侧非流式）
10. **CLI / NPM 包 / Claude Code 插件形态属远期**：MVP 直接 `npm run dev` 启动
11. **多 provider 属远期**：MVP 单一 baseURL，靠 provider 侧多 model 名支撑
