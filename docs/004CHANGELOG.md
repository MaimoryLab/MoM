## [2026-07-14-4] feat(live): Phase 6 Live Compare full stack — /api/live/run SSE + judge compare + comparisons table [ISS-033]

### 改动
- **新增 `src/judge/` 目录 3 个文件**
  - `judge-prompt.ts` — `JUDGE_COMPARE_PROMPT_EN` / `JUDGE_COMPARE_PROMPT_ZH`（匿名 A/B、JSON-only、5 维定义 correctness/completeness/depth/clarity/usefulness）+ `buildJudgeCompareUserMessage`
  - `judge-parse.ts` — `parseJudgeCompare(raw)` 二阶段：`JSON.parse` 剥 code fence → 失败退到正则抽首个 `{...}` 块；`fallback` 标记后一路径命中；分数 clamp 到 `[0,100]`
  - `judge-runtime.ts` — `runJudgeCompare` 随机匿名 A/B 后 dispatch + demap；始终不抛，`error` 归入结果；`rand?` 参数便于测试
- **新增 `src/live/` 目录 5 个文件**
  - `live-types.ts` — `ComparisonRecord` / `ComparisonMomRow` / `ComparisonBaselineRow` / `ComparisonJudgeRow` / `ComparisonStatus`
  - `live-events.ts` — `writeLiveEvent` / `encodeLiveEvent`（SSE 8 事件编码，兼容已 `end` 的 output）
  - `live-store.ts` — `createComparison` / `updateComparisonMom` / `updateComparisonBaseline(+Error)` / `updateComparisonJudge(+Error)` / `getComparisonById` 走 node:sqlite prepared statements
  - `baseline.ts` — `runBaselineCall` 单模型 non-streaming，永不抛
  - `live-runtime.ts` — `runLiveTurn` 编排：并发 orchestrator streaming（`DevNullWritable` sink + `createSSEParser` 观察者收集 momText）+ baseline call → Promise.all → 串行 judge compare；每阶段 emit SSE + upsert comparisons + 落 `role='baseline'/'judge'` TraceRequest
- **新增 `src/gateway/live-api.ts`**：`registerLiveAPI(app, {holder})` 挂 `POST /api/live/run`（body 校验 → reply.hijack + text/event-stream → `runLiveTurn`）+ `GET /api/comparison/:gateway_request_id`（`getComparisonById` → `ComparisonResponse` / 404）
- **改造 `src/gateway/server.ts`**：挂载 `registerLiveAPI(app, {holder})` 取代 `registerComparisonAPI(app)`
- **删除 `src/dashboard-api/comparison-api.ts`**：501 占位彻底移除（其职责由 live-api.ts 承担）
- **改造 `src/orchestrator/orchestrator-holder.ts`**：`OrchestratorHolder` 加 `getRuntime()` 方法，供 live-api 拿最新 runtime 引用
- **改造 `src/storage/db.ts`**：SCHEMA 追加 `comparisons` 表（PK=gateway_request_id + mom/baseline/judge 三段字段 + 2 个索引）
- **改造 `src/types/mom.ts`**：`TraceRequest.role` union 追加 `'baseline' | 'judge'`；`TraceErrorType` 追加 `baseline_error | judge_error`；新增 `JudgeScores` / `JudgeCompareResult`；`BaselineResult` 扩展 `text / started_at / finished_at / error`
- **改造 `src/types/dashboard-api.ts`**：追加 `LiveRunRequest` / `LiveRunEvent`（8-事件 union） / `ComparisonResponse` / `ComparisonStatus` / `JudgeScoresApi` / `ComparisonMomSnapshot` / `ComparisonBaselineSnapshot` / `ComparisonJudgeSnapshot` / `ComparisonUsage`

- **改造 `web/src/lib/api.ts`**：追加 Phase 6 类型镜像 + `postLiveRun(body, signal): AsyncGenerator<LiveRunEvent>` SSE 客户端（fetch + `ReadableStream` + 帧解析）+ `getComparison(gwId)` wrapper
- **新增 `web/src/hooks/useLiveRun.ts`**：驱动一次 turn 的状态机；async iterable + AbortController；返回 `{status, momText, mom, baseline, judge, run, cancel, reset,...}`
- **改造 `web/src/pages/LivePage.tsx`**：预置按钮 click 立即 Run（不填入 textarea）+ 独立多行 textarea + Baseline checkbox + Run/Cancel 主 CTA；MoM 栏真 SSE 增量渲染 + 光标；Baseline 栏到达后 `useTypewriter` 视觉打字机；Judge 雷达 + verdict + fallback 标注；Ranking chart 顶挂 "Phase 7 Preview" 徽章
- **改造 `web/src/mock/live-samples.ts`**：精简到只留 5 preset 中英 prompt 文本（`PRESET_ORDER` / `getPresetPrompt` / `PresetKey` / `JudgeScores` 类型保留），mock 回复 / advisor previews / judge 分全部退休
- **改造 `web/src/i18n/dict.ts`**：`live.*` 追加 6 个 key（`cancel` / `pendingBaseline` / `pendingJudge` / `judgeFallbackNote` / `errorTitle` / `rankingPreviewBadge`）中英各一

- **新增 `test/judge-parse.test.ts`**：9 case 覆盖 strict / code fence / regex fallback / clamp / round / missing dim / missing side / no JSON / truncated
- **新建 `PLAN7.md`**：Phase 6 未做项汇总（PLAN7-01 aggregation_mode=judge、PLAN7-02 Ranking 真数据、PLAN7-03 分享链接 SSE 旁听、PLAN7-04/05/06 Cost/Settings/Pipeline 真接入、PLAN7-07/08/09 判分深化）

### 涉及文件
- 后端新增：`src/judge/{judge-prompt,judge-parse,judge-runtime}.ts` / `src/live/{live-types,live-events,live-store,baseline,live-runtime}.ts` / `src/gateway/live-api.ts`
- 后端修改：`src/gateway/server.ts` / `src/orchestrator/orchestrator-holder.ts` / `src/storage/db.ts` / `src/types/mom.ts` / `src/types/dashboard-api.ts`
- 后端删除：`src/dashboard-api/comparison-api.ts`
- 前端修改：`web/src/lib/api.ts` / `web/src/pages/LivePage.tsx` / `web/src/mock/live-samples.ts` / `web/src/i18n/dict.ts`
- 前端新增：`web/src/hooks/useLiveRun.ts`
- 测试新增：`test/judge-parse.test.ts`
- 文档：`docs/decisions/009-phase6-live-fullstack.md` 新增；`docs/003ISSUES.md` ISS-033 [进行中] → [已解决]；`docs/001ARCHITECTURE.md` §2/§4/§5(链路 I)/§6/§7 补 Phase 6 状态；`docs/002STRUCTURE.md` 追加 `src/judge/*` `src/live/*` `web/src/hooks/useLiveRun.ts`，更新 db/types 说明；`docs/006API.md` §1.1 补 Live 两条端点 + §1.5 转"无待做" + §1.7 详细契约（POST /api/live/run SSE + GET /api/comparison/:gwId）+ §2.9 Judge SDK + §2.10 Live Runtime SDK + §4 类型清单；`PLAN.md` Phase 6 状态改 🚧 部分完成；`PLAN7.md` 新增

### 自检
- `npm run typecheck`：通过（0 error）
- `npm run build`：通过
- `npm --prefix web run build`：通过（vite `dist/index-*.js` gzip 184.85 kB）
- `npm run test`：193 tests / 186 pass / 7 fail —— 7 个 fail 全为 pre-existing（`orchestrator-cost.test.ts` / `orchestrator-cost-edge.test.ts` 期望 `TraceRequest.cost_usd` 字段但该字段从未在类型上存在，已确认主分支同样失败；本轮新增的 9 case judge-parse 测试全通过）
- 手工验证：Live 页需要真 provider 才能端到端跑；未在本机跑真 provider（未配置 `.env`），reviewer 需以真配置手测（详见 PR body Manual Follow-up）

### 关联
-> ISS-033
-> decisions/009-phase6-live-fullstack.md
-> PLAN7.md

---

## [2026-07-14-3] feat(dashboard-api): implement Phase 4 REST API + orchestrator hot reload [ISS-032]

### 改动
- **新增 `src/dashboard-api/` 目录 5 个文件**
  - `config-api.ts` — `GET /api/config` 返回 `ConfigResponse`（provider 走 `maskApiKey` = 前3+****+后2 固定形状）；`POST /api/config` 走 `assertMoMConfigShape`（手写字段级 typeguard，无 zod）→ `assertModeRequirements` → `saveMoMConfig` → 就地替换 `runtime.mom` + 重算 `mom_config_source` → `holder.rebuild()`；忽略请求体中的 provider 字段
  - `traces-api.ts` — `GET /api/traces?limit&offset&role&status&gateway_request_id` 走 SQL 分页 + 过滤，返 `TraceSummary[]`（剥离 `settings_snapshot` / `request_summary` / `response_summary`）；`GET /api/traces/:request_id` 返全量 / 404；`GET /api/traces/by-gateway/:gateway_request_id` 空数组不 404，按 `started_at` ASC
  - `metrics-api.ts` — `GET /api/metrics?window=&limit=` 一次返 5 段（summary / per_turn / by_role / cache_hit_by_model / timeline）；`computeMetrics` 为纯函数（只读 SELECT）便于单测；cost null 语义：一条 non-zero usage trace 缺 pricing → 该聚合层 `cost_usd` = null；`window` 支持 `last_24h` / `last_7d` / `all`
  - `benchmarks-api.ts` — `GET /api/benchmarks` 从 `data/benchmarks.json` 读；ENOENT 返 200 + 空态；`normalizeBenchmarks` 每字段 typed 校验，非法 JSON / shape 失败返 500 `internal_error`
  - `comparison-api.ts` — `GET /api/comparison/:trace_id` 返 501 `not_implemented`（Phase 6 占位）
- **新增 `src/orchestrator/orchestrator-holder.ts`**：`createOrchestratorHolder(runtime): { get, rebuild }` — mutable holder 支撑 `POST /api/config` 后 orchestrator 热重建，旧 fanout cache 释放
- **新增 `src/types/dashboard-api.ts`**：前后端共享响应类型（20+ 接口，参考 `docs/006API.md §4`）
- **改造 `src/gateway/server.ts`**：`createServer(runtime, { momConfigPath, benchmarksPath })` 挂载全部 6 组新路由 + 传 `holder` 给 config-api + messages-handler；`startServer` 同步扩签名
- **改造 `src/gateway/messages-handler.ts`**：`createMessagesHandler(holder)`，每次 handle 从 `holder.get()` 拿最新 orchestrator（POST /api/config 立即生效）；构造签名从 `runtime` 变为 `holder`
- **改造 `src/index.ts`**：读 `MOM_BENCHMARKS_PATH` env（默认 `data/benchmarks.json`），传给 `startServer`
- **新增 `data/benchmarks.json`**：Overview 页静态数据；`.gitignore` 加白名单 `!data/benchmarks.json`（`data/` 其他文件仍忽略）
- **新增 `web/src/lib/api.ts`**：Dashboard API 类型镜像 + typed fetch wrappers（`getConfig` / `saveConfig` / `listTraces` / `getTrace` / `getTracesByGateway` / `getMetrics` / `getBenchmarks`）；**Page 引用不切**（`mock/*` 仍是当前 Page 的唯一数据源，Phase 5.1 才切）
- **新增 5 组单元测试 42 case 全通过**
  - `test/dashboard-api-config.test.ts` — maskApiKey 3 case / assertMoMConfigShape 4 case / GET-POST /api/config 8 case（含 rebuild 副作用可观测断言）
  - `test/dashboard-api-traces.test.ts` — 10 case 覆盖分页/过滤/排序/404/空 by-gateway
  - `test/dashboard-api-metrics.test.ts` — 7 case 覆盖 empty/mixed/window/cost null 语义 + HTTP 400/200
  - `test/dashboard-api-benchmarks.test.ts` — 10 case 覆盖 normalize/loadFromDisk ENOENT/malformed + HTTP 200/500

### 涉及文件
- `src/dashboard-api/config-api.ts`：新增
- `src/dashboard-api/traces-api.ts`：新增
- `src/dashboard-api/metrics-api.ts`：新增
- `src/dashboard-api/benchmarks-api.ts`：新增
- `src/dashboard-api/comparison-api.ts`：新增
- `src/orchestrator/orchestrator-holder.ts`：新增
- `src/types/dashboard-api.ts`：新增
- `src/gateway/server.ts`：挂载全部 /api/* 路由 + 构造 holder
- `src/gateway/messages-handler.ts`：签名接 holder，每次 handle 读最新 orchestrator
- `src/index.ts`：`MOM_BENCHMARKS_PATH` env + 传路径给 startServer
- `data/benchmarks.json`：新增静态数据（gitignore 白名单）
- `.gitignore`：`!data/benchmarks.json`
- `web/src/lib/api.ts`：新增类型镜像 + fetch wrappers
- `test/dashboard-api-config.test.ts`：新增
- `test/dashboard-api-traces.test.ts`：新增
- `test/dashboard-api-metrics.test.ts`：新增
- `test/dashboard-api-benchmarks.test.ts`：新增
- `docs/decisions/008-phase4-dashboard-api-shape.md`：新增（10 决策拍板 + 否定方案 A-K + 5 项已知代价 + 6 项不在本期范围）
- `docs/003ISSUES.md`：新增 ISS-032 [讨论中] → [已解决]
- `PLAN.md`：Phase 4 章节从 📝 略写升级为 📋 已规划的完整设计（含目标 / 偏离 / 前置 / 组件改动 / API 契约 / 验证方式 / 单测清单）
- `docs/001ARCHITECTURE.md`：§2 分层图补 `src/dashboard-api/*` + `OrchestratorHolder`；§5 追加链路 G（Dashboard config hot reload）与链路 H（Dashboard 观察 API）；§6 追加 5 条 Phase 4 关键约定；§7 更新前端 mock/lib 状态
- `docs/002STRUCTURE.md`：追加 `data/benchmarks.json` / `src/dashboard-api/*` / `src/orchestrator/orchestrator-holder.ts` / `src/types/dashboard-api.ts` / `web/src/lib/api.ts` / `test/dashboard-api-*.test.ts`；更新 gateway/server + messages-handler + orchestrator 行内说明；从"未创建目录"清单删除 `src/dashboard-api/`
- `docs/006API.md`：§1.1 追加 7 行 Phase 4 端点；§1.5 已规划表只留 Phase 6 comparison；§1.6 新增详细契约（覆盖每个端点的 200/400/404/500/501 响应形状与语义）；§2.8 新增 dashboard-api SDK 入口清单；§4 类型契约段追加 `src/types/dashboard-api.ts` 类型清单

### 关联
-> ISS-032
-> decisions/008-phase4-dashboard-api-shape.md
-> future-plans/001-dashboard-api-shape-reconciliation.md

---

## [2026-07-14-2] refactor(prompts): swap advisor + aggregator prompts to MoA-classic short form [ISS-031]

### 改动
- **`src/advisor/prompts.ts:ADVISOR_SYSTEM_PROMPT` / `ADVISORY_INSTRUCTION` 换成同一句短判断语**
  - 新文本："The conversation above is the current state of the task. Give your most intelligent judgement: what is going on, what should happen next, what risks or mistakes you see, and how the acting agent should proceed."
  - 引入文件级 `const ADVISOR_JUDGEMENT_PROMPT`，两个导出符号都指向它——单源可维护，`ADVISOR_SYSTEM_PROMPT === ADVISORY_INSTRUCTION` 是设计意图（system 位与合成 marker 位说同一句话，语义与 cache-decorator 精确匹配保持一致）
  - 两个符号名不变 → `cache-decorator` 通过 `import { ADVISORY_INSTRUCTION }` 自动跟随，无需硬编码修改
- **`src/advisor/prompts.ts:AGGREGATOR_GUIDANCE` 换成 MoA 经典 synth 语**
  - 新文本："You have been provided with a set of responses from various models to the latest user query. Your task is to synthesize these responses into a single, high-quality response. It is crucial to critically evaluate the information provided in these responses, recognizing that some of it may be biased or incorrect. Your response should not simply replicate the given answers but should offer a refined, accurate, and comprehensive reply to the instruction. Ensure your response is well-structured, coherent, and adheres to the highest standards of accuracy and reliability."
  - `AGGREGATOR_REFERENCES_HEADER` 不变——保留 "Advisor Panel References (for the aggregator only, not user-visible):" 作为 references 起点，仍带"不面向用户"的语义提示
  - 注入路径 `src/aggregator/reference-builder.ts:composeAggregatorPayload` 与 `appendReferencesToLastUser` 不改，仍是最后一条 user 尾部注入 `GUIDANCE + '\n\n' + HEADER + '\n' + references`
- **测试同步（5 处特征匹配从旧 opener 换成新 opener）**
  - `test/reference-builder.test.ts` 4 处 `You are the aggregator in a Mixture-of-Models process.` → `You have been provided with a set of responses from various models`
  - `test/orchestrator-cost.test.ts` 1 处 `You are the aggregator in a Mixture-of-Models process.` → `You have been provided with a set of responses from various models`
  - `test/cache-decorator.test.ts` / `test/view-transformer.test.ts` 通过 `import { ADVISORY_INSTRUCTION }` 自动跟随新文本，无需改动
- **不变量**
  - `ADVISOR_SYSTEM_PROMPT` / `ADVISORY_INSTRUCTION` 导出符号名保持不变 → cache-decorator 合成 marker 精确匹配依然生效
  - `AGGREGATOR_REFERENCES_HEADER` 常量与其文本均不变 → 现有测试断言与人工排查线索不受影响
  - Aggregator 请求的 `system` 字段仍字节级透传 Claude Code 原 system → Anthropic prompt caching 前缀命中不受影响
  - `AggregatorSettings` schema 不动（本次仍不引入 `system_prompt` 可配置字段）

### 涉及文件
- `src/advisor/prompts.ts`：`ADVISOR_SYSTEM_PROMPT` / `ADVISORY_INSTRUCTION` 复用同一常量并改为短判断语；`AGGREGATOR_GUIDANCE` 改为 MoA 经典 synth 语；文件顶部旧的长注释一并精简
- `test/reference-builder.test.ts`：4 处正则从旧 aggregator opener 换成新 opener
- `test/orchestrator-cost.test.ts`：1 处正则从旧 aggregator opener 换成新 opener
- `docs/004CHANGELOG.md`：新增本条 [2026-07-14-2]

### 自检
- `npm run typecheck`：0（通过）
- `npm run build`：0（通过）
- `npm run build:web`：0（通过）
- `npm test`：tests 142 / pass 135 / fail 7 —— 与 [2026-07-14-1] 及 main 分支同 suite 完全一致（同 7 条 ISS-010 遗留 `cost_usd` 失败，与本次改动无关）
- `npx tsx --test test/reference-builder.test.ts test/cache-decorator.test.ts test/view-transformer.test.ts`：22/22 全通过（覆盖本次改动的 4 个 reference-builder 断言 + advisor 视图合成 marker 相关断言）

### 关联
-> ISS-031

---

## [2026-07-14-1] refactor(prompts): rewrite advisor prompt from first principles + inject aggregator guidance [ISS-031]

### 改动
- **`src/advisor/prompts.ts` 从第一性原理重写**（4 行短句 → 结构化 6 句英文 system prompt）
  - `ADVISOR_SYSTEM_PROMPT` 明确 advisor 处境：Claude Code agent-loop 里的 mid-task 会话（含 `[called tool: ...]` / `[tool result: ...]` 渲染），advisor 不能调工具，输出不是给用户看的，是喂给 aggregator 的多路参考之一 → 要求 informed judgement + 下一步（含具体 tool call 参数） + 风险 + 事实
  - `ADVISORY_INSTRUCTION` 从 "please provide analysis" 改成同风格的"给出对当前状态的最强判断 + 下一步 + 风险"
  - 两个符号名保持不变，`cache-decorator` 与 4 处测试通过 import 引用自动跟随
- **新增 `AGGREGATOR_GUIDANCE` / `AGGREGATOR_REFERENCES_HEADER` 两个导出常量**（同文件）
  - `AGGREGATOR_GUIDANCE`：告诉 aggregator 它是 MoM 里的融合者，下方是 advisor panel 的多路参考——不是用户输入、不是 ground truth，可能互相矛盾；应该融合出**当前 turn** 的最强响应（工具调用直接调，否则直接回答）；不要引用/枚举 references、不要提及 ensemble/advisors/model names；意见冲突时自己判断，advisor 集体错误时要 override
  - `AGGREGATOR_REFERENCES_HEADER`：从旧 `Expert Panel References:` 换成 `Advisor Panel References (for the aggregator only, not user-visible):`，标题自带"不面向用户"的语义
- **`src/aggregator/reference-builder.ts` 注入方式重构**
  - 新增内部 `composeAggregatorPayload(references)` 组装 `GUIDANCE + '\n\n' + HEADER + '\n' + references`
  - `appendReferencesToLastUser` 无论走"追加到最后一条 user 的最后一个 text block"还是"末尾是 assistant → 合成新 user"两条路径，都注入完整 payload
  - **aggregator 请求的 `system` 字段仍字节级透传 Claude Code 原 system**（001ARCHITECTURE.md §2 Anthropic prompt-caching 约束）；前缀 message 引用严格不变
- **测试同步**
  - `test/reference-builder.test.ts` 5 处旧断言（`Expert Panel References:`）换成新 header + guidance 特征片段（4 个 case）
  - `test/orchestrator-cost.test.ts` "advisor & aggregator context scope" case 的最后 4 条 assert 同步更新
  - `test/cache-decorator.test.ts` / `test/view-transformer.test.ts` 通过 `import { ADVISORY_INSTRUCTION }` 自动跟随新文本，无需硬编码修改
- **不变量**
  - `ADVISOR_SYSTEM_PROMPT` / `ADVISORY_INSTRUCTION` 导出符号名保持不变 → cache-decorator 的合成 marker 精确匹配依然生效
  - Aggregator 请求 `system` 字段字节级透传保持不变 → Anthropic prompt caching 前缀命中不受影响
  - `AggregatorSettings` schema 不动（本次不引入 `system_prompt` 可配置字段，硬编码默认；如需可配置化再新开 issue）

### 涉及文件
- `src/advisor/prompts.ts`：重写 + 新增 `AGGREGATOR_GUIDANCE` / `AGGREGATOR_REFERENCES_HEADER`
- `src/aggregator/reference-builder.ts`：新增 `composeAggregatorPayload`；`appendReferencesToLastUser` 注入新 payload
- `test/reference-builder.test.ts`：4 处断言改到新 header + guidance
- `test/orchestrator-cost.test.ts`：advisor & aggregator context scope case 断言同步
- `docs/003ISSUES.md`：新增 ISS-031（进行中）
- `docs/002STRUCTURE.md`：`prompts.ts` 行内说明补充新常量
- `docs/001ARCHITECTURE.md`：§2 "Aggregator 侧字节级透传原则"补一句关于 aggregator guidance 通过最后一条 user 注入
- `docs/005DEVELOPMENT.md`：Q&A "Aggregator 上下文范围"段落更新为新 payload 结构

### 自检
- `npm run typecheck`：0（通过）
- `npm test`：pass 135 / fail 7 —— 与 main 分支运行同 suite 完全一致（同 7 条历史 `cost_usd` 测试用例失败，属 ISS-010 遗留的 dead-assertion，与本次改动无关），已在 PR body 说明供 reviewer 复核

### 关联
-> ISS-031

---

## [2026-07-13-3] refactor(config): drop assertRecursionGuard, allow aggregator.model to appear in advisor.slots [ISS-030]

### 改动
- 删除 `src/config.ts:assertRecursionGuard` 函数与其在 `getConfig()` 中的调用；`aggregator.model` 与 `advisor.slots` 精确同名不再让进程 `exit 1`
- `ConfigError` 类保留（`assertModeRequirements` + provider/mom-config-file 加载仍用）；`assertModeRequirements` 语义不变
- 文档同步：`001ARCHITECTURE.md` §3 链路 0 与 §6 关键运行时约定的"递归护栏"条目移除；`002STRUCTURE.md` 中 `src/config.ts` 说明更新；`006API.md` §2.6 签名清单移除 `assertRecursionGuard`；`000README.md` 自检自测示例把"aggregator 递归护栏"替换为"启动期护栏"

### 涉及文件
- `src/config.ts`：删除 `assertRecursionGuard` 与 `getConfig` 内的调用
- `docs/001ARCHITECTURE.md`：链路 0 装配步骤 + Config 层描述 + 关键运行时约定移除递归护栏条目
- `docs/002STRUCTURE.md`：`src/config.ts` 行内说明去掉"递归护栏"
- `docs/006API.md`：配置装配签名清单去掉 `assertRecursionGuard`
- `docs/000README.md`：自检自测约定示例替换
- `docs/003ISSUES.md`：新增 ISS-030
- `docs/005DEVELOPMENT.md`：不改历史条目（保留 Phase 1 / 配置分层等 dated 段落里的护栏描述作为当期史料）
- `PLAN.md`：不改历史阶段规格（Phase 1 已完成条目保持不动）

### 关联
-> ISS-030
## [2026-07-13-2] refactor(dashboard): royal-blue 主题 + 展厅字号阶梯 (base 14→18) [ISS-030]

### 改动
- **theme.ts 换血**（`web/src/theme.ts`）
  - `bg` #FAF9F5 → #F7F8FC；`bgSubtle` #F5F2E9 → #EEF1F8
  - `mom` 主色 #C96442 (陶橙) → #3E5BDB (royal blue)；`momSoft` #F5DDD1 → #DBE3F9
  - `flagship` / `aggregatorOnly` / `advisorA/B/C` 全部换到冷灰蓝紫色带
  - `textPrimary/Secondary/Muted` 换成冷调；`border` / `gridLine` 冷灰化
  - `positive` / `negative` / `info` 微调到更冷更清晰的版本
  - `shadow` rgba 从 (31,27,22) warm 改为 (20,26,46) cool
- **font.size / font.weight 语义常量**（`web/src/theme.ts` 新增字段）
  - 十档 xxs (14) / xs (15) / sm (16) / base (18) / md (20) / lg (22) / xl (26) / h2 (30) / h1 (36) / kpi (44) / kpiHero (56) / kpiUltra (84)
  - `layout.sidebarWidth` 220 → 244；`contentMaxWidth` 1440 → 1520 给放大字号留呼吸空间
- **global.css base 字号 14 → 18**（`web/src/global.css`）
  - `:root { font-size: 18px }` + bg / color 冷调化；scrollbar / pulse-mom keyframe 换新蓝色
- **组件全站扫齐**：散落在 `sidebar / PageShell / Card / KpiCard / Badge / Button / 六个 chart / 五个 page` 里的 px 硬编码 `fontSize` 全部替换为 `font.size.*`；`rgba(31,27,22,*)` boxShadow 替换为 `shadow.*` 引用；Badge 语义色底也从暖调改为冷调
- **图表容器高度上调**（配合放大字号）
  - ParetoChart 360→420、ComboChart 360→420、RankingChart 320→380、CostStackedBar 260→320、CostTimeline 240→300、JudgeRadar 280→340、CostPie 260→320

### 涉及文件
- `web/src/theme.ts`：色板换血 + `font.size` / `font.weight` 新增 + `layout` 调整
- `web/src/global.css`：base 字号 + 底色 + scrollbar + pulse-mom 颜色
- `web/src/components/layout/Sidebar.tsx`：nav item / brand / footer 字号 + pill 尺寸
- `web/src/components/layout/PageShell.tsx`：H1 / subtitle 字号
- `web/src/components/primitives/{Card,KpiCard,Badge,Button}.tsx`：字号 + Badge 冷调语义色 + Button 高度 36→42
- `web/src/components/charts/*.tsx`：8 张图的 tick / label / legend / tooltip 字号 + 阴影 + 图表容器高度
- `web/src/pages/OverviewPage.tsx`：走 KpiCard 常量,无需内联字号
- `web/src/pages/LivePage.tsx`：typewriter pre / 成本对比行 / prompt shelf 按钮 / row / label 字号
- `web/src/pages/PipelinePage.tsx`：SpeedToggle / FlowNode / DiffColumn / DiffModal / AdvisorCard 字号 + 冷调 backdrop rgba
- `web/src/pages/CostPage.tsx`：SavedBanner 各段字号从 11/22/28/44/72 上调到 xs/lg/h2/kpiHero/kpiUltra
- `web/src/pages/SettingsPage.tsx`：Field label / ReadOnly / Select / NumInput / PricingTable / RadioBtn / saved flash 字号 + Badge tone 冷调
- `docs/003ISSUES.md`：新增 ISS-030
- `docs/004CHANGELOG.md`：本条

### 自检
- `npm run typecheck`：通过（`tsc -p tsconfig.json --noEmit` 无输出）
- `npm run build:web`：通过（`tsc -b && vite build`，编译 859 modules，`built in 1.17s`）
- `npm run build`：通过（`tsc -p tsconfig.json`）
- 纯前端 mock 视觉；orchestrator / API / storage / tests 未触及

### 关联
-> ISS-030
-> web/src/theme.ts / global.css
-> web/src/components/layout/*
-> web/src/components/primitives/*
-> web/src/components/charts/*
-> web/src/pages/*
-> docs/003ISSUES.md [ISS-030]

---

## [2026-07-13-1] fix(dashboard): Pareto legend 5-model split · Overview 分数三卡 · Live 动态排名图 · Combo legend 两行 [ISS-029]

### 改动
- **ParetoChart 视觉修订**（`web/src/components/charts/ParetoChart.tsx`）
  - X 轴标签改 `insideBottom` + 负 offset 压回轴线上方，legend 恢复紧贴 x 轴（`paddingTop: 8` + `margin.bottom: 30`，与 ComboChart 对齐）
  - 5 个非 MoM 模型拆成独立 Scatter，legend 显示全名：Fable 5 (circle) / GPT-5 (square) / Sonnet 4.6 (triangle) / Haiku 4.5 (diamond) / Aggregator only (cross)
  - Aggregator-only 用 `color.aggregatorOnly`（卡其）区分内部 baseline 与竞品旗舰灰
- **OverviewPage KPI 分数三卡**（`web/src/pages/OverviewPage.tsx`）
  - 顶部原有三卡（96% / −68% / +1.2s）保留，新增第二排：Fable 5 (85.5) / MoM (82.4, clay 强调) / Aggregator-only (71.1)
  - 分数直接读 `mock/benchmarks.ts` 的 `paretoData`，与 Pareto 图完全一致
- **LivePage 动态排名图**（新增 `web/src/components/charts/RankingChart.tsx` + `web/src/mock/live-ranking.ts`；`web/src/pages/LivePage.tsx` 挂载）
  - 位置：Judge 雷达 / 成本对比行之下的独立全宽卡片
  - 数据：最近 10 turn；前 9 turn 为历史 mock，第 10 turn 跟 Prompt Shelf preset 联动切换
  - 三条折线 MoM / Aggregator-only / Fable 5，同色 stroke 家族与 ComboChart 一致；Y 轴 `reversed`，tick 1/2/3（1 = 最好）
  - Tooltip 显示当前 turn 的问题标题（中英切换）+ 三家排名；副标题点明"开放型问题绝对分不可比、用相对排名"
- **ComboChart legend 拆两行**（`web/src/components/charts/ComboChart.tsx`）
  - 自定义 `TwoRowLegend`：第一行三个 cost 项（柱色），第二行三个 score 项（线色）
  - 底部 margin 30 → 40 给两行 legend 留位
- **i18n 键**（`web/src/i18n/dict.ts`）
  - 新增 `overview.kpi.scoreMoM / scoreMoMHint / scoreFable5 / scoreFable5HintFlagship / scoreBaseline / scoreBaselineHint`
  - 新增 `live.rankingTitle / rankingSubtitle / rankingAxisX / rankingAxisY`
  - 中英双语齐

### 涉及文件
- `web/src/components/charts/ParetoChart.tsx`：X 轴 label 定位 + 5 个 Scatter 拆分 + 卡其色 Aggregator only + 图高 400→360
- `web/src/components/charts/ComboChart.tsx`：自定义 `TwoRowLegend` + margin.bottom 30→40
- `web/src/components/charts/RankingChart.tsx`：**新增** 折线图 + 自定义 `RankTooltip`（含中英/turn label/prompt label）
- `web/src/pages/OverviewPage.tsx`：读 `paretoData` + 第二排 KPI 三卡
- `web/src/pages/LivePage.tsx`：引入 `RankingChart`，挂到 judge / cost 行之下的独立卡片
- `web/src/mock/live-ranking.ts`：**新增** 10 turn ranking fixture（9 turn 历史 + 5 preset 各自的第 10 turn）
- `web/src/i18n/dict.ts`：新增 kpi + ranking 键（zh + en）
- `docs/003ISSUES.md`：新增 ISS-029
- `docs/004CHANGELOG.md`：本条
- `docs/002STRUCTURE.md`：`web/src/components/charts/` 与 `web/src/mock/` 子树补 RankingChart / live-ranking.ts
- `PLAN.md`：Phase 5 页面 1（Overview）+ 页面 2（Live Compare）描述二次修订

### 自检
- `npm --prefix web run build`（`tsc -b && vite build`）通过
- 无代码逻辑改动，全部为前端 mock 视觉；orchestrator / API / storage / tests 未触及

### 关联
-> ISS-029
-> web/src/components/charts/ParetoChart.tsx / ComboChart.tsx / RankingChart.tsx
-> web/src/pages/OverviewPage.tsx / LivePage.tsx
-> web/src/mock/live-ranking.ts
-> web/src/i18n/dict.ts
-> PLAN.md Phase 5 页面 1 & 2

---

## [2026-07-12-5] test(orchestrator): fanout_mode=off + anthropic-normalize coverage; issue triage on af33818/af68b46 [ISS-021..027]

### 改动
- 新增 `test/anthropic-normalize-edge.test.ts`(16 例):normalizeAnthropicResponse 三种"unsigned"边界(undefined / "" / null)、连续多个 unsigned thinking、message_start 内 content 过滤、SSE normalizer 交错 index 重映射、delta/stop 落在 dropped index / kept index 的行为、非 record / 非 string type 事件的健壮性、独立实例隔离
- 新增 `test/stream-forward-chunking.test.ts`(4 例):1 / 5 / 300 / 4096 字节 chunk 切片下 SSE 帧无重复无丢失,验证 af33818 从字节级 pipe 改为 parse→normalize→重编码后 chunk-boundary 语义仍然正确
- 新增 `test/fanout-off.test.ts`(5 例):R1+R2 tool iteration 双真跑 / trigger_reason 落 `fanout_cache_off` / cache 未被写 / off vs user_turn 3 轮 provider 调用次数对比 (9 vs 5) / 现算 cost (pricing × usage) 正确
- 复核结论(未闭环):af33818 未解决 ISS-015..020(PR #11 待合入的 P1/P2/P3 议题——本次改动轴不同,预期);af68b46 部分解决 ISS-019(cost_usd 字段删除后,`pricing IS NULL` 直接区分 cache_hit vs pricing 缺失)
- 003ISSUES.md 新增 7 条问题(ISS-021..027):
  - **ISS-021 [P2]**:passthroughStream 主链路从字节级 pipe 变为 parse→normalize→重编码,破坏 001ARCHITECTURE 承诺
  - **ISS-022 [P3]**:content_block_delta/stop 在无对应 start 时 pass-through,index 连续性弱保证
  - **ISS-023 [P3]**:`selectSignatureMessages` `!== 'user_turn'` 全捕获,off 模式冗余分支
  - **ISS-024 [P3]**:off 模式下 `isNewTurn` 依然计算,微小无用工作
  - **ISS-025 [P3]**:SSE parse 失败 fallback 把 multi-line data 压成单行
  - **ISS-026 [P3]**:docs/005DEVELOPMENT.md 仍写 `total_cost_usd`(af68b46 已删),SQL 示例会报错
  - **ISS-027 [P3]**:docs/001ARCHITECTURE.md §6 未反映 `fanout_cache_off` 第 7 种 trigger_reason 枚举
- 手动测试步骤 M8–M11 加入 `docs/005DEVELOPMENT.md` 顶部新章节 `[2026-07-12-2]`:fanout_mode=off 场景 curl 覆盖 + 流式 thinking normalization 验证
- 全 123 例测试通过(原 97 + 新 26),typecheck 无 diff
- 本次 PR 不改代码逻辑,只加测试 + 文档 + issues

### 涉及文件
- test/anthropic-normalize-edge.test.ts:新增 16 例
- test/stream-forward-chunking.test.ts:新增 4 例
- test/fanout-off.test.ts:新增 5 例
- docs/003ISSUES.md:追加 ISS-021..027
- docs/004CHANGELOG.md:本条
- docs/005DEVELOPMENT.md:顶部新增 [2026-07-12-2] 章节

### 关联
-> ISS-021 / ISS-022 / ISS-023 / ISS-024 / ISS-025 / ISS-026 / ISS-027
-> af33818(cache-off + thinking normalize commit)
-> af68b46(cost_usd 删除,ISS-010 sync-pricing)

---

## [2026-07-12-4] docs(dashboard): rewrite PLAN Phase 5/6 and ship 5-page mock-first preview [ISS-028]

### 改动
- 改写 PLAN.md Phase 5：拆两阶段——5.0 交付 mock 数据驱动的**设计预览版**（当前）+ 5.1 待 Phase 4 API 到位后回填。原三层（Settings / Traces / Metrics）升级为五页（Overview / Live Compare / Pipeline / Cost / Settings），Traces 页被 Live + Pipeline 吸收，Metrics 拆成 Overview（效果 KPI + Pareto + combo）+ Cost（成本 KPI + 每轮堆叠 + cache 矩阵）
- 改写 PLAN.md Phase 6：改为"Judge 模式 + Baseline **后端**接入"，Dashboard UI 已在 5.0 完成；拆 `runJudge` 结构化整合 + `runJudgeCompare` 5 维打分两条路径
- 更新 PLAN.md 概览表（Phase 5 状态 `🎨 预览版已交付`）、依赖链表述、目录树的 `web/` 子树、Context 概述里"三层 Dashboard"改为"五页 Dashboard，双语中英可切换"
- 落地 web/ 预览版：五页 + 双语 i18n + Recharts 图表；`npm --prefix web run build` 通过
- 视觉体系：奶油底 `#FBF7EE` + clay 主色 `#C96442` + 低饱和三色带（MoM / Baseline / Flagship）
- 003ISSUES.md 新增 ISS-028（状态 [已解决]）
- 新增 decisions/007-dashboard-5-page-preview.md（五页拆分 + mock-first + Recharts + 自研 i18n 的完整推理链）
- 新增 future-plans/001-dashboard-api-shape-reconciliation.md（Phase 5.1 mock 数据换 API 的回填计划）
- 新增 future-plans/002-dashboard-4k-and-demo-loop.md（4K 兼容 + 展会自动循环 demo 模式）
- 修正 decisions/README.md 与 future-plans/README.md 中残留的、指向另一个项目文件的"现有列表"，改为本项目实际文件

### 涉及文件
- PLAN.md：Phase 5 / Phase 6 整节改写，概览表 + 依赖链 + 目录树 + Context 一句话表述
- web/：新增 `src/{App.tsx,main.tsx,theme.ts,global.css}` / `src/i18n/{dict.ts,context.tsx,format.ts}` / `src/hooks/{useTypewriter.ts,useEventSource.ts}` / `src/pages/{Overview,Live,Pipeline,Cost,Settings}Page.tsx` / `src/components/{layout,primitives,charts}/*` / `src/mock/{benchmarks,live-samples,pipeline-trace,cost,config}.ts`；`package.json` 新增依赖 `recharts@^2.15.4`
- docs/003ISSUES.md：追加 ISS-028
- docs/decisions/007-dashboard-5-page-preview.md：新增
- docs/future-plans/001-dashboard-api-shape-reconciliation.md：新增
- docs/future-plans/002-dashboard-4k-and-demo-loop.md：新增
- docs/decisions/README.md：修正"现有决策"列表
- docs/future-plans/README.md：修正"现有规划"列表

### 关联
-> ISS-028
-> decisions/007-dashboard-5-page-preview.md

---

## [2026-07-12-3] fix(provider): normalize invalid thinking blocks

- 非流式 provider 响应删除缺失有效 `signature` 的 thinking blocks，保留可安全回传的 signed thinking。
- 流式 SSE 同步过滤 unsigned thinking 的 start/delta/stop，并重映射后续 content block index，保持下游索引连续。
- 新增普通响应与 SSE normalization 回归测试。

## [2026-07-12-2] feat(cache): allow `fanout_mode=off`

- `FanoutMode` 新增 `off`：保持 MoM fan-out/aggregation 主链路不变，完全绕过进程内 fanout cache 的读取和写入。
- 新增 `fanout_cache_off` 日志事件与 trace trigger reason，测试时可明确验证未使用缓存。
- 新增 off 模式回归测试并更新中英文 README、开发与 API 文档。


## [2026-07-12-1] test(orchestrator): cost/cache accounting e2e coverage and issue triage [ISS-015..020]

### 改动
- 新增 e2e orchestrator 级 cost / cache-token 会计测试 `test/orchestrator-cost.test.ts`（8 例）：验证 N+1 粒度 / 4 段 usage / cost=pricing×usage 严格计算 / cache_hit 语义 / passthrough 路径 client_model 与 pricing 命中 / advisor 与 aggregator 上下文范围 / `/trace/requests` API 端到端 / multi-session 共享 fanout cache / null session_id 落盘但不可查
- 新增边界探针测试 `test/orchestrator-cost-edge.test.ts`（11 例）：null session gateway_request_id 关联 / mom_off 流式 SSE usage 抽取 / per_iteration 模式 tool iteration 必 miss / TTL 过期 / usage 极端值 clamp / Unicode/emoji cache key 稳定性 / provider host 抽取 / 多轮 cache 命中率累积 / 全新 user turn 使旧 key 失效
- 手动 e2e 测试指导写入 `docs/005DEVELOPMENT.md` 顶部 `[2026-07-12-1]` 章节：M1–M7 curl 步骤（session 首轮 miss / tool iteration hit / 新 user turn / /trace/requests 查询 / 缺失 session / UUID 校验 / SQL 直查 cost）+ 概念速览 + FAQ 5 条（advisor/aggregator 上下文范围、cache 隔离、进程重启行为）
- 003ISSUES.md 新增 6 条问题（本次测试发现，未修复）：
  - **ISS-015 [P1]**：fanout cache 缓存失败结果 → tool iteration cache_hit 时 `status='cache_hit'` 与 `error != null` 契约冲突，eval 侧故障率被低估
  - **ISS-016 [P1]**：`buildConcatReferences` 把 `TraceError` 对象模板字符串化输出 `[object Object]`，aggregator 拿到无诊断信息的失败占位符（ISS-012 类型收窄后遗留）
  - **ISS-017 [P3]**：`request_summary.tool_use_count` 混合 tool_use 与 tool_result
  - **ISS-018 [P3]**：`reasoning_tokens` / `reasoning_per_million` 双向硬编码 0/null
  - **ISS-019 [P2]**：cache_hit + pricing_table 未配 model 时 pricing=null → SQL 层用 cost_usd=0 无法区分
  - **ISS-020 [P3]**：cache_hit 复用时 origin request 溯源缺 hook（ISS-015 关联）
- 全 109 例测试通过（原 90 + 新 19），typecheck 无 diff；本次 PR 不改代码逻辑

### 涉及文件
- test/orchestrator-cost.test.ts：新增 e2e 主链路 cost/cache/context 覆盖
- test/orchestrator-cost-edge.test.ts：新增边界探针
- docs/003ISSUES.md：追加 ISS-015..020
- docs/005DEVELOPMENT.md：顶部新增 [2026-07-12-1] 手动测试指导章节 + 概念速览 + FAQ

### 关联
-> ISS-015 / ISS-016 / ISS-017 / ISS-018 / ISS-019 / ISS-020

## [2026-07-11-3] feat(scripts): add sync-pricing + drop cost_usd, carry currency from data source [ISS-010]

### 改动
- 新增 `scripts/sync-pricing.mjs`：一次性运维脚本，从 `PROVIDER_BASE_URL/v1/models` 拉取模型清单，按 `input_price * 1e6` / `output_price * 1e6` / `cached_price * 1e6` 换算成 per-1M-tokens 价格灌进 `data/mom.config.json.pricing_table`；`cache_write` 按 Anthropic 惯例 `input × 1.25` 估算（provider 未暴露该字段）；`--currency`（默认 `CNY`）+ `--overwrite` + `--dry-run` + `--config <path>`；默认只补齐缺失项、不覆盖手改；provider 未列出的本地条目仅打印 `SKIP unknown-to-provider` 不删除；.tmp + rename 原子写；`package.json` 加 `sync-pricing` npm script
- 类型 `src/types/mom.ts`：`ModelPricing` 新增必填字段 `currency: string`（ISO 4217，跟随数据源）；`PricingSnapshot.currency` 从字面量 `'USD'` 拓宽为 `string`（网关不假设币种，从 `ModelPricing.currency` 忠实带出）；**删除** `TraceRequest.cost_usd`、`JudgeResult.cost_usd`、`Metrics.total_cost_usd`、`Metrics.baseline_cost_usd`
- 存储 `src/storage/db.ts` / `src/storage/traces.ts`：`traces` 表 DDL 删除 `cost_usd REAL NOT NULL` 列；`saveTraceRequest` INSERT 语句从 14 列改回 13 列，去掉 `trace.cost_usd` 参数
- 计价 `src/cost/pricing.ts`：`snapshotPricing` 从 `rate.currency` 带出 `currency`，不再硬编码 `'USD'`
- Orchestrator `src/orchestrator/orchestrator.ts`：三处（persistAdvisorTraces / persistAggregatorTrace / persistPassthroughTrace）删除 `cost_usd: calculateCostFromSnapshot(usage, pricing)` 写入；`calculateCostFromSnapshot` 保留作为 SDK 层公开 helper（eval / 未来 dashboard-api 可用）
- 测试同步：`test/pricing.test.ts` / `test/pricing-snapshot.test.ts` `ModelPricing` 字面量补 `currency: 'CNY'`；新增 `snapshotPricing carries currency verbatim` 断言；`test/trace-api.test.ts` / `test/trace-storage.test.ts` 删除 `cost_usd: 0` 字面量；91/91 通过
- 关闭 ISS-010：状态改 `[已解决]`；解决方案一句话；关联本 CHANGELOG

### 涉及文件
- scripts/sync-pricing.mjs：新增，一次性 pricing 同步脚本
- package.json：新增 `sync-pricing` npm script
- src/types/mom.ts：ModelPricing 加 currency；PricingSnapshot.currency 拓宽为 string；TraceRequest / JudgeResult / Metrics 去掉 cost_usd 及派生字段
- src/storage/db.ts：traces 表删除 cost_usd 列
- src/storage/traces.ts：saveTraceRequest 参数列表同步
- src/cost/pricing.ts：snapshotPricing 从 rate.currency 带出
- src/orchestrator/orchestrator.ts：三处 cost_usd 写入删除；import 精简
- test/pricing.test.ts / test/pricing-snapshot.test.ts：ModelPricing 加 currency；新增 currency 携带断言
- test/trace-api.test.ts / test/trace-storage.test.ts：删除 cost_usd 字面量
- docs/003ISSUES.md：ISS-010 状态 [讨论中] → [已解决]；方案讨论收敛；解决日期
- docs/001ARCHITECTURE.md：链路 A / 链路 D 描述删掉 cost_usd；"Pricing 请求时冻结" 约定改写为币种从数据源带出、成本由消费方现算
- docs/002STRUCTURE.md：新增 scripts/ 目录说明；src/cost/pricing.ts 说明校准
- docs/006API.md：§1.4 TraceRequest 契约删除 cost_usd 示例；pricing.currency 说明改为跟随数据源、示例值改为 CNY
- docs/005DEVELOPMENT.md：新增 [2026-07-11-1] 段，记录 sync-pricing 使用姿势、类型结构变化、DB 破坏性变更（需 `rm mom.db`）

### 关联
-> ISS-010
-> decisions/006-eval-trace-request-api.md（§不在本期范围 项 1 / 项 4 均由本次交付闭环）

---

## [2026-07-11-2] fix(gateway): trace observation completeness on error paths [ISS-012]

### 改动
- 重构 `src/provider/stream-forward.ts`：passthroughStream 遇 provider 非 2xx / 网络错误时统一抛 `ProviderError` / 原始 `Error`；SSE `error` 帧作为副作用先写再抛，客户端仍收到规范帧、orchestrator 落 `status='error'` TraceRequest 不再被吞（修复 A/C 根因：先前非 2xx 只 `return` 让 streamError=null 导致 trace 错记 success）
- 提升 `toTraceError(err, fallbackType)` 到 `src/provider/provider-client.ts`，advisor / aggregator / passthrough / stream-forward 四条路径共用；从 `ProviderError` 抽 `statusCode` 到 `TraceError.http_status`（修复 B：advisor / aggregator 路径 http_status 恒为 null）
- 类型收窄 `src/types/mom.ts`：`TraceError.type` 由 `string` 改为 `TraceErrorType = 'provider_error' | 'gateway_error' | 'advisor_error' | 'aggregator_error'` union；`AdvisorResult.error` / `AggregatorResult.error` 由 `string?` 改为 `TraceError | null`；`RuntimeConfig` 新增 `mom_config_source: string` 字段
- 修改 `src/advisor/advisor-runtime.ts` / `src/aggregator/aggregator-runtime.ts`：catch 用 `toTraceError(err, 'advisor_error' | 'aggregator_error')` 保留结构化错误；`StreamingTimingResult.error` 改为 `TraceError | null`
- 修改 `src/orchestrator/orchestrator.ts`：`persistAdvisorTraces` / `persistAggregatorTrace` / `persistPassthroughTrace` 直接透传 `TraceError`，不再本地构造 `{type, message, http_status: null}`；orchestrator 接受 `runtime.mom_config_source` 作为 `PRICING_SOURCE` 常量的替代，pricing.source 现为 `mom.config.json@<mtime iso>`（修复 E：pricing_table 变动后可从 source 定位版本）
- 修改 `src/cache/fanout-cache.ts`：`cloneAsCacheHit` 适配 `error: TraceError | null`（从 conditional spread 改为 直传原值）
- 放宽 `src/gateway/trace-api.ts` UUID 正则：`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` 大小写不敏感，接受 v6/v7/v8/NIL/max（修复 D：先前 `[1-5]` 拒绝 UUIDv7 timestamp-ordered）
- 新增 `src/config.ts:stampMoMConfigSource(path)`：`statSync` 读 mtime 拼 `basename@<iso>`；stat 失败 fallback 到 basename；`getConfig` 拼进 `RuntimeConfig.mom_config_source`
- 新增回归测试 4 个文件 14 例：`test/stream-forward-error.test.ts`（502 / 网络错误抛 ProviderError + SSE 帧）/ `test/advisor-error.test.ts`（502 / 429 http_status 保留）/ `test/trace-api-uuid.test.ts`（v6 / v7 / NIL / max 接受）/ `test/config-source.test.ts`（mtime stamping）；全 90 例通过
- 关闭 ISS-009 / ISS-011（补 [已解决] + 解决方案 + CHANGELOG 关联）；新开 ISS-012（本次交付）/ ISS-013（settings_snapshot 冗余，Phase 3 遗留）/ ISS-014（saveTraceRequest 未缓存 statement）

### 涉及文件
- src/provider/stream-forward.ts：非 2xx / 网络错误抛错；SSE 帧作为副作用
- src/provider/provider-client.ts：新增 toTraceError 共享工具
- src/types/mom.ts：TraceError.type 收窄；AdvisorResult/AggregatorResult error 结构化；RuntimeConfig 加 mom_config_source
- src/advisor/advisor-runtime.ts：catch 用 toTraceError；success 时 error: null
- src/aggregator/aggregator-runtime.ts：catch 用 toTraceError；StreamingTimingResult.error: TraceError | null
- src/orchestrator/orchestrator.ts：persist* 透传 TraceError；pricingSource 由 runtime 提供
- src/cache/fanout-cache.ts：cloneAsCacheHit 适配 error 新类型
- src/gateway/trace-api.ts：UUID 正则放宽为 hex-only
- src/config.ts：新增 stampMoMConfigSource；getConfig 拼 mom_config_source
- test/stream-forward-error.test.ts / test/advisor-error.test.ts / test/trace-api-uuid.test.ts / test/config-source.test.ts：新增回归
- docs/003ISSUES.md：ISS-009/011 关闭；新增 ISS-012/013/014
- docs/001ARCHITECTURE.md：新增 "Provider 错误信号双通道" / "TraceError 结构化传递" / "Pricing source stamping" 三条约定
- docs/006API.md：§1.4 UUID 描述更新；`pricing.source` 示例改为 `mom.config.json@<iso>`；§4 类型清单补 TraceErrorType 与 RuntimeConfig.mom_config_source

### 关联
-> ISS-009
-> ISS-011
-> ISS-012
-> decisions/006-eval-trace-request-api.md

---

## [2026-07-11-1] feat(gateway): eval trace API — per-upstream TraceRequest + GET /trace/requests

### 改动
- 新增 `src/gateway/trace-api.ts`：`registerTraceAPI(app)` 挂载 `GET /trace/requests?session_id=<uuid>`；UUID 严格校验（RFC 4122 v1-v5）；缺参 / 非法 UUID → 400 `invalid_request_error`；存储层异常 → 500 `internal_error`；命中即返回 `{ session_id, requests: TraceRequest[] }`，按 `started_at` 升序，空数组不 404
- 重构 `src/types/mom.ts`：删除旧 `Trace` 类型（入口聚合结构），新增 `TraceRequest`（每次上游调用一条）+ `TraceUsage` / `PricingSnapshot` / `TraceError` / `RequestSummary` / `ResponseSummary` 五个子类型；`AdvisorResult` / `AggregatorResult` 各补 `started_at` / `finished_at` / `selected_model` / `response_summary` 字段
- 重构 `src/storage/db.ts`：`traces` 表 schema 从 8 列改为 14 列（新增 `session_id` / `gateway_request_id` / `role` / `client_model` / `selected_model` / `provider` / `started_at` / `finished_at` / `duration_ms` / `status` / `cost_usd`；主键改为 `request_id`；删除 `mom_triggered` / `total_cost_usd` / `total_latency_ms` / `baseline_cost_usd`）；新增 3 个索引（`idx_traces_session_id` 部分索引跳过 NULL / `idx_traces_started_at` / `idx_traces_gateway_request_id`）
- 重写 `src/storage/traces.ts`：`saveTrace` → `saveTraceRequest`；`getTraceById` → `getTraceRequestById`；`getRecentTraces` → `getRecentTraceRequests`；新增 `getTraceRequestsBySessionId(session_id)` 走 session_id 索引 + `ORDER BY started_at ASC`
- 重写 `src/orchestrator/orchestrator.ts`：orchestrator 签名接受 `sessionId: string | null`；`createOrchestrator` 内部为每次入口请求生成 `gateway_request_id`；主链路 fanout 后立即 `persistAdvisorTraces` 落 N 条 role='advisor' TraceRequest；aggregator 完成后 `persistAggregatorTrace` 落 1 条；aggregator 抛错时先补落 status='error' aggregator TraceRequest 再重抛；透传路径 `persistPassthroughTrace` 落 role='passthrough' 一条；错误路径也落 trace（保证 eval 侧能观察到失败）
- 扩展 `src/cost/pricing.ts`：新增 `snapshotPricing(model, table, source)` 深拷贝 pricing 快照；`toTraceUsage(usage)` Anthropic → TraceUsage 五段映射；`calculateCostFromSnapshot(usage, snapshot)` 内嵌快照计价；保留旧 `calculateCost` / `sumUsage` 供既有测试与 metrics 后续使用
- 修改 `src/gateway/messages-handler.ts`：`extractSessionId(req)` 从 `X-Session-ID` header 提取；handler 签名传入 orchestrator
- 修改 `src/gateway/server.ts`：`registerTraceAPI(app)` 挂载
- 修改 `src/advisor/advisor-runtime.ts`：`runAdvisor` 返回值补 `started_at` / `finished_at` / `selected_model` / `response_summary`
- 修改 `src/aggregator/aggregator-runtime.ts`：`runAggregatorNonStreaming` 返回值补 timing + `response_summary`；`runAggregatorStreaming` 返回 `StreamingTimingResult { references_appended, started_at, finished_at, error? }` 供 orchestrator 落 aggregator trace
- 修改 `src/cache/fanout-cache.ts`：`cloneAsCacheHit` 补 `started_at=finished_at=Date.now()` / `selected_model` / `response_summary=null`
- 新增 `test/pricing-snapshot.test.ts`（9 例）/ `test/trace-storage.test.ts`（7 例）/ `test/trace-api.test.ts`（5 例）：单测覆盖新纯函数、SQLite CRUD、HTTP 端点契约

### 涉及文件
- src/types/mom.ts：删旧 Trace，加 TraceRequest + 5 个子类型 + AdvisorResult/AggregatorResult 扩字段
- src/storage/db.ts：SCHEMA 重写，14 列 + 3 索引
- src/storage/traces.ts：接口重命名 + 新增 getTraceRequestsBySessionId
- src/orchestrator/orchestrator.ts：orchestrator 接受 sessionId；每次上游落一条 TraceRequest
- src/cost/pricing.ts：新增 snapshotPricing / toTraceUsage / calculateCostFromSnapshot
- src/advisor/advisor-runtime.ts：返回值补时间/model/summary
- src/aggregator/aggregator-runtime.ts：返回值补时间/summary，streaming 返回 timing
- src/cache/fanout-cache.ts：cloneAsCacheHit 补新字段
- src/gateway/messages-handler.ts：提取 X-Session-ID header 传入 orchestrator
- src/gateway/server.ts：挂载 registerTraceAPI
- src/gateway/trace-api.ts：新增 GET /trace/requests 路由
- test/pricing-snapshot.test.ts / test/trace-storage.test.ts / test/trace-api.test.ts：新增
- docs/decisions/006-eval-trace-request-api.md：新增
- docs/003ISSUES.md：新增 ISS-009 / ISS-010 / ISS-011
- docs/001ARCHITECTURE.md：更新链路 A-F trace 落盘描述 + 关键约定 Trace 粒度 / Session 关联键 / Pricing 冻结
- docs/002STRUCTURE.md：新增 trace-api.ts / 新测试文件；更新 orchestrator / cost / storage / types 一句话
- docs/006API.md：§1.1 加 `/trace/requests` 端点；新增 §1.4 详细契约；§2.1 orchestrator 签名补 sessionId；§2.7 traces 接口重命名；§3 / §4 补新类型

### 关联
-> ISS-009
-> ISS-011
-> decisions/006-eval-trace-request-api.md

---



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
