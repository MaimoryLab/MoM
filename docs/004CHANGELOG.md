## [2026-07-10-3] feat(orchestrator): Phase 3 trigger + fanout cache + cost + trace + SDK decouple

### 改动
- 新增 `src/orchestrator/trigger.ts`：`isNewUserTurn(messages)` 严格判定最后一条 user 是否含任何 `tool_result` block；`computeTriggerReason(fanoutMode, isNewTurn, cacheHit)` 纯标签函数，输出 6 种 `TriggerReason` 枚举之一
- 新增 `src/cache/cache-key.ts`：`computeFanoutCacheKey(messages, momConfig)` 三段哈希 `settingsHash|slotsHash|sig`，slot 顺序保留（不 sort）；`selectSignatureMessages` 按 fanout_mode 决定取样范围（user_turn 截到最后真实 user；per_iteration 全量）；user_turn 首请求即 tool_result 时 fallback 到全量
- 新增 `src/cache/fanout-cache.ts`：Map-based TTL + LRU，零第三方依赖；懒过期检查；`cloneAsCacheHit` 复用时将 usage 归零 / cache_hit=true / latency=0 / reference 原文保留
- 新增 `src/cache/cache-decorator.ts`：`applyAdvisorCacheControl` system_and_3 布局；system 转 SystemBlock[]（第 1 个 marker）；跳过合成 `ADVISORY_INSTRUCTION` marker 后挑最后 3 条 message 的最后一个 block 打 `cache_control: {type:'ephemeral'}`
- 新增 `src/cost/pricing.ts`：`calculateCost(model, usage, table, log?)` 四段单价加总（input/output/cache_write/cache_read），单位 USD per million tokens；缺项 warn+返回 0；`sumUsage` 汇总 4 字段
- 新增 `src/storage/traces.ts`：`saveTrace` INSERT + 冗余常用列；`getTraceById` / `getRecentTraces`；行反序列化到 `Trace`
- 扩展 `src/gateway/sse.ts`：`createSSEParser()` 增量分帧器（按 `event:` / `data:` / 空行累积，收到空行 emit `RawSSEEvent`）
- 重写 `src/provider/stream-forward.ts`：签名从 `passthroughStream(req, reply, provider)` 改为 `passthroughStream(req, output: NodeJS.WritableStream, provider, {onEvent?, log?})`；手动 `data` 监听同时写 output + 喂 parser + 回调 onEvent；observer 异常吞掉不影响主转发；SSE header + hijack 上提到 `messages-handler`
- 重写 `src/orchestrator/orchestrator.ts`：`createOrchestrator(runtime): Orchestrator` 工厂，闭包持有 fanout cache；`nonStreaming(body, log): Response` 和 `streaming(body, output, log): void` 两入口，都接受最小 `Logger`（`{info, warn, error}`）；主链路"cache key → cache.get → miss 补跑 → cost → trace"；透传路径也写 trace（`mom_triggered=false / trigger_reason='mom_off'`）；`saveTrace` 抛错一律 `log.error` 后吞掉
- 扩展 `src/orchestrator/fanout.ts`：新增 `fanoutAdvisorsWithCache(messages, momConfig, provider, cache, key)`，`fanoutAdvisors` 原始函数保留供纯 fanout 场景使用
- 改写 `src/aggregator/aggregator-runtime.ts`：`runAggregatorStreaming` 签名从 `reply: FastifyReply` 改为 `output: NodeJS.WritableStream + {onEvent?, log?}`；返回 `{references_appended}` 供 trace 组装
- 改写 `src/gateway/messages-handler.ts`：使用 `createOrchestrator(runtime)`，拆分 non-streaming / streaming 两分支；streaming 分支上提 SSE header + hijack + 兜底 error 帧
- 改写 `src/advisor/advisor-runtime.ts`：请求前过 `applyAdvisorCacheControl`；system 字段从 string 换成 SystemBlock[]；respect `advisor.system_prompt` 覆盖
- 类型扩展 `src/types/mom.ts`：新增 `TriggerReason` 联合类型、`Logger` 最小接口
- ISS-007 顺手解决：3 处 Fastify 耦合（orchestrator.ts / aggregator-runtime.ts / stream-forward.ts）全部消除，业务层与 Fastify 完全解耦（Fastify 仅剩 messages-handler.ts + server.ts）
- 单元测试新增 39 例：`test/trigger.test.ts` / `test/cache-key.test.ts` / `test/fanout-cache.test.ts` / `test/cache-decorator.test.ts` / `test/pricing.test.ts`；全 56 例通过
- e2e 手动验证：mock provider + 6 条 curl 覆盖 `user_turn` / `skipped_tool_iteration` / `tool_iteration_cache_miss` / `mom_off` / streaming 五种 trace；SQLite 落盘 6 条，成本分账 μUSD 级精确；`settings_snapshot` 字段核对无 provider 秘钥泄漏

### 涉及文件
- src/orchestrator/trigger.ts：新增
- src/orchestrator/fanout.ts：扩展 fanoutAdvisorsWithCache
- src/orchestrator/orchestrator.ts：整体重写为 createOrchestrator 工厂 + 两入口 + trace 组装
- src/cache/cache-key.ts：新增
- src/cache/fanout-cache.ts：新增
- src/cache/cache-decorator.ts：新增
- src/cost/pricing.ts：新增
- src/storage/traces.ts：新增
- src/gateway/sse.ts：新增 createSSEParser
- src/gateway/messages-handler.ts：接 createOrchestrator + 拆 non-streaming/streaming
- src/provider/stream-forward.ts：签名改为 NodeJS.WritableStream + 可选 onEvent observer
- src/aggregator/aggregator-runtime.ts：runAggregatorStreaming 改为 NodeJS.WritableStream
- src/advisor/advisor-runtime.ts：接入 applyAdvisorCacheControl
- src/types/mom.ts：新增 TriggerReason / Logger
- test/{trigger,cache-key,fanout-cache,cache-decorator,pricing}.test.ts：新增

### 关联
-> ISS-005（Phase 3 收尾）
-> ISS-006（trigger/cache 解耦落地）
-> ISS-007（SDK 解耦顺手完成）
-> decisions/005-trigger-cache-decoupling.md

---

## [2026-07-10-2] docs(api): add 006API.md; assess MoM SDK decoupling

### 改动
- 新增 docs/006API.md：
  - §1 HTTP 端点：当前已实现（POST /v1/messages / GET /dashboard/* / GET /healthz）+ Phase 4-6 已规划（/api/traces / /api/metrics / /api/config / /api/comparison）+ 明确不会开放的路径（provider 秘钥编辑、auth 端点）
  - §2 内部 MoM SDK 入口函数：主调度 / advisor fanout / aggregator / provider client / 配置装配 / 存储层各层导出函数清单，逐个标注已解耦或耦合状态
  - §3 MoM 与网关消息处理解耦评估：`git grep FastifyReply|FastifyBaseLogger` 结果——业务层耦合集中在 3 处（orchestrator.ts:12 / aggregator-runtime.ts:49 / stream-forward.ts:8）；已解耦部分约 80%（所有类型、配置、advisor fanout、aggregator non-streaming、provider non-streaming、存储层）；完全解耦估算 ~50 行 diff / 4 个文件，不动业务逻辑
  - §4 类型契约清单
  - §5 变更规则
- docs/000README.md 文件职责表新增 006API.md 一行
- docs/003ISSUES.md 新增 ISS-007（状态 [暂缓] / P3）：记录 3 处耦合位置与解耦评估结果；暂缓原因（MVP 优先主链路 + 建议随 Phase 3 顺手做）
- docs/004CHANGELOG.md 追加本条

### 涉及文件
- docs/006API.md：新建
- docs/000README.md：文件职责表新增 006API.md 行
- docs/003ISSUES.md：新增 ISS-007
- docs/004CHANGELOG.md：新增本条

### 关联
-> ISS-007

---

## [2026-07-10-1] docs(plan): revise Phase 3 — decouple trigger from cache reuse

### 改动
- PLAN.md Phase 3 章节全面重写（原 320-399 行）：
  - "目标"段明确"触发判断与缓存复用解耦"，控制流永远"先查 cache、命中即复用、未命中就跑 fanout"，无"跳过 advisor"分支
  - `trigger_reason` 枚举定稿为六种：`mom_off` / `user_turn` / `skipped_tool_iteration` / `tool_iteration_cache_miss` / `per_iteration` / `fanout_cache_hit`
  - 组件改动：`shouldFanout` 删除，改为纯标签函数 `computeTriggerReason(fanoutMode, isNewTurn, cacheHit)`；cache key 用原顺序 `slotsHash`（不 sort）；`fanout-cache.ts` 明确 Map-based TTL + LRU（零第三方依赖）；`passthroughStream` 加可选 `onEvent` 参数（单一实现 + 观察者）；透传路径也写 trace
  - `src/cost/` 目录职责边界明确：只放"计价 / usage 纯函数"，metrics 聚合归 storage / dashboard-api
  - 新增"与 Phase 3 初稿的关键偏离"块（6 条），逐条列出偏离理由
  - "验证方式"清单从 8 条扩为 9 条，新增 miss 降级路径与 streaming trace 校验
  - 新增"单元测试"清单：trigger / cache-key / fanout-cache / cache-decorator / pricing
- 新增 docs/decisions/005-trigger-cache-decoupling.md：记录"cache miss 无条件补跑而非跳过"的决策链，否定"严格跳过"/"只 warn 不补跑"/"sortedSlots"/"复制两套 stream 实现"四个方案；已知代价 4 项 + 不在本期范围 2 项，全部带 Followup 标注
- 新增 docs/003ISSUES.md ISS-006（状态 [已解决]），关联 decisions/005 与本 CHANGELOG

### 涉及文件
- PLAN.md：Phase 3 章节重写（目标 / 前置条件 / 组件改动 / 偏离块 / 验证方式 / 单元测试）
- docs/decisions/005-trigger-cache-decoupling.md：新建
- docs/003ISSUES.md：新增 ISS-006
- docs/004CHANGELOG.md：新增本条

### 关联
-> ISS-006
-> decisions/005-trigger-cache-decoupling.md

---

## [2026-07-09-4] feat(orchestrator): implement Phase 2 advisor fanout + concat aggregator; narrow Trace snapshot to MoMConfig

### 改动
- 新增 `src/advisor/`（`prompts.ts` / `view-transformer.ts` / `advisor-runtime.ts`）：`convertToAdvisorView` 展平 tool_use、截断 tool_result、丢弃 image、末尾 assistant 追加 `ADVISORY_INSTRUCTION` 合成 user marker；`runAdvisor` 单 slot 调用非流式 provider，失败以占位符返回不抛
- 新增 `src/orchestrator/fanout.ts`：自写 `promisePool<T,R>(items, limit, worker)`（不引入 p-limit 依赖），`fanoutAdvisors` 并发上限 8、保 slots 顺序
- 新增 `src/aggregator/reference-builder.ts`：`buildConcatReferences` 拼接标号 references 并按 `reference_max_tokens * 4` 字符截断；`appendReferencesToLastUser` 只克隆最后一条 message、前缀所有 message 保持原对象引用不变（Aggregator 字节级透传原则）；末条为 assistant 时合成尾部 user
- 新增 `src/aggregator/aggregator-runtime.ts`：`runAggregatorNonStreaming` 返回 `AggregatorResult`；`runAggregatorStreaming` Phase 2 直接复用 Phase 1 `passthroughStream` 直 pipe（不 tee/SSEParser/onComplete，Phase 3 引入 trace 落盘时再加）
- 新增 `src/orchestrator/orchestrator.ts`：`orchestrate(body, reply, runtime, log)` 主链路——`mom_mode !== 'always'` 走透传（复用 Phase 1 行为）；`mom_mode === 'always'` 走 fanout → concat → aggregator；Phase 2 只 log 事件，不组装 Trace
- `src/config.ts`：新增 `assertModeRequirements`——`mom_mode==='always'` 时 `advisor.slots` 非空、`aggregator.model` 非空，否则 `ConfigError` 退出
- `src/gateway/messages-handler.ts`：`createMessagesHandler(provider)` → `createMessagesHandler(runtime: RuntimeConfig)`，把透传替换为 `orchestrate(body, reply, runtime, req.log)`；错误映射逻辑保持原样
- `src/gateway/server.ts`：`startServer(port, provider)` → `startServer(port, runtime: RuntimeConfig)`；provider 层的 `passthroughCall`/`passthroughStream` 签名不动，分层约束不破
- `src/index.ts`：`startServer(PORT, runtime.provider)` → `startServer(PORT, runtime)`
- `src/types/mom.ts`：`Trace.settings_snapshot: RuntimeConfig` → `MoMConfig`——避免 Phase 3 落盘时把 `provider.api_key` 写进 SQLite（ISS-004 修复）
- 新增 `test/view-transformer.test.ts` / `test/reference-builder.test.ts`：Node 22 内置 `node:test` 覆盖三处纯逻辑，重点验证「append 只改最后一条 message、前缀 message 引用不变」不变量
- `package.json` 新增 `test` script（`node --test --import tsx test/*.test.ts`）
- PLAN.md Phase 2 新增"与本节初稿的偏离"块，逐条列出实际实现相对初稿的偏离
- docs/001ARCHITECTURE.md 新增 Orchestrator 分层、链路 D/E（MoM 主链路 non-streaming/streaming）、`assertModeRequirements` / Aggregator 字节级透传 / Advisor 失败容忍 / Trace 快照范围 四条约定
- docs/002STRUCTURE.md 目录树新增 `src/orchestrator/` / `src/advisor/` / `src/aggregator/` / `test/`

### 涉及文件
- `src/types/mom.ts`：`Trace.settings_snapshot` 类型缩窄
- `src/config.ts`：新增 `assertModeRequirements`
- `src/gateway/messages-handler.ts`：签名升 RuntimeConfig，委托 orchestrate
- `src/gateway/server.ts`：签名升 RuntimeConfig
- `src/index.ts`：调 `startServer(PORT, runtime)`
- `src/advisor/prompts.ts`：新建
- `src/advisor/view-transformer.ts`：新建
- `src/advisor/advisor-runtime.ts`：新建
- `src/orchestrator/orchestrator.ts`：新建
- `src/orchestrator/fanout.ts`：新建
- `src/aggregator/reference-builder.ts`：新建
- `src/aggregator/aggregator-runtime.ts`：新建
- `test/view-transformer.test.ts`：新建
- `test/reference-builder.test.ts`：新建
- `package.json`：新增 `test` script
- `PLAN.md`：Phase 2 组件改动 + 偏离块
- `docs/001ARCHITECTURE.md`：分层图 + 链路 + 关键约定
- `docs/002STRUCTURE.md`：目录树 + 新增 `test/`；未创建目录清单删除 orchestrator/advisor/aggregator
- `docs/003ISSUES.md`：新增 ISS-004（已解决）+ ISS-005（已解决）
- `docs/decisions/004-trace-snapshot-scope.md`：新建

### 关联
-> ISS-004
-> ISS-005
-> decisions/004-trace-snapshot-scope.md

---

## [2026-07-09-3] docs(workflow): AI runs self-check then opens draft PR [ISS-003]

### 改动
- 删除 `docs/000README.md` 中"不得在实现或核查过程中自行运行任何测试命令 / 不得自行执行任何 git 操作"两条禁令
- `### 禁止行为` 重写为 Claude Code 环境硬红线：禁 push main、禁 --force、禁合并 PR、禁改 git config、禁 --no-verify、禁破坏他人分支、禁吞掉自检失败信号
- 新增 `## 自检自测约定` 节：强制项 `npm run typecheck` + `npm run build` + `npm run build:web`，退出码必须为 0；增量项要求本次改动新引入的验证脚本 Claude 自跑并粘贴关键输出；明确不打真实 provider 接口
- `## 交付清单约定` 重写为 `## 交付流程约定`：commit → push feature 分支 → `gh pr create --draft` → 输出结构化交付回执（feature 分支名 / PR URL / 用户合并后需执行 `git checkout main && git pull --ff-only`）
- 新增 "commit / PR title ≤ 72 字符" 硬约束，避免 Claude Code 自动截断成 `...` 破坏合并 commit
- 工作流生命周期图末段更新：从"输出交付清单等人工"改为"自检自测 → 交付流程输出 PR URL → 人工 review + merge + 本地 pull"
- 二次核查节的"稳定后写 CHANGELOG"衔接语调整，插入自检自测环节
- 删除 `README-PLAN.md` 在顶部提示块和文件职责表中的引用（该文件实际不存在）

### 涉及文件
- docs/000README.md：改写工作流生命周期末段、禁止行为、新增自检自测节、交付清单节重写为交付流程节、删除 README-PLAN.md 引用
- docs/003ISSUES.md：追加 ISS-003 条目，状态直接 [已解决]

### 关联
-> ISS-003

---

## [2026-07-09-2] refactor(config): split settings into env (provider secrets) + mom.config.json (business) + SQLite (runtime data)

### 改动
- 拆 `MoMSettings` 为 `ProviderConfig`（L1，只从 env 加载）+ `MoMConfig`（L2，业务配置）+ `RuntimeConfig = { provider, mom }`
- 新增 `src/config/provider-env.ts`：`loadProviderConfig()` 从 `process.env` 读 `PROVIDER_BASE_URL` / `PROVIDER_API_KEY` / `PROVIDER_AUTH_STYLE`，缺失或非法值抛 `ProviderConfigError`
- 新增 `src/config/mom-config-file.ts`：`loadMoMConfig(path)` / `saveMoMConfig(path, config)`，ENOENT 时写入 `DEFAULT_MOM_CONFIG`；写入走 tmp + `renameSync` 原子替换
- `src/config.ts` 改为组合装配：`getConfig(momConfigPath)` 返回 `RuntimeConfig`，跑 `assertRecursionGuard(mom)`
- `src/index.ts` 读三个 env 路径（`MOM_DB_PATH` / `MOM_CONFIG_PATH` / `MOM_PORT`），启动期把 `ConfigError` / `ProviderConfigError` / `MoMConfigFileError` 统一转为 exit 1
- `src/provider/provider-client.ts` / `src/provider/stream-forward.ts` 的签名从 `settings: MoMSettings` 改为 `provider: ProviderConfig`——provider 层不再感知业务配置
- `src/gateway/messages-handler.ts` 改为工厂 `createMessagesHandler(provider)`；`src/gateway/server.ts` 由 `startServer(port, provider)` 装配；`server.ts` 中 `fileURLToPath(import.meta.url)` 顺手改为 `process.cwd()`，修掉 Phase 1 骨架的 `TS1470` 既存错
- 删除 `src/storage/settings.ts` 与 SQLite `settings` 表（`src/storage/db.ts` 的 `SCHEMA` 常量只保留 `traces` / `metrics_cache`）
- `MoMConfig.pricing_table` 从原 `MoMSettings.provider.pricing_table` 迁出，与 provider 名空间解耦
- `.env.example` 新增；`.gitignore` 增加 `data/`
- `package.json` 的 `dev` / `start` 加 `--env-file=.env`（Node 22 原生，无 dotenv 依赖）
- PLAN.md / README.md / README.en.md / docs/001ARCHITECTURE.md / docs/002STRUCTURE.md / docs/005DEVELOPMENT.md 全面同步：技术栈、目录结构、Phase 1 组件与验证、Phase 2 provider-client 签名、Phase 3 pricing 路径、Phase 5 SettingsPage 明确不编辑秘钥

### 涉及文件
- `src/types/mom.ts`：拆类型 + 迁 `pricing_table`
- `src/config.ts`：改为组合装配
- `src/config/provider-env.ts`：新建
- `src/config/mom-config-file.ts`：新建
- `src/index.ts`：新增两个 env 路径、扩展启动异常捕获
- `src/gateway/server.ts`：`startServer(port, provider)`；`import.meta.url` → `process.cwd()`
- `src/gateway/messages-handler.ts`：`createMessagesHandler(provider)` 工厂
- `src/provider/provider-client.ts`：签名 `ProviderConfig`
- `src/provider/stream-forward.ts`：签名 `ProviderConfig`
- `src/storage/db.ts`：SCHEMA 删 settings 表
- `src/storage/settings.ts`：删除
- `.env.example`：新建
- `.gitignore`：新增 `data/`
- `package.json`：scripts 加 `--env-file=.env`
- `PLAN.md`：技术栈 / 关键约定 / 目录结构 / Phase 1-3-5 全面同步
- `README.md` / `README.en.md`：配置流程重写
- `docs/001ARCHITECTURE.md`：拓扑图 / 分层 / 状态分类 / 关键约定重写
- `docs/002STRUCTURE.md`：目录树 + storage 只保留 db.ts、新增 config/
- `docs/003ISSUES.md`：ISS-002 状态改为 [已解决]
- `docs/005DEVELOPMENT.md`：追加 [2026-07-09-2] 记录，含验证命令与配置读者对照表
- `docs/decisions/002-config-layering.md`：新建

### 关联
-> ISS-002
-> decisions/002-config-layering.md

---

## [2026-07-09-1] refactor(storage): switch from better-sqlite3 to Node built-in node:sqlite

### 改动
- 将 storage 层驱动从 `better-sqlite3` 切换到 Node 内置 `node:sqlite`（`DatabaseSync`），去除 native 编译依赖
- 将 DDL 从独立 `schema.sql` 文件内联为 `db.ts` 内的 `SCHEMA` 常量，去除运行时 `readFileSync` + `import.meta.url` 依赖以及 build 期拷贝步骤
- `settings.ts` 因 `StatementSync` 无泛型，`.get()` 结果改为 `as SettingsRow | undefined` cast
- `package.json` 移除 `better-sqlite3` 与 `@types/better-sqlite3`；`@types/node` 顶到 ^22；`engines.node` 从 `>=20` 提升到 `>=22.13.0`；`build` 脚本删除 schema.sql 拷贝步骤
- PLAN.md / README.md / README.en.md / docs/001ARCHITECTURE.md / docs/002STRUCTURE.md / docs/005DEVELOPMENT.md 同步技术栈描述，验证命令改用 `node -e` + `node:sqlite` 免装 CLI

### 涉及文件
- `package.json`：删依赖、提升 engines、简化 build 脚本
- `src/storage/db.ts`：换 `DatabaseSync`、内联 SCHEMA
- `src/storage/settings.ts`：移除 `prepare` 泛型、显式 cast
- `src/storage/schema.sql`：删除（DDL 已内联）
- `PLAN.md`：技术栈行 / Phase 1 目标 / Phase 1 存储改动 / Phase 3 存储改动 / 目录结构 / 验证命令
- `README.md` / `README.en.md`：环境要求 / 配置命令
- `docs/001ARCHITECTURE.md`：分层图 storage 一行
- `docs/002STRUCTURE.md`：storage 子树 + 删 schema.sql
- `docs/005DEVELOPMENT.md`：追加 2026-07-09 记录，说明环境要求变化与免 CLI 命令
- `docs/003ISSUES.md`：ISS-001 状态改为 [已解决]，关联本条 CHANGELOG
- `docs/decisions/001-storage-node-sqlite.md`：新建 — 记录方案 B/C/D/E 的否定原因与已知代价

### 关联
-> ISS-001
-> decisions/001-storage-node-sqlite.md

---

## [2026-07-08-1] feat(gateway): bootstrap Phase 1 skeleton with Anthropic Messages passthrough

### 改动
- 建立 npm workspaces 根工程与 `web/` 前端子工程
- 新增后端 TS 类型层，覆盖 Anthropic Messages API 请求/响应/SSE 事件与 MoM 内部类型
- 实现 SQLite 初始化、`settings` 单行 upsert、`traces` 与 `metrics_cache` 建表
- 实现 `POST /v1/messages` 请求校验 + 非流式透传（undici）+ 流式 SSE 转发（`res.body.pipe(reply.raw)`）
- 实现 `bearer` 与 `x-api-key` 两种 provider 认证头构造
- 实现启动期递归护栏：`aggregator.model` 出现在 `advisor.slots` 时以 `ConfigError` 退出
- Fastify 静态挂载 `web/dist` 到 `/dashboard/*`；未构建时返回占位 HTML
- 前端 Vite + React 骨架，`App.tsx` 显示 "Hello MoM"、`base: '/dashboard/'`、dev proxy `/api` 与 `/v1` 到 `:3000`

### 涉及文件
- `package.json`：新建 — 根 workspace 声明、后端依赖、build/dev/typecheck 脚本
- `tsconfig.json`：新建 — 后端 TS 配置
- `.gitignore`：新建 — 忽略 node_modules / dist / *.db / .DS_Store
- `src/index.ts`：新建 — 进程入口
- `src/config.ts`：新建 — `getConfig()` 包装 `loadSettings()` + 递归护栏
- `src/gateway/server.ts`：新建 — Fastify 实例与路由 / 静态挂载
- `src/gateway/messages-handler.ts`：新建 — Phase 1 只做透传的入口
- `src/gateway/validator.ts`：新建 — 请求体最小字段校验
- `src/gateway/sse.ts`：新建 — SSE 编解码工具
- `src/provider/provider-client.ts`：新建 — 非流式 undici POST + `ProviderError`
- `src/provider/stream-forward.ts`：新建 — 流式 SSE 转发 + 错误 SSE 帧
- `src/storage/db.ts`：新建 — better-sqlite3 单例
- `src/storage/schema.sql`：新建 — settings / traces / metrics_cache
- `src/storage/settings.ts`：新建 — settings 表读写
- `src/types/anthropic.ts`：新建 — 完整 Anthropic Messages 类型
- `src/types/mom.ts`：新建 — MoMSettings / Trace / DEFAULT_SETTINGS 等
- `src/types/index.ts`：新建 — barrel export
- `web/package.json` / `web/tsconfig.json` / `web/vite.config.ts` / `web/index.html`：新建 — 前端子工程配置
- `web/src/main.tsx` / `web/src/App.tsx`：新建 — 前端骨架

### 关联
-> PLAN.md Phase 1

---

<!--
type：feat / fix / refactor / chore / docs
标题：英文，动词开头，不超过一行
时间倒序：新条目插入文件顶部
同一天多条：序号递增（-1, -2, -3）
关联字段必填，无 decisions 文件时只写 ISS 编号；早期骨架期尚无 issue，可关联 PLAN.md 阶段
-->
