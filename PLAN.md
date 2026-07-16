# MoM (Mixture of Models) — 分阶段实施计划

## Context

MoM 是位于 Claude Code 与 provider 之间的独立 HTTP 网关，对标 OpenRouter Fusion，实现"多个廉价模型组合逼近旗舰模型能力"。第一版只面向 Claude Code（Anthropic Messages API 协议），只对接一个 provider baseURL（该 provider 侧配多个 model 名），不实现成本权衡功能（另有独立项目后期合并）。目标交付三件事：统一数据结构、MoM 网关本体、可反映效果的 Dashboard（面向展会演示，五页：Overview 总览 / Live Compare 实时对比 / Pipeline 请求流程 / Cost 成本分析 / Settings 设置，双语中英可切换）。

---

## 阶段总览

| 阶段 | 名称 | 状态 | 一句话说明 |
|------|------|------|-----------|
| Phase 1 | 骨架 + 协议透传（含 Streaming） | ✅ 已完成 | Node/TS 单进程服务、Anthropic Messages 端点、SSE 流式透传、node:sqlite、Vite 前端骨架 |
| Phase 2 | Advisor 视图 + Fan-out + Concat 拼接 | ✅ 已完成 | MoM 核心流程，always 触发、无缓存 |
| Phase 3 | 触发粒度 + Fanout 缓存 + Cache 装饰 + 成本分账 | ✅ 已完成 | user_turn / per_iteration 双模式、advisor 缓存、system_and_3 marker、Trace 落盘 |
| Phase 4 | Dashboard 后端 API | 📝 略写 | traces / metrics / settings / comparison 四组 API |
| Phase 5 | Dashboard 前端五页 + 预览版 | 🎨 预览版已交付 | Overview / Live / Pipeline / Cost / Settings，双语 i18n，mock 数据可跑通设计审 |
| Phase 6 | Judge 模式 + Baseline 后端接入 | 📝 略写 | Judge 5 维雷达打分、baseline 异步对比调用；Dashboard 端已在 Phase 5 预览版实现 UI |

> 依赖链：Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5（真数据接入），Phase 6 可与 4 并行。
> Phase 5 已先以 mock 数据出预览版，锁定 UI 与 API 契约再回填 Phase 4。

---

## 架构概览

### 技术栈
- 运行时：Node.js ≥ 22.13 + TypeScript 5.x（node:sqlite 从 v22.13.0 起脱离 experimental，无需 `--experimental-sqlite` flag；Node 22 原生 `--env-file` 加载 .env，无需 dotenv）
- 网关框架：Fastify（原生 SSE 支持优于 Express）
- 前端：Vite + React 18 + TypeScript（独立子工程 `web/`，构建产物由 Fastify 静态挂载）
- 配置分层：
  - L1 部署配置（`provider.base_url` / `api_key` / `auth_style` / `MOM_PORT` / `MOM_DB_PATH` / `MOM_CONFIG_PATH`）→ `.env`（`--env-file` 加载）
  - L2 业务配置（`mom_mode` / `fanout_mode` / `advisor` / `aggregator` / `judge` / `cache` / `comparison` / `pricing_table` / `cost_tradeoff` 等）→ `data/mom.config.json`（Dashboard 或手工编辑）
  - L3 运行时数据（`traces` / `metrics_cache`）→ `mom.db`（node:sqlite）
- HTTP 客户端：undici（原生流式支持，避免 axios stream 的坑）
- 包管理：npm workspaces

### 关键约定

- **入口协议**：完整 Anthropic Messages API（`POST /v1/messages`，支持 `stream: true` SSE）
- **出口协议**：Anthropic Messages（provider 侧兼容，网关不做协议转换）
- **Provider 认证**：支持两种 auth style —— `bearer`（`Authorization: Bearer <key>`，兼容 OpenRouter/DeepSeek/Kimi 等）和 `x-api-key`（`x-api-key: <key>`，Anthropic 官方）；通过 `.env` 中的 `PROVIDER_AUTH_STYLE` 配置，默认 `bearer`
- **配置边界**：秘钥 / 部署环境（provider.* 与 MOM_*）只来自 `.env`，永不写入业务配置文件与 SQLite；业务配置只来自 `data/mom.config.json`；Dashboard SettingsPage 编辑的对象是 `MoMConfig`，**不显示、不编辑秘钥**（只读展示 provider 状态摘要）
- **Aggregator 侧字节级透传原则**：aggregator 请求的 messages 数组，除了最后一条 user message 之外的所有 message 一律**逐字节**保持原样，Claude Code 自己打的 `cache_control` marker 全部保留；references guidance 只追加到最后一条 user message 的最后一个 text block 尾部，可接受"最后一条 message 的 cache 失效、前面所有 message cache 依然命中"这个 trade-off
- **Advisor 视图不透传 cache marker**：advisor 视图是网关重构产物，Claude Code 的 marker 已经不在，由网关按 system_and_3 布局（system + 倒数 3 条非合成 marker）自主装饰 4 个 `cache_control` breakpoints
- **失败容忍**：单个 advisor 失败以 `[Advisor {slot} failed: {reason}]` 占位继续，不打断 turn
- **递归护栏**：`aggregator.model` 与 `advisor.slots` 中任一条相同 → 启动时报错
- **定价表**：不硬编码，作为 `MoMConfig.pricing_table` 存储在 `data/mom.config.json`，Dashboard 可编辑（与 provider 秘钥完全解耦）
- **AdvisorResult 语义**：`usage` 是本次真实调用产生的 token 数；命中缓存时 `usage` 所有字段为 0 且 `cache_hit = true`、`latency_ms ≈ 0`
- **成本汇总语义**：`trace.total_cost_usd` = advisor 成本 + aggregator 成本 + judge 成本（Phase 6 后引入）；`baseline_cost_usd` 独立字段（对比参考，不算进 total_cost_usd）

### 目录结构

```
mom/
├── .env.example                  # 部署配置模板（含 PROVIDER_* 与 MOM_*，仓库提交；.env 本身 gitignore）
├── data/                         # 业务配置与本地状态（gitignore）
│   └── mom.config.json           # MoMConfig 持久化文件；首次启动自动写入 DEFAULT_MOM_CONFIG
├── src/                          # 网关服务
│   ├── index.ts                  # 主入口
│   ├── config.ts                 # 组装 RuntimeConfig（provider + mom）+ 递归护栏检查
│   ├── config/
│   │   ├── provider-env.ts       # loadProviderConfig — 从 process.env 读三个 PROVIDER_* 字段 + 校验
│   │   └── mom-config-file.ts    # loadMoMConfig / saveMoMConfig — mom.config.json 读写（原子 rename）
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
│   │   ├── db.ts                 # node:sqlite 初始化（DatabaseSync 单例、内联 SCHEMA 常量 — 仅 traces / metrics_cache）
│   │   ├── traces.ts             # trace CRUD
│   │   └── metrics.ts            # metrics 计算
│   ├── dashboard-api/            # Phase 4
│   │   ├── traces-api.ts
│   │   ├── metrics-api.ts
│   │   ├── settings-api.ts
│   │   └── comparison-api.ts
│   ├── cost/
│   │   └── pricing.ts            # 基于 momConfig.pricing_table 的成本计算
│   └── types/
│       ├── anthropic.ts          # Anthropic Messages API 类型
│       ├── mom.ts                # ProviderConfig / MoMConfig / RuntimeConfig / Trace / Metrics / AdvisorResult 等
│       └── index.ts
├── web/                          # Dashboard 前端（Vite 独立子工程）
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx               # 侧边栏 useState-based 路由
│   │   ├── global.css            # 奶油底色 + blink keyframe
│   │   ├── theme.ts              # 色板 / 字体 / 圆角 / 阴影常量集中定义
│   │   ├── i18n/
│   │   │   ├── dict.ts           # 中英双语字典（术语保留英文）
│   │   │   ├── context.tsx       # I18nProvider + useI18n（localStorage 持久化）
│   │   │   └── format.ts         # 成本 / 延迟 / token 数的双语格式化
│   │   ├── hooks/
│   │   │   ├── useTypewriter.ts  # Live/Pipeline 假流式打字机
│   │   │   └── useEventSource.ts # SSE 接入位（Phase 4 真数据）
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx  # Pareto 主图 + Combo 副图 + 3 KPI
│   │   │   ├── LivePage.tsx      # 预置 prompt shelf / MoM vs Baseline 并排 / Judge 雷达 / 成本条
│   │   │   ├── PipelinePage.tsx  # user→3 advisor→装配→aggregator→final 动画 + Replay + Diff 抽屉
│   │   │   ├── CostPage.tsx      # 节省 banner + 4 KPI + 每轮堆叠柱 / 饼图 / cache 命中 / 时间线
│   │   │   └── SettingsPage.tsx  # 语言 / Provider 只读 / Aggregator / Advisor slots / Judge / Pricing
│   │   ├── components/
│   │   │   ├── layout/           # Sidebar / PageShell
│   │   │   ├── primitives/       # Card / KpiCard / Badge / Button
│   │   │   └── charts/           # Pareto / Combo / JudgeRadar / CostStackedBar / CostPie / CacheHitBars / CostTimeline
│   │   └── mock/                 # 预览版伪数据（Phase 4 后端接入后逐步替换）
│   │       ├── benchmarks.ts     # Pareto + per-benchmark combo
│   │       ├── live-samples.ts   # 5 个预置 prompt × 中英 × MoM/Baseline/Judge 全套脚本
│   │       ├── pipeline-trace.ts # 一条 canned trace + 动画时序
│   │       ├── cost.ts           # 32 turns session 成本 + cache 命中
│   │       └── config.ts         # Settings 初值 + 模型下拉候选
│   ├── index.html
│   └── vite.config.ts
├── package.json                  # npm workspaces 根（含 "workspaces": ["web"]）
├── tsconfig.json
└── mom.db                        # 运行时生成
```

---

## Phase 1: 骨架 + 协议透传（含 Streaming）

### 目标
Node/TS 单进程服务启动后，暴露 `POST /v1/messages`（支持 `stream: true` SSE）和 `/dashboard/*` 静态资源；不做任何 MoM 逻辑，来什么请求原样转发到 provider，返回响应原样透出。三层配置各就各位：`.env` 提供 provider 秘钥，`data/mom.config.json` 提供业务配置默认值，SQLite（node:sqlite）初始化 `traces` / `metrics_cache` 表。前端 Vite 骨架跑通、访问 `/dashboard` 能看到"Hello MoM"。

### 组件改动

**类型定义**（Phase 1 的核心交付物之一，Phase 2/3 会扩展使用）

- **新增** `src/types/anthropic.ts`：完整定义 Anthropic Messages API 的请求/响应/SSE 事件类型
  - `AnthropicMessagesRequest` / `AnthropicMessage` / `ContentBlock`（联合类型：`TextBlock` / `ImageBlock` / `ToolUseBlock` / `ToolResultBlock`）
  - `SystemBlock` / `Tool` / `CacheControl`
  - `AnthropicMessagesResponse` / `Usage`
  - SSE 事件类型：`MessageStartEvent` / `ContentBlockStartEvent` / `ContentBlockDeltaEvent` / `ContentBlockStopEvent` / `MessageDeltaEvent` / `MessageStopEvent` / `PingEvent` / `ErrorEvent`
- **新增** `src/types/mom.ts`：MoM 内部类型
  - `ProviderConfig`（`base_url` / `api_key` / `auth_style`）— L1 部署配置，只从 env 加载
  - `MoMConfig`（`mom_mode` / `fanout_mode` / `aggregation_mode` / `reference_max_tokens` / `advisor` / `aggregator` / `judge` / `cache` / `comparison` / `pricing_table` / `cost_tradeoff`）— L2 业务配置，从 `mom.config.json` 加载
    - `pricing_table: Record<string, ModelPricing>`，其中 `ModelPricing = {input: number, output: number, cache_write: number, cache_read: number}`，单位 USD per million tokens
  - `RuntimeConfig = { provider: ProviderConfig; mom: MoMConfig }` — 网关内部统一运行时视图
  - `AdvisorResult` / `JudgeResult` / `AggregatorResult` / `BaselineResult`
  - `Trace`（一次请求一条，字段：`id` / `timestamp` / `request` / `response` / `mom_triggered` / `trigger_reason` / `advisor_results` / `aggregator_result` / `judge_result?` / `baseline_result?` / `total_cost_usd` / `baseline_cost_usd?` / `total_latency_ms` / `settings_snapshot: MoMConfig`）
  - `Metrics`（聚合，含 `total_usage`（含 advisor + judge + aggregator 汇总，非仅 aggregator）等）
  - `FanoutCacheKey` / `FanoutCacheValue`
  - `DEFAULT_MOM_CONFIG` 常量（provider 字段永不会有默认值——空 env 即启动失败）

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

**Provider 客户端**（只依赖 `ProviderConfig`，不感知业务配置与 SQLite）

- **新增** `src/provider/provider-client.ts`
  - `buildAuthHeaders(provider: ProviderConfig): Record<string, string>` — 根据 `provider.auth_style` 构造：`bearer` → `{Authorization: "Bearer <key>"}`；`x-api-key` → `{"x-api-key": "<key>", "anthropic-version": "2023-06-01"}`
  - `passthroughCall(req, provider): Promise<AnthropicMessagesResponse>` — undici `request()` POST 到 `provider.base_url + /v1/messages`；**非 2xx 状态码**读取 body 后抛出 `ProviderError`（含 statusCode / body / model 供上层构造 Anthropic error JSON）；成功返回解析后的 response
  - `ProviderError extends Error` — 带 `statusCode` / `providerBody` / `model` 字段
- **新增** `src/provider/stream-forward.ts`
  - `passthroughStream(req, reply, provider)` — undici stream 模式：非 2xx 先读 body 转成 `error` SSE 事件写入 reply 后 close；2xx 时 `response.body.pipe(reply.raw)` 原样转发；网络异常 catch 后同样发 `error` SSE 事件

**存储（仅 L3 运行时数据）**

- **新增** `src/storage/db.ts`
  - 内联 `const SCHEMA = \`...\`` 常量，仅含 `traces` / `metrics_cache` 两张表的 DDL（settings 表被移除；配置改由 env + config.json 承担）
  - `initDB(path)` — `new DatabaseSync(path, { enableForeignKeyConstraints: true })` 打开数据库，`db.exec('PRAGMA journal_mode = WAL')` 启用 WAL，随后 `db.exec(SCHEMA)` 建表
  - `getDB()` — 单例

**配置加载器**

- **新增** `src/config/provider-env.ts`
  - `loadProviderConfig(): ProviderConfig` — 从 `process.env` 读 `PROVIDER_BASE_URL` / `PROVIDER_API_KEY` / `PROVIDER_AUTH_STYLE`；缺失或非法值抛 `ProviderConfigError`（启动即失败，不静默使用默认值）
- **新增** `src/config/mom-config-file.ts`
  - `loadMoMConfig(path): MoMConfig` — 读 `data/mom.config.json`；ENOENT → 写入 `DEFAULT_MOM_CONFIG` 并返回；JSON 非法 → 抛 `MoMConfigFileError`
  - `saveMoMConfig(path, config): void` — 原子写：`writeFile tmp + renameSync`，保证 Dashboard 编辑期间读者不见到半截 JSON
- **新增** `src/config.ts`
  - `assertRecursionGuard(mom: MoMConfig)` — aggregator model ∉ advisor.slots
  - `getConfig(momConfigPath): RuntimeConfig` — 组合 `loadProviderConfig()` 与 `loadMoMConfig()`，跑护栏后返回

**主入口**

- **新增** `src/index.ts` — 读 `MOM_DB_PATH` / `MOM_CONFIG_PATH` / `MOM_PORT` env → `initDB()` → `getConfig(MOM_CONFIG_PATH)`（`ConfigError` / `ProviderConfigError` / `MoMConfigFileError` 三类都触发 exit 1）→ `startServer(port, runtime.provider)`
- npm scripts：`dev` / `start` 使用 `--env-file=.env`（Node 22 原生），无 dotenv 依赖

**前端骨架**

- **新增** `web/package.json` / `web/vite.config.ts` / `web/index.html` / `web/src/main.tsx` / `web/src/App.tsx`
  - `App.tsx` 显示 `Hello MoM`，验证 Vite 构建
  - `vite.config.ts` 配置 `base: '/dashboard/'`、开发时 proxy `/api` 和 `/v1` 到 backend
- **新增** `package.json`（根） — 通过 `"workspaces": ["web"]` 声明 npm workspace
- **新增** `tsconfig.json`（根） — backend 用；`web/tsconfig.json` 独立

### 验证方式

1. `cp .env.example .env` → 编辑 `.env` 填 `PROVIDER_BASE_URL` / `PROVIDER_API_KEY`（`PROVIDER_AUTH_STYLE` 默认 `bearer`）
2. `npm install && npm run build --workspace=web && npm run dev` → 期望终端输出 `MoM gateway listening on 3000`；`data/mom.config.json` 自动生成并含 `DEFAULT_MOM_CONFIG` JSON
3. `curl http://localhost:3000/dashboard/` → 期望返回 HTML，浏览器看到 "Hello MoM"
4. `cat data/mom.config.json` → 期望是 `DEFAULT_MOM_CONFIG` 的 JSON（不含任何 provider.* 字段）
5. Non-streaming 请求：
   ```
   curl -X POST http://localhost:3000/v1/messages -H 'content-type: application/json' \
     -d '{"model":"<某模型>","messages":[{"role":"user","content":[{"type":"text","text":"Hello"}]}],"max_tokens":100}'
   ```
   → 期望返回 provider 的响应，字段结构符合 `AnthropicMessagesResponse`
6. Streaming 请求（加 `"stream":true`）→ 期望 `Content-Type: text/event-stream`，可看到 `event: message_start` / `event: content_block_delta` / `event: message_stop` 依次输出
7. Claude Code 端把 `ANTHROPIC_BASE_URL` 指向 `http://localhost:3000`，发一句对话 → 期望正常收到回复（此时 MoM 尚无 MoM 逻辑，等于直连 provider）
8. 递归护栏：编辑 `data/mom.config.json` 把 `aggregator.model` 设为 `advisor.slots[0]` 的同名值，重启 → 期望进程报错退出：`[MoM] config error: aggregator.model "..." also appears in advisor.slots — recursion guard tripped`
9. 秘钥缺失护栏：临时删除 `.env` 中的 `PROVIDER_API_KEY` 行，重启 → 期望进程报错退出：`[MoM] config error: missing required environment variable PROVIDER_API_KEY ...`

---

## Phase 2: Advisor 视图 + Fan-out + Concat 拼接

### 目标
`mom_mode: always` 时，每次请求都 fan-out 全部 advisor、拿到 references、以 concat 方式拼到 aggregator 请求最后一条 user 尾部，用 aggregator 模型调用 provider 返回。支持 streaming（aggregator 侧流式返回，advisor 侧非流式）。暂不做缓存、不做触发粒度判断、不做 trace 落盘（异常打 log 即可）。

### 与本节初稿的偏离（执行时确认，见 decisions/003）

1. **Streaming aggregator 仅做直 pipe**：初稿要求 tee + SSEParser + onComplete；Phase 2 无 trace 消费者，parser/回调为死代码——推迟到 Phase 3 与 saveTrace 一同引入
2. **不引入 p-limit**：自写 `promisePool<T>(items, limit, worker)`（20 行）替代
3. **不新建 `src/orchestrator/aggregation.ts`**：Phase 2 只有 concat 一条路径，`aggregator/reference-builder.ts` 就承担；Judge 是 Phase 6，届时再建骨架
4. **新增启动护栏 `assertModeRequirements`**：`mom_mode==='always'` 时校验 `advisor.slots` 非空且 `aggregator.model` 非空，不满足即 `ConfigError` 退出（与 `assertRecursionGuard` 同级）
5. **`Trace.settings_snapshot: RuntimeConfig` → `MoMConfig`**：宏观修复，避免 Phase 3 落盘时把 `provider.api_key` 写进 SQLite（违反 decisions/002）。类型层的边界防御，前置到 Phase 2
6. **handler / server 签名升到 `RuntimeConfig`**：`createMessagesHandler(runtime)` / `startServer(port, runtime)`；provider 层的 `passthroughCall(req, provider)` / `passthroughStream(req, reply, provider)` 保持只依赖 `ProviderConfig`，分层约束不破
7. **Phase 2 只 log 事件、不组装 Trace**：Trace 组装整体推迟到 Phase 3，与 saveTrace 一起做
8. **单测采用 Node 22 内置 `node:test`**：零依赖，覆盖 `convertToAdvisorView` / `truncateToolResult` / `appendReferencesToLastUser` 三处纯逻辑；重点验证「append 只改最后一条 message、前缀 message 引用相等」不变量

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
  - `runAdvisor(slot, messages, momConfig, provider): Promise<AdvisorResult>`
    - 视图转换 → 构造请求（`model=slot`、`system=ADVISOR_SYSTEM_PROMPT`、不传 `tools`、`max_tokens=momConfig.reference_max_tokens ?? 4096`、`stream=false`）→ 调 `passthroughCall(req, provider)`
    - 抽取 response 里所有 `type:"text"` block 的 text 拼接为 `reference`
    - 记录 `usage` / `latency_ms`；异常场景 catch 后返回 `{success:false, error, latency_ms}`，绝不抛

**并发 fan-out**

- **新增** `src/orchestrator/fanout.ts`
  - `promisePool<T, R>(items, limit, worker)` — 自写 20 行并发限流（不引入 p-limit 依赖）
  - `fanoutAdvisors(messages, momConfig, provider): Promise<AdvisorResult[]>` — 并发上限 8，保持 slots 顺序返回

**References 拼接**

- **新增** `src/aggregator/reference-builder.ts`
  - `buildConcatReferences(results: AdvisorResult[], momConfig: MoMConfig): string`
    - 每个 result：成功 → `[Reference {i} — {slot}]\n{truncated_reference}`；失败 → `[Reference {i} — {slot} failed: {error}]`
    - 每个 reference 按 `momConfig.reference_max_tokens * 4` 字符截断（简单估算 1 token ≈ 4 chars）
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
    - `buildConcatReferences` → `appendReferencesToLastUser` → 用 `momConfig.aggregator.model` 替换 `model` 字段 → `passthroughCall(req, provider)`
    - 返回含 `response` / `usage` / `latency_ms` / `references_appended`
  - `runAggregatorStreaming(original, results, momConfig, provider, reply): Promise<void>`
    - 同上构造 request 但 `stream=true`，直接 `passthroughStream(req, reply, provider)` 转发（Phase 2 复用 Phase 1 的字节级 pipe，不做 tee/SSEParser/onComplete；Phase 3 引入 trace 落盘时再加）
    - `latency_ms` 与 trace 组装均由 Phase 3 承接

**主调度**

- **新增** `src/orchestrator/orchestrator.ts`
  - `orchestrate(body, reply, runtime, log)`
    - 读入进程启动时装配好的 `RuntimeConfig`（不再动态从磁盘 `loadSettings()`；Dashboard 编辑后由 `saveMoMConfig` 触发 hot-reload 或重启，具体机制在 Phase 4 定）→ 若 `momConfig.mom_mode !== "always"` 走透传（Phase 1 已有逻辑）
    - `fanoutAdvisors(body.messages, momConfig, provider)` 拿到 advisorResults；用 fastify logger 打 fanout / aggregator 事件（Phase 2 不组装 Trace，Phase 3 再引入）
    - `stream` → `runAggregatorStreaming` 直接 pipe；否则 `runAggregatorNonStreaming` 返回 JSON
- **修改** `src/gateway/messages-handler.ts`：签名升为 `createMessagesHandler(runtime: RuntimeConfig)`；把透传逻辑替换成 `orchestrate(body, reply, runtime, req.log)`
- **修改** `src/gateway/server.ts`：签名升为 `startServer(port, runtime: RuntimeConfig)`；provider 层的 `passthroughCall(req, provider)` / `passthroughStream(req, reply, provider)` 保持只依赖 `ProviderConfig`

### 验证方式

1. 在 `data/mom.config.json` 里至少配 3 个 provider 侧可用模型到 `advisor.slots`，`aggregator.model` 也填一个不冲突的
2. Non-streaming 请求 → 期望在日志里看到 3 条 advisor 调用（并发）、1 条 aggregator 调用，返回符合 `AnthropicMessagesResponse`
3. 在 `runAggregatorNonStreaming` 里 dump 最终发给 provider 的 messages → 验证：
   - `messages` 除最后一条外，与原始 `req.messages` **逐对象引用相等**（即前缀字节稳定）
   - 最后一条 user message 尾部含 `Expert Panel References:` 段落
   - 所有 references 顺序与 `momConfig.advisor.slots` 顺序一致
4. Streaming 请求 + Claude Code 实测 → 期望正常流式渲染回复
5. 视图转换单测：构造一条含 `tool_use` + 后续 `tool_result` 的 messages → `convertToAdvisorView` 输出：
   - assistant text 尾部有 `[called tool: bash({"cmd":"ls"})]`
   - 下一条 user 尾部有 `[tool result: ...]`
   - 若原始最后是 assistant，输出末尾追加了合成 user marker
6. 故意杀一个 advisor slot（改成不存在的模型名）→ 期望 aggregator 收到 `[Reference N — slot failed: ...]` 字符串，请求不中断

---

## Phase 3: 触发粒度 + Fanout 缓存 + Cache 装饰 + 成本分账

### 目标
支持 `fanout_mode: user_turn | per_iteration` 双模式。**触发判断与缓存复用解耦**：`fanout_mode` 只影响 cache key 的取样范围（`user_turn` 只对最后一次真实 user turn 之前的前缀做签名；`per_iteration` 对完整 messages 做签名），控制流永远是"先查 cache，命中即复用、未命中就跑 fanout"——没有"跳过 advisor"这条分支。`trigger_reason` 变成描述性标签（`user_turn` / `skipped_tool_iteration` / `tool_iteration_cache_miss` / `per_iteration` / `fanout_cache_hit` / `mom_off`），只用于 trace/metrics，不控制主链路走向。

Advisor 请求侧按 system_and_3 布局装 4 个 `cache_control` marker。每次请求写一条 `Trace` 到 SQLite（node:sqlite），含 advisor + aggregator 两层 usage 汇总和成本分账（advisor 各自 slot 单价、aggregator 单价；judge 在 Phase 6 引入）。`mom_mode !== 'always'` 的透传请求也写 trace（`mom_triggered=false` / `trigger_reason="mom_off"`），给 Phase 4 metrics `mom_trigger_rate` 一个分母。

### 前置条件
- Phase 2 的 `orchestrate` 骨架、`fanoutAdvisors` 已实现
- `momConfig.cache.ttl` / `momConfig.cache.max_entries` / `momConfig.fanout_mode` / `momConfig.pricing_table` 字段已在 Phase 1 定义

### 组件改动

**触发判断（描述性标签，不控制流程）**

- **新增** `src/orchestrator/trigger.ts`
  - `isNewUserTurn(messages: AnthropicMessage[]): boolean` — **严格规则**：最后一条 user message 的 content blocks 里只要存在**任何一个** `type:"tool_result"` block（不管是否同时含 text）就返回 false；否则 true
  - `computeTriggerReason(fanoutMode, isNewTurn, cacheHit): TriggerReason` — 纯函数，输出六种枚举值之一：
    - `mom_off`：`mom_mode !== 'always'`，透传路径（在 orchestrator 层判定，不进 trigger.ts）
    - `user_turn`：user_turn 模式 + 新 turn + cache MISS → 跑 fanout
    - `skipped_tool_iteration`：user_turn 模式 + tool iteration + cache HIT → 复用
    - `tool_iteration_cache_miss`：user_turn 模式 + tool iteration + cache MISS → **补跑 fanout 并写缓存**（覆盖进程重启、TTL 过期、首请求即 tool_result 三种真实场景）
    - `per_iteration`：per_iteration 模式 + cache MISS → 跑 fanout
    - `fanout_cache_hit`：per_iteration 模式 + cache HIT → 复用
- **删除** PLAN 初稿的 `shouldFanout({trigger, reason})` 返回值——不再把"是否跑 fanout"作为决策；`mom_mode==='always'` 时永远 fanout（除非 cache 命中）

**Fanout 缓存**

- **新增** `src/cache/cache-key.ts`
  - `computeFanoutCacheKey(messages, momConfig): string` — 组成：
    - `sig` = sha256(canonical JSON stringify(signatureMessages))
    - user_turn 模式：signatureMessages = messages 截到并**包含**最后一个"真实 user message"（`isRealUserMessage` = role==='user' 且 content 里**没有** `tool_result` block）为止；同一 turn 内后续 tool iteration 的 messages 只是在其后追加 tool_use/tool_result，签名前缀不变
    - per_iteration 模式：signatureMessages = 完整 messages
    - `settingsHash` = sha256 of stable JSON of `{system_prompt, tools_enabled, reference_max_tokens}`（只哈希影响 advisor 视图/输出的字段；无关字段变动不失效缓存）
    - `slotsHash` = sha256 of `slots.join('\x00')`（**保留原顺序、不排序**——顺序调整会 miss 一次，但避免"复用旧顺序结果导致 aggregator 引用编号语义漂移"）
    - 最终 key = `settingsHash|slotsHash|sig`（三段用 `|` 拼接的字符串，可读、易调试）
- **新增** `src/cache/fanout-cache.ts`
  - **Map-based TTL + LRU，零第三方依赖**（延续 Phase 2 拒绝 p-limit 的项目风格）
  - 结构：`Map<string, {value: FanoutCacheValue, expires_at: number}>`；LRU 靠"get/set 时先 delete 再 set"利用 Map 插入顺序特性；过期检查在 get 时懒执行
  - `createFanoutCache({max_entries, ttl_ms})` → `{get(key), set(key, value), size(), clear()}`
  - TTL preset 转换：`'5m' → 5*60*1000`、`'1h' → 60*60*1000`
- **修改** `src/orchestrator/fanout.ts`：`fanoutAdvisors` 签名扩展为接收 `cache` 与预算好的 `key`；命中直接返回原 `AdvisorResult[]` 的深拷贝，每条打 `cache_hit=true` / `usage` 归零 / `latency_ms=0` / `reference` **保留原文**（不清空——否则 aggregator 无 references 拼接，等于白命中）；MISS 时正常跑再 `set(key, results)`

**Cache 装饰（Anthropic 侧 prompt caching）**

- **新增** `src/cache/cache-decorator.ts`
  - `applyAdvisorCacheControl(system: string, messages: AnthropicMessage[]): {system: SystemBlock[], messages: AnthropicMessage[]}` — **system_and_3 布局**：
    - `system` 转成 `[{type:"text", text: system, cache_control:{type:"ephemeral"}}]`（第 1 个 marker）
    - 遍历 messages 找**最后 3 条非 ADVISORY_INSTRUCTION 合成 marker** 的 message，在各自最后一个 content block 上加 `cache_control`（第 2/3/4 个 marker）
    - 不足 3 条时能加几个加几个
    - 合成 marker（单 text block 且 text === `ADVISORY_INSTRUCTION`）跳过，因为它每次位置可能漂移
- **修改** `src/advisor/advisor-runtime.ts`：在调 `passthroughCall` 前先过 `applyAdvisorCacheControl`；request 的 `system` 字段从 `string` 换成 `SystemBlock[]`（Anthropic Messages API 的 `system` 字段本就是 `string | SystemBlock[]` union，切到数组形式才能承载 `cache_control`）

**成本分账**

- **新增** `src/cost/pricing.ts`（**目录职责边界**：`src/cost/` 只放"计价 / usage 纯函数"，metrics 聚合永远归 `src/storage/metrics.ts` 或 `src/dashboard-api/metrics-api.ts`）
  - `calculateCost(model: string, usage: Usage, pricingTable): number` — 从 `pricingTable[model]` 读四段单价（input / output / cache_write / cache_read），缺项时 log warn + 返回 0；单位 USD per million tokens
  - `sumUsage(usages: Usage[]): Usage` — 汇总多次调用的 usage（供 metrics 用）

**Streaming trace observer（provider 层内部实现细节）**

- **修改** `src/provider/stream-forward.ts`：给 `passthroughStream` 增加可选参数 `onEvent?: (evt: SSEEvent) => void`
  - 字节仍 `res.body.pipe(reply.raw)` 原样转发（透传路径行为完全不变）
  - `onEvent` 非空时，用 `res.body.pipe(new PassThrough())` 分叉一路，用行级 SSE parser 增量组装事件后回调；observer 内部异常一律 `log.warn` 后吞掉，不影响主转发
  - Phase 2 的透传路径**不传 `onEvent`**，行为完全等价；Phase 3 的 MoM streaming 路径传 `onEvent`
- **扩展** `src/gateway/sse.ts` 补 `createSSEParser()`（增量分帧器，按 `event:` / `data:` / 空行三种前缀累积，收到空行时 emit 一个 `SSEEvent`）

**Trace 持久化**

- **新增** `src/storage/traces.ts`
  - `saveTrace(trace: Trace): void` — 序列化整条 `Trace` 到 `data` 列，同时把常用字段（`mom_triggered` / `trigger_reason` / `total_cost_usd` / `baseline_cost_usd` / `total_latency_ms`）冗余到独立列，方便 Phase 4 metrics 聚合直接走 SQL
  - `getTraceById(id): Trace | null`
  - `getRecentTraces(limit): Trace[]`
  - `deserializeTraceRow(row): Trace` — 内部工具
- **`src/storage/db.ts`**：现有 SCHEMA 已含所有列（`id / timestamp / mom_triggered / trigger_reason / total_cost_usd / baseline_cost_usd / total_latency_ms / data`），无需改动
- **修改** `src/orchestrator/orchestrator.ts`：
  - **主链路一律先算 cache key + trigger_reason**，然后决定 fanout 走 cache 复用还是真跑
  - 非流式：组装 `Trace`（`settings_snapshot: MoMConfig` 深拷贝、`total_cost_usd` = Σ advisor 成本 + aggregator 成本、`total_latency_ms` = 请求进入到 response 生成完毕），reply 前同步 `saveTrace()`；`saveTrace` 抛错只 `log.error`，不打断响应
  - 流式：把 `onEvent` observer 传给 `runAggregatorStreaming`；observer 累积成 `AnthropicMessagesResponse` + `Usage`，`message_stop` 后 orchestrator 组装 `Trace` 并 `saveTrace`；此时 reply 可能已 end，落盘完全异步
  - 透传路径（`mom_mode !== 'always'`）：透传完成后写一条 `mom_triggered=false / trigger_reason="mom_off" / advisor_results=[] / aggregator_result=null / total_cost_usd=0` 的 trace

### 与 Phase 3 初稿的关键偏离（含理由）

1. **`shouldFanout` 从"决策函数"退化成"标签函数"**：初稿隐含"user_turn tool iteration 直接跳过 advisor"，无法处理进程重启 / TTL 过期 / 首请求即 tool_result 三个真实场景（aggregator 会拿到空 references，严重降级到 baseline）。新语义：控制流永远"cache 查询 + miss 补跑"，`trigger_reason` 只做叙述。详见 `decisions/005-trigger-cache-decoupling.md`。
2. **cache key 用 ordered `slotsHash` 而非 `sortedSlots`**：`AdvisorResult[]` 是按 `advisor.slots` 顺序拼接的，缓存复用旧顺序结果 + 新配置读顺序 = "Reference 1 — A" 内容实际是旧 slot A 的分析、但当前配置的引用 1 语义应该是 slot C——缓存必须承担"输入即输出"的强不变量，slot 顺序变更即输入变更。
3. **不引入 `lru-cache` 依赖**：Map-based TTL + LRU 手写 30-40 行（延续 Phase 2 拒绝 p-limit 的选择）。
4. **`passthroughStream` 单一实现 + 可选 observer**，不复制出两套转发逻辑：透传模式不传 `onEvent`、行为等价；MoM streaming 传 `onEvent`、旁路解析。stream 层解析归 provider 层内部实现，不上升到 aggregator。
5. **透传路径也写 trace**（`mom_triggered=false`）：给 Phase 4 `mom_trigger_rate` 一个正确的分母；每请求多一次 SQLite 同步写入，MVP 可接受，若 Phase 4 性能压力大再引入批量写。
6. **`src/cost/` 目录职责收敛**：只放"计价 / usage 纯函数"；metrics 聚合永远归 storage / dashboard-api，避免目录膨胀。
7. **顺手完成 ISS-007 SDK 解耦**：把 3 处 `FastifyReply` / `FastifyBaseLogger` 耦合（`orchestrate` / `runAggregatorStreaming` / `passthroughStream`）全部消除。`orchestrate` 变为 `createOrchestrator(runtime): { nonStreaming, streaming }` 工厂（同时闭包持有 fanout cache）；`runAggregatorStreaming` / `passthroughStream` 改接 `NodeJS.WritableStream + {onEvent?, log?}`；SSE header + hijack 上移到 `messages-handler`。业务层零 Fastify 依赖，Fastify 仅剩 `src/gateway/*`。因 Phase 3 无论如何都要动这 3 个文件，顺手解耦比之后专门开 refactor 更省事；ISS-007 从 [暂缓] 转 [已解决]。详见 `docs/006API.md §3`。
8. **`passthroughStream` 内部改为手动 `data` 监听**：初稿是 `res.body.pipe(reply.raw)`；新实现是 `res.body.on('data', chunk => { output.write(chunk); if (onEvent) parser.push(chunk).forEach(evt => onEvent(...)) })`。理由：单一实现里同时给主链路 pipe + 观察者 tee，用 `data` 事件把两路合成一处、避免 PassThrough 中间层，也避免 `pipe` 与 `data` 混用的双消费问题。

### 验证方式

1. **`fanout_mode: user_turn` — 命中路径**：清空 mom.db → 用 Claude Code 发一条会引发 tool 调用的请求（"读一下 README"）→ 观察 fastify 日志：第 1 个请求（纯 user）出现 `event=fanout_miss` + N 个 slot 调用完成；第 2 个请求（含 tool_result）出现 `event=fanout_hit` + 0 次 provider 调用
2. **`fanout_mode: user_turn` — miss 降级路径**：`.env` 里临时把 `MOM_DB_PATH` 换到新文件重启（模拟"首请求就是 tool_result"）；或缓存刚建好就等 TTL 过期；发一条 `messages` 末尾是 tool_result 的请求 → 期望日志出现 `event=fanout_miss` + `trigger_reason="tool_iteration_cache_miss"`，aggregator 依然拿到完整 references（非空数组）
3. **trace `trigger_reason` 校验**：`sqlite3 mom.db 'SELECT trigger_reason, mom_triggered FROM traces ORDER BY timestamp DESC LIMIT 10'` → 期望能看到六种枚举值中出现的对应组合（`mom_off` 透传路径 / `user_turn` 首 turn / `skipped_tool_iteration` 后续 tool iteration / `tool_iteration_cache_miss` 冷启 tool 场景 / `per_iteration` 或 `fanout_cache_hit`）
4. **`fanout_mode: per_iteration`**：切模式重启 → 期望每次请求都 MISS（除非 messages 完全等价）+ 每次都跑 N 个 slot；`trigger_reason` 在 `per_iteration` 与 `fanout_cache_hit` 之间切换
5. **cache 装饰生效**：在 `advisor-runtime` 请求发出前 dump messages 与 system，观察 3-4 个 `cache_control: {type:"ephemeral"}` marker 落在预期位置（system 第 1 个 + 最后 3 条非合成 marker message 各 1 个）
6. **provider prompt caching 命中**：观察连续两次同前缀 advisor 请求的 provider 响应，`usage.cache_read_input_tokens` 第二次显著大于 0
7. **成本分账**：`sqlite3 mom.db 'SELECT id, trigger_reason, total_cost_usd FROM traces ORDER BY timestamp DESC LIMIT 5'` → 非命中 trace `total_cost_usd > 0`（= Σ advisor slot 成本 + aggregator 成本）；命中 trace `total_cost_usd` = aggregator 成本（advisor usage 归零，成本 0）；`mom_off` trace `total_cost_usd = 0`（透传路径不知道 provider 内 usage）
8. **pricing 热更**：修改 `data/mom.config.json` 里 `pricing_table.<slot>` 的价格 → 重启后新请求按新价格计算
9. **streaming trace**：`stream:true` 请求 → 客户端正常收流；response 结束后 `sqlite3` 查该 trace，`aggregator_result.usage` / `aggregator_result.response.id` 应正确填充（说明 observer 解析 SSE 成功）

### 单元测试

- `test/trigger.test.ts`：`isNewUserTurn` 正/负例（纯 user / user+tool_result / assistant / 空 messages）、`computeTriggerReason` 六种组合
- `test/cache-key.test.ts`：user_turn 模式下 tool iteration 与前一次真实 user 命中同 key；slot 顺序不同不命中；`settingsHash` 影响字段变化不命中
- `test/fanout-cache.test.ts`：TTL 过期、LRU 淘汰、`max_entries` 边界
- `test/cache-decorator.test.ts`：4 个 marker 落位、合成 marker 被跳过、不足 3 条时不越界
- `test/pricing.test.ts`：`calculateCost` 四段单价加总、缺项返回 0、`sumUsage` 聚合正确

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

## Phase 5: Dashboard 前端五页（预览版已交付）

### 目标
面向展会演示的 Dashboard。核心叙事："**用更便宜的组合，逼近旗舰模型的效果**"——前三页从三个角度回答"效果"，第四页回答"成本"，第五页负责配置。技术栈 Vite + React 18 + TS；本 phase 的所有数据都写在 `web/src/mock/*.ts`，页面组件直接读 mock、不走网络，也不触达 Phase 2–4 的真实工作流。作用是先把 UI/文案/图表结构与后续 API 契约锁定，Phase 6+ 再逐步换成真接口。

### 视觉语言（Anthropic 奶油底 · 暖灰调）
数值以 `web/src/theme.ts` 为准，本节只列该文件里实际用到的常量。
- 底色 `#FAF9F5`（`color.bg`）+ 卡片纯白 `#FFFFFF` + 大留白；卡片浅描边 `#E8E3D8`（`color.border`），强描边 `#D6CFC0`
- 主强调色 `#C96442`（`color.mom`，Anthropic 品牌陶橙），用于 MoM 系列、主 CTA 与"运行中"状态；柔化色 `#F5DDD1`（`color.momSoft`）用于高亮底
- 图表低饱和暖色带：MoM = `#C96442` / Baseline & Flagship 灰 = `#8B8680`（`color.flagship`）/ Aggregator-only 卡其 = `#C4A574`；三个 advisor 分别是 `#B8A88A` / `#A8998C` / `#C9B79C`
- 语义色：正向 `#6B8E6F`（`color.positive`）、负向 `#B96E5A`（`color.negative`）、信息 `#7A8AA6`（`color.info`）；网格线 `#EDE7DB`，轴标签 `#8A8177`
- 字体全走 sans（`"Söhne", ui-sans-serif, -apple-system, "PingFang SC", ...`），代码 / token 数字用 `ui-monospace`；没有 serif 分支
- 圆角常量 `sm 6 / md 10 / lg 14 / xl 20`；阴影用 `rgba(31, 27, 22, .04~.10)` 三档（`shadow.card / raised / hover`）
- 图表库 **Recharts** 一把梭；无暗色主题（现场大屏白底更稳）

### 五页设计

**1. Overview 总览页（`pages/OverviewPage.tsx` · 静态）**
数据源是评测组的 benchmark 结果占位，预览版全走 `mock/benchmarks.ts`。回答"MoM 到底达没达到旗舰效果、代价几何"。
- **KPI 顶部三卡**（读 `heroStats`）：`达到 Fable 5 平均分`（96%，clay 强调）/ `相比 Fable 5 成本`（−68%，positive 绿）/ `延迟（我们说实话）`（+1.2s，negative 红，副文案"这是我们承认的代价"）
- **KPI 分数三卡**（ISS-029 二修新增，读 `paretoData`）：`Fable 5 平均分`（85.5，旗舰参照）/ `MoM 平均分`（82.4，clay 强调）/ `Aggregator 单跑平均分`（71.1，baseline），跟 Pareto 图数字完全一致
- **副图 · 分 benchmark Combo**（`components/charts/ComboChart.tsx`）：横轴 6 个 benchmark（MMLU / HumanEval / GSM8K / BBH / MATH / GPQA），主 Y 轴分数三条折线（MoM / Aggregator only / Fable 5），次 Y 轴是**成本**（`$/1k token`）三组柱——不是 token 消耗；Legend 用自定义 `TwoRowLegend` 拆两行（ISS-029 二修）——第一行 3 个 cost 项，第二行 3 个 score 项
- **主图 · Pareto 效果-成本气泡图**（`components/charts/ParetoChart.tsx`）：横轴 `$ / 1M 输出 token`（线性 0–20，非对数），纵轴 avg score（60–90）；散点六个 = MoM / Aggregator only / Fable 5 / GPT-5 / Sonnet 4.6 / Haiku 4.5，**每个非 MoM 模型都是独立 Scatter**（ISS-029 二修），legend 列全部名字，shape 分别 star (MoM) / circle (Fable5) / square (GPT-5) / triangle (Sonnet4.6) / diamond (Haiku4.5) / cross (Aggregator only)；Aggregator-only 走 `color.aggregatorOnly` 卡其色区分内部 baseline 与竞品旗舰灰；背景一根 clay 虚线连出 Pareto frontier 折线（Haiku → AggOnly → MoM → GPT-5 → Fable 5，全部非被支配点）；X 轴 label 走 `insideBottom` 压回轴线上方，与 Combo 图 legend spacing 对齐（`paddingTop: 8` + `margin.bottom: 30`）；tooltip 显示 `score X.X · cost $Y.YY/1M`
- 不含 `Wins / Ties / Losses` 卡；不含"MoM → Flagship 差值标注"

**2. Live Compare 实时对比页（`pages/LivePage.tsx` · mock 打字机）**
"实时"是指打字机动画的实时——真正的 SSE 尚未接入。预览版从 `mock/live-samples.ts` 里读 5 个预置 prompt 的完整脚本（中英各一套，含 MoM/Baseline 长文本、latency/tokens/costUsd、advisor previews、5 维 judge 分）。
- **顶部 Prompt Shelf**（`PromptShelf`，Card 内嵌）：5 个预置按 `PRESET_ORDER` 排 — `binarySearch` / `cap` / `refactor` / `race` / `urlShort`（"Rust 二分查找 / CAP 定理 / 重构代码片段 / 排查竞态问题 / 设计短链服务"）；下方一个 checkbox `同时跑一次 Baseline 对比`；页面右上主 CTA `▶ Run`，触发 `setRunId` 重启打字机
- **主区左右并排**（Baseline 关掉时退化为单栏）：
  - 左卡（MoM）：标题旁挂 `Badge tone="mom"` 显示 `3 advisors`；副标题 `3 advisors + aggregator · MoM`（型号字用 mono）——不是三个独立 slot 芯片
  - 右卡（Baseline）：标题 `Baseline`，副标题 `单次旗舰模型调用 · claude-fable-5`
  - Body：`useTypewriter(text, { runId, tickMs, charsPerTick })` 逐字流出到 `<pre>` 里（无 markdown 高亮，等宽字体原样渲染代码块）；未完成时右侧闪一个 clay 光标
  - Footer 一行三项：`⏱ 延迟 · N tokens · $ cost`（延迟按 locale 显示"1.2 秒"或"3.4s"）——**没有 prompt / completion 拆分**，也**没有 cache hit%**
- **下方两栏**：
  - 左：**Judge 雷达图**（`components/charts/JudgeRadar.tsx`，Recharts `RadarChart`），5 维 = `Correctness` / `Completeness` / `Depth` / `Clarity` / `Usefulness`（中文：准确性 / 完整度 / 深度 / 清晰度 / 实用性）；MoM 实线 clay 填充 22%，Baseline 灰色虚线填充 10%；无圆心综合分差数字
  - 右：**成本对比条**（`CostCompare`）：并排两根横向单色条（MoM clay / Baseline flagship 灰），不再细分 advisor/aggregator/judge/baseline 段；下方一行"You saved −N%"（正向绿）+ "Latency Δ +N.Ns"（正数红、负数绿）
- **底部动态排名图**（ISS-029 二修新增，`components/charts/RankingChart.tsx`，全宽独立卡片）：横轴最近 10 turn（第 10 = 当前 preset），Y 轴 `reversed` 显示 rank 1/2/3（1 = 最好）；三条折线 MoM / Aggregator-only / Fable 5，同色 stroke 家族与 ComboChart 一致；数据来自 `mock/live-ranking.ts`（9 turn 历史固定 mock + 每个 preset 单独定义的第 10 turn，Prompt Shelf 切换 preset 时第 10 turn 联动）；Tooltip 显示 turn 号 + 当轮问题标题（中英切换）+ 三家排名；副标题点明"对不确定问题绝对分不可比、用相对排名衡量效果"这一叙事动机——补 Judge 雷达"只看当前一轮"的短板，讲解"MoM 在开放型问题上是否稳定优于 baseline"
- **不含底部甘特时间线**；请求各阶段耗时不在此页展示

**3. Pipeline 请求流程页（`pages/PipelinePage.tsx` · mock 时序）**
回答"MoM 内部是怎么跑的"。时序读 `mock/pipeline-trace.ts` 的 `pipelineTimeline`；每次点 Replay 就 `setRunId+1`，`useEffect` 用 `requestAnimationFrame` + `performance.now()` 推进 elapsed，节点靠 `computeStatus(node, elapsed, speed)` 计算 `pending / running / done`。**此页与 Live 页彼此独立，不联动。**
- **主流程图（垂直排列）**：`User prompt` → **fan-out 虚线**（SVG 三叉）→ 三张并排 `Advisor` 卡片（A/B/C）→ **fan-in 虚线**（三叉汇一）→ `Context assembly` 装配盒（副标注 `system_and_3 layout · 4 cache breakpoints`）→ 单虚线 → `Aggregator` → 单虚线 → `Final answer`
- **动画节奏**：节点按 `pending（灰底、40% 不透明）→ running（clay 边、"● 进行中"徽章）→ done（positive 绿边、"✓ 已完成"徽章）` 三态切换；advisor 卡片会实时显示预置的 preview 文本、`tokens / latency / cost`，A 号卡带 `cache 命中` 徽章
- **顶部控件**：右上一组 `Speed 1× / 2× / 4×` 分段控件（`SpeedToggle`）+ 一个 `▶ Replay` 主按钮；`Turn #N · X.XXs` 与一根 clay 细进度条（`ProgressBar`）显示总进度
- **Context diff 弹窗**（`DiffModal`）：装配盒里的 `Show context diff →` 幽灵按钮打开一个居中 modal，左右并排两个 `<pre>` 展示 `装配前` vs `装配后` 的 messages JSON（右侧多出 `<references>...</references>` 段落）；点遮罩或右上 `× 关闭` 收起
- **每张卡目前不可点开抽屉**；请求 messages 全文与 aggregator 最终 messages 只在 diff 弹窗里以 JSON 片段呈现，暂无 slot / aggregator 独立抽屉

**4. Cost 成本分析页（`pages/CostPage.tsx` · MoM 内部成本剖析）**
Scope 只算 MoM 流程内部（3 个 advisor + aggregator），Baseline 与 Judge 单独展示；本 phase 的 mock 里 judge 成本还没建模。
- **顶部横幅 `SavedBanner`**（读 `mock/cost.ts` 的 `sessionCost`，32 turns）：左侧 `Baseline $4.12`（灰色删除线）→ `MoM $1.33`（44px clay 加粗）；右侧巨号 `−68%`（72px positive 绿）+ 副标 `节省 / saved`
- **KPI 四卡**：`总成本 Total cost` / `平均每轮 Avg / turn` / `Cache 命中率 Cache hit rate` / `已运行轮次 Turns run`——**不是 Advisor:Aggregator:Judge 占比卡**
- **主图 · 每轮堆叠柱**（`CostStackedBar.tsx`）：横轴 turn index（32 轮），纵轴 cost（`$0.XXX`），四段堆叠 `Advisor A / B / C / Aggregator`（clay 段在最上，radius=[3,3,0,0]）；hover tooltip 显示 `$0.XXXX` 明细。**当前无 judge 段**
- **副图 · 饼图**（`CostPie.tsx`）：4 段 `Advisor A/B/C + Aggregator`（三 advisor 用暖灰渐变 `advisorA/B/C`，aggregator 用 clay），中空环形，图例 & tooltip 均按角色显示 `$0.XXX`
- **Cache 命中率条**（`CacheHitBars.tsx`）：横向条形对比 4 个模型（`kimi-k2 (Advisor A)` / `deepseek-v3 (Advisor B)` / `qwen3-72b (Advisor C)` / `claude-sonnet-4-6 (Aggregator)`），每行单值命中率（0–100%）、渐变填充（aggregatorOnly → mom）——**不区分 read/write/miss 三段**，也**没有第 5 行 judge**
- **底部时间线**（`CostTimeline.tsx`）：本次 session 每轮成本折线（`AreaChart`，clay 描边 + clay 半透明填充）；**不是 24h 累计线**，**没有 Flagship 上限虚线**，也不做"价格调整点标注"

**5. Settings 设置页（`pages/SettingsPage.tsx` · 本地 state，不落库）**
所有字段初值读 `mock/config.ts` 的 `initialConfig`；`Save` 只 setState + 弹一个 `✓ 设置已保存（预览版无后端接入）` 的 flash，**不调 API**，也不写 `localStorage`。语言切换是唯一真正持久化的项，走 `I18nProvider` 写 `mom-dashboard-lang`。
- **Language 卡**：`English / 中文` 两颗大 radio 按钮；描述说明本设置同时控制 Dashboard UI 与 MoM 与 Claude Code 交互时使用的语言。**没有主题切换**
- **Provider 卡（`.env` 只读快照）**：两条只读字段 `Base URL: https://api.deepseek.com`、`Auth style: bearer · dee****k7yq`；每行右侧带 `🔒 只读` 徽章 + 说明 `Provider 秘钥请在 .env 中修改，此处不可编辑`
- **Aggregator 卡**：一个 Model 下拉；**没有 temperature / max_tokens / system prompt 输入框**
- **Advisor slots 卡**：可 `+ 添加槽位` / `× 移除` 每个 slot；每行三列 = `Slot 标签徽章 / Model 下拉 / 移除按钮`；**没有 name / weight / stance / enabled 字段**；也没有 slot 数量 ≥1 / ≤4 的硬性校验
- **Judge & Baseline 合并卡**：并排两个 Model 下拉 `Judge model` + `Baseline model` + 一行 checkbox `启用 Baseline 对比 · 为演示每次多调一次，代价换效果`；**没有 5 维权重滑块**、**没有 `JUDGE_SYSTEM_PROMPT` 展开**；`Comparison` 未独立成卡
- **Pricing table 卡**：`model / Input $ / 1M / Output $ / 1M` 三列可编辑（`NumInput` 数字输入）；**没有 cache_read / cache_write 两列**；行是固定的（从 `initialConfig.pricing` 派生），不支持增删 model
- **Save/Cancel 按钮**在 `PageShell` 右上（不是页面底部）；Cancel 会把整份 config 重置回 `initialConfig`
- **不含 Cost tradeoff `Coming soon` 卡**

### 双语（i18n）
- **实现**：`web/src/i18n/{dict.ts, context.tsx, format.ts}`，`I18nProvider` + `useI18n()` 一套自研；不引入 i18next
- **术语策略**：技术术语保留英文（`token` / `cache hit` / `latency` / `Aggregator` / `Advisor` / `Judge` / `Baseline` / `Pareto` / 各 benchmark 名 / 各模型 ID），本地化的是叙述性文字：`本会话共节省` / `节省` / `等待中` / `已完成` / `设置已保存` 等
- **切换后果**：Dashboard UI 全体切换 + `<html lang>` 属性同步为 `zh-CN` / `en`；`mock/live-samples.ts` 与 `mock/pipeline-trace.ts` 都按 lang 提供两套完整脚本，切语言即换全套预置内容
- **默认语言**：读 `localStorage['mom-dashboard-lang']`，缺省时用 `navigator.language`（`zh-*` → zh，其他 → en）；用户切换后写回 `localStorage`
- **格式化**（`i18n/format.ts`）：成本一律 `$X.XX / X.XXX / X.XXXX`（两种语言共用，未做 `$0.42` vs `0.42 $` 分叉，也未做千分位分隔号切换）；延迟 `1.2 秒` / `1.2s`；token 数超过 1k 缩为 `1.2k`

### 预览版交付边界（本 phase 已完成）
- 五页可切换 + 中英可切换 + 主要动画（Live 打字机 / Pipeline 节点状态推进 & Diff modal / 图表 hover）可跑
- 数据全部来自 `web/src/mock/*`；`hooks/useEventSource.ts` 是保留空壳的 `EventSource` 封装，签名 `{ events, connected }`，本 phase 无消费者
- `npm --prefix web run build`（`tsc -b && vite build`）通过；Vite 配置 `base: '/dashboard/'`，dev proxy `/api` + `/v1` → `http://localhost:3000`——已经为将来接后端预留
- **不做的事**：不接 Phase 2/3 orchestrator、不接 `/v1/messages`、不消费 `/trace/requests`、不接 SSE、不写数据库、不改 `mom.config.json`

### 待讨论的问题
- 现场大屏分辨率：假设 1920×1080，是否需要 4K 兼容（字号跟随视口 clamp？）
- 展会现场是否要一个"Demo 循环模式"（每 20s 自动切页 + 触发一次 Live 播放）—— 若要，加一个 `?demo=1` query flag 即可
- Pipeline 页目前只有 Diff modal，没有 advisor / aggregator 抽屉——展会讲解需不需要能"点开某个 slot 看请求全文"？若要，Phase 6 接真数据时补

---

## Phase 6: Judge 模式 + Baseline 后端接入（略写）

### 目标
后端两件事：（1）`aggregation_mode: judge` 生效——所有 advisor 跑完后走一次 judge 调用（temperature=0），输出 5 类 JSON 结构化摘要塞进 aggregator；（2）`comparison.enabled` 生效——每次 MoM turn 结束后异步跑一次 baseline 单模型调用 + 一次 judge 对 MoM 输出 vs baseline 输出的多维打分，供 Live Compare 页展示。**Dashboard 端的 UI 已在 Phase 5 预览版里做好了**，本 phase 只填后端数据管道。

### 初步构想
- **Judge 结构化整合** `src/judge/judge-runtime.ts` `runJudge(results, settings): Promise<JudgeResult>`
  - 构造 messages：把成功的 advisor references 编号后拼进 user message，system=`JUDGE_INTEGRATION_PROMPT`（要求严格输出 JSON），`temperature=0`
  - Response 用 `safeJsonParse` 解析：`JSON.parse` 失败 → 用 `/\{[\s\S]*\}/` 正则抽取第一个 `{...}` 段再 parse → 仍失败 → 降级到 concat 模式（Phase 2 逻辑），标记 `judge_result.fallback = true`
  - 输出 5 类：`consensus` / `disagreements` / `partial_coverage` / `unique_insights` / `blind_spots`
- **Judge 打分（对比用）** `runJudgeCompare(mom_output, baseline_output, settings): Promise<JudgeScore>`
  - 与结构化整合是同一个 judge 模型，不同的 system prompt（`JUDGE_COMPARE_PROMPT`）
  - 输出严格 JSON：`{ correctness, depth, clarity, efficiency, safety }` 各 0-100，附 `verdict_summary` 字符串
  - 落 `trace.judge_score`，供 Live 页雷达图消费
- **成本归属**：
  - `total_cost_usd += judge_integration.cost_usd`（整合是 MoM 流程内部成本）
  - `judge_compare.cost_usd` 与 `baseline_cost_usd` 一起归入 `comparison_cost_usd`（**不算进 total_cost_usd**，仅供 Live 页展示）
  - `trace.judge_result` / `trace.judge_score` / `trace.baseline_result` 存全量供前端消费
- **Baseline 异步调用**：
  - `settings.comparison.enabled = true` 时，每次 MoM turn 结束**不阻塞主链路**，用 `queueMicrotask` + 独立 fetch 发一次 `baseline_model` 调用（同 messages、不含 references），失败静默
  - Baseline 完成 → 触发 judge compare → 全部落库
- **API 输出**：
  - `GET /api/comparison/:trace_id` 返回 `{ mom_result, baseline_result, judge_result, judge_score, cost_breakdown }` 一次性给 Live 页
  - `GET /api/traces/:id` 的 detail 保持不变，comparison 字段为 optional
- **JUDGE_INTEGRATION_PROMPT** — 借鉴 Fusion 文档的 5 类语义
- **JUDGE_COMPARE_PROMPT** — 明确 5 维定义（Correctness 覆盖事实 / Depth 论证深度 / Clarity 表达清晰 / Efficiency 简洁度 / Safety 拒答与安全）+ 举例锚点 + 强制 JSON 输出

### 待讨论的问题
- Judge 模型默认（Sonnet 4.6 vs Opus 4.8 vs Kimi K2）—— 展会建议用 Sonnet 4.6（快 + 便宜 + 判分稳定）
- Judge 失败降级 concat 时是否显式在 trace 里加 flag → 加，Dashboard Cost 页需要区分"降级 turn"占比
- Baseline call 是否 streaming：**否**（Live 页只需最终文本 + usage，不需要流；打字机是前端播放的视觉效果，不是真流）
- Judge compare 是否要求 CoT：**否**（要求 JSON-only、temperature=0，保证可解析）

---

## 改动点总结

### 讨论中否定的方案
1. **advisor 侧协议不做 OpenAI Chat Completions**：MVP 只支持 Anthropic Messages，advisor 与 aggregator 走同一协议（避免协议转换的实现复杂度）
2. **对比粒度不做 session 级分叉**：MoM 与 baseline 两个 session 独立跑 agent loop 会走成两棵不可比的树、成本翻倍；只做"同一 messages 输入的单次 aggregator call 对比"
3. **触发不做 manual 触发**：不加 `/mom on|off` 之类的手动指令；用户对 MoM 触发无感，由 `mom_mode` / `fanout_mode` 配置项决定
4. **触发不做 auto 模式**：MVP 只做 `always`；`auto` 模式（网关自动判断问题值不值得触发）留字段远期，因为间歇性触发会破坏缓存前缀连续性，实现代价高
5. **advisor 工具权限 MVP 不开**：`advisor.tools_enabled` 字段保留默认 false；远期开启也只考虑 web_search/web_fetch 类幂等工具
6. **不实现 Hermes 的一次性 `/moa <prompt>` 路径**：产品定位是网关，Claude Code 无感触发，不需要单次 shortcut
7. **成本计算不硬编码定价表**：定价通过 `MoMConfig.pricing_table`（存于 `data/mom.config.json`）配置，Dashboard 可编辑
8. **前端不用 CDN + inline Babel**：一律 Vite + React + TS 正规工程，`web/` 作为独立 workspace
9. **Streaming 不推到后期**：Phase 1 就实现 SSE passthrough；Phase 2 的 aggregator 一并支持 streaming（advisor 侧非流式）
10. **CLI / NPM 包 / Claude Code 插件形态属远期**：MVP 直接 `npm run dev` 启动
11. **多 provider 属远期**：MVP 单一 baseURL，靠 provider 侧多 model 名支撑
