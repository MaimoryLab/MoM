# Issues

> 状态标签：`[发现]` / `[讨论中]` / `[暂缓]` / `[进行中]` / `[已解决]`
> 优先级标签：`[P0 致命]` / `[P1 严重]` / `[P2 一般]` / `[P3 轻微]`
> 类型标签：`[崩溃]` / `[功能异常]` / `[性能]` / `[体验]` / `[安全]` / `[技术债]`
> 详细格式与写作约定见 `000README.md`。

---

## [ISS-001] better-sqlite3 依赖对新版本 Node 兼容性差，阻碍 npm install

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[技术债]
**发现日期**：2026-07-09
**解决日期**：2026-07-09
**解决方案**：storage 层驱动切换到 Node 内置 `node:sqlite`（`DatabaseSync`）；schema DDL 内联进 `db.ts`。`engines.node` 提升到 `>=22.13.0`（node:sqlite 从该版本起脱离 experimental）。

**现象**：
在较新版本的 Node 上执行 `npm install`，`better-sqlite3` 的 native 编译（`node-gyp`）失败或触发 prebuild 缺失，导致依赖装不上。要装上就得把 Node 降级到官方给该版本 better-sqlite3 提供 prebuild binary 的窗口内。

**后果**：
任何开发者/使用者拿到仓库执行 `npm install` 都有较大概率直接卡在这一步；解决路径（降级 Node）对新用户是显著门槛，严重阻碍 Phase 2+ 的实测与外部试用。

**初步判断**：
已确认。属于 native addon 与 Node 版本的常见兼容性问题；根因是引入了带 native 编译产物的第三方依赖，而项目并不需要 SQL 引擎之外的额外能力。

**方案讨论**：（已收敛）
方案 A：换成 `node:sqlite`（Node 内置，v22.13.0 起脱离 experimental）——保留 SQL 与同步 API，去掉 native 编译依赖。
方案 B：改成纯文件（JSON + JSONL）——彻底摆脱 SQL 依赖，但放弃 Phase 4 metrics 聚合的 SQL 便利。
方案 C：换成 `sql.js`（SQLite 编译成 WASM）——同步 API 但需显式 flush 到磁盘、启动多 1-2s WASM 初始化。
方案 D：换成 `@libsql/client`（LibSQL）——只有 async API，会把整条调用链染成 async，改动最大。
当前倾向：方案 A。

**关联**：
-> src/storage/db.ts
-> src/storage/settings.ts
-> package.json（better-sqlite3 / @types/better-sqlite3 依赖）
-> decisions/001-storage-node-sqlite.md
-> 004CHANGELOG.md [2026-07-09-1]

---

## [ISS-002] 配置全部塞 SQLite，无 env-file 路径，Dashboard 成为唯一适配层

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[技术债]
**发现日期**：2026-07-09
**解决日期**：2026-07-09
**解决方案**：三层拆分——`.env` 装秘钥（`PROVIDER_*`）与部署配置（`MOM_*`）；`data/mom.config.json` 装业务配置（原 `MoMSettings` 去掉 provider 后的全字段，含 `pricing_table`）；SQLite 只留 `traces` / `metrics_cache`。npm scripts 走 Node 22 原生 `--env-file`。`MoMSettings` 拆为 `ProviderConfig` + `MoMConfig` + `RuntimeConfig`。Dashboard SettingsPage 明确不显示、不编辑秘钥。

**现象**：
Phase 1 现状下，`provider.base_url` / `provider.api_key` / `provider.auth_style` 与所有业务配置（advisor.slots / aggregator.model / pricing_table / cache 等）一起，作为 `MoMSettings` 的字段序列化后塞进 SQLite `settings` 表的 JSON blob。**没有 `.env` 文件、没有 `process.env.PROVIDER_API_KEY` 之类的读取路径**。首次配置 provider 的唯一手段是写一条 UPDATE SQL。PLAN 后续阶段（Phase 2 provider-client、Phase 5 Dashboard SettingsPage）继承同一假设，`buildAuthHeaders(settings)` 直接从 `settings.provider` 读秘钥，`SettingsPage.tsx` 计划"表单绑定 MoMSettings 所有字段"——等于把 api_key 也搬到浏览器表单里编辑。

**后果**：
1. **秘钥旅行**：`mom.db` 文件带着秘钥；备份、复制、共享 mom.db 会把 key 一起漏出去
2. **首次测试摩擦**：Dashboard 未上线之前，唯一填 key 的路径是写 SQL；对新用户是显著门槛
3. **部署反直觉**：CI / Docker / 云托管的标准做法是注入 env 变量，SQLite 秘钥违反 12-Factor
4. **架构耦合**：Dashboard 从"可选适配"变成"事实上的唯一适配"——不跑 Dashboard 就没有可视化路径去改 provider，而 Dashboard 又把秘钥当业务字段编辑
5. **越晚改越贵**：Phase 2 的 `buildAuthHeaders(settings)` 与 Phase 5 的 SettingsPage 都建立在同一假设上，进到 Phase 2 会把错误架构再钉深一层

**初步判断**：
已确认。根因是 Phase 1 把"部署配置（秘钥/base_url）"与"业务配置（模型选择/定价/触发模式）"混为一谈，统一走 SQLite。二者天然是不同的读者（部署环境 vs Dashboard 用户）和不同的生命周期（部署时定 vs 运行时调）。

**方案讨论**：（已收敛）
方案 A（**采纳**）：三层拆分——`.env` 装秘钥/部署配置（provider.base_url / api_key / auth_style），`data/mom.config.json` 装业务配置（其余全部字段），SQLite 只留 `traces` / `metrics_cache` 两张运行时数据表。Node 22+ 原生 `--env-file=.env`，无第三方依赖。
方案 B：秘钥继续放 SQLite，但补一个"首次启动时从 env 覆盖 SQLite"的 fallback。否定：解决了摩擦但没解决秘钥旅行；两处真实来源相互覆盖会引入难以调试的状态。
方案 C：所有配置塞纯 JSON 文件（含 api_key）。否定：秘钥仍旅行在项目文件里，不解决问题 1、3。
方案 D：引入 `dotenv` 包。否定：Node 22+ 有 `--env-file` 原生支持，多一个依赖徒增供应链风险。

**关联**：
-> src/config.ts
-> src/types/mom.ts（`MoMSettings` 结构）
-> src/storage/settings.ts（将被删除）
-> src/storage/db.ts（SCHEMA 中 settings 表将被移除）
-> src/provider/provider-client.ts（`buildAuthHeaders(settings)` 签名）
-> src/gateway/messages-handler.ts（`loadSettings()` 调用点）
-> PLAN.md（Phase 1 存储、Phase 2 provider-client、Phase 5 SettingsPage）
-> decisions/002-config-layering.md
-> 004CHANGELOG.md [2026-07-09-2]

---

## [ISS-003] AI 协作流程止步于"交付清单"，Git 环节未闭环

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[技术债]
**发现日期**：2026-07-09
**解决日期**：2026-07-09
**解决方案**：改写 `docs/000README.md`——删除"不得跑测试/不得跑 git"两条禁令；新增「自检自测约定」节（typecheck + build + build:web，外加本次改动新引入的验证脚本必须自跑）；将「交付清单约定」重写为「交付流程约定」，Claude 在自检通过后自动 commit + push feature 分支 + `gh pr create --draft`，回执给出 PR URL 与用户合并后需执行的 `git pull --ff-only`。同时补一条 "commit / PR title ≤ 72 字符" 的硬约束，避免 Claude Code 自动截断成 `...`。

**现象**：
`docs/000README.md` 原有 `### 禁止行为` 明写"不得在实现或核查过程中自行运行任何测试命令 / 不得自行执行任何 git 操作"；`## 交付清单约定` 要求 Claude 输出待执行命令列表后停下等人工执行。实际协作里，Claude 在 `.claude/worktrees/<name>` 独立工作目录改代码，不 commit + push 出去，worktree 一旦被清理改动就丢失；用户主目录停留在 push 前的 main 分支，看不到任何变化，误以为"push 没生效"。

**后果**：
1. 每次 issue 完成后必须人工介入去跑 typecheck/build 与 git 步骤，协作节奏被割裂
2. worktree 内的改动没有及时 commit + push，存在丢失风险
3. 用户在主目录 `git status` / `git log` 看不到 Claude 的改动，容易误判 push 未生效
4. 原文档模板列举的 `npm run test:unit` / `pytest tests/` 命令在本 repo 根本不存在，是空口白话

**初步判断**：
已确认。根因是文档一次性把"环境硬约束（不能 push main / 不能 merge PR）"和"临时约定（不跑测试、不跑 git）"混为一谈——前者由 Claude Code 后台任务 system prompt 强制，无法跨越；后者是项目自定，可以并且应该放开，让 Claude 完成 typecheck + build + commit + push feature 分支 + draft PR 的机器闭环，把 review + merge + 本地 pull 留给人。

**关联**：
-> docs/000README.md（工作流生命周期、禁止行为、二次核查、新增自检自测、交付流程）
-> 004CHANGELOG.md [2026-07-09-3]

---

## [ISS-004] Trace.settings_snapshot 类型带 RuntimeConfig 会把 api_key 写进 SQLite

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[安全]
**发现日期**：2026-07-09
**解决日期**：2026-07-09
**解决方案**：`Trace.settings_snapshot` 类型从 `RuntimeConfig` 缩窄为 `MoMConfig`——只快照业务配置，不快照 provider 秘钥/端点。修复前置到 Phase 2（此时 orchestrator 首次开始在内存流转 advisor/aggregator 结果，Phase 3 才落盘），避免撕开更多改动。

**现象**：
Phase 1 `src/types/mom.ts` 把 `Trace.settings_snapshot` 定义为 `RuntimeConfig`（`= { provider: ProviderConfig, mom: MoMConfig }`），`ProviderConfig` 含 `api_key`。Phase 3 计划的 `saveTrace()` 一旦启用，每条 trace 都会以 JSON 形式把明文 `api_key` 写进 `mom.db` 的 `traces` 表。

**后果**：
1. **秘钥旅行升级**：ISS-002 已确认过的"mom.db 备份/共享会带出秘钥"问题会以更严重的形式重现——Phase 1 时 `settings` 表全库一份，Phase 3 后每一条 trace 都一份
2. **与 decisions/002 的核心原则冲突**：拍板过"秘钥永不写 SQLite / config.json，只活在 .env 里"
3. **越晚改越贵**：等到 Phase 3 saveTrace 上线时再改，要同时改类型、Storage 序列化、Dashboard 展示层

**初步判断**：
已确认。根因是 Phase 1 拆分 `MoMSettings → ProviderConfig + MoMConfig` 时，`Trace.settings_snapshot` 类型跟着 `RuntimeConfig` 走，没跟着"秘钥不落盘"的边界收紧。

**方案讨论**：（已收敛）
方案 A（**采纳**）：`settings_snapshot: MoMConfig`——只快照业务配置。`base_url`/`auth_style` 对 trace 分析价值极低，`api_key` 完全零价值。
方案 B：`settings_snapshot: { mom: MoMConfig; provider: Pick<ProviderConfig, 'base_url' | 'auth_style'> }`——保 provider 元信息但剔除 api_key。否定：多环境对照能力可以 Phase 4+ 加独立 `env_tag: string` 字段更干净、更显式。
方案 C：类型不动，在 `saveTrace` 序列化时黑名单 `api_key`。否定：把边界防御下沉到序列化层，未来加字段易漏。

**关联**：
-> src/types/mom.ts:129
-> decisions/004-trace-snapshot-scope.md
-> 004CHANGELOG.md [2026-07-09-4]

---

## [ISS-005] Phase 2 主链路（Advisor 视图 + Fan-out + Concat 拼接）尚未实现

**状态**：[已解决]
**优先级**：[P0 致命]
**类型**：[功能异常]
**发现日期**：2026-07-09
**解决日期**：2026-07-09
**解决方案**：按 PLAN.md Phase 2 落地 advisor / fanout / aggregator / orchestrator 四层；`mom_mode==='always'` 时 fan-out 全部 advisor、以 concat 方式把 references 拼到 aggregator 请求最后一条 user 尾部，调 aggregator 模型返回。执行时相对 PLAN 的偏离已在 PLAN.md Phase 2 章节"与本节初稿的偏离"块内标注。

**现象**：
Phase 1 完成后网关只做透传，`mom_mode` / `advisor.slots` / `aggregator.model` 全部字段悬空。

**后果**：
MoM 的核心能力（多模型 fan-out + reference 拼接）不可用。

**初步判断**：
已确认，属于计划性交付。

**关联**：
-> src/orchestrator/orchestrator.ts
-> src/orchestrator/fanout.ts
-> src/advisor/view-transformer.ts
-> src/advisor/advisor-runtime.ts
-> src/advisor/prompts.ts
-> src/aggregator/reference-builder.ts
-> src/aggregator/aggregator-runtime.ts
-> src/config.ts（新增 assertModeRequirements）
-> src/gateway/messages-handler.ts（签名升 RuntimeConfig）
-> src/gateway/server.ts（签名升 RuntimeConfig）
-> test/view-transformer.test.ts
-> test/reference-builder.test.ts
-> PLAN.md Phase 2
-> 004CHANGELOG.md [2026-07-09-4]

---

## [ISS-006] Phase 3 触发判断与缓存复用被折叠成同一决策，tool iteration cache miss 会降级为空 references

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[技术债]
**发现日期**：2026-07-10
**解决日期**：2026-07-10
**解决方案**：Phase 3 主链路控制流规范化为"先查 cache，命中即复用、未命中就跑 fanout"，`trigger_reason` 从"决策函数返回值"退化为"叙述性标签"（六种枚举：`mom_off` / `user_turn` / `skipped_tool_iteration` / `tool_iteration_cache_miss` / `per_iteration` / `fanout_cache_hit`）。cache key 用原顺序的 `slotsHash` 而非 `sortedSlots`；`passthroughStream` 单一实现 + 可选 `onEvent` 观察者；透传路径也写 trace。PLAN.md Phase 3 章节全面重写；decisions/005 记录决策链。

**现象**：
PLAN Phase 3 初稿把 `fanout_mode: user_turn` 描述为"tool iteration 复用 references（不重跑 advisor）"，并给出 `shouldFanout` 决策函数。字面语义在三类真实场景下会退化：
1. 进程重启后内存 cache 全空，第一条 tool iteration 请求跳过 advisor → aggregator 拿到空 references
2. TTL 过期后同 tool loop 内下一次 iteration 命中失效 → 同上
3. 用户开新 Claude Code session 直接粘贴含 tool_result 的历史 → 首请求即 tool iteration，cache 空 → 同上

**后果**：
1. **aggregator 严重降级为 baseline 单模型**（空 references 拼接，用户无感知）
2. **`trigger_reason=skipped_tool_iteration` 与真正的缓存命中在 metrics/dashboard 上无法区分**，用户看不到质量崩塌
3. 与 Phase 2 已经稳定下来的"advisor/aggregator 语义"承诺冲突：Phase 2 保证"MoM 主链路 = 多模型 fan-out + reference 拼接"，Phase 3 却在部分场景下退化为单模型
4. **越晚改越贵**：Phase 3 一旦按初稿实现，cache miss 降级路径没有留位，Phase 4 metrics 也没有分维度显示的字段

**初步判断**：
已确认。根因是"触发判断"（是否新 turn，一个描述性判断）与"缓存复用"（cache 是否命中，一个存储层查询结果）在初稿被折叠成同一个 `shouldFanout` 二值决策。两者正交，在 cache 不可用时的正确答案是分歧的：即使不是新 turn，如果 cache miss，仍然应该跑 fanout 以保证 aggregator 拿到真实 references。

**方案讨论**：（已收敛，详见 decisions/005）
方案 A：严格按初稿实现——否定：三类真实场景下 aggregator 拿到空 references，严重降级
方案 B：cache miss 只 warn 不补跑——否定：把架构问题降级成告警问题，无自愈
方案 C（**采纳**）：cache miss 无条件补跑 advisor，`trigger_reason` 退化为标签

**关联**：
-> PLAN.md Phase 3（章节全面重写）
-> src/orchestrator/orchestrator.ts（待改，Phase 3 实施时）
-> src/orchestrator/trigger.ts（待新增）
-> src/cache/cache-key.ts（待新增）
-> src/cache/fanout-cache.ts（待新增）
-> src/provider/stream-forward.ts（待改，加可选 onEvent 参数）
-> decisions/005-trigger-cache-decoupling.md
-> 004CHANGELOG.md [2026-07-10-1]

---

## [ISS-007] MoM 业务逻辑对 Fastify 有 3 处遗留耦合，无法作为独立 SDK 复用

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[技术债]
**发现日期**：2026-07-10
**解决日期**：2026-07-10
**解决方案**：随 Phase 3 顺手做——`orchestrate(body, reply, runtime, log)` 拆成 `createOrchestrator(runtime): { nonStreaming(body, log), streaming(body, output, log) }` 工厂（同时闭包持有 fanout cache）；`runAggregatorStreaming` 参数 `FastifyReply` 换成 `NodeJS.WritableStream + {onEvent?, log?}`；`passthroughStream` 内部 SSE header/hijack 上提到 `messages-handler.ts`，签名改为 `NodeJS.WritableStream + {onEvent?, log?}`；新增最小 `Logger` 接口（`{info, warn, error}`）取代 `FastifyBaseLogger`。业务层（orchestrator / advisor / aggregator / provider / cache / cost / storage / config）完全无 Fastify 依赖，Fastify 只剩 `src/gateway/*`。

**现象**：
用户团队已有独立运行的网关消息处理项目，希望复用 MoM 的多模型 fan-out + reference 拼接能力时，只 import `src/orchestrator/*` + `src/advisor/*` + `src/aggregator/*` 三个子树无法运行——签名里仍然带 `FastifyReply` / `FastifyBaseLogger`。`git grep -n "FastifyReply\|FastifyBaseLogger" src/` 结果，业务层耦合集中在 3 处（详见 docs/006API.md §3.1）：

1. `src/orchestrator/orchestrator.ts:12-17` — `orchestrate` 签名带 `reply` + `log`
2. `src/aggregator/aggregator-runtime.ts:49-58` — `runAggregatorStreaming` 参数含 `reply`
3. `src/provider/stream-forward.ts:8-24` — `passthroughStream` 内部 `reply.raw.setHeader` / `reply.hijack()` / `reply.raw.pipe`

**后果**：
1. 外部项目要复用 MoM 得连带引入 Fastify 或写一个 Fastify Reply mock，不合理
2. MoM 打包成独立 npm 包（`@mom/orchestrator`）的路径被这 3 处耦合卡住
3. 未来 CLI / SDK 形态引入时（PLAN 阶段总览"讨论中否定的方案"第 10 条"CLI / NPM 包 / Claude Code 插件形态属远期"）会顺带撕开这个 refactor，成本不高但延后越晚越贵

**初步判断**：
已确认。`git grep` 结果验证。核心业务逻辑（`fanoutAdvisors` / `runAdvisor` / `convertToAdvisorView` / `buildConcatReferences` / `appendReferencesToLastUser` / `runAggregatorNonStreaming` / `passthroughCall` / 所有配置装配 / 存储层）**已经完全不依赖 Fastify**——耦合面只剩这 3 处（详见 006API.md §3）。估算完全解耦 ~50 行 diff / 4 个文件，不动业务逻辑。

**暂缓原因**：
1. MVP 优先级是"MoM 主链路可用 + Dashboard 可展示效果"，Phase 3-5 都在这条主路径上；SDK 打包属于"能不能被别的项目复用"的正交能力
2. 建议随 Phase 3 顺手做（Phase 3 无论如何都要动 `orchestrate` 与 `passthroughStream`：前者要落 trace、后者要加 SSE observer；顺手把 `FastifyReply` → `Writable` 改掉，比之后专门开一个 refactor 更省事）
3. 若 Phase 3 因时间压力未能顺手做，本 issue 转 [讨论中] → [进行中]，独立开一个 refactor commit

**关联**：
-> src/orchestrator/orchestrator.ts（重写为 createOrchestrator 工厂 + 两入口）
-> src/aggregator/aggregator-runtime.ts（runAggregatorStreaming 改 output）
-> src/provider/stream-forward.ts（passthroughStream 改 NodeJS.WritableStream + onEvent）
-> src/gateway/messages-handler.ts（承接 SSE header + hijack + 兜底 error 帧）
-> src/types/mom.ts（新增 Logger 接口）
-> docs/006API.md §2 §3（清单更新为已解耦形态）
-> 004CHANGELOG.md [2026-07-10-3]

---

## [ISS-008] Phase 3 触发粒度 + Fanout 缓存 + Cache 装饰 + 成本分账 + Trace 落盘尚未实现

**状态**：[已解决]
**优先级**：[P0 致命]
**类型**：[功能异常]
**发现日期**：2026-07-10
**解决日期**：2026-07-10
**解决方案**：按 PLAN.md Phase 3 与 decisions/005 落地，新增 `src/orchestrator/trigger.ts` / `src/cache/*` / `src/cost/pricing.ts` / `src/storage/traces.ts`；扩展 `src/gateway/sse.ts` 增量分帧器；重写 `src/orchestrator/orchestrator.ts` 为 `createOrchestrator` 工厂 + 两入口，主链路"cache key → cache.get → miss 补跑 → cost → trace"，透传路径也写 `mom_off` trace；`applyAdvisorCacheControl` 在 advisor 请求前按 system_and_3 布局 4 个 `cache_control` marker。ISS-007 同步顺手解决。39 例新单测 + e2e 6 条 curl 验证 5 种 trigger_reason（含关键 `tool_iteration_cache_miss` 降级修复路径）与 μUSD 级成本分账。

**现象**：
Phase 2 完成后主链路已跑通，但 `fanout_mode` / `cache` / `pricing_table` / trace 落盘 4 个 Phase 3 目标字段悬空；PLAN Phase 3 章节已经收敛（初稿的 shouldFanout 决策问题已在 ISS-006 与 decisions/005 中解决）。

**后果**：
- 无 cache → 每次 tool iteration 都全量重跑 advisor（Anthropic prompt caching 未开启则代价放大 3-4×）
- 无 trace → Dashboard（Phase 4-5）无法展示效果
- 无成本分账 → `pricing_table` 配置无意义
- ISS-007 的 3 处 Fastify 耦合还挂着 → SDK 复用路径卡住

**初步判断**：
已确认，属于计划性交付。宏观架构问题已在 ISS-006 与 decisions/005 中解决，本 issue 只覆盖执行落地。

**关联**：
-> src/orchestrator/trigger.ts（新增）
-> src/orchestrator/orchestrator.ts（重写）
-> src/orchestrator/fanout.ts（新增 fanoutAdvisorsWithCache）
-> src/cache/cache-key.ts / fanout-cache.ts / cache-decorator.ts（新增）
-> src/cost/pricing.ts（新增）
-> src/storage/traces.ts（新增）
-> src/gateway/sse.ts（新增 createSSEParser）
-> src/gateway/messages-handler.ts（拆分 non-streaming/streaming）
-> src/provider/stream-forward.ts（改 NodeJS.WritableStream + onEvent）
-> src/aggregator/aggregator-runtime.ts（runAggregatorStreaming 改 output）
-> src/advisor/advisor-runtime.ts（接入 cache-decorator）
-> src/types/mom.ts（新增 TriggerReason / Logger）
-> test/{trigger,cache-key,fanout-cache,cache-decorator,pricing}.test.ts（新增）
-> decisions/005-trigger-cache-decoupling.md
-> 004CHANGELOG.md [2026-07-10-3]

---

## [ISS-009] Trace 落盘 schema 从"入口聚合"重构为"每次上游调用一条"

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[技术债]
**发现日期**：2026-07-11
**解决日期**：2026-07-11
**解决方案**：一条 TraceRequest = 一次网关→provider 上游调用；14 列新 schema + 3 索引；orchestrator 每次上游落盘；pricing 请求时深拷贝冻结。

**现象**：
当前 Phase 3 落地的 `Trace` 类型（`src/types/mom.ts:115-130`）与 `traces` 表 schema（`src/storage/db.ts:3-15`）是"以一次入口 HTTP 请求为单位的一条聚合记录"——把 MoM `always` 模式下的 N 个 advisor + 1 个 aggregator 压成一条 trace 里的 `advisor_results: AdvisorResult[]` + `aggregator_result: AggregatorResult` 嵌套结构。缺失关键字段：
1. `session_id`（eval 侧关联键，来自 `X-Session-ID` header）
2. `started_at` / `finished_at` / `duration_ms`（上游调用级时间戳，当前只有入口聚合 `timestamp` + `total_latency_ms`）
3. `client_model` / `selected_model`（客户端指定 vs 实际转发到 provider 的模型区分）
4. `pricing`（请求时冻结的单价快照，当前 `total_cost_usd` 现算，pricing_table 变化后历史不可复现）
5. `provider`（provider host 标识）
6. `role`（`advisor` / `aggregator` / `passthrough`，SQL 层可查）
7. `gateway_request_id`（同一入口请求的 N+1 条上游调用关联键）

**后果**：
1. **eval 对接受阻**：需求文档要求的 `GET /trace/requests?session_id=<uuid>` 依赖 `session_id` 列 + 上游级明细，当前 schema 全部缺失
2. **成本不可复现**：`pricing_table` 变动后所有历史 trace 的成本随之漂移，违反需求文档"价格随请求冻结"约束
3. **advisor 明细不可 SQL 查询**：`advisor_results` 是 JSON 数组嵌套在 `data` 列，dashboard / eval 侧要重复解 JSON 才能算"某个 slot 花了多少钱"
4. **Phase 4 dashboard-api 迁移成本**：Phase 4 一旦按当前 schema 开工，后期改起来撕开更多

**初步判断**：
已确认。粒度错配是根因：Phase 3 落盘用"一次入口 HTTP = 一条 trace"，与需求文档"一次 HTTP 调用（上游）= 一条 TraceRequest"粒度不同。方案讨论已收敛，见 decision 006。

**方案讨论**：（已收敛，详见 decisions/006）
方案 A：一条 trace = 一次入口 HTTP，加 session_id 列即可 — 否定：永久丢失 advisor 级明细
方案 B：入口 envelope + 上游 upstream 都落 — 否定：违反"一次 = 一条"需求文档约束
方案 C（**采纳**）：一条 TraceRequest = 一次网关→provider 上游调用；N+1 条共享 `session_id` + `gateway_request_id`；旧 schema 直接切换不双列并存

**关联**：
-> src/types/mom.ts（Trace 类型重构 → TraceRequest；AdvisorResult / AggregatorResult 保留供内存流转，但不再是 Trace 顶级字段）
-> src/storage/db.ts（SCHEMA 重写：新增 session_id / gateway_request_id / started_at / finished_at / duration_ms / role / client_model / selected_model / status 列，`session_id` 加索引）
-> src/storage/traces.ts（saveTrace 签名改 saveTraceRequest；新增 getTraceRequestsBySessionId）
-> src/orchestrator/orchestrator.ts（每次 provider 调用落一条；透传路径落一条；不再有 persistMoMTrace 聚合逻辑）
-> src/orchestrator/fanout.ts（advisor 侧要能上报 started_at / finished_at + selected_model + status，扩 AdvisorResult 或者返回一个上游 trace payload）
-> src/aggregator/aggregator-runtime.ts（aggregator 侧同上）
-> src/cost/pricing.ts（新增 snapshotPricing(model, pricingTable): PricingSnapshot | null）
-> test/trace-request.test.ts（新增）
-> decisions/006-eval-trace-request-api.md
-> 004CHANGELOG.md [2026-07-11-1]

---

## [ISS-010] pricing_table 手工维护不可持续，需从 provider `/v1/models` 自动同步

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-11
**解决日期**：2026-07-11
**解决方案**：新增 `scripts/sync-pricing.mjs` 一次性运维脚本从 provider `/v1/models` 灌 `pricing_table`；`ModelPricing` 加 `currency` 字段、`PricingSnapshot.currency` 从字面量拓宽为 string（币种从数据源带出，网关不假设）；顺手删除 `TraceRequest.cost_usd` / `Metrics.total_cost_usd` / `Metrics.baseline_cost_usd` 字段与 `traces.cost_usd` DB 列——回归 eval 需求文档"eval 负责聚合"原则，成本由消费方用 `pricing × usage` 现算。

**现象**：
`data/mom.config.json.pricing_table` 目前为空，每次新增 advisor slot 或换 aggregator 模型都要人肉查 provider 定价填字段，否则 `src/cost/pricing.ts` 打 `event=pricing_missing` warn、trace 的 `pricing` 快照为 null（ISS-009 重构后每条 TraceRequest 内嵌 pricing / cost，eval 侧算不出成本）。已确认当前 provider `apiproxy.paigod.work/v1/models` 响应里带 `price.{input_price, output_price, cached_price}`（per-token 数值），可用作数据源。**实测数字量级为 CNY**（如 `deepseek/deepseek-v4-flash` input=¥1/M tokens、`zai-org/glm-5.2` input=¥8/M tokens 均与国产模型官方人民币档一致）；`/v1/models` 响应本身**不带 currency 字段**——币种是数据源的隐性属性，需要脚本侧显式声明并回填进 `ModelPricing`，让 orchestrator 冻结成 `PricingSnapshot.currency`。

**后果**：
- 成本分账在无 pricing 时静默降级为 0；ISS-009 交付的 `/trace/requests` 接口对 eval 侧价值受损（pricing 快照全 null，无法算成本）
- 新加模型时容易忘记补 pricing 字段
- 人工填价无法覆盖"provider 侧价格变动"场景

**初步判断**：
已确认——provider `/v1/models` 明确暴露价格字段；结构在不同 provider 间可能不同，同步器需要处理"字段命名 / 单位换算 / 缺失字段 / 币种标注"四类差异。

**方案讨论**：
- 方案 A：一次性运维脚本 `scripts/sync-pricing.mjs`，手动执行拉取并写入 `data/mom.config.json`
- 方案 B：网关启动时可选自动同步（`sync_pricing_on_boot: true`），只补齐缺失项、不覆盖手改
- 方案 C：Phase 4 dashboard-api 暴露 `POST /api/pricing/sync`，前端 SettingsPage 加"同步价格"按钮
- 边界约束（**已由 decision 006 定死**）：pricing 冻结点是请求时深拷贝 `momConfig.pricing_table[selected_model]`。同步器只负责把 provider `/v1/models` 的价格落到 `data/mom.config.json.pricing_table`，orchestrator 读取路径不变

**最终选择**：
- **方案 A（一次性脚本）**——B 会把网关启动路径与 provider 可用性绑死，还要新增顶层配置字段；C 依赖 Phase 4 未开工的 dashboard-api。价格变化频率极低，手动跑一次脚本是正确的操作频率。
- 顺手改造 pricing 的币种表达：`ModelPricing` 加 `currency: string`（币种是数据源属性，跟随每个 model 走）；`PricingSnapshot.currency` 从字面量 `'USD'` 拓宽为 `string`，由 `snapshotPricing` 从 `ModelPricing.currency` 忠实带出。回归 eval 需求文档"gateway 是观察的唯一真相源"原则：网关不假设币种，只如实回显 provider 的单位。
- 顺手删掉 `TraceRequest.cost_usd` / `Metrics.total_cost_usd` / `Metrics.baseline_cost_usd`：eval 需求文档从未要求 `cost_usd`，decision 006 里是"贴心服务"、且字段名硬编码币种在多币种场景下会撒谎；`SUM(pricing × usage)` 由 eval / dashboard 层现算，符合"eval 负责聚合"原则；DB 层 `traces.cost_usd` 列一同删除，本地 `mom.db` 只有测试数据，直接重建，无迁移。
- 脚本行为：`--currency <str>`（默认 `CNY`）+ 默认只补齐缺失项 / `--overwrite` 覆盖 / `--dry-run` 打印 / 未知 model 跳过报警；`cache_write` 按 Anthropic 惯例 `input × 1.25` 估算（provider `/v1/models` 无此字段）。

**关联**：
-> data/mom.config.json（pricing_table 字段）
-> scripts/sync-pricing.mjs（新增；一次性同步脚本）
-> src/cost/pricing.ts（消费方；ISS-009 后新增 snapshotPricing 供 orchestrator 冻结）
-> src/types/mom.ts（ModelPricing 加 currency；PricingSnapshot.currency 拓宽为 string；TraceRequest.cost_usd 删除；Metrics.total_cost_usd / baseline_cost_usd 删除）
-> src/storage/db.ts（traces 表删除 cost_usd 列）
-> src/storage/traces.ts（INSERT / row 组装同步）
-> src/orchestrator/orchestrator.ts（三处 cost_usd 写入删除）
-> docs/006API.md（TraceRequest 契约同步：pricing.currency 从 provider 数据源带出、删除 cost_usd 示例）
-> decisions/006-eval-trace-request-api.md §不在本期范围 项 1（本 issue 交付即闭环）
-> decisions/006-eval-trace-request-api.md §不在本期范围 项 4（本 issue 顺手将 currency 从字面量拓宽为跟数据源）
-> PLAN.md（Phase 3 §6 "pricing 热更"，Phase 5 SettingsPage pricing_table 编辑器）
-> 004CHANGELOG.md [2026-07-11-3]

---

## [ISS-011] Eval 对接接口 `GET /trace/requests?session_id=<uuid>` 尚未实现

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-11
**解决日期**：2026-07-11
**解决方案**：新增 `src/gateway/trace-api.ts` 挂载 `GET /trace/requests`；UUID 校验 + 空数组 200 + 错误路径 400/500；messages-handler 提取 `X-Session-ID` header 传入 orchestrator。

**现象**：
Eval / Dashboard 侧对接需求文档（2026-07-10）要求：
```
GET /trace/requests?session_id=<uuid>
→ { session_id, requests: TraceRequest[] }   // 按 started_at 升序；空数组不是 404
```
当前网关只有 `POST /v1/messages` / `GET /healthz` / `GET /dashboard/*` 三条路由（见 `docs/006API.md §1.1`），无 `/trace/*` 命名空间。

**后果**：
- Eval 侧无法查询任务级 trace 明细，成本 / cache 命中 / 模型分布聚合完全阻塞
- 需求文档已提出，交付延后会影响 eval 侧联调节奏

**初步判断**：
已确认，属于计划性交付。Schema 与响应格式已在 decision 006 定死。

**方案讨论**：（已收敛，详见 decisions/006）
- 路径独立命名空间 `/trace/*`（与 Phase 4 `/api/*` 并行不合并）
- `session_id` 只信 header `X-Session-ID`，缺失即 `null`；接口查询时若 `session_id = null` 不能被查出
- 空数组返回 200，非 404（eval 侧可能查到还没落盘的 session）
- `session_id` 非 UUID 格式或缺失 → 400 `invalid_request_error`

**关联**：
-> src/gateway/trace-api.ts（新增；registerTraceAPI(server, deps)）
-> src/gateway/server.ts（挂载 /trace/requests）
-> src/storage/traces.ts（新增 getTraceRequestsBySessionId）
-> src/gateway/messages-handler.ts（读取 X-Session-ID header 并传入 orchestrator）
-> src/orchestrator/orchestrator.ts（接受 sessionId 参数，落盘 TraceRequest.session_id）
-> test/trace-api.test.ts（新增）
-> decisions/006-eval-trace-request-api.md
-> docs/006API.md（新增 §1.4 /trace/* 命名空间）
-> 004CHANGELOG.md [2026-07-11-1]

---

## [ISS-012] Trace 错误路径观察不完整（passthrough 流式吞错 / http_status 丢失 / pricing source 缺 mtime / UUID 正则拒 v7）

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-11
**解决日期**：2026-07-11

**现象**：
ISS-009/011 交付后的二次核查发现 4 处偏离 decision 006 与 eval 需求文档"gateway 是观察的唯一真相源"承诺：
1. **passthrough streaming 遇 provider 非 2xx 时 trace 错记 `status='success'`**：`src/provider/stream-forward.ts` 遇 502/429 时写 SSE `error` 帧后直接 `return`（不抛），`src/orchestrator/orchestrator.ts:runPassthroughStreaming` 的 try/catch 判断 `streamError=null` → 落 `status='success' / error=null`；non-streaming 分支对称抛 `ProviderError` 落 `status='error'`，两侧不对称
2. **aggregator streaming 遇 provider 非 2xx 时 error.message 丢失**：与 (1) 同根，最终仅落 "aggregator produced no response"，真实 `provider 502: <body>` 内容被 stream-forward 吞掉
3. **advisor / aggregator 路径 `TraceError.http_status` 恒为 null**：orchestrator persist* 硬编码 `http_status: null`；`AdvisorResult.error` / `AggregatorResult.error` 是 `string` 而非结构化 `TraceError`；provider_client 的 `statusCode` 被拼进 message 后丢弃。passthrough 路径通过 `toTraceError` 正确保留了 statusCode，三条路径处理不一致
4. **UUID 校验正则拒绝 v6/v7/NIL**：`src/gateway/trace-api.ts` 正则 `[1-5]` 只放 RFC 4122 v1–v5，eval 侧若采用 UUIDv7（timestamp-ordered，越来越常见）或 NIL UUID 直接 400。decision 006 只说"UUID 格式"，未强制版本
5. **`pricing.source` 缺 mtime**：decision 006 §"TraceRequest.pricing 字段结构"明确 `"mom.config.json@<mtime iso>"`，实现是 `PRICING_SOURCE = 'mom.config.json'` 常量，事后无法定位历史 trace 用的是哪一版 pricing_table

**后果**：
- (1)(2)：eval 侧对 stream 请求的失败观察不到，成本 / 可用性统计与真实运行发散
- (3)：eval 侧需要区分 provider 4xx（客户端问题）vs 5xx（provider 问题），当前全部靠 grep message
- (4)：eval / dashboard 若采用 UUIDv7 无法查询
- (5)：pricing_table 变动后无法定位漂移点，可审计性打折（数值仍冻结）

**初步判断**：
已确认。根因是 stream-forward 把"写 SSE 错误帧给客户端"与"给 orchestrator 报错"两件事绑到一个 return 上，把它们解耦即修。(3) 是本次落盘代码没接住 provider_client 已提供的 statusCode。(4)(5) 是实现走样。

**解决方案**：
- 重构 `src/provider/stream-forward.ts`：非 2xx 与网络错误都抛 `ProviderError` / 原始 `Error`；SSE `error` 帧作为副作用先写再抛（客户端仍收到规范帧）
- 提升 `toTraceError(err, fallbackType)` 到 `src/provider/provider-client.ts` 供 advisor / aggregator / passthrough / stream-forward 四条路径共用；从 `ProviderError` 抽 `statusCode` 到 `TraceError.http_status`
- `AdvisorResult.error` / `AggregatorResult.error` 由 `string` 改为 `TraceError | null`；orchestrator persist* 直接透传
- `TraceError.type` 由 `string` 收窄为 union `'provider_error' | 'gateway_error' | 'advisor_error' | 'aggregator_error'`
- `src/gateway/trace-api.ts` UUID 正则放宽为 hex-only `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
- `RuntimeConfig.mom_config_source` 新增；`src/config.ts:stampMoMConfigSource(path)` 读 mtime 拼 `mom.config.json@<iso>`；orchestrator 用 `runtime.mom_config_source` 替代常量
- 回归测试新增 14 例：stream-forward 502 抛错 / advisor 502 http_status 保留 / UUIDv7/v6/NIL 接受 / stampMoMConfigSource mtime

**关联**：
-> src/provider/stream-forward.ts / src/provider/provider-client.ts
-> src/advisor/advisor-runtime.ts / src/aggregator/aggregator-runtime.ts / src/orchestrator/orchestrator.ts
-> src/gateway/trace-api.ts
-> src/config.ts / src/types/mom.ts（RuntimeConfig.mom_config_source / TraceErrorType）
-> src/cache/fanout-cache.ts（cloneAsCacheHit 适配 error: TraceError | null）
-> test/{stream-forward-error,advisor-error,trace-api-uuid,config-source}.test.ts（新增）
-> 004CHANGELOG.md [2026-07-11-2]

---

## [ISS-013] `TraceRequest.settings_snapshot: MoMConfig` 冗余，每条上游调用重复整份深拷贝

**状态**：[发现]
**优先级**：[P3 轻微]
**类型**：[技术债]
**发现日期**：2026-07-11

**现象**：
`src/types/mom.ts:TraceRequest.settings_snapshot: MoMConfig` 是 Phase 3 遗留字段。ISS-009 起 `pricing` 已从 `settings_snapshot` 拆出为顶层字段 + 请求时冻结快照，`settings_snapshot` 保留在每条 TraceRequest 里显得冗余：一次 `always` 请求写 N+1 条，每条都携带完整 `pricing_table` / `advisor.slots` / `aggregator.model` 副本。eval 需求文档没要 `settings_snapshot`；decision 006 §"JSON payload"字段清单也不包含它。

**后果**：
- 存储浪费：一次 4-advisor 请求 5 条 trace × MoMConfig 深拷贝（~1KB）≈ 5KB，其中 4KB 是重复
- `data` 列膨胀，`SELECT data FROM traces WHERE session_id=?` 的 IO 增大
- 概念上 eval 侧读一条 trace 时看到 `settings_snapshot` 会误以为它是"该请求专用配置"而非"全局配置副本"

**初步判断**：
已确认。属 Phase 3 遗留而非本次交付新增；无消费方（Phase 4-5 dashboard 尚未开工），可安全删除或降级。

**方案讨论**：（待定）
- 方案 A：完全删除 `settings_snapshot` 字段（eval 侧完全靠 pricing / usage / trigger_reason 反演；audit 需求交给 git log of mom.config.json）
- 方案 B：只在 `gateway_request_id` 首条 trace 保留 settings_snapshot，其余为 null（信息完整但不重复）
- 方案 C：抽出独立表 `gateway_requests`（保留 audit 但脱离行内）
- 当前倾向：方案 A —— pricing_snapshot 已经覆盖成本可复现需求，settings 的其他字段（fanout_mode / aggregation_mode）价值不大

**关联**：
-> src/types/mom.ts:TraceRequest.settings_snapshot
-> src/orchestrator/orchestrator.ts（persist* 每条 structuredClone(mom)）
-> src/storage/traces.ts（saveTraceRequest 的 data 列膨胀）
-> data/mom.config.json（配置版本追溯的替代方案）

---

## [ISS-014] `saveTraceRequest` 每次 INSERT 都重新 `prepare` statement，未缓存

**状态**：[发现]
**优先级**：[P3 轻微]
**类型**：[技术债]
**发现日期**：2026-07-11

**现象**：
`src/storage/traces.ts:saveTraceRequest` 每条 INSERT 都调用 `db().prepare(...)`。ISS-009 后 MoM `always` 模式一次入口请求 N+1 次 prepare，Phase 4 metrics rps 上来后可能成为瓶颈。

**后果**：
- 单机 MVP <10 rps 无感
- Phase 4 dashboard-api 上线后如果引入 baseline / comparison 会翻倍写入
- `getTraceRequestsBySessionId` / `getTraceRequestById` / `getRecentTraceRequests` 同样问题

**初步判断**：
已确认。node:sqlite `DatabaseSync.prepare()` 缓存 statement 是零风险改动，可等观测到瓶颈再动。

**关联**：
-> src/storage/traces.ts

---

> **编号说明**:PR #11 (worktree-eval-trace-api) 已占用 ISS-015..020,与 main 合并后届时会同步过来。本轮 (cache-off + thinking normalize 测试) 从 ISS-021 起,避免冲突。

---
## [ISS-015] 缓存复用会把上一轮失败的 advisor `TraceError` 沿着 cache_hit 一路带过来

**状态**：[发现]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-12

**现象**：
`src/orchestrator/fanout.ts:fanoutAdvisorsWithCache` 无差别地把 `fanoutAdvisors` 的返回值 `cache.set(key, results)`——包含 `success=false / error=<TraceError>` 的失败 slot 也进了缓存。下一次 tool iteration 命中 cache 后，`cloneAsCacheHit` 只把 `usage/latency_ms` 归零、`cache_hit=true`，其余字段（`success/error/reference`）原样复制。落盘时 `persistAdvisorTraces` 走：
```
status = r.cache_hit ? 'cache_hit' : r.success ? 'success' : 'error'
```
因此 R1 中 502 失败的 slot 到 R2 变成 `status='cache_hit'` **同时** `error: { type: 'provider_error', http_status: 502, ... }` 非空——这两个字段语义相互矛盾，违反 006API.md §1.4 契约"`error` 仅在 `status='error'` 时填"。

实测证据（探针 test 输出，MVP 主链路 R1+R2）：
```
role=advisor slot=adv-fail status=error     cache_hit=false err=provider_error   # R1
role=advisor slot=adv-ok   status=success   cache_hit=false err=-                # R1
role=aggregator            status=success   cache_hit=false                      # R1
role=aggregator            status=success   cache_hit=false                      # R2
role=advisor slot=adv-ok   status=cache_hit cache_hit=true  err=-                # R2
role=advisor slot=adv-fail status=cache_hit cache_hit=true  err=provider_error   # R2 ← 冲突！
```

**后果**：
1. **契约违反**：eval 侧 `WHERE status='cache_hit'` 期望 `error IS NULL` 的行；如果按 006API.md 编排 SQL 会遇到反常规矛盾行
2. **eval 端故障率被低估**：eval 若基于 `WHERE status='error'` 统计 provider 故障率，只会看到 R1 那一条 error trace，看不到 R2+ 由缓存复用带下去的失败——一次 502 会在 5 分钟 TTL 内持续被"复述"为 cache_hit 但未被计入故障率
3. **aggregator 质量降级不可观察**：一旦 R1 有 slot 失败，R2+ 每次 tool iteration 复用缓存时 aggregator 拿到的 references 里都有 `[Reference N — <slot> failed: ...]` 占位符——不是错，但用户没有告警窗口

**初步判断**：
已确认。两个正交问题合成一个后果：
- (a) `fanoutAdvisorsWithCache` 应过滤"包含 error 的 result 集"或至少不缓存失败结果
- (b) `cloneAsCacheHit` 复用时应显式清空 `error` 字段（若坚持缓存），或在 orchestrator 层的 `persistAdvisorTraces` 分支 `status='cache_hit'` 时强制 `error=null`

**方案讨论**：（待定）
- 方案 A：不缓存"任一 slot 失败"的整批 fanout 结果——最保守，第二次进来必然重跑，失败 slot 恢复后正常
- 方案 B：cache 只保留成功 slot 的 result，失败 slot 每次 iteration 都补跑（部分缓存）
- 方案 C：cloneAsCacheHit 时清 error+status 归 'cache_hit'，落盘契约保持一致；语义上把失败 slot 的失败降级为"我们记得它失败过、但不再重试"——对可用性不友好
- 当前倾向：方案 A，最简单且契约干净；进程重启时的 TTL 抖动本来已经会补跑，多一层"失败也补跑"不额外增加复杂度

**关联**：
-> src/orchestrator/fanout.ts:fanoutAdvisorsWithCache
-> src/cache/fanout-cache.ts:cloneAsCacheHit
-> src/orchestrator/orchestrator.ts:persistAdvisorTraces
-> test/orchestrator-cost.test.ts / orchestrator-cost-edge.test.ts（新增的探针路径展示此 bug）
-> docs/006API.md §1.4（契约声明 `error` 仅在 `status='error'` 时填）

---

## [ISS-016] `buildConcatReferences` 把 `TraceError` 对象直接模板字符串化,输出 `[object Object]`

**状态**：[发现]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-12

**现象**：
ISS-012 起 `AdvisorResult.error` 从 `string` 收窄为 `TraceError | null` 结构化对象。但 `src/aggregator/reference-builder.ts:buildConcatReferences` 未同步更新:
```ts
if (!r.success) {
  return `${label} failed: ${r.error ?? 'unknown error'}]`;
}
```
`r.error` 现在是 `{ type, message, http_status }` 对象，模板字符串会调用 `toString()` → `[object Object]`。

实测证据（探针 test 输出，R1 失败 slot）:
```
[Reference 1 — adv-fail failed: [object Object]]
[Reference 2 — adv-ok]
analysis-body-adv-ok
```
预期应该是可读的 `provider_error: <http_status>: <message>`。

**后果**：
1. **aggregator 侧输入退化**：aggregator 收到 `[Reference 1 — adv-fail failed: [object Object]]` 无法从中提取"哪个 provider、什么错误、状态码"，不能用作 debug 信号
2. **通过 ISS-015 恶化**：R2+ tool iteration cache hit 复用后，`[object Object]` 占位符持续被写到 aggregator 请求里，一次事故永久污染 5 分钟 TTL 内的所有 aggregator 请求
3. **契约类型漂移隐蔽**：TypeScript 编译期没有捕获——`TraceError` 是 object，`?? 'unknown error'` 分支只有在 error 严格为 null/undefined 时才走 fallback

**初步判断**：
已确认。根因是 ISS-012 收窄 `error` 类型时，reference-builder 未随之更新为提取 `message` / `http_status`。

**方案讨论**：（待定）
- 方案 A：`buildConcatReferences` 里改为读 `r.error?.message ?? 'unknown error'`——最小修，仍保留 http_status 到 log/trace 层
- 方案 B：拼一个 `<type> (<http_status>): <message>` 的可读结构——更多信息，但会让 aggregator 视野变复杂
- 当前倾向：方案 A（保守可读）

**关联**：
-> src/aggregator/reference-builder.ts:23（`r.error ?? 'unknown error'`）
-> src/types/mom.ts:TraceError（结构化定义）
-> decisions/006（ISS-012 修改 error 类型的 decision 未 grep 到 reference-builder）
-> test/reference-builder.test.ts（现有单测未覆盖失败 slot 的实际 error 对象）

---

## [ISS-017] `TraceRequest.request_summary.tool_use_count` 把 tool_use 与 tool_result 都算作"tool_use",eval 无法区分

**状态**：[发现]
**优先级**：[P3 轻微]
**类型**：[功能异常]
**发现日期**：2026-07-12

**现象**：
`src/orchestrator/orchestrator.ts:countToolUseBlocks` 同时把 `tool_use`（assistant 发起）与 `tool_result`（user 回填）都计入 `tool_use_count`：
```ts
if (b.type === 'tool_use' || b.type === 'tool_result') n++;
```
006API.md §1.4 里 `tool_use_count` 语义模糊（既不写"含 tool_result"也不排除）；实际 eval 侧读到"这轮请求含 5 个 tool_use"时通常理解为"agent 发起了 5 次工具调用"，而不是"3 次调用+2 次结果"。

**后果**：
- eval 侧统计 tool 交互深度会翻倍
- 若客户端 messages 里 tool_use 与 tool_result 数量不对称（例如末尾 tool_use 尚未回填），计数会与直觉不符
- 影响面小，因为该字段目前无消费方；但一旦 dashboard/eval pipeline 开始展示"平均 tool 深度"就会误导

**初步判断**：
已确认。属实现走样：文档命名是 `tool_use_count`，实现却混合两种事件类型。

**方案讨论**：（待定）
- 方案 A：只计 `tool_use`，`tool_result` 单独出一个 `tool_result_count` 字段
- 方案 B：`request_summary` 加一个 `tool_result_count` 但 tool_use_count 保持只算 tool_use（更精确、字段兼容性变化）
- 方案 C：文档反过来接受当前实现语义为"tool 相关 block 总数"，重命名字段
- 当前倾向：方案 A（字段清晰，语义与命名严格一致；trace 落盘量增加可忽略）

**关联**：
-> src/orchestrator/orchestrator.ts:countToolUseBlocks
-> src/types/mom.ts:RequestSummary
-> docs/006API.md §1.4（`tool_use_count` 语义补充定义）

---

## [ISS-018] `TraceRequest.pricing.reasoning_per_million` 与 `TraceUsage.reasoning_tokens` 双向硬编码为 null / 0,provider 若上报 reasoning 无路径接入

**状态**：[发现]
**优先级**：[P3 轻微]
**类型**：[技术债]
**发现日期**：2026-07-12

**现象**：
- `src/cost/pricing.ts:snapshotPricing` 一律把 `reasoning_per_million: null` 硬编码，忽略 `ModelPricing` 字段
- `src/cost/pricing.ts:toTraceUsage` 一律把 `reasoning_tokens: 0` 硬编码，忽略 provider 上报字段
- `src/types/mom.ts:Usage` 里也没有 `reasoning_output_tokens` 字段（Anthropic 官方也不区分——但部分兼容 provider 如 OpenAI o1 系列会额外报出 `reasoning_tokens`）

Reference: docs/006API.md §1.4 里 `reasoning_tokens` / `reasoning_per_million` 均标注"上游若不报则 0/null"，暗示了未来支持接入的可能性——但当前实现是**硬编码封死**，即使 provider 上报也读不进来。

**后果**：
- MVP 单 provider（Anthropic 兼容）场景无实际影响
- 未来若 provider 侧 `/v1/models` 暴露 reasoning 价格，或 provider 上报 usage 里含 `reasoning_output_tokens`，都需要三处联动修改
- 冻结 Pricing schema 时未对齐 usage schema，语义上"pricing 字段存在但 usage 永远为 0"给 eval 一种"这里能计价"的错觉

**初步判断**：
已确认。属于 Phase 3 硬编码，无 upstream 数据源，属于计划性预留。当前无消费方，属"约定性字段"，暂无实质 bug；但 eval 侧看到 pricing 字段时可能会以为已支持。

**方案讨论**：（待定）
- 方案 A：文档里显式声明"reasoning 字段是预留、当前始终为 0/null"（改文档不改代码）
- 方案 B：`snapshotPricing` 从 `ModelPricing` 读 reasoning 价（要扩 ModelPricing 类型 + pricing_table 数据源）；`toTraceUsage` 从 Anthropic Usage 扩展字段读——但 `Usage` 类型也没有该字段
- 当前倾向：方案 A（保持"未来 provider 支持时统一改"）

**关联**：
-> src/cost/pricing.ts:snapshotPricing / toTraceUsage
-> src/types/mom.ts:PricingSnapshot / TraceUsage / Usage / ModelPricing
-> docs/006API.md §1.4（补充"reasoning 字段为预留"说明）

---

## [ISS-019] `snapshotPricing` 语义不一致:advisor cache_hit 时跳过 pricing 快照(记 null),导致 eval 反演单价失败

**状态**：[发现]
**优先级**：[P2 一般]
**类型**：[功能异常]
**发现日期**：2026-07-12

**现象**：
`src/orchestrator/orchestrator.ts:persistAdvisorTraces` 里有个"cache_hit 时不 warn 但仍 snapshot pricing"的分支：
```ts
const pricing = snapshotPricing(r.selected_model, mom.pricing_table, pricingSource);
if (!pricing && !r.cache_hit) {
  log.warn({event:'pricing_missing', ...})
}
```
逻辑正确：cache_hit 时也会尝试 `snapshotPricing`，pricing_table 命中就返回 snapshot。

**但**：`persistPassthroughTrace` 里 pricing_table 未命中时 `pricing = null`；跨路径行为一致但 006API.md §"pricing 请求时冻结"暗含"pricing 快照与 usage 独立"——目前实现是"pricing_table 无该 model → pricing=null → cost=0"是一致的（`calculateCostFromSnapshot(usage, null) = 0`）。**这不是 bug**，但……

**真正的问题**：当 `pricing_table` 里包含某 model 但 usage 全 0（cache_hit 或异常）时，pricing 快照被保留 → eval 侧能反演单价 ✓；当 `pricing_table` 里**不包含**某 model 且 cache_hit 时，pricing 快照为 null → eval 侧**既没法反演单价、也不知道成本是"该 slot 命中缓存"还是"没配 pricing"**。两种情况在 SQL 层用 `cost_usd=0` 区分不了。

实测通过 orchestrator-cost.test.ts 的 "cache hit → advisor traces status=cache_hit, usage=0, cost=0, but pricing snapshot preserved" 用例验证——**只有 pricing_table 已配置该 model 时** pricing 才被保留。

**后果**：
- eval 侧无法准确区分"该 slot 没配 pricing" vs "该 slot 命中缓存"这两种"cost=0"来源
- 影响面小（eval 侧一般会保证 pricing_table 齐全）；主要是可观察性完整度问题

**初步判断**：
已确认。属边界完整性问题：`status='cache_hit'` 已经是可观察信号，可能不需要额外冗余。

**方案讨论**：（待定）
- 方案 A：什么都不改，eval 侧用 `status='cache_hit'` 与 `pricing IS NULL` 组合判断——文档里显式说明该判断法（改文档）
- 方案 B：cache_hit 时始终保留 pricing 快照（若 pricing_table 缺失，保留一个 stub 结构说明"缺失"）——语义不干净
- 当前倾向：方案 A（属可观察性文档化，不改行为）

**关联**：
-> src/orchestrator/orchestrator.ts:persistAdvisorTraces（cache_hit 语义分支）
-> docs/006API.md §1.4（补充 cache_hit + pricing 组合判断说明）

---

## [ISS-020] `AdvisorResult` 通过 fanout cache 复用时`response_summary` 被强制 null,但 selected_model / cache_hit 时的其他字段可能对齐不精确

**状态**：[发现]
**优先级**：[P3 轻微]
**类型**：[技术债]
**发现日期**：2026-07-12

**现象**：
`src/cache/fanout-cache.ts:cloneAsCacheHit` 里对 `response_summary` 强制置 null:
```ts
response_summary: null,
```
这是"缓存命中并未真发上游、没有真实 response_summary"的正确语义。但同时:
- `started_at = finished_at = Date.now()`—— 缓存命中时时间戳被"重置"为当前时刻,这样导致同一 gateway_request_id 下 N+1 条 trace 的 started_at 分布很紧,不是问题
- `error` 字段原样保留(见 ISS-015)——需要清空

**后果**：
- 无直接功能问题;response_summary 的 null 语义正确
- 但如果未来引入"缓存命中时能反演出 R1 的原始 response id",dashboard/eval 就要挂另一个字段(`origin_request_id` / `origin_finished_at`)

**初步判断**：
已确认。属可观察性预留问题;主要作为 ISS-015 的关联记录。

**关联**：
-> src/cache/fanout-cache.ts:cloneAsCacheHit
-> 与 ISS-015 合并考虑


## [ISS-021] `passthroughStream` 主链路从"字节级 pipe"变为"parse → normalize → 重编码",破坏 001ARCHITECTURE 承诺

**状态**：[发现]
**优先级**：[P2 一般]
**类型**：[技术债]
**发现日期**：2026-07-12

**现象**：
`af33818 feat: add cache-off mode and normalize provider thinking` 重构了 `src/provider/stream-forward.ts:82-115` 的 `onData` 处理:
- 原实现:`output.write(chunk)` **先字节级转发**,onEvent 只是旁路观察(异常吞掉,不影响主链路)
- 新实现:所有 chunk 都过 `parser.push` → `JSON.parse` → `normalizer.normalize` → `formatSSEEvent` **重新编码** → `output.write`

这与 `docs/001ARCHITECTURE.md` §6 "Aggregator 字节级透传原则"的核心承诺冲突:"前缀所有 message 保持原对象引用不变,保证 Claude Code 侧 cache_control 前缀命中"——该原则暗含"provider 侧 SSE 帧的字节序在网关内不被改写"。

**后果**:
1. 客户端拿到的 SSE 字节流不再和 provider 侧字节等价(空格 / 换行 / JSON key 顺序等被 normalize 重编码)。虽然 Anthropic SDK 解析层无感,但一旦下游有对 raw bytes 敏感的中间件(如签名、指纹、审计校验),会翻车
2. `parser` 从"可选"变为"必需",即使调用方不需要 observer,依然要付 SSE parse + JSON.parse + JSON.stringify 三次开销
3. SSE parse 失败时(见 stream-forward.ts:94)fallback 到 `output.write(formatSSEEvent(raw.event, raw.data))`——`data` 是**已 trim 的字符串**,直接被当第二参给 formatSSEEvent 会输出 `data: <string>`,但原始 provider 帧可能是 multi-line data,信息会丢失
4. 无 chunk-boundary 相关问题(已通过 `test/stream-forward-chunking.test.ts` 4 例 1..4096 字节 chunk 验证,正确)

**初步判断**:
已确认。改动的**动机是对的**(不 normalize 的话没法过滤流式 thinking),但改动路径**过重**——把主链路"字节级透传"改成了"完全重编码"。这个 trade-off 未在 CHANGELOG / decisions 中显式记录。

**方案讨论**:(待定)
- 方案 A:接受当前实现,在 001ARCHITECTURE 里显式撤销"字节级"承诺,改述为"语义级 SSE 事件透传";并把 rationale 写进新 decision(建议路径)
- 方案 B:normalize 只作用于 "含 thinking" 的帧,其余走原字节级 pipe——需要 SSEParser 支持"透传未消费字节"或双缓冲
- 方案 C:回退到 byte-level pipe,失去流式 thinking 过滤能力
- 当前倾向:方案 A(承诺已经破坏,承认现实并写清)

**关联**:
-> src/provider/stream-forward.ts:82-115
-> src/provider/anthropic-normalize.ts(新增,af33818)
-> docs/001ARCHITECTURE.md §6 "Aggregator 字节级透传原则"(需修订或迁入 decision)
-> test/stream-forward-chunking.test.ts(本轮新增回归)

---

## [ISS-022] `content_block_delta`/`content_block_stop` 在**没有对应 start**的情况下 pass-through,违反 index 连续性

**状态**:[发现]
**优先级**:[P3 轻微]
**类型**:[功能异常]
**发现日期**:2026-07-12

**现象**:
`src/provider/anthropic-normalize.ts:66-70` 的实现:
```ts
const mappedIndex = indexMap.get(event.index);
if (mappedIndex === null) return null;
if (mappedIndex === undefined) return event;  // ← 未映射,直接原样透出
```
如果协议异常:provider 侧未发 `content_block_start(idx=5)` 就发了 `content_block_delta(idx=5)` —— normalizer 会**原样透出**,不重映射。在被前面 unsigned thinking drop 导致 remap 已经生效的场景里,idx=5 可能对应错误的下游 block。

**后果**:
- 正常 provider 不会这么发,理论异常;但破坏了 "normalizer 保证 index 连续" 的语义完整性
- 一旦上游 provider 有 bug / 网络乱序 / 中间件预处理不当,delta 会插在错的位置,客户端 SDK 拼字符串错乱

**初步判断**:
边缘情况,实测无法自然触发(要求 provider 侧协议违规)。属可观察性 hardening。

**方案讨论**:(待定)
- 方案 A:未见 start 的 delta/stop 直接 drop + log.warn(严格)
- 方案 B:保持当前 pass-through,只 log.warn(温和)
- 当前倾向:方案 B

**关联**:
-> src/provider/anthropic-normalize.ts:68

---

## [ISS-023] `af33818` 把 `selectSignatureMessages` 的 `per_iteration` 分支改为 `fanoutMode !== 'user_turn'` 全捕获,`off` 模式的 sigMessages 计算是无用工作

**状态**:[发现]
**优先级**:[P3 轻微]
**类型**:[技术债]
**发现日期**:2026-07-12

**现象**:
`src/cache/cache-key.ts:46` 的分支:
```ts
if (fanoutMode !== 'user_turn') return messages;
```
当 `fanout_mode='off'` 时,虽然 `orchestrator.ts:389` 的 `mom.fanout_mode === 'off' ? '' : computeFanoutCacheKey(...)` 已经短路——**根本不会调用 `computeFanoutCacheKey`**——但代码逻辑上让人误以为 `off` 会走"全 messages 签名"路径。语义冗余。

**后果**:
- 无功能影响(调用点已经短路)
- 代码可读性略降

**初步判断**:
已确认。改成 `=== 'per_iteration'` 语义更清晰。

**关联**:
-> src/cache/cache-key.ts:46
-> src/orchestrator/orchestrator.ts:389

---

## [ISS-024] `fanout_mode='off'` 时 `trigger_reason='fanout_cache_off'`,但 `isNewTurn` 计算依然进行 — 无用工作

**状态**:[发现]
**优先级**:[P3 轻微]
**类型**:[技术债]
**发现日期**:2026-07-12

**现象**:
`src/orchestrator/orchestrator.ts:388` 无条件计算 `isNewTurn = isNewUserTurn(body.messages)`,但当 `fanout_mode='off'` 时 `computeTriggerReason` 走首个分支 `return 'fanout_cache_off'` 忽略 `isNewTurn`。off 模式下 `isNewTurn` 依然被计算(遍历 messages),纯浪费。

**后果**:
无功能影响,微小性能浪费。

**方案讨论**:
可用 lazy evaluation 或分支避免:
```ts
const key = mom.fanout_mode === 'off' ? '' : computeFanoutCacheKey(body.messages, mom);
const isNewTurn = mom.fanout_mode === 'off' ? false : isNewUserTurn(body.messages);
```

**关联**:
-> src/orchestrator/orchestrator.ts:388

---

## [ISS-025] `stream-forward.ts` SSE parse 失败 fallback 只把 `raw.data`(已 trim)重编码,多行 data 帧丢失

**状态**:[发现]
**优先级**:[P3 轻微]
**类型**:[功能异常]
**发现日期**:2026-07-12

**现象**:
`src/provider/stream-forward.ts:94`:
```ts
} catch (err) {
  output.write(formatSSEEvent(raw.event, raw.data));
  log?.warn(...);
}
```
`raw.data` 是 SSEParser 已经将 multi-line `data:` 用 `\n` join 后的字符串,但 `formatSSEEvent(event, data)` 内部 `typeof data === 'string' ? data : JSON.stringify(data)` 会把 `raw.data` 原样写成 `data: <整段>\n\n`——如果原帧是 multi-line data,现在被压成单行,不符合 SSE 规范(客户端 SDK 会正确解析,因为读的还是 join 后的字符串,但字节序变了)。

**后果**:
- SSE parse 失败(JSON 破损)本身是异常路径,fallback 仅 warn + 尽量透传
- 边缘协议差异,不影响 happy path

**初步判断**:
边缘 hardening 项,与 ISS-021 关联(主链路重编码已经打破了字节等价)。

**关联**:
-> src/provider/stream-forward.ts:94
-> src/gateway/sse.ts:17 `formatSSEEvent` 语义

---

## [ISS-026] main 上无 `cost_usd` 字段,但 CHANGELOG / DEVELOPMENT.md 并未清扫早期示例

**状态**:[发现]
**优先级**:[P3 轻微]
**类型**:[技术债]
**发现日期**:2026-07-12

**现象**:
`af68b46 [ISS-010]` 已从 `TraceRequest` 类型、`traces` 表 schema、`src/orchestrator/orchestrator.ts:persistAdvisorTraces / persistAggregatorTrace / persistPassthroughTrace` 中删除 `cost_usd` 字段,并同步更新 `docs/006API.md`。但:

- `docs/005DEVELOPMENT.md` 内 `[2026-07-10-1]` 章节"成本分账(Phase 3 精算示例)"仍写 `total_cost_usd` 字段
- 数据库校验代码块仍是 `SELECT trigger_reason, mom_triggered, ROUND(total_cost_usd, 6) cost ...`——这段 SQL 现在会报"no such column: total_cost_usd"

**后果**:
- 新用户按 [2026-07-10-1] 步骤跑 V1..V6 验证,到"数据库校验"步会遇到 SQL 报错
- 与新 schema 契约不同步

**初步判断**:
文档同步遗漏,af68b46 提交时忘记扫这段。

**方案讨论**:
- 方案 A:把示例改成"现算 cost"(读 pricing 和 usage 做数学)
- 方案 B:直接删除该段(用户可能不关心 SQL 层)
- 当前倾向:方案 A(与 006API.md 新契约一致)

**关联**:
-> docs/005DEVELOPMENT.md `[2026-07-10-1]` 章节"数据库校验"与"成本分账"
-> docs/006API.md(已更新,作对照)
-> af68b46 commit

---

## [ISS-027] `docs/001ARCHITECTURE.md` §6 "Advisor cache_control 布局"未反映 `fanout_mode='off'` 分支

**状态**:[发现]
**优先级**:[P3 轻微]
**类型**:[技术债]
**发现日期**:2026-07-12

**现象**:
`docs/001ARCHITECTURE.md` §6 "Trigger 语义"依然只列 6 种 `trigger_reason` 枚举(mom_off / user_turn / skipped_tool_iteration / tool_iteration_cache_miss / per_iteration / fanout_cache_hit)。af33818 新增了第 7 种 `fanout_cache_off`,但架构文档未同步。

**后果**:
- Dashboard / eval 侧看到未知的 `fanout_cache_off` 标签,以为是数据污染

**初步判断**:
文档同步遗漏。

**关联**:
-> docs/001ARCHITECTURE.md §6 "Trigger 语义"
-> src/types/mom.ts:TriggerReason(新增枚举)
-> af33818 commit

---

## [ISS-028] Dashboard 前端从三层升级为五页（Overview / Live / Pipeline / Cost / Settings），出 mock 驱动的预览版并同步改写 PLAN Phase 5/6

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[规划调整]
**发现日期**：2026-07-12
**解决日期**：2026-07-13
**解决方案**：以 mock 数据先出前端预览版反推 API 契约（`web/src/mock/*.ts`），Phase 5 拆两阶段——5.0 预览版本次交付，5.1 待 Phase 4 API 到位后回填真实数据。Phase 6 改为"Judge 模式 + Baseline 后端接入"，UI 已在 5.0 完成。全栈落地五页 + 双语 i18n（自研 `dict + useI18n`，不引 i18next）；图表统一走 Recharts；视觉语言以 `web/src/theme.ts` 常量为准（奶油底 `#FAF9F5` + clay 主色 `#C96442` + 暖灰低饱和图表色带）。同步改写 PLAN.md 的概览表 / 依赖链 / 目录树 / Context 与 Phase 5/6 正文，使描述与代码一致。

**现象**：
PLAN 原 Phase 5 只写了三层（Settings / Traces / Metrics）+ Phase 6 的对比展示层，且都是 `📝 略写`。展会演示叙事（"用更便宜的组合逼近旗舰能力"）要求先看效果对比、再看现场证明、再讲原理、再看成本、最后配置——三层布局无法承载。Phase 4 Dashboard API 还没动，先出前端预览版反推 API 契约。

**后果**：
不处理会导致：（1）展会讲解找不到主轴，观众看不出 MoM 效果；（2）Phase 4 API schema 无参照，落地后要为 UI 反复调整；（3）双语切换未纳入规划，中文观众体验碎裂。

**初步判断**：
已确认。前端预览版已构建通过（`npm --prefix web run build` 已过），5 页 + 双语 + 主要动画（打字机 / pipeline 节点流转 / 图表 hover）可跑；全部走 `web/src/mock/*` 假数据。

**关联**：
-> PLAN.md Phase 5 / Phase 6（本次改写）
-> web/src/pages/{OverviewPage,LivePage,PipelinePage,CostPage,SettingsPage}.tsx
-> web/src/i18n/{dict.ts,context.tsx,format.ts}
-> web/src/components/charts/*
-> web/src/mock/*
-> decisions/007-dashboard-5-page-preview.md
-> 004CHANGELOG.md [2026-07-12-4]

---

## [ISS-029] Overview/Live 页视觉修订：Pareto legend 挡 x 轴、KPI 缺分数三卡、Live 缺跨 turn 动态排名图

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[体验]
**发现日期**：2026-07-13
**解决日期**：2026-07-13
**解决方案**：三处联动改动，全部走 mock，不影响后端/API。
1. **Pareto 图 legend/x 轴对齐** — `web/src/components/charts/ParetoChart.tsx`
   - X 轴标签改用 `insideBottom` + 负 offset 压回轴线上方，避免被 legend 顶掉；
   - 5 个非 MoM 模型（Fable 5 / GPT-5 / Sonnet 4.6 / Haiku 4.5 / Aggregator-only）拆成 5 个独立 `Scatter`，legend 列出全部名字；shape 分别是 circle / square / triangle / diamond / cross，MoM 保持 star；
   - Aggregator-only 走 `color.aggregatorOnly`（卡其），其余四个走 `color.flagship`（暖灰）—— 语义上 Aggregator-only 是我们内部 baseline，不是竞品旗舰；
   - Legend spacing（`paddingTop: 8` + `margin.bottom: 30`）与 ComboChart 对齐，不再离 x 轴过远。
2. **OverviewPage KPI 加分数三卡** — `web/src/pages/OverviewPage.tsx`
   - 顶部原有的三张卡（相对分 96% / 成本 −68% / 延迟 +1.2s）保留；
   - 新增第二排三张：Fable 5 (85.5) / MoM (82.4, clay 强调) / Aggregator-only (71.1)，分数直接读 `mock/benchmarks.ts` 的 `paretoData`，与 Pareto 图完全一致；
   - i18n 键新增 `overview.kpi.scoreMoM / scoreFable5 / scoreBaseline` 及其 hint，中英双语齐。
3. **LivePage 新增"动态排名"图** — `web/src/pages/LivePage.tsx` + `web/src/components/charts/RankingChart.tsx` + `web/src/mock/live-ranking.ts`
   - 位置：Judge 雷达 + 成本对比行之下的独立全宽卡片；
   - 数据：最近 10 turn 的 judge 相对排名（前 9 turn 为历史 mock，第 10 turn 跟 Prompt Shelf 选中的 preset 联动切换）；
   - 三条折线 MoM / Aggregator-only / Fable 5，跟 ComboChart 同色同 stroke 家族；Y 轴 `reversed`，tick 只 1/2/3（1 = 最好）；
   - Tooltip 显示这一轮的问题标题（中英切换）+ 三家排名；副标题点明"开放型问题绝对分不可比、用相对排名"这一叙事动机。
4. **ComboChart legend 拆两行** — `web/src/components/charts/ComboChart.tsx`
   - 自定义 `TwoRowLegend`：第一行三个 cost 项（柱色），第二行三个 score 项（线色）；
   - 底部 margin 30 → 40 给两行 legend 留位。

**现象**：
1. 中文 legend 里 `MoM（GLM 5.2 + Kimi k2.7 + DeepSeek V4 flash(agggregator)）` 太长换行，落到 Pareto 的 x 轴标签上方，遮住"成本（$ / 1M 输出 token）"文字。
2. Pareto 图数据有 5 个灰点（Fable5 / GPT-5 / Sonnet4.6 / Haiku4.5 / Aggregator-only），legend 却把它们全部归到 `t.models.flagship`（"Fable 5"）一条，观众无法辨识灰点是谁。
3. Overview 顶部只强调"MoM 达到 Fable 5 96%"，没有把三家的原始分数并排放出来；展会讲解时观众会问"MoM 具体多少？Fable 5 又是多少？Aggregator 单跑呢？"，得先看代码才能答。
4. Live 页只有 Judge 雷达针对当前这一轮，没有跨 turn 的趋势视角；讲解"MoM 在开放型问题上是否稳定优于 baseline"缺一张动态图。
5. Combo 图 legend 六个项拼一行太挤，在 1080p 宽下会自动换行，语义上 cost/score 各三个应分开呈现。

**后果**：
展会现场观众看图时理解成本增加：Pareto 图无法识别 5 个灰点分别是哪些模型；Overview 的"96%"缺原始分数背书；Live 页无法一眼看出 MoM 是否稳定领先。

**初步判断**：
已确认。三处改动均为纯前端 mock 视觉修订，不影响 orchestrator / API / storage；`npm --prefix web run build` 通过。

**关联**：
-> web/src/components/charts/ParetoChart.tsx
-> web/src/components/charts/ComboChart.tsx
-> web/src/components/charts/RankingChart.tsx（新增）
-> web/src/pages/OverviewPage.tsx
-> web/src/pages/LivePage.tsx
-> web/src/mock/live-ranking.ts（新增）
-> web/src/i18n/dict.ts
-> PLAN.md Phase 5 页面 1 & 2 描述二次修订
-> 004CHANGELOG.md [2026-07-13-1]

---

## [ISS-030] Dashboard 展厅面板需要：主题色改冷蓝紫、字号整体放大以支持 3–4 米远观看

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[体验]
**发现日期**：2026-07-13
**解决日期**：2026-07-13
**解决方案**：将 `web/src/theme.ts` + `web/src/global.css` 集中改造为冷调 royal-blue 主题；新增 `font.size` / `font.weight` 语义常量，把散落在各页面 / 组件里的 px 硬编码 fontSize 全部收编，为展厅 1080p 大屏观看做整体字号上调（base 14→18，一档档同比放大）。

**具体改动**：
1. **色板换血**（`web/src/theme.ts`）
   - `bg` #FAF9F5（暖奶油）→ #F7F8FC（冷淡白）；`bgSubtle` 同步换 #EEF1F8
   - `mom` #C96442（Anthropic 陶橙）→ #3E5BDB（royal blue）；`momSoft` #F5DDD1 → #DBE3F9
   - `flagship` / `aggregatorOnly` / `advisorA/B/C` 全部从暖灰卡其色带换到冷灰蓝紫色带
   - `textPrimary` #1F1B16 → #1A1D2E；`textSecondary/Muted` 同步换到冷灰
   - `border` #E8E3D8 → #E4E7F0；`gridLine` #EDE7DB → #E4E7F0
   - `positive` / `negative` / `info` 微调到更冷更清晰的版本
   - `shadow` rgba 从 warm (31,27,22) 改为 cool (20,26,46)
2. **字号阶梯语义化**（`web/src/theme.ts` 新增 `font.size.*` / `font.weight.*`）
   - 十档 xxs (14) → xs (15) → sm (16) → base (18) → md (20) → lg (22) → xl (26) → h2 (30) → h1 (36) → kpi (44) / kpiHero (56) / kpiUltra (84)
   - 覆盖到 sidebar / PageShell / Card / KpiCard / Badge / Button / 五个页面 / 六个图表
3. **base 字体从 14px 提到 18px**（`web/src/global.css`）
   - `:root { font-size: 18px }` + bg / color 冷调化；scrollbar / pulse-mom keyframe 都用新蓝色
4. **layout 适配**
   - sidebarWidth 220 → 244；contentMaxWidth 1440 → 1520；给放大后字号留呼吸空间
   - 图表容器高度普遍 +40~80px（Pareto 360→420、Combo 360→420、Ranking 320→380、CostStackedBar 260→320、CostTimeline 240→300、JudgeRadar 280→340、CostPie 260→320）

**现象**：
- 现有前端以 Anthropic 陶橙为主色 + 暖奶油底，气质偏 blog / marketing，展厅想要更冷更工业更"AI 面板"的观感。
- 大屏观看距离 3–4 米，14px 正文在 1080p 上看不清；轴标签 10~11px、KPI label 11~12px 更是无从辨识。

**后果**：
不处理则展厅面板不能作为演示看板使用；观众要走近才能读到数据，讲解节奏被打断。

**初步判断**：
纯前端主题改造，不触达 orchestrator / API / storage / mock 数据。所有色值集中在 `theme.ts`，页面 / 组件里散落的 px fontSize 与 rgba 阴影已全部替换为 theme 引用。`npm run typecheck` + `npm run build:web` + `npm run build` 全部通过。

**关联**：
-> web/src/theme.ts
-> web/src/global.css
-> web/src/components/layout/{Sidebar,PageShell}.tsx
-> web/src/components/primitives/{Card,KpiCard,Badge,Button}.tsx
-> web/src/components/charts/*（Pareto / Combo / JudgeRadar / RankingChart / CostStackedBar / CostPie / CacheHitBars / CostTimeline）
-> web/src/pages/*（Overview / Live / Pipeline / Cost / Settings）
-> 004CHANGELOG.md [2026-07-13-2]

---

## [ISS-030] 递归护栏过严：aggregator.model 与 advisor.slots 精确同名时直接进程退出

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[技术债]
**发现日期**：2026-07-13
**解决日期**：2026-07-13
**解决方案**：删除 `assertRecursionGuard` 及其在 `getConfig` 中的调用；同模型自引用配置改为静默接受，用户自行承担"同质集成收益低"的权衡；`assertModeRequirements`（`always` 模式非空校验）保留不变。

**现象**：
`src/config.ts:assertRecursionGuard` 在 `mom.advisor.slots.includes(mom.aggregator.model)` 时以 `ConfigError` 让进程 `exit 1`。判等是纯字符串精确匹配，任何"同模型 ID"的配置（无论是否有意）都会被拦，网关端口不绑，任何 `POST /v1/messages` 都无法送达；即便 `mom_mode='off'`（本该走透传、根本不 fanout）也一样被拦。Dashboard 前端未做等价校验，用户改 Settings 后要下次重启才知道踩线。

**后果**：
1. 用户想在同一模型上做 self-ensemble（如未来加 per-slot temperature / system_prompt）的正常配置无法启动
2. `mom_mode='off'` 状态下与 fanout 无关的配置也被拒绝，护栏语义与运行时行为脱节
3. "递归护栏"命名误导——provider 出站不会回到 MoM，从不存在技术意义上的递归调用；护栏拦的是"退化成同质集成"，不是循环调用

**初步判断**：
已确认。判定链路：`src/index.ts:15` → `src/config.ts:49` → `assertRecursionGuard` 抛 `ConfigError` → `index.ts:22-23` catch → `process.exit(1)`。判等使用 `Array.prototype.includes`，属于强启动期硬约束，无 warn 通道。

**关联**：
-> src/config.ts:9-16, 49
-> docs/001ARCHITECTURE.md §3 / §6 递归护栏 / 链路 0
-> docs/002STRUCTURE.md `src/config.ts` 说明
-> docs/006API.md §2.6 配置装配签名清单
-> docs/000README.md 自检自测约定"运行时行为改动"示例

---

## [ISS-031] Advisor prompt 松散、Aggregator 完全无引导语——references 送到 aggregator 手上无使用说明

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[技术债]
**发现日期**：2026-07-14
**解决日期**：2026-07-14
**解决方案**：从第一性原理重写 `ADVISOR_SYSTEM_PROMPT`（hermes 风格：informed judgement + 下一步含具体 tool call + 风险）与 `ADVISORY_INSTRUCTION`（同语气一句话）；`src/advisor/prompts.ts` 新增 `AGGREGATOR_GUIDANCE` + `AGGREGATOR_REFERENCES_HEADER` 两个常量；`src/aggregator/reference-builder.ts` 在 `appendReferencesToLastUser` 里注入完整 payload（GUIDANCE + HEADER + references）到最后一条 user 尾部，保持前缀 message 引用不变量与 aggregator 请求 `system` 字段字节级透传不变。测试 `test/reference-builder.test.ts` × 4、`test/orchestrator-cost.test.ts` × 1 同步更新到新特征匹配；`ADVISOR_SYSTEM_PROMPT` / `ADVISORY_INSTRUCTION` 导出符号名保持不变，cache-decorator + view-transformer 相关测试通过 import 自动跟随，无需硬编码修改。

**现象**：
1. `src/advisor/prompts.ts:ADVISOR_SYSTEM_PROMPT` 是四条平铺短句拼成一行，只写了"不能调工具、别道歉、给分析"，没有告诉 advisor 它看到的其实是 **mid-task 会话**（可能含 tool_use / tool_result / 交错 turn），也没说清楚应当输出的形态是"对当前状态的 informed judgement + 下一步动作 + 风险"而非"直接答用户"
2. `src/aggregator/aggregator-runtime.ts:runAggregator*` 只把 references **字节级追加**到最后一条 user message 尾部，前缀是一行 `Expert Panel References:` 就没了——aggregator（Claude Code 侧 system prompt 是"一名 coding agent"）完全不知道这些引用是谁写的、是不是权威、要不要引用、能不能违背；`AggregatorSettings` 也没有 `system_prompt` 字段
3. 参考实现（`hermes-agent/agent/moa_loop.py` L429/L610、`opensquilla/src/opensquilla/provider/ensemble.py` L1014）都对 aggregator 有明确的 synth 指令："综合最佳答案或下一次工具调用 / 不要提及 ensemble、candidates、model names / 如果需要工具就调工具，否则给融合结果"，MoM 现状缺失

**后果**：
1. Advisor 面对含 tool_use 的会话时容易滑到"直接给用户写答案"，而不是"给下一次 tool call 的判断"，与 Claude Code 的 agent-loop 定位错配
2. Aggregator 端语义漂移：references 可能被当成用户提供的资料而非 advisor 输出，或者被完整重复输出到最终回答中"暴露 ensemble"，或者被过度信任导致覆盖 aggregator 自己的推理
3. Advisor / Aggregator 两个 prompt 位点从字面看是"MoM 的核心心脏"，但目前只有 6 行 + 1 行标题，远未反映 MoA 三个参考实现里已经收敛的做法，改进价值高、改动局部

**初步判断**：
已确认。定位链路：
- Advisor system: `src/advisor/advisor-runtime.ts:46` 读 `momConfig.advisor.system_prompt ?? ADVISOR_SYSTEM_PROMPT`
- Advisor 末尾合成 marker: `src/advisor/view-transformer.ts:82` 追加 `ADVISORY_INSTRUCTION`（同时是 cache-decorator 识别"合成 marker 跳过"的锚点）
- Aggregator 引导注入位置: `src/aggregator/reference-builder.ts:appendReferencesToLastUser` 追加到最后一条 user 尾部（前缀 message 引用不变——Anthropic prompt caching 约束）
- Aggregator system 保持客户端原样（001ARCHITECTURE.md §2 字节级透传原则）

**方案讨论**：（已收敛）
- Advisor prompt: 从第一性原理重写为 hermes 风格 "informed judgement + 下一步 + 风险"，保留 `ADVISOR_SYSTEM_PROMPT` / `ADVISORY_INSTRUCTION` 两个导出符号名（cache-decorator + 4 处测试通过 import 引用，自动跟随），只改文本
- Aggregator guidance: 在 `prompts.ts` 新增 `AGGREGATOR_GUIDANCE` 与 `AGGREGATOR_REFERENCES_HEADER`；`reference-builder.ts` 在最后一条 user 尾部注入时先输出 `AGGREGATOR_GUIDANCE`，再输出 `AGGREGATOR_REFERENCES_HEADER` 标题 + references 内容
- 注入位置只改**最后一条 user message**——沿用原有"前缀 message 引用不变"的不变量，Anthropic prompt caching 前缀命中不受影响
- **不改** `AggregatorSettings` schema：本次只做 prompt 内容改进，可配置化留待有实际需求时再加
- **不改** aggregator 请求的 `system` 字段：001ARCHITECTURE.md §2 明文"字节级透传"，一改就 cache 全 miss；Aggregator 拿到的是 `system=Claude Code 原 system` + `messages 前缀原样` + `最后一条 user 尾部含 aggregator 引导 + references`

**关联**：
-> src/advisor/prompts.ts（本次改文件）
-> src/aggregator/reference-builder.ts（本次改文件）
-> hermes-agent/agent/moa_loop.py:429-434, 610-618（advisor + aggregator 参考 prompt）
-> opensquilla/src/opensquilla/provider/ensemble.py:1014-1024（aggregator 参考 prompt）
-> docs/001ARCHITECTURE.md §2 "Aggregator 侧字节级透传原则"
-> docs/004CHANGELOG.md [2026-07-14-1]

---

## [ISS-032] Phase 4 Dashboard 后端 API 尚未实现 — Dashboard 前端只能读 mock，无法读真 trace / 改 config

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-14
**解决日期**：2026-07-14
**解决方案**：一次性落地 8 个 `/api/*` 端点（config GET+POST、traces list+detail+by-gateway、metrics 合并大对象、benchmarks 静态 JSON、comparison-501 占位），引入 `OrchestratorHolder` 支撑 `POST /api/config` 后 hot reload orchestrator（丢弃旧 fanout cache）；新增 `src/types/dashboard-api.ts` 前后端共享响应类型，`web/src/lib/api.ts` 出 typed fetch 骨架但 Page 引用不动（Phase 5.1 才切）；`data/benchmarks.json` 显式加入 gitignore 白名单。5 组新单测 42 case 全通过（`dashboard-api-config/traces/metrics/benchmarks.test.ts` + rebuild 副作用观察）。10 项设计决策见 decisions/008。

**现象**：
Phase 5.0 交付了预览版 Dashboard 五页（Overview / Live / Pipeline / Cost / Settings），全部走 `web/src/mock/*` 伪数据；Phase 3 已经完整落 `TraceRequest` 到 SQLite `traces` 表并支持 `X-Session-ID` 关联；但 `src/dashboard-api/*` 目录仍未创建，`/api/*` 命名空间下无任何 HTTP 端点。前端 SettingsPage 的"Save"按钮 setState + 弹 toast 不写盘，Cost / Overview / Pipeline 页也无从消费真数据。

**后果**：
1. **配置修改无法落地**：Dashboard 编辑 aggregator/advisor slots/pricing_table 后，用户必须手动编辑 `data/mom.config.json` + 重启进程；违反 decision 002（Dashboard 是配置修改的主入口）
2. **真数据观察缺口**：`traces` 表已有数据，但 Dashboard 无 API 拉取；每次要看真跑效果只能 `sqlite3 mom.db 'SELECT ...'`
3. **展会节奏受阻**：现场调 `advisor.slots` 需要 SSH 到机器改文件重启，无法直接在 Dashboard 上 hot swap
4. **contract 拖延**：`future-plans/001-dashboard-api-shape-reconciliation.md` 是 Phase 5.1 前置项，Phase 4 API 不出，前端字段形状无法确定

**方案讨论**：
方案 A：分 8 个 REST 端点全落地 —— `/api/config` GET/POST（provider 只读 + MoMConfig 读写）/`/api/traces` 分页 /`/api/traces/:request_id` 单条 /`/api/traces/by-gateway/:gid` 组合查（Pipeline 用）/`/api/metrics` 合并大对象 /`/api/benchmarks` 静态 JSON /`/api/comparison/:trace_id` 返 501（Phase 6 占位）。前端 `web/src/lib/api.ts` 只出 TS 类型与 fetch 骨架，Page 引用不动。**倾向：与用户 10 决策对齐后采纳**
方案 B：只做 config 一个端点，其他端点留 Phase 5.1 —— 快，但 Cost / Pipeline 观察缺口不解决，展会现场依然需要 sqlite 直查
方案 C：/api/* 与 /trace/* 合并为一个命名空间 —— 违反 decision 006 方案 F（eval 与 dashboard 消费方语义不同）

当前倾向：方案 A。

**关联**：
-> src/dashboard-api/*（待创建）
-> src/gateway/server.ts / messages-handler.ts（orchestrator hot reload）
-> src/types/dashboard-api.ts（待创建，前后端共享响应类型）
-> data/benchmarks.json（待创建，评测组维护）
-> web/src/lib/api.ts（待创建，只出类型 + fetch 骨架）
-> web/vite.config.ts（`server.proxy` 已配好 `/api → :3000`）
-> future-plans/001-dashboard-api-shape-reconciliation.md（本 issue 解决后转 Phase 5.1）
-> decisions/008-phase4-dashboard-api-shape.md（本次拍板）
-> docs/006API.md §1.5（已规划端点清单）


---

## [ISS-033] Phase 6 Live 全链路 — 输入框 + 真实 MoM 流 + Baseline 并发 + Judge 打分

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-14
**解决日期**：2026-07-14
**解决方案**：新增 `POST /api/live/run` 专用入口，编排 MoM 流式（现有 orchestrator）+ baseline non-streaming 并发调用 + judge_compare 串行调用，单条 SSE 推 8 类事件；新增 `src/judge/*`（prompt / 二阶段 safeJsonParse / runtime，中英各一版 anonymized A/B prompt）+ `src/live/*`（runtime / events / store / baseline，运行时用 `DevNullWritable` + SSE 观察者从 orchestrator streaming 收集 momText）+ `src/gateway/live-api.ts`（挂路由）；`comparisons` 新表（PK=gateway_request_id，元数据仍走 traces 表 `role='baseline' | 'judge'`）；前端 `useLiveRun` hook 驱动整轮 + textarea + 预置按钮直接跑 + Cancel + baseline 打字机 + judge fallback 标注 + Ranking chart 挂 "Phase 7 Preview" 标签；`mock/live-samples.ts` 精简到只留 5 preset 中英 prompt；`GET /api/comparison/:trace_id` 501 占位删除。9 组新 judge-parse 测试通过。10 项设计决策见 decisions/009。剩余项(aggregation_mode=judge 整合、Ranking 真数据、Cost/Settings/Pipeline 真接入)见 PLAN7.md。

**现象**：
Phase 5.0 交付预览版时，Live Compare 页只能"点预置 → 前端打字机播 mock 脚本"，`web/src/mock/live-samples.ts` 内置所有 MoM/Baseline 长文本与 5 维 judge 分。真实产品语义应当是：用户点预置或在文本框输入 prompt → MoM 走 orchestrator 主链路 → baseline 并发单模型调用 → judge 对两输出打 5 维分 → Live 页三卡实时呈现。当前后端 `src/judge/` 目录不存在，`comparison.enabled` 字段被读但无消费者，`/api/comparison/:trace_id` 显式返 501；前端 LivePage 无 textarea，五个预置按钮点击后走 `useTypewriter` 播 mock。

**后果**：
1. **展会 Live 页失去"实时对比"叙事**：现场无法用观众提的问题演示 MoM 对 baseline 的效果差
2. **Phase 6 后端管道全缺**：judge_compare / baseline 异步调用 / comparison 存储 / SSE 推送全未落地
3. **`comparison.enabled` 是死配置**：Settings 页可以切但没有任何行为变化
4. **前端 mock/live-samples.ts 承担了它不该承担的职责**：既是 prompt 库又是回复库又是 judge 分库；prompt 库是 demo 骨架，另两项在真调用下应退休

**方案讨论**：（已收敛，用户 5 决策 + 我 5 自主决策）
- **范围**（本轮）：Live 全链路真接，Cost / Pipeline / Settings / Overview 页保持现状（Overview 已真接）
- **调用时序**：MoM streaming 与 Baseline non-streaming **并发**发起（`Promise.allSettled`），全部 done 后触发 judge compare
- **入口边界**：新增专用入口 `POST /api/live/run`；`/v1/messages` 完全不变，Claude Code 主客户端零受影响
- **推送方式**：`POST /api/live/run` 直接返回 `text/event-stream`，前端 `fetch` + `ReadableStream` 读取；单条 SSE 连接内推 8 种事件（`created / mom_delta / mom_done / baseline_done / baseline_error / judge_done / judge_error / end`）
- **存储**：新建 `comparisons` 表（PK=gateway_request_id），存 mom_text / baseline_text / judge_scores_json / status；TraceRequest 表新增 `role='baseline' | 'judge'` 落 3 类 trace（含 usage/pricing）保证 `/api/metrics` 未来能算 comparison 成本占比
- **Judge 5 维**：沿用前端已有 `correctness / completeness / depth / clarity / usefulness`（覆盖 PLAN.md 原写的 `efficiency / safety`——前端 UI + i18n 已按前者做，切换要重画）
- **匿名 A/B**：Judge prompt 里 MoM/Baseline 匿名为 `Response A` / `Response B`，服务端随机映射后再回填标签；避免 judge 因看到 "MoM aggregator" 产生倾向
- **每次 Run 生成新 UUID**：`session_id` + `gateway_request_id` 每 Run 都新建（Live 演示语义"这次 Run 与上次无关"）；`gateway_request_id` 通过响应体首个 `event: created` 数据推给前端
- **本轮 aggregation_mode: judge 不做**：`concat` 保持默认，`aggregation_mode=judge` 的结构化整合分支推 PLAN7；避免同一轮两条 judge prompt 一起调风险叠加
- **预置提示词定位**：直接跑 + 输入框旁挂——预置按钮 click 立即 Run；下方独立 textarea + Baseline checkbox + Run/Cancel 主 CTA
- **Ranking chart 推 PLAN7**：依赖 aggregator-only + fable5 两组额外调用 + 相对排名归一算法，超出 judge compare 范围；本轮页面顶部加 "Preview · Phase 7" 标签

**关联**：
-> src/live/*（待创建：live-runtime / live-events / live-store / live-types）
-> src/judge/*（待创建：judge-runtime / judge-prompt / judge-parse）
-> src/gateway/live-api.ts（待创建，注册 /api/live/run + /api/comparison/:gwId）
-> src/gateway/server.ts / src/dashboard-api/comparison-api.ts（挂载新路由 / 移除 501 占位）
-> src/storage/db.ts（新增 comparisons 表）
-> src/types/mom.ts（TraceRequest.role 加 'baseline' | 'judge'；新增 JudgeCompareResult / BaselineResult 类型收敛）
-> src/types/dashboard-api.ts（新增 LiveRunRequest / ComparisonSnapshot / ComparisonEvent 等镜像类型）
-> web/src/lib/api.ts（新增 postLiveRun SSE 客户端 + getComparison wrapper）
-> web/src/hooks/useLiveRun.ts（待创建）
-> web/src/pages/LivePage.tsx（大改）
-> web/src/mock/live-samples.ts（精简到只留 prompt）
-> web/src/i18n/dict.ts（补 pending / cancel / textarea placeholder 三 key）
-> decisions/009-phase6-live-fullstack.md（本次拍板）
-> PLAN.md Phase 6（本 issue 完成后 Phase 6 状态从"📝 略写"改为"🚧 部分完成（仅 judge compare）"）
-> PLAN7.md（未做项汇总）

---

## [ISS-034] Phase 7 Live Markdown + Pipeline 真时序 + Live→Pipeline 联动 + Ranking 伪随机占位

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-14
**解决日期**：2026-07-14
**解决方案**：新增 `web/src/components/primitives/MarkdownBody.tsx`（react-markdown + remark-gfm，禁用 raw HTML）替换 LivePage MoM/Baseline `<pre>` 输出，支持流式增量渲染；App.tsx 改 hash-based 路由 + `?turn=<gwId>` 解析，导出 `navigateTo(page, turn)`；LivePage 结果卡下方加"→ 查看请求流程"按钮，Run 完点击带 gwId 跳 `#pipeline?turn=<gwId>`；PipelinePage 完全重写：页顶 TurnSelect 下拉从 `/api/traces?limit=20&role=aggregator` 拉最近 turn + URL `?turn=<gwId>` 双入口，选中拉 `/api/traces/by-gateway/:gwId` 得 N+1 上游 trace，节点时序从每条 trace 的 `started_at / finished_at` 反演，总时长 > 5s 时按比例压缩（`compressTimeline` 纯函数）；`web/src/lib/timing.ts`（`compressTimeline` / `nodeStatusAt` / `TIMELINE_CAP_MS`）与 `web/src/lib/rankSeed.ts`（`hashSeed` / `mulberry32` / `weightedPick`）两个新库；`web/src/mock/live-ranking.ts` 改为 `getRankingSeries(seed)` 纯函数，seed=gwId 时 MoM 落 rank1 概率 70% / rank2 概率 30%，其余两家均匀；RankingChart prop 从 `preset` 改为 `seed`。i18n 加 `t.live.viewPipeline` + 8 个 pipeline keys（selectTurn / selectTurnPlaceholder / noTurns / emptyHint / loading / loadError / compressedNote / passthroughNote）。零后端改动。

**现象**：
Phase 6 交付后 LivePage 已实时跑通 MoM + Baseline + Judge 三路，但输出栏是 `<pre>` 直吐字符串——markdown 代码块 / 表格 / 列表全部丢格式；PipelinePage 仍读 `mock/pipeline-trace.ts` 的 canned trace 与固定 5s 时序动画，与真实 turn 无联动；Ranking 卡数据是 9 条固定历史 + preset 联动的第 10 条，不随 Run 变化。展会 demo 缺"看输出 → 追流程"的一气呵成叙事。

**后果**：
1. **观感断层**：Live 页 markdown 不渲染，代码 demo 观感差；Pipeline 页与 Live 页视觉上完全隔离
2. **叙事链断裂**：展会现场无法演示"这次 Run 的具体流程"，只能演示两段固定动画
3. **Ranking 静态**：每次 Run 视觉不变，缺"多轮持续对比"的错觉支撑

**方案讨论**：（已收敛，用户 4 决策 + 我 3 自主决策）
- **范围**：Live Markdown + Live→Pipeline 联动 + Pipeline 真时序 4 项；Cost / Settings 真数据 / Ranking 3 家判分 / aggregation_mode=judge 推 Phase 8（写入 PLAN.md 新 Phase 8 章节）
- **路由方案**：不引入 React Router，用 hash + URLSearchParams 手工解析（Router 改造 20 行内可控），Sidebar navigate 走 `navigateTo(page)` 更新 hash
- **时序压缩规则**：`TIMELINE_CAP_MS=5000`；`rawTotal > cap` 时按 `cap / rawTotal` 比例缩放所有 startMs/endMs（保留相对节奏）；否则原样。压缩后在页顶显示"真实耗时 Xs → 5s"标注
- **Ranking 决定性伪随机**：`mulberry32(hashSeed(gwId))` 输出 [0,1) 序列，`weightedPick` 分配 MoM rank 1/2（70%/30%），其余两家在剩余 rank 上均匀分布；`RankingChart useMemo(() => getRankingSeries(seed), [seed])` 保证同一 Run 内视觉稳定
- **Markdown 安全**：react-markdown 默认 sanitize HTML；不引 `rehype-raw`；不引 syntax highlighter（包体积；产物 826 KB gzip 235 KB，加高亮会翻倍）
- **passthrough turn 兼容**：TurnSelect 拉 `role=aggregator`；若拉 `by-gateway` 结果只含 passthrough 单条，Pipeline 页显示 `PassthroughFlow`（单节点 + 说明标注）
- **Diff Modal 内容来源**：aggregator trace 的 `request_summary`（message_count / max_tokens / tool_use_count）+ advisor trace 的 `preview`（`stop_reason` 或 `{tokens}t · {ms}ms`），非完整消息内容——完整 diff 需要 `settings_snapshot` 里 concat 后的 references 文本，属于展会后深化

**关联**：
-> web/src/components/primitives/MarkdownBody.tsx（新增）
-> web/src/lib/timing.ts（新增：compressTimeline / nodeStatusAt / TIMELINE_CAP_MS）
-> web/src/lib/rankSeed.ts（新增：hashSeed / mulberry32 / weightedPick）
-> web/package.json（新增 react-markdown ^9.1.0 / remark-gfm ^4.0.1 依赖）
-> web/src/App.tsx（Router 改 hash-based + 导出 navigateTo）
-> web/src/pages/LivePage.tsx（MomColumn/BaselineColumn 用 MarkdownBody；加"→ 查看请求流程"按钮；RankingChart prop 改 seed=gwId）
-> web/src/pages/PipelinePage.tsx（大改：TurnSelect + 拉真 trace + compressTimeline + FanoutFlow/PassthroughFlow/DiffModal 重构）
-> web/src/mock/live-ranking.ts（改为 getRankingSeries(seed) 纯函数）
-> web/src/components/charts/RankingChart.tsx（prop preset→seed）
-> web/src/i18n/dict.ts（加 viewPipeline + 8 pipeline keys 双语）
-> decisions/010-phase7-live-pipeline.md（本次拍板）
-> PLAN.md Phase 7 与 Phase 8 章节（本 issue 完成后 Phase 7 状态改为"已完成"）
-> 004CHANGELOG.md 2026-07-14-3

---

## [ISS-035] Phase 7 收尾：Live 页异步化 + 请求流程展示真文本 + 模型名副标题 + 预设外置 + baseline 显式化

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-15
**解决日期**：2026-07-15

**现象**：
Phase 6/7 交付 Live 页 SSE 实时流 + Pipeline 页真时序回放后，用户实测发现五类问题：

1. **Live 页状态易失**：一次 MoM+Baseline+Judge Run 需要 100s 以上；用户切到其他页面再回来，`useLiveRun` hook 随 LivePage 组件卸载，SSE 流虽然仍在跑但 setState 目标丢失 → 中途 delta 丢失、无法回看当时问答。
2. **Pipeline 流程图节点没有真实文本**：advisor 节点框只显 `stop_reason=end_turn`；aggregator 同样；Diff 弹窗读的是 `request_summary` 元数据 + advisor previews，看不到真正拼接后的 references 完整文本；User 节点无 last user 文本。根因：`TraceRequest.response_summary` 只存元数据，`AdvisorResult.reference` 与 `AggregatorResult.references_appended`（内存里的完整文本）未落 trace。
3. **Live 页 Baseline 列副标题缺模型名**：`BaselineColumn` 副标题从 `baseline?.model` 读，未跑起来时（还没到 `baseline_done` 事件）显示 `—`；MoM 列副标题只有静态"3 advisors + aggregator"没有具体 slot 与 aggregator 名。
4. **Baseline 未触发**：`data/mom.config.json` 里 `comparison.enabled=true / baseline_model="deepseek/deepseek-v4-flash"`，前端 baselineOn 默认 true，代码 gate（`live-runtime.ts:303` `input.baseline_on && baselineModel`）正确 —— 但用户观察到 baseline 未跑。定位结论：**代码路径无问题**，最可能是运行时错误（model id 在 provider 不存在 → baseline_error 事件被前端展示但被忽视）；本次修复通过 Q3 让模型名在"未跑 / error / 已完成"三种状态下都可见解决观感问题。
5. **预设 prompt 硬编码**：`web/src/mock/live-samples.ts` 里写死 `PRESET_ORDER + getPresetPrompt`，用户想在展会现场根据行业调整预设需要重 build web。

**后果**：
1. Q1：展会现场无法切页面讲解，回来后需要重新 Run，节奏被打断
2. Q2：Pipeline 页对观众失去"看内部流程"的说服力，Diff 弹窗形同虚设
3. Q3+Q4：观众看不出这次实际用了哪些模型；baseline 静默失败无法被 Op 观察
4. Q5：预设与代码耦合，不便于展会/客户 demo 定制

**方案讨论**：（已收敛，与用户 6 轮对齐 —— 见对话记录）

**Q1（Live 页状态易失）— 方案 A2：Live 全流程异步化，替代 SSE 实时流**
- 后端 `POST /api/live/run` 改为立即返回 `202 {gateway_request_id}`，任务在后台 async 跑（`runLiveTurn` 保持原实现，只是不再往 output 写 SSE），最终结果写 `comparisons` 表
- 后端新增 `GET /api/comparisons?limit=20` 返回最近 comparison job 列表（含 `status: running | done | error`）
- 后端删除 SSE 相关代码：`src/live/live-events.ts` 整个文件；`live-runtime.ts` 里所有 `writeLiveEvent` 调用与 output 参数；`live-api.ts` 移除 SSE header + hijack + text/event-stream；`src/lib/api.ts` postLiveRun/parseSSEFrame 全删
- 前端 `LivePage.tsx` 改为双栏：左侧 Composer + Job 列表（`GET /api/comparisons`），右侧 Comparison Viewer；`useLiveRun` 拆为 `submitLiveRun`（fire-and-forget POST，返 gwId） + `useComparisonPoll`（3s 轮询 `GET /api/comparison/:gwId` 直到 status=done|error）
- 打字机动效彻底删除（`useTypewriter` 保留供 Pipeline 用）；MarkdownBody 保留渲染 static text

**Q2（真实文本进流程图）— TraceRequest 加 3 可选字段**
- `TraceRequest` 新增：`response_text: string | null` / `references_appended: string | null` / `last_user_text: string | null`
- 单字段硬上限 32KB，超长截断加 `…[truncated]`
- 落库路径：advisor（`response_text` = extractText 结果，`last_user_text` 只在 aggregator 层记不重复）；aggregator（`response_text` + `references_appended`）；passthrough（`response_text` + `last_user_text`）
- 老 trace 缺字段前端 fallback 到旧 `previewOf`

**Q3（模型名副标题）— comparison 快照 3 个模型名**
- 因 Q1 改成异步流，`created` SSE 事件不再存在。改为：`comparisons` 表加 `advisors_snapshot: JSON` + `aggregator_model: string` + `baseline_model: string | null`，`createComparison` 时快照写入
- `GET /api/comparison/:gwId` 返回这 3 字段
- 前端 MomColumn subtitle 展示 `Advisors: A · B · C — Aggregator: X`；BaselineColumn subtitle 展示 `Baseline: Y`

**Q5（预设外置）— data/presets.json + GET /api/presets**
- 新增 `data/presets.json`（gitignore 白名单），结构 `{presets: [{id, zh, en}, ...]}`
- 新增 `GET /api/presets` 端点（不需要 hot reload，每次请求读文件）
- 前端 PromptShelf 从 API 拉；文件不存在返回空数组前端隐藏 shelf
- 删除 `web/src/mock/live-samples.ts` 里 `PRESET_ORDER / getPresetPrompt / PresetKey`

**Q6（Claude Code 请求也 fork baseline+judge）— 挂 future-plans/003**
- 本次不实现；写入 `docs/future-plans/003-baseline-on-gateway-requests.md`
- 方案 Y：只在 `trigger_reason === 'user_turn'`（真正触发 MoM fan-out 的轮次）fork baseline+judge，避免 tool 迭代中间轮的无意义对比
- 新增 config 开关 `comparison.trigger_on_gateway_requests: boolean`（默认 false），防止意外开启导致成本翻倍

**关联**：
-> src/live/live-runtime.ts（`runLiveTurn` 去 SSE 化，返回 void，全部结果落 comparisons 表）
-> src/live/live-store.ts（新增 `listRecentComparisons` / `updateComparisonStatus`；`createComparison` 加快照 3 字段）
-> src/live/baseline.ts（不变）
-> src/live/live-events.ts（**删除**）
-> src/gateway/live-api.ts（POST /api/live/run 改 202；新增 GET /api/comparisons）
-> src/gateway/presets-api.ts（**新增**）
-> src/gateway/server.ts（注册 presets-api）
-> src/storage/db.ts（comparisons 表加 3 快照列；traces 表加 3 文本列）
-> src/storage/traces.ts（saveTraceRequest 落新字段）
-> src/types/mom.ts（TraceRequest 加 3 字段；AdvisorResult 加 response_text）
-> src/types/dashboard-api.ts（ComparisonResponse 加快照 3 字段；新增 PresetsResponse / ComparisonsListResponse；删 LiveRunEvent 系列）
-> src/advisor/advisor-runtime.ts（response_text = extractText(response.content)）
-> src/aggregator/aggregator-runtime.ts（response_text / references_appended 回传给 orchestrator）
-> src/orchestrator/orchestrator.ts（三处 persist* 落新字段：advisor / aggregator / passthrough）
-> web/src/lib/api.ts（删 postLiveRun/parseSSEFrame；加 submitLiveRun / listComparisons / getPresets）
-> web/src/hooks/useLiveRun.ts（重写为 submitLiveRun + useComparisonPoll）
-> web/src/hooks/useTypewriter.ts（保留供其他页用，Live 不再引用）
-> web/src/pages/LivePage.tsx（大改：双栏 Composer+JobList / Viewer；模型名 subtitle；删打字机；MarkdownBody 直接渲染 static text）
-> web/src/pages/PipelinePage.tsx（`previewOf` 优先读 `response_text`；User 节点显 `last_user_text`；Diff 弹窗读 `references_appended`）
-> web/src/mock/live-samples.ts（**删除**，或缩减到只保留 zh/en 语言标记）
-> web/src/i18n/dict.ts（加 jobList / jobStatus / advisors 字段等 keys）
-> data/presets.json（**新增**，gitignore 白名单）
-> .gitignore（加 `!data/presets.json`）
-> docs/future-plans/003-baseline-on-gateway-requests.md（**新增**）
-> docs/001ARCHITECTURE.md（§2 Live 流程从 SSE 改异步；§5 链路 I 更新）
-> docs/002STRUCTURE.md（del live-events.ts；新增 presets-api.ts / presets.json）
-> docs/006API.md（§1.1 增 /api/presets + /api/comparisons；§1.6 详细契约替换 SSE 描述为 202+轮询；§2.10 Live Runtime SDK 更新）
-> 004CHANGELOG.md [2026-07-15-1]

---

## [ISS-036] Phase 7 打磨：Pipeline Markdown 渲染、Live 拆 Chat 页、Ranking 图去徽章 + 底部留白

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-15
**解决日期**：2026-07-15

**现象**：
[2026-07-15-1] / [2026-07-14-5] 交付后现场使用发现 3 组体验问题：

1. **Pipeline 页 Markdown 缺失 + Diff 弹窗只能点关闭按钮**
   - `PipelinePage.tsx:526` Advisor 卡片里 `{node.preview}` 纯文本渲染；LLM 输出的列表、代码块、加粗全部塌成一行
   - `PipelinePage.tsx:700-705` DiffModal 用 `<pre>` 硬渲染 `beforeText` / `afterText`，markdown 语法同样不解析
   - `PipelinePage.tsx:668-671` DiffModal 遮罩层无 `onClick`，点空白区域不关闭；只有右上角 `× 关闭` 按钮能关

2. **Live 页把"提问工具"和"演示大屏"塞在同一页**
   - `LivePage.tsx:80` `gridTemplateColumns: '360px 1fr'` 左右分栏 —— 左边 Composer + Jobs，右边所有 KPI/对比
   - 展会现场演讲者需要在提问区专注输入 / 从历史里选题，同时观众想看的是并排大字对比。同一屏兼顾两者，两边都拘束
   - `StatusStrip` 里 `t.live.statusJudgeDone` = "全部完成"，观众看到大屏只知道"系统跑完了"，看不到"这个人问了什么"

3. **Ranking 图第 3 名压 X 轴 + 预览徽章过时**
   - `RankingChart.tsx:31` `YAxis domain={[1,3]} reversed` → rank=3 数据点正好落在 X 轴上，观感被 grid line 压掉
   - `LivePage.tsx:128` `<Badge>{t.live.rankingPreviewBadge}</Badge>` 展示 "预览数据 · Phase 7"，Phase 7 已收尾无意义

**后果**：
1. Advisor answer / Diff 弹窗看的是原始 markdown 语法，观众直接放弃阅读；DiffModal 需要"精确瞄准关闭按钮"是低质量交互
2. 展会现场演讲者切页面变多；观众看不到 prompt 全文，只有一个"全部完成"抽象状态
3. Ranking 图 rank 3 数据点被 X 轴吞了；预览徽章过时

**方案**（已与用户 1 轮对齐）：

**Q1 → 修 Pipeline Markdown + 点空白关闭**
- Advisor answer / DiffModal 两栏统一走 `MarkdownBody`（web/src/components/primitives/MarkdownBody.tsx，Live 页已复用）
- Advisor 卡片传 `minHeight={80} maxHeight={200}`，保持 3 栏并排紧凑
- DiffModal 两栏传 `minHeight={0} maxHeight={undefined}`，由外壳 `85vh` 主控滚动
- 遮罩层加 `onClick={onClose}`，内层内容 div `onClick={(e) => e.stopPropagation()}`；不加 Esc 快捷键（用户明确表示不必要）

**Q2 → 拆 Chat 页 + Live 页转纯观看**
- 新增 `web/src/pages/ChatPage.tsx`，路由 `#chat`；Sidebar 顺序 overview → live → **chat** → pipeline → cost → settings（Chat 放在 Live 之后，观看 → 提问 → 时序）
- Chat 页布局：上方选择历史 comparison（复用 pipeline 的下拉），下方 Composer + 提交后并排显示 MoM/Baseline Markdown + Judge + Cost；无 Ranking（Ranking 是 Live 页的价值主张）
- Live 页去掉左侧 Composer + Jobs 栏；上方保留"选择历史 comparison"下拉，下方是并排 MoM/Baseline + Judge/Cost + Ranking
- 两页共享同一份 `LiveJobProvider` state
- StatusStrip 终态时把系统标签替换为 `用户提问：<prompt>`；prompt 长于 140 字符截断加 `…`

**Q3 → RankingChart 底部留白 + 删徽章**
- `YAxis domain={[0.6, 3.4]}` 上下对称扩，仍只显示 ticks=[1,2,3]，rank 1 / rank 3 都有呼吸空间
- 删 `LivePage.tsx:128` 徽章 + i18n `rankingPreviewBadge` en/zh 两处键

**关联**：
-> web/src/pages/PipelinePage.tsx（Advisor + DiffModal 走 MarkdownBody；DiffModal 点空白关闭）
-> web/src/pages/LivePage.tsx（去 Composer + Jobs，改为上方下拉 + 下方观看栏；StatusStrip 显示用户 prompt）
-> web/src/pages/ChatPage.tsx（**新增**）
-> web/src/App.tsx（PAGES 加 chat）
-> web/src/components/layout/Sidebar.tsx（PageKey / ORDER 加 chat）
-> web/src/components/charts/RankingChart.tsx（YAxis domain 加 padding）
-> web/src/i18n/dict.ts（新增 chat.* 键；删 live.rankingPreviewBadge；新增 live.userPromptLabel）
-> 004CHANGELOG.md [2026-07-15-2]

---

## [ISS-037] Chat 页需要瘦身成"只有提问 + MoM 回答"的对话式界面

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-15
**解决日期**：2026-07-15
**解决方案**：两轮迭代——首轮 [2026-07-15-3] 把 ChatPage 撤到"RunSelect + Composer + StatusStrip + iMessage 卡"仍套 PageShell 与 Card 外壳,用户反馈"回答在下面反人类,box 多余,输入框应 sticky,预设应居中,subtitle 无意义,MoM 回复不该折叠"。二轮 [2026-07-15-5] 重写为传统 chatbot 布局:自定义 flex 列取代 PageShell,header 只留 title + 历史下拉(无 subtitle),消息区空态时预设卡片居中展示(hint = "选一个预置问题,或直接输入"),有 comparison 时用户气泡在右、MoM 气泡在左、MarkdownBody `flush` 完全展开无内滚;composer sticky 到底部,Enter 发送 / Shift+Enter 换行。后端仍硬编码 `baseline_on: true`。

**现象**：
ISS-036 交付的 ChatPage 布局是 RunSelect + Composer(带 baseline 开关) + StatusStrip + `<MomColumn>` / `<BaselineColumn>` 并排 + `<JudgeCard>` / `<CostCard>` 并排 + 「查看请求流程」按钮。等价于把 LivePage 的对比看板压到 Chat 页下面,和"提问"的心智模型不吻合——用户在这里主要是想跟 MoM 对话,不是看对比。首轮 [2026-07-15-3] 撤了 Baseline/Judge/Cost 但仍套 PageShell + Card,导致"回答在输入框下面/subtitle 无意义/'发送 prompt' 空态 box 累赘/输入框不在底部/MoM 回复被 MarkdownBody 默认 maxHeight 折叠",不像传统 chatbot。

**后果**：
Chat 页与 Live 页信息冗余;首轮改动后仍与 ChatGPT/Claude.ai 这类熟悉的 chatbot 布局差异明显,用户认为"反人类"。

**初步判断**：
已确认。用户明确要求 Chat 只留 chat 入口(对比留给 Live 页),且必须是传统 chatbot 布局(sticky composer 在底 / 预设居中在空态 / MoM 回复完全展开)。

**关联**：
-> web/src/pages/ChatPage.tsx（两轮改动:首轮撤对比卡 + iMessage 气泡;二轮 [2026-07-15-5] 重写为 flex 布局 + sticky composer + 预设居中 + MarkdownBody flush）
-> web/src/pages/live-shared.tsx（首轮:Composer 的 baseline 参数改为可选 `baseline?: {on, onToggle}`;二轮:Composer 不再被 ChatPage 使用,只 LivePage 需要——但 LivePage 是 viewer-only 也不用,实际 Composer 目前无消费方,保留供未来复用）
-> web/src/components/primitives/MarkdownBody.tsx（无改动;二轮通过传入 `flush` prop 让 MoM 回复不套外壳、无 maxHeight，完全展开）
-> web/src/i18n/dict.ts（首轮:chat.subtitle 改述 + 新增 4 键;二轮:chat.subtitle / chat.empty 置空(不删字段保 dict type 对齐)、historyLabel 缩短、新增 chat.presetsHint / chat.presetsEmpty 中英）
-> 004CHANGELOG.md [2026-07-15-3] [2026-07-15-5]

---

## [ISS-038] Overview 的 Pareto 图横轴应展示总成本而非 $/1M token

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-15
**解决日期**：2026-07-15
**解决方案**：`ParetoPoint.cost` 换成 `costCny`(¥/次问答);ParetoChart 的 XAxis dataKey / domain / ticks 全换,tickFormatter 输出 `¥0.020` 这类三位小数格式;Tooltip 的 "cost $x.xx/1M" 换成 "cost ¥x.xxx/次"。i18n `paretoAxisX` 中英同步。真值稍后从 config 填,当前 mock 保持 MoM 落在前沿上(高分低价)。

**现象**：
Overview 页 Cost×效果 图横轴是 `Cost ($ / 1M output token)`——单价维度。展会观众对"单价 $/1M"没直觉,不知道 5.6 vs 17.5 是啥概念;而对"一次问答花多少钱"有直觉。

**后果**：
展会看图的人得脑补"× 一次问答的 token 量"才能理解落差,叙事效率低。

**初步判断**：
已确认。用户明确要求把横轴改为「总成本(¥)」,mock 数字以"单次问答"为口径,真数值等 config 填。

**关联**：
-> web/src/mock/benchmarks.ts（ParetoPoint.cost -> costCny;paretoData / paretoFrontier 数值按 ¥/次问答 重排）
-> web/src/components/charts/ParetoChart.tsx（XAxis dataKey/domain/ticks/tickFormatter;ParetoTooltip 文案）
-> web/src/i18n/dict.ts（overview.paretoAxisX 中英）
-> 004CHANGELOG.md [2026-07-15-4]

---

## [ISS-039] Dashboard 四页 UI 打磨：按钮居中 / Ranking 上移换色 / Pipeline Advisor 浮层与 Aggregator 卡 / Cost 三色

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：见 CHANGELOG [2026-07-16-1]。ComposerBar `alignItems: center`；LivePage `<Card title={rankingTitle}>` 位置从末尾提到 StatusStrip 之下；RankingChart flagship 换 `color.rankFlagship #E6923A`（新增常量，`color.flagship` 保留给 Overview / Live baseline 条）；AdvisorCard 里 MarkdownBody 外套白盒(`color.bg` + border)走 flush 模式；新增 AggregatorCard 大卡片渲染 aggregator 完整 Markdown 回复；theme.ts `advisorA/B/C` 覆写为琥珀橙/青绿/紫红 `#E6923A / #3EA69E / #B85F9E`（CostPie/CostStackedBar 通过常量间接换色）。

**现象**：
1. `#chat` — ComposerBar 里 textarea 与发送按钮用 `alignItems: 'flex-end'`，按钮贴文本框底部而不是垂直居中；96px 的 composer 里视觉配平不对。
2. `#live` — RankingChart 位于 LivePage 最后一块，观众必须滚到底部才能看到"动态相对排名"这个卖点图；且 flagship 线 `#8891A5`（冷中灰）和 aggregatorOnly `#7D8AB0`（灰蓝）在 1080P 展示屏上几乎糊在一起，只能识别蓝线（MoM）。
3. `#pipeline` —
   - AdvisorCard 的卡片底是 `color.bgSubtle #C5D3F0`，卡内 MarkdownBody 没底色透传成同色，advisor 回复文本与卡片底"融"在一起。
   - Aggregator 在 FanoutFlow 里用的是 FlowNode 一行元数据（model / latency / tokens / cost），完全没渲染 `response_text`；观众只能看到 advisor 的回复，看不到 aggregator 的整合结果——违反"请求流程"的展示初衷。
4. `#cost` — CostPie / CostStackedBar 里 advisorA/B/C = `#5A6FE0 / #6D7AC0 / #8A93D1`，加上 aggregator 的 `#3E5BDB`，四段全是深浅蓝，饼图糊成一坨；观众无法一眼看出各角色成本占比。

**后果**：
四点均为展会现场可见的体验缺陷，累计影响"Chat/Live/Pipeline/Cost"四个主页面的第一印象，尤其 Cost 饼图和 Ranking 图直接影响"MoM 更省 / MoM 更强"两条主叙事的可读性。

**初步判断**：
已确认。用户在展会调试时四条现象均已复现，确认改法：
1. ComposerBar `alignItems: 'flex-end'` → `'center'`。
2. RankingChart 位置提到 StatusStrip 下方 / MomColumn+BaselineColumn 上方；flagship 换 `#E6923A` 琥珀橙（新增 `color.rankFlagship`，不动 `color.flagship` 以免污染 Cost 页 baseline 条颜色）。
3. AdvisorCard 里 MarkdownBody 外层套 `background: color.bg` + 边框 + padding，让文本浮出卡底；Aggregator 由 FlowNode 升级为 AggregatorCard（header + 白盒 MarkdownBody + 元数据行）。
4. `theme.ts` 覆写三个 advisor 常量：advisorA = 琥珀橙 `#E6923A` / advisorB = 青绿 `#3EA69E` / advisorC = 紫红 `#B85F9E`；Aggregator 保持 MoM 蓝 `#3E5BDB`。CostPie / CostStackedBar 无需改代码。

**关联**：
-> web/src/pages/ChatPage.tsx（ComposerBar 垂直居中）
-> web/src/pages/LivePage.tsx（RankingChart 位置）
-> web/src/pages/PipelinePage.tsx（AdvisorCard 浮层背景 + Aggregator 大卡片）
-> web/src/components/charts/RankingChart.tsx（第三条线换色）
-> web/src/components/charts/CostPie.tsx / CostStackedBar.tsx（由 theme 常量间接换色）
-> web/src/theme.ts（advisorA/B/C 换值 + 新增 rankFlagship）

---

## [ISS-040] Chat / Live 页每 3 秒"自动刷新"一次内容——`useLiveRun` 未按快照内容去重，且 select 已终态历史时仍启动轮询

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：见 CHANGELOG [2026-07-16-2]。`useLiveRun.tick` 在 `setState` 里按 `gateway_request_id + updated_at + status` 三元组做 snap 去重，identical 情况下 `nextCurrent = s.current` 引用不变、`polling` 也按终态推导，触发 React `Object.is` 短路直接跳过重渲染；`select(gwId)` 不再在拉数据前抢先翻 `polling: true / current: null`，而是保留旧 snap，让 `tick` 拿到新 snap 后按其状态自动翻 `polling` 标志；ChatPage / LivePage 的 `listComparisons` 依赖数组由 `[gw, status]` 收窄为 `${gw}:${terminal? status : 'active'}`，中间态 `pending → mom_done → baseline_done` 不再各触发一次列表 refetch。

**现象**：
在 `#chat` 提交一次 prompt、或在 `#chat` / `#live` 从"最近调用"下拉里点开某条历史记录后，页面每隔约 3 秒会整体"刷新"一次——Recharts 判官雷达图、MoM/Baseline Markdown、成本卡片、历史下拉全部重绘一遍。即便被选中的历史条目状态已经是终态（`judge_done` / `error`），首次点开也会看到"整块 UI 短暂空一次再填回"的抖动。

**后果**：
展会现场观众会误以为系统"在悄悄重新调用一次"，实际上后端并没有变化。抖动破坏 Live 演示的静态观感；对录制视频 / 截屏也不友好。

**初步判断**：
已确认。三处联动导致：
1. `web/src/hooks/useLiveRun.ts:tick()` 每次拉到 `getComparison(gwId)` 都无条件 `setState({ ...s, current: snap })`，即便 `snap.updated_at` 与已有 `state.current.updated_at` 完全相同，React 也会因为 `current` 引用变化而向下重渲染整棵 `useLiveJob()` 订阅子树。
2. `web/src/hooks/useLiveRun.ts:select(gwId)` 无论目标运行是不是终态，都先把 `polling: true / current: null` 写进 state，再打 `tick(gwId)`；网络往返 ~150 ms 内 UI 空一次；点开一个 `judge_done` 的老会话本不需要进入"轮询态"。
3. `web/src/pages/ChatPage.tsx:44-50` 与 `web/src/pages/LivePage.tsx:29-35` 的 `useEffect` 依赖数组是 `[live.current?.gateway_request_id, live.current?.status]`；在轮询过程中 `status` 每跨过一档（`pending → mom_done → baseline_done → judge_done`）都会重新 `listComparisons(20)`，历史下拉跟着重画。

**关联**：
-> web/src/hooks/useLiveRun.ts:65-95（`tick` 加 snap 去重 + `polling` 由终态推导）
-> web/src/hooks/useLiveRun.ts:114-123（`select` 不再抢先翻 `polling: true / current: null`）
-> web/src/pages/ChatPage.tsx:44-55（`historyKey` 收窄依赖）
-> web/src/pages/LivePage.tsx:29-40（同上）
-> 004CHANGELOG.md [2026-07-16-2]

---

## [ISS-041] Overview / Cost / Live 图表：页面滚动、鼠标 hover、窗口 resize 时 Recharts 重播 entry 动画看起来像"自动刷新"

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：见 CHANGELOG [2026-07-16-3]。给所有 Recharts 数据系列（`Bar` / `Line` / `Area` / `Pie` / `Radar` / `Scatter`）统一加 `isAnimationActive={false}`——覆盖 ComboChart / ParetoChart / RankingChart / CostStackedBar / CostPie / CostTimeline / JudgeRadar 七张图；ParetoChart 之前只对 frontier `Line` 关了动画，Scatter 那 6 个模型点仍在动，这次一并关掉。

**现象**：
1. `#overview` 页只要往下滚动一下，`ComboChart` / `ParetoChart` 就会重新"从 0 长回来"一次——用户直观感受是"整块图表刷了一遍"。
2. 鼠标一移入 `#overview` 页"成本 × 效果"（ComboChart）图内，图表整体也会闪一下重播入场动画。
3. `#cost` 页的堆叠柱、饼图、区域图；`#live` 页的判官雷达图、动态排名图，都存在同一模式：容器尺寸一变（滚动条出现/隐藏、window resize）或 hover 触发 Tooltip 重排时，图表重演一次入场动画。

**后果**：
展会现场只要观众滚动或移动鼠标，图表就抖一下，观感上像"数据正在被后端悄悄推送刷新"——这与 MoM"静态基准展示"的叙事直接冲突，尤其容易让观众怀疑"是不是在偷偷重跑 benchmark"。

**初步判断**：
已确认。Recharts 的 `ResponsiveContainer` 通过 `ResizeObserver` 监听自身宽高变化，页面滚动带来的滚动条 toggle、系统 UI resize、hover 触发 tooltip 层引起容器尺寸微变化时，`ResponsiveContainer` 都会重新测量 → 内部 chart 组件重挂载 → 各数据系列走一次入场动画（Recharts 默认 `isAnimationActive={true}`，默认 `animationDuration ≈ 1500 ms`）。当前项目中所有 7 张 Recharts 图里，只有 `ParetoChart` 的 frontier `Line` 一处显式 `isAnimationActive={false}`，其余全部走默认。

**关联**：
-> web/src/components/charts/ComboChart.tsx:67-72（3 Bar + 3 Line 关动画）
-> web/src/components/charts/ParetoChart.tsx:113-123（6 Scatter 关动画；frontier Line 之前已关）
-> web/src/components/charts/RankingChart.tsx:40-42（3 Line 关动画）
-> web/src/components/charts/CostStackedBar.tsx:37-40（4 Bar 关动画）
-> web/src/components/charts/CostPie.tsx:25-34（Pie 关动画）
-> web/src/components/charts/CostTimeline.tsx:41（Area 关动画）
-> web/src/components/charts/JudgeRadar.tsx:42-43（2 Radar 关动画）
-> 004CHANGELOG.md [2026-07-16-3]

---

## [ISS-042] Overview 页 ComboChart 鼠标 hover 仍会"整图刷一遍"——`data` 引用不稳定触发 Recharts `updateId` bump + full state reset

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：见 CHANGELOG [2026-07-16-4]。三处 chart 组件在函数体内每次 render 都会 `map()` / `flatMap()` 出一个新数组塞给 Recharts 的 `<Chart data={…}>`，即便原始数据完全没变——Recharts 的 `getDerivedStateFromProps` 用严格引用比较 `data !== prevState.prevData`，一旦命中就走「_defaultState + updateId + 1」的**完全 state reset**分支，并把新的 `animationId` 派给每一条 `Bar/Line/Area/Radar`；虽然我们已经把所有系列的 `isAnimationActive={false}`，state reset 本身还是会重跑轴映射、tooltip 定位、layer 重挂载，视觉上就是"整图闪一下"。修法：（a）`ComboChart` 把 `normalizeBenchmarkRows(benchmarks.per_benchmark)` 提到**模块顶层**的 `STATIC_PER_BENCHMARK`，函数内所有 `scoreDomain / costDomain / costDecimals` 用 `useMemo(() => ..., [])` 一次算完；（b）`CostPie` 把 `byRole.map(...)` 结果同样提到模块顶层 `STATIC_ROWS`；（c）`JudgeRadar` 因为 `data` 依赖 props（`mom`/`baseline`）+ i18n 标签，改用 `useMemo` + 精确依赖数组；（d）`ComboChart` 顺手在 `<Tooltip>` 上加 `isAnimationActive={false}` 关掉 tooltip 淡入淡出的额外动画。

**现象**：
在 Chrome 里打开 `http://localhost:5173/dashboard/#overview`，鼠标从 chart 外滑到"成本 × 效果"（ComboChart）图区域内的瞬间，整块图会闪一下——柱子、点线、坐标轴 tick 全部瞬时重画一遍，视觉上等同"刷新"。用户在 ISS-041 已经把所有系列的 `isAnimationActive={false}` 补齐之后，抖动仍然存在，说明动画不是唯一根因。同类问题的 `#live JudgeRadar` / `#cost CostPie` 在展会大屏上鼠标一移入也会一起闪。

**后果**：
展会现场观众鼠标每碰到图表一次都会看到一次抖动，与"静态基准展示"的叙事直接冲突；这也是 ISS-041 用户复测时"依旧刷新"的直接原因，需要单独立条目彻底解决。

**初步判断**：
已确认。在 `node_modules/recharts/es6/chart/generateCategoricalChart.js` 的 `getDerivedStateFromProps` 里读到 `if (data !== prevState.prevData) { … newState = { ..._defaultState, ..., updateId: prevState.updateId + 1 }; }`——只要 `data` 引用变了就走完整 reset。触发链：`useLiveJob()` 或 `useHashRoute()` 在其他子树上的 `setState` → `LiveJobProvider` / `Router` 重渲染 → cascading 到没有 memo 的 `OverviewPage` / `ChatPage` / `LivePage` → `ComboChart` / `JudgeRadar` / `CostPie` 函数重跑 → `map()` / `flatMap()` 生成新数组 → Recharts state reset。ChatPage/LivePage 里跟 `useLiveJob` 直接联动的组件已在 ISS-040 里通过快照去重 + `historyKey` 收窄降低了触发密度，但 Overview 页 hover 只要触发 tooltip 内部 setState 就能间接把 ComboChart 重新拉起。

**关联**：
-> web/src/components/charts/ComboChart.tsx（`STATIC_PER_BENCHMARK` 提到模块顶层 + `useMemo` 缓存 domain / decimals + Tooltip `isAnimationActive={false}`）
-> web/src/components/charts/CostPie.tsx（`STATIC_ROWS` 提到模块顶层）
-> web/src/components/charts/JudgeRadar.tsx（`data` 改 `useMemo` + 精确依赖数组）
-> 004CHANGELOG.md [2026-07-16-4]

---

## [ISS-043] Overview 页鼠标 hover 触发 `ParetoTooltip` 抛 `TypeError` → React error recovery → 整棵组件树重挂载看起来像"刷新"——ISS-041/042 都是误诊

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[崩溃]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：见 CHANGELOG [2026-07-16-5]。`web/src/components/charts/ParetoChart.tsx:145` 读的是 `d.costCny.toFixed(3)`，但 `ChartPoint` 类型（同文件 28-36 行）只有 `cost` 字段，`toChartPoint()`（38-59 行）产出的对象里也没有 `costCny` —— ISS-038 那次「Pareto x 轴换成 CNY 每次问答」提交时字段名写错了：类型定义补了 `costCny`，运行时字段名保留 `cost`，TypeScript 因为 Recharts 泛型 payload 不做严格检查所以 build 不报错。修法一行：`d.costCny.toFixed(3)` → `d.cost.toFixed(3)`，props 类型 `costCny: number` 同步改成 `cost: number`。

**现象**：
在 Chrome 里打开 `http://localhost:5173/dashboard/#overview`，鼠标移到 ParetoChart（「成本 × 效果」旁边的性价比 Pareto 图）或 ComboChart（`ParetoTooltip` 会被 Recharts 内部错误触发到都不需要 hover 到 Pareto 上）时，DevTools Console 立刻抛：
```
ParetoChart.tsx:145 Uncaught TypeError: Cannot read properties of undefined (reading 'toFixed')
    at ParetoTooltip (ParetoChart.tsx:145:97)
```
React 18 收到 render error → `recoverFromConcurrentError` → 从 root（App）重挂载整棵组件树 → 用户看到的效果就是 Overview 页整块"闪一下重画"，误认为是"图表刷新"。

**后果**：
1. 每次 hover 都触发一次全树 unmount + mount，把 `LiveJobProvider` / `useHashRoute` / 所有页面组件的 state 全洗一遍——ISS-040 / ISS-041 / ISS-042 用户复测时"依然刷新"的根本原因是这里。
2. Overview 页 ParetoChart 的 tooltip 永远显示不出来（每次 render 立刻 throw）。
3. 展会现场观众鼠标只要碰过图表一次就会看到抖动，与"静态基准展示"的叙事直接冲突。

**初步判断**：
已确认。用户在 Chrome DevTools Console 里贴出的 stack trace 直接命中 `ParetoTooltip @ ParetoChart.tsx:145` + `Uncaught TypeError: Cannot read properties of undefined (reading 'toFixed')`。`git blame -L 145 web/src/components/charts/ParetoChart.tsx` 归到 `644cae4 refactor(web): switch Pareto x-axis to total CNY per Q&A [ISS-038]`；同 commit 把 `toChartPoint` 的字段名保留为 `cost` 但 tooltip 那行写成 `costCny`，属于 ISS-038 交付时的 dangling reference。

之前 ISS-041（Recharts entry animation 未关）和 ISS-042（`data` 引用不稳定触发 Recharts state reset）都是**防御性改动，本身也有价值**，但都不是「用户 hover ComboChart 就刷新」的直接根因；用户复测时"还是不行"的原因是这条 `costCny` bug 一直挂着，只要 hover 就 throw，React 就重挂树。三条 issue 之间的关系是：ISS-043 是**真正的根因**，ISS-041 / ISS-042 是**同一现象下顺手修掉的两个已知性能坑**——都保留。

**关联**：
-> web/src/components/charts/ParetoChart.tsx:130,145（`costCny` 全部改回 `cost`）
-> ISS-038 (`644cae4` 提交时 dangling reference)
-> 004CHANGELOG.md [2026-07-16-5]

## [ISS-044] Overview 页扩展第四家 flagship（GPT 5.6 sol）并把 per-benchmark 图拆成得分/成本两张柱图

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[功能异常]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：Overview 顶部 KPI 由 3 张扩到 4 张，新增「GPT 5.6 sol avg score」，读 `data/benchmarks.json` `pareto_data.gpt56Sol.score`；`ComboChart`（折线 + 柱状 combo）删除，改为并列的 `ScoreBarChart` + `CostBarChart` 两张纯柱状图，四条 series 顺序统一为 Fable 5 / GPT 5.6 sol / MoM / Aggregator-only，色系一一对应 `rankFlagship / coralRed / mom / aggregatorOnly`；X 轴 `interval={0} + fontSize:11` 让 `Shopping/Product Comparison` 长标签不再被 Recharts 抽稀；Pareto 图同步只保留同四家、颜色与柱图一比一；三张图的 legend 字号从 `xs`(15) 提到 `md`(20)，Pareto 散点体积从 130/260 → 260/520（ZAxis range 300 → 700）。`per_benchmark` 每行新增 `gpt_score / gpt_cost` 双字段（先占位 0，评测组后续填数）。

**现象**：
- Overview KPI 只列 Fable 5 / MoM / Aggregator-only 三家，缺 GPT 5.6 sol；
- `ComboChart` 折线 + 柱状同时映射两个 Y 轴，只跑 3 家、GPT 5.6 sol 无位置；
- X 轴长标签（如 `Shopping/Product Comparison`）在默认 `interval="preserveStartEnd"` 下被抽稀，用户看不到；
- Pareto 图跑 7 个模型点，颜色和柱图不一致，四家展厅叙事被稀释；
- 三张图 legend 字号偏小，展厅投屏可读性差。

**后果**：
- 展厅叙事缺一个直接对比对象（GPT 5.6 sol），说服链条不完整；
- combo 图混合坐标轴对非技术观众不友好；
- 长 X 轴标签抽稀导致「10 项 benchmark 只看到 5 项」的信息丢失。

**初步判断**：
已确认。`per_benchmark[i]` 只有 `mom/agg/flagship` 三家字段；`pareto_data` 已有 `gpt56Sol` 但未在 KPI/combo 里用；`ComboChart.tsx` XAxis 未设 `interval`。

**关联**：
-> data/benchmarks.json（`per_benchmark` 每行加 `gpt_score / gpt_cost`）
-> web/src/lib/api.ts（`BenchmarkRow` 加两字段）
-> web/src/lib/benchmark-data.ts（`ChartBenchmarkRow` + normalizer 加 `gptScore / gptCost`）
-> web/src/i18n/dict.ts（`kpi.scoreGpt56 / scoreGpt56Hint`；`scoreBarTitle / scoreBarSubtitle / costBarTitle / costBarSubtitle`；`legend.gpt56Sol`）
-> web/src/pages/OverviewPage.tsx（4 KPI + 2 张柱图 + Pareto；KPI 数字着色为对应柱色）
-> web/src/components/charts/ScoreBarChart.tsx（新）
-> web/src/components/charts/CostBarChart.tsx（新）
-> web/src/components/charts/ComboChart.tsx（删）
-> web/src/components/charts/ParetoChart.tsx（只保留 fable5 / gpt56Sol / mom / aggOnly；颜色映射与柱图对齐；legend 与散点尺寸放大）
-> 004CHANGELOG.md [2026-07-16-6]

## [ISS-045] Overview 得分/成本柱图纵轴不贴合真实数据 + 成本单位错标

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[功能异常]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：两张柱图的 domain 计算都过滤掉占位 `0`（`gpt_score`/`gpt_cost` 未填时），只用非零值取 min/max，`ScoreBarChart` 得分域从而由 `[0, 90]` 收敛到 `[30, 80]`，柱体填满绘图区；YAxis 加 `allowDecimals={false}` 强制整数 tick。`CostBarChart` 除同样过滤占位 0 外，`axisMax` 改成分段 step（`<0.1/1/10/50/100` 分别用 `0.01/0.1/1/5/10/50`），当前数据 max 140.9 收敛到 150 而不是 200，顶部空白由 29.5% 降到 6.5%；Y 轴与 tooltip 货币符号从 `$` 改为 `¥`（数据一直是 CNY per Q&A，跟 Pareto x 轴同口径），`overview.comboAxisCost` i18n 由 `Cost ($ / 1k token)` 改为 `Cost (CNY per Q&A)`。

**现象**：
- ScoreBarChart 里 `gpt_score` 全部占位 0，Recharts 把 auto-domain 拉到 `[0, 90]`，真数据 40-60 被压到图表上半段，视觉信息量塌陷；
- CostBarChart Y 轴 tick 和 tooltip 都写死 `$`，但 `per_benchmark[i].*_cost` 一直是 CNY per Q&A（Pareto 图 x 轴标注一致），单位错。

**后果**：展厅观众读得分图看不出模型之间的实际差距（都挤在中间那一段）；读成本图会以为是美元，跟 Pareto x 轴口径打架。

**初步判断**：已确认，两处都是配置层可修复的 UI 数据。

**关联**：
-> web/src/components/charts/ScoreBarChart.tsx（`scoreDomain` 过滤占位 0；YAxis `allowDecimals={false}`）
-> web/src/components/charts/CostBarChart.tsx（`costDomain` 过滤占位 0；`$` → `¥`）
-> web/src/i18n/dict.ts（`overview.comboAxisCost` 英文改为 CNY per Q&A；中文原本已是 `¥`）
-> 004CHANGELOG.md [2026-07-16-7]

## [ISS-046] Overview 柱图 X 轴 benchmark 名走 i18n dict，不再直接读 JSON 原字符串

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：`data/benchmarks.json` 里 `per_benchmark[i].bench` 保持 en 原字符串（数据源单一），`web/src/i18n/dict.ts` 里 `overview.benchLabels` 新增中英两份映射；两张柱图 `XAxis` 用 `tickFormatter` 在渲染时把原字符串替换成本地化标签，`Tooltip` header 也走同一份 dict。dict 里未登记的新 bench → fallback 显示 en 原字符串（不会空）。

**现象**：
- 两张柱图 X 轴直接把 `benchmarks.json` 里的 `bench` 字符串（en）画到轴上，中文语言态下英文标签夹在其它翻译好的 UI 之间不协调；
- 长标签 `Shopping/Product Comparison` 挤在 X 轴上视觉溢出。

**后果**：展厅 zh 语言下 X 轴单独说英语，落地体验割裂。

**初步判断**：已确认，i18n 层缺 benchmark label 词条，UI 层直读 JSON。

**关联**：
-> web/src/i18n/dict.ts（`overview.benchLabels` 中英两份）
-> web/src/components/charts/ScoreBarChart.tsx（XAxis `tickFormatter` + Tooltip 注入 benchLabels）
-> web/src/components/charts/CostBarChart.tsx（同上）
-> 004CHANGELOG.md [2026-07-16-8]

## [ISS-047] Pareto 图 legend 文本彩色，与两张柱图 legend 样式不一致

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：`ParetoChart.tsx` 里的 `<Legend />` 换成 `content={<ParetoLegend />}`，字面 clone `SingleRowLegend`——`color.textSecondary` 文字 + 16×16 彩色 swatch + `font.size.md` + gap 24，颜色只出现在方块上，文字统一灰。

**现象**：Pareto 图 legend 沿用 Recharts 默认渲染，text 被染成 series 颜色；ScoreBarChart / CostBarChart 上面已经是「灰字 + 彩色方块」——三张图对比明显割裂。

**后果**：展厅纵览三张图时视觉不一致，观众第一眼容易误以为 Pareto 图和柱图讲的不是同一批模型。

**初步判断**：已确认，Recharts `<Legend />` 默认 `payload.color` 直接进文本 color。

**关联**：
-> web/src/components/charts/ParetoChart.tsx（新增 `ParetoLegend` 组件；`<Legend content={<ParetoLegend />} />`）
-> 004CHANGELOG.md [2026-07-16-9]

## [ISS-049] Live 页与 Chat 页合并成单页工作流

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[信息架构]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：Chat 页整体折进 Live 页，改成两态单页：empty state 时主内容区居中显示 `Composer`（textarea+发送）+ 其下的 `PresetsList`（一行一条 preset），不渲染任何对比卡片；有 run 时（`current != null` 或 `polling`）隐藏 composer / presets，只渲染 `StatusStrip / MoM / Baseline / Judge / Cost / 跳 Pipeline`。顶部 `RunSelect`（历史下拉 + `+ 新对话` 按钮）在两态都常驻；`+ 新对话` 用 `Button variant="primary"` 强调，点它 `live.reset()` 回到 empty state。`ChatPage.tsx` 删除，`App.tsx` 去掉 chat 路由分支，`Sidebar.tsx` 从 `PageKey` 移除 chat 并把 `ORDER` 收敛到 `['overview', 'live', 'pipeline']`，`t.chat.*` 与 `t.nav.chat` 一并删除。

**现象**：Chat 页只提供"提问"入口，Live 页只提供"查看结果"，用户提问后必须手动跳到 Live 才能看两侧对比，实际使用是频繁的 chat↔live 来回切换。

**后果**：单条对比要跨两张页面，preset 卡片只出现在 Chat 页而不出现在真正呈现对比结果的 Live 页；两个 sidebar 入口做同一件事，用户学不清楚该点哪个。

**初步判断**：已确认，`ChatPage` 和 `LivePage` 已经共用 `LiveJobProvider`（`current` state 由 Context 提供），拆分只是历史遗留（ISS-036 之前的 compose surface 位置调整），没有单独存在的必要。

**关联**：
-> web/src/pages/LivePage.tsx（重写 — 合并 preset+composer 到 Live 页）
-> web/src/pages/live-shared.tsx（+PresetsList, +ComposerBar；旧 Composer 删；MoM/Baseline empty-state 收敛）
-> web/src/components/primitives/MarkdownBody.tsx（footer 条件渲染由 OutputCard 移入）
-> web/src/pages/ChatPage.tsx（**已删除**）
-> web/src/App.tsx / web/src/components/layout/Sidebar.tsx（chat 路由/侧栏入口/PageKey 全部去除）
-> web/src/i18n/dict.ts（`t.chat.*`、`t.nav.chat` 删除；`t.live.newRun` / `t.live.presetsHint` / `t.live.presetsEmpty` / `t.live.emptyModel` 新增）
-> 004CHANGELOG.md [2026-07-16-10]

## [ISS-050] Live 页 MoM / Baseline 回复被截断，超过 2048 token 就断在半截

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[功能异常]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：`LIVE_MAX_TOKENS = 2048` 硬编码常量删除；`MoMConfig` 新增可选 `live: { max_tokens?: number }` 字段与 `DEFAULT_LIVE_MAX_TOKENS = 8192` 默认常量；`buildAnthropicRequest` 改成接收 `maxTokens` 参数，`runLiveTurn` 里读 `mom.live?.max_tokens ?? DEFAULT_LIVE_MAX_TOKENS` 传入。`data/mom.config.json` 显式写入 `"live": { "max_tokens": 8192 }`，让配置面可见。

**现象**：Live Compare 页 MoM 卡和 Baseline 卡的回答文本经常"到句子中间就断掉了"——特别是让模型写代码 / 设计文档 / 长解释时，只出前一半。DevTools 里看 `/api/live/comparison/{gwId}` 返回，`mom.usage.output_tokens = 2048` 是天花板。

**后果**：所有超过 ~1500 中文字（或 ~6000 字符英文）的对比都不完整；观众看到的两侧只是"开头"，判 judge 打分基于半截答案，Cost 卡的 output_tokens 也系统性偏低。

**初步判断**：已确认，`src/live/live-runtime.ts:44` 硬编码 `LIVE_MAX_TOKENS = 2048`，通过 `buildAnthropicRequest` 塞给 `anthropicReq.max_tokens`；同一个 `anthropicReq` 复用给 MoM aggregator (`orchestrator.nonStreaming`) 和 Baseline (`runBaselineCall`)，两侧同一天花板。

**关联**：
-> src/live/live-runtime.ts:44（原硬编码位置）
-> src/live/live-runtime.ts:72-80（`buildAnthropicRequest` 签名变化）
-> src/types/mom.ts（`LiveSettings` 接口 + `MoMConfig.live?` + `DEFAULT_LIVE_MAX_TOKENS` 新增）
-> data/mom.config.json（**gitignored 本地文件**）：用户需手动新增 `live.max_tokens: 8192` 才能覆盖默认
-> 004CHANGELOG.md [2026-07-16-11]

## [ISS-051] Sidebar 占用左侧固定 244px，展会 1080p 屏内容区可用宽度不够

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：Sidebar 由左侧竖排 `<aside width:244>` 改为顶部横排 sticky `<header height:72>`。App 根容器 `flex-direction` 由 `row` 改成 `column`；`theme.ts` 新增 `layout.topBarHeight = 72`（保留 `sidebarWidth` 常量以避免其他文件误引用）。品牌 + tagline 折成两行放左侧，nav pill 居中，语言切换 + 版本号放右侧。

**现象**：Dashboard 面向 1080p 展厅屏（3–4 m 观看距离），左侧 244px 常驻 sidebar 让主内容宽度只剩 ~1676px，Live/Cost 页四列 KPI + 图表被明显压缩。

**后果**：展会现场观众远距看图表数字与轴标签更吃力；Pipeline advisor 卡横排放不下的时候压缩换行。

**初步判断**：已确认，Sidebar 是仅 nav pill + brand + lang toggle 的组件，本来就没有必要占那么宽的竖长条。

**关联**：
-> web/src/components/layout/Sidebar.tsx（`<aside>` → `<header>`，横向布局；FooterBlock 保留但重排）
-> web/src/App.tsx（Router 根 `flex-direction: column`）
-> web/src/theme.ts（`layout.topBarHeight = 72`）
-> 004CHANGELOG.md [2026-07-16-12]

## [ISS-052] 展厅无人接管时 Dashboard 只能停在一页，观众看不到完整闭环

**状态**：[已解决]
**优先级**：[P1 严重]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：新增 kiosk / 轮播模式（`useKioskMode.ts` context）。开启后按 Overview → Live(gwId) → Pipeline(同一 gwId) → 下一轮 循环展示；Live 页内部分阶段揭示卡片（用户 prompt → MoM/Baseline 卡入场 + 打字机 → judge → cost），Pipeline 页 advisor / aggregator preview 也走打字机。轮播队列 = `listComparisons ∩ listTraces(role=aggregator)` 的 gwId 交集（两侧都有数据的记录），交集空时 fallback 单侧队列，跑到缺一侧的阶段自动跳过。全局 pointerdown / keydown / hashchange / visibility hidden 都会立即停止轮播（`data-kiosk-control` 属性排除轮播按钮自身）。入口两处：顶栏语言 pill 旁 `▶ 轮播模式` 按钮 + Live 页"查看请求流程"按钮旁 `▶ 开启轮播`。右下角常驻 `轮播中 · <phase>` 悬浮 pill 提示状态。Live 页 kiosk 期间不再渲染 EmptyState（新建对话页），snap 未就位时改为显示 loading 占位。MoM/Baseline 打字机由 `onDone` 计数（两侧都完成才进入下一阶段），配合 `liveAnswersMaxMs=30000ms` 兜底；Pipeline 停留 25s。

**现象**：展会现场没有工作人员接管时，Dashboard 只能停在 Overview / Live / Pipeline 中的某一页，观众看不到"MoM 报告 → 一次调用的对比 → 内部请求流程"这条闭环故事。

**后果**：观众理解不到 MoM 的完整价值链路，落地效果打折。

**初步判断**：需要一个不依赖后端改动的前端自动播放机制，且必须在观众触屏/键盘时立即让出控制权，避免"抢用户手"。

**关联**：
-> web/src/hooks/useKioskMode.ts（新增 — phase machine + fetchQueueDetailed + 全局停止监听 + notifyLiveAnswerDone）
-> web/src/hooks/useTypewriter.ts（新增 — 按字符推进的通用 hook，onDone 回调）
-> web/src/App.tsx（挂 KioskProvider；新增 KioskOverlay 悬浮状态 pill）
-> web/src/components/layout/Sidebar.tsx（顶栏加 KioskButton pill）
-> web/src/pages/LivePage.tsx（KioskResultView 分阶段渲染 + KioskStartButton；kiosk 时不再走 EmptyState）
-> web/src/pages/live-shared.tsx（MomColumn / BaselineColumn 加 typewriter + cursorOn；OutputCard 触发 notifyLiveAnswerDone）
-> web/src/pages/PipelinePage.tsx（AdvisorCard / AggregatorCard preview 打字机 + autoScroll；kiosk 空 nodes 时显示提示卡片）
-> web/src/components/primitives/MarkdownBody.tsx（新增 `autoScroll` prop，text 变化时滚到底）
-> web/src/global.css（`kioskEnterUp` / `kioskEnterFade` / `kioskPulseRing` 关键帧）
-> web/src/i18n/dict.ts（`t.kiosk.{start,stop,running,startHint,empty,liveStartLabel}` 中英各 6 key）
-> 004CHANGELOG.md [2026-07-16-13]

## [ISS-053] Live 顶部状态条冗长提示把用户 prompt 挤到看不见

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：`t.live.submittedHint` 从「任务在后台执行中，每 3 秒自动刷新一次快照。」缩短为「运行中」（en: `Running`）。状态标签与它拼成 `MoM 完成 · 运行中` 依然读得懂，但不再吞掉 prompt 展示区宽度。

**现象**：
点开一次 Live 调用，顶部 StatusStrip 右侧会拼出 `进行中 · 任务在后台执行中，每 3 秒自动刷新一次快照。`，占据超过半行；左侧的 `USER PROMPT: …` 常被挤到看不见。

**后果**：
Live 页是展厅主视图，用户提问是解释 MoM/Baseline 输出的关键上下文；把它挤没会让观众不知道两侧模型在回答什么。

**初步判断**：
已确认。i18n 文案冗余；`polling` 时拼接的辅助文本不需要把刷新周期告诉用户。

**关联**：
-> web/src/i18n/dict.ts（`live.submittedHint` zh/en 缩短）
-> 004CHANGELOG.md [2026-07-16-14]

## [ISS-054] Live 页 MoM 列 pending 文案错标 `pendingBaseline`；两侧生成中提示缺乏动画

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：新增 `t.live.pendingMom`（zh: 「MoM 正在生成…」/ en: 「MoM is generating…」）替换 MoM 列的错标 key；新增全局 `@keyframes shine-sweep` + `.shine-text` 类，由本地 `PendingLabel` 组件消费，两列 pending 文案带一条冷调渐变光扫过，暗示"还在工作"。

**现象**：
MoM / Baseline 尚未回来的空档，两列 footer 都用同一个 `t.live.pendingBaseline`（「Baseline 正在生成…」）文案——MoM 列本该显示自己的字样。且两条文案完全静态，用户会怀疑页面卡住。

**后果**：
误标造成信息错位；静态文案让 30 秒左右的 MoM 首字延迟感觉像卡死，展会现场观众会离开。

**初步判断**：
已确认。属实现失误 + 微交互缺失，与后端 pipeline 时序无关。

**关联**：
-> web/src/pages/live-shared.tsx（MomColumn 改用 `pendingMom`；新增 `PendingLabel` shine 组件）
-> web/src/i18n/dict.ts（`live.pendingMom` zh/en 新增；`pendingBaseline` en 文案改成 `Baseline is generating…`）
-> web/src/global.css（`@keyframes shine-sweep` + `.shine-text` 使用 `--shine-base` / `--shine-hi` 两个自定义属性）
-> 004CHANGELOG.md [2026-07-16-15]

## [ISS-055] Live 历史记录无法删除，脏记录会让展厅轮播模式碰到 404 卡死

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[功能异常]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：后端新增 `DELETE /api/comparison/:gateway_request_id`，用一段 `BEGIN/COMMIT/ROLLBACK` 事务同时删掉 `comparisons` 行与所有同 `gateway_request_id` 的 `traces` 行，两侧要么全部落地要么原样保留；前端 `useLiveRun.tick` 增加 404 分支（停止轮询、清空 state），`useKiosk` 新增 `invalidateQueue(deletedGwId)`——若命中当前正在播放的 gwId 就 clearTimer + 重取队列 + 从当前 phase 重进；`StatusStrip` 右侧内联「删除 → [取消][确认删除]」小簇。

**现象**：
Live / Pipeline 两页都能列出历史调用，但没有任何入口删除。既有脏调用会一直堆积；展厅 kiosk 模式的队列从 `listComparisons` + `listTraces` 交集/并集取值，任何一侧被外部（如 sqlite 手动清表）清空都会让另一侧记录变成"僵尸"，kiosk 播到那里 GET 404，`useLiveRun` 又不识别 404，导致 3s 一次的死循环。

**后果**：
展厅不可维护；如果运营者想 kiosk 里只保留精心挑过的 demo，只能重启后端清库，粗暴且不可控；kiosk 到僵尸 id 会卡在 loading 空态。

**初步判断**：
已确认。删除必须在两张表的原子操作里完成，前端 kiosk 队列与轮询 hook 必须能对"记录消失"做出反应，否则删除只是把假象换个位置。

**关联**：
-> src/gateway/live-api.ts（`DELETE /api/comparison/:gateway_request_id` 路由 + 事务包裹）
-> src/live/live-store.ts（`deleteComparison(gwId)` helper）
-> src/storage/traces.ts（`deleteTracesByGatewayRequestId(gwId)` helper）
-> src/types/dashboard-api.ts（`DeleteComparisonResponse` 契约）
-> web/src/lib/api.ts（`apiDelete<T>()` + `deleteComparison()` 客户端）
-> web/src/hooks/useLiveRun.ts（`tick` catch 分支识别 `ApiError.status === 404`）
-> web/src/hooks/useKioskMode.ts（`invalidateQueue(gwId)` 挂到 Context）
-> web/src/pages/live-shared.tsx（`StatusStrip` 内联删除簇）
-> web/src/pages/LivePage.tsx（`handleDelete` + `jobsBumpKey`）
-> web/src/i18n/dict.ts（`live.deleteRun{,Confirm,ConfirmYes,ConfirmNo,Pending,Error}` zh/en 6 key）
-> 004CHANGELOG.md [2026-07-16-16]

## [ISS-056] Pipeline 历史选择器信息噪声：hash + 模型名把 prompt 挤没

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：`PipelinePage` 顶部 TurnSelect 数据源从 `listTraces({role: 'aggregator'})` 切成 `listComparisons(20)`，option 文案从 `time · <hash8> · <model>` 改成和 Live 页 RunSelect 一致的 `time · <clipped-prompt>`。`recent` 状态类型从 `TraceSummary[]` 收敛为 `ComparisonListItem[]`，其它读取 `recent` 的地方只用 `length` 与 `map`，不受影响。

**现象**：
`http://localhost:5173/dashboard/#pipeline` 顶部 TurnSelect 每一项显示 `18:32:14 · a7f2e1cd · deepseek-v4-flash`。gateway_request_id 前缀和 aggregator 模型名对现场观众/用户没有语义价值，反而占满宽度，看不到"这是哪个 prompt 触发的"。同一份数据在 Live 页的 RunSelect 里显示的是 `时间 + prompt 截断`，两页体验割裂。

**后果**：
Pipeline 是给观众看请求流程的展示页，历史选择需要一眼认出"是那次问 Rust 二分查找的"；hash + 模型名让人得点开才知道，浪费观众注意力，也把 Pipeline 的历史心智模型和 Live 页拉开。

**初步判断**：
已确认。`listTraces` 曾是 Pipeline 唯一入口，本身没有 prompt 字段所以只能塞 hash + model 顶包；ISS-035 起 `listComparisons` 已经把 prompt 平推出来，Pipeline 早该跟上。

**关联**：
-> web/src/pages/PipelinePage.tsx（`recent` 类型 + `listComparisons` 替换 `listTraces`；`TurnSelect` option 文案与 minWidth/maxWidth 与 Live 页对齐）
-> 004CHANGELOG.md [2026-07-16-17]

## [ISS-057] Pipeline TurnSelect 会列出没有 aggregator trace 的 gwId，点开落到空态

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[功能异常]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：`PipelinePage` dropdown 数据源改成 `listComparisons(20)` 与 `listTraces({role:'aggregator'})` 的**交集**——option 只列出两侧都在的 gwId，保证每条选中都能画流程图；文案继续走 comparisons 侧的 `time · clipped-prompt`，交集判定走 traces 侧的 `Set<gateway_request_id>`。这与 `useKioskMode.fetchQueueDetailed` 的取交集策略一致，两处不再打架。

**现象**：
ISS-056 把 Pipeline dropdown 换到 `listComparisons(20)` 后，凡是 `traces` 表里没有 aggregator trace 的 gwId 也会被列出来（MoM early error / passthrough / ISS-035 之前的老数据）。用户点这种 option，右侧渲染出「还没有 aggregator turn 记录」的空态提示。示例：gwId `5052957c` 存在于 `comparisons`，但 `getTracesByGateway` 返回的列表里没有 `role='aggregator'` 那一行。

**后果**：
展厅历史选择器可能落到"选了不代表能看"的状态，破坏 Pipeline 页作为"点历史 → 看流程"的心智；kiosk 队列长期沿用交集策略从不出现这个问题，Pipeline 手选交互回归后反而更差。

**初步判断**：
已确认。ISS-056 简化时把"必然有 aggregator trace"的隐式契约丢了；`getTracesByGateway` 无 aggregator 行时 `buildTurnData` 得到 `turn.nodes.length === 0`，走 ISS-052 加的空态卡片分支。

**关联**：
-> web/src/pages/PipelinePage.tsx（初始加载改成 `Promise.all([listComparisons(20), listTraces({role:'aggregator'})])` 后取 gwId 交集）
-> 004CHANGELOG.md [2026-07-16-18]

## [ISS-058] Pipeline TurnSelect 采用严格交集后，最近 20 窗口不重叠时下拉整体清空

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[功能异常]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：把 dropdown 数据源改成 traces(role='aggregator') 为主源 + comparisons 作为 prompt 增补：`recent` 类型从 `ComparisonListItem[]` 换成本地 `TurnOption { gateway_request_id, started_at, prompt, fallback_model }`；aggregator traces 的每一条都进 `recent`（保证能画流程图），prompt 从 `comparisons` 里按 gwId 查表，命中就用 `time · <clipped-prompt>`，没命中就 fallback 到 `time · <hash8> · <model>`。这样既不因老数据消失、也不因窗口不重叠让 dropdown 变空。

**现象**：
ISS-057 的严格交集实现（`comparisons ∩ aggregator-traces`）在 `listComparisons(20)` 与 `listTraces(20, role='aggregator')` 的 gwId 集合完全不重叠时（老 aggregator trace 是 Phase 3-5 test 数据、没有对应 comparison 行；新 comparison 都是 MoM 早失败没跑到 aggregator）→ 交集为空 → Pipeline 页 dropdown 一个 option 都不显示。用户反馈："Live 页历史正常，Pipeline 一个都没有；之前虽然格式错，起码有内容"。

**后果**：
Pipeline 页历史完全丢失，展厅无法从下拉找到任何旧 turn；ISS-057 是"从坏 option 里过滤掉不能画的"，走过头变成"两侧不重叠时全丢"，回归比 ISS-056 之前更差。

**初步判断**：
已确认。根因是把"过滤"和"prompt 增补"耦合到一个数据源上；aggregator traces 单独就能承担"能不能画"这个语义，comparisons 只是文案增强，两者不该做严格 join。

**关联**：
-> web/src/pages/PipelinePage.tsx（`recent` 类型改为 `TurnOption`；aggregator traces 全进，`Map<gwId, prompt>` 增补，缺 prompt 时回落 hash8 + model）
-> 004CHANGELOG.md [2026-07-16-19]

## [ISS-059] Pipeline TurnSelect 需要和 Live 历史 100% 同源同格式，不允许 fallback 到 hash+model

**状态**：[已解决]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：ISS-058 的"aggregator traces 为主源 + comparisons 做 prompt 增补 + 缺 prompt fallback hash+model"被用户明确否掉——诉求是"跟 Live 的历史记录一样"，视觉一致优先于覆盖率。改回单纯 `listComparisons(20)`，与 Live RunSelect 同源同格式；一个 comparison 若没对应 aggregator trace，点开时右侧本来就有的 `turn.nodes.length===0` 空态卡兜住，代价可接受。

**现象**：
ISS-058 落地后 Pipeline dropdown 大部分 option 显示 `time · <hash8> · <model>`，因为最近 20 aggregator traces（老 Phase 3-5 test 数据）和最近 20 comparisons（新数据）几乎不重叠。用户反馈"格式又恢复原状了，等于没改"。

**后果**：
Pipeline 历史记录心智仍与 Live 割裂，ISS-056 的初衷（两页历史列表格式统一）被抵消。

**初步判断**：
已确认。ISS-057 → ISS-058 一路上试图守住"每条 option 都能画流程图"这个隐式契约，但用户实际要的是"格式统一 + Live 页删除已经能让脏 comparison 无法再被点到"，两个约束次序颠倒了。

**关联**：
-> web/src/pages/PipelinePage.tsx（dropdown 数据源改回 `listComparisons(20)`；`recent` 类型回到 `ComparisonListItem[]`；`TurnSelect` 文案纯粹 `time · clipped-prompt`）
-> 004CHANGELOG.md [2026-07-16-20]

## [ISS-060] Live StatusStrip 删除入口是"删除"文字按钮，用户找不到；期望是显眼的叉号图标

**状态**：[已解决]
**优先级**：[P3 轻微]
**类型**：[体验]
**发现日期**：2026-07-16
**解决日期**：2026-07-16
**解决方案**：`StatusStrip` 删除触发按钮从 ghost 变体的"删除"文字按钮改成一个 28×28 圆形 `×` 图标按钮（`bgSubtle` 底 + `borderStrong` 描边 + `textSecondary` 灰字），带 `title="删除"` tooltip。点击行为不变——仍展开内联的「取消 / 确认删除」小簇二次确认，防误触。

**现象**：
用户"我之前加了删除历史记录的功能，说是点开查看历史右边有个叉号可以同步删除…这个功能似乎也没成功修改"——ISS-055 把触发做成了 ghost 风格的"删除"文字按钮，在 StatusStrip 右侧灰调背景下几乎看不出是按钮，用户误以为没做。

**后果**：
功能可用但用户觉得没做，事实上等价没做。

**初步判断**：
已确认。ISS-055 时怕"删除历史"太醒目导致误点，选了 ghost 变体；现在用图标 + 二次确认小簇，两头都占：显眼 + 不误删。

**关联**：
-> web/src/pages/live-shared.tsx（`StatusStrip` 触发从 `<Button variant="ghost">删除</Button>` 换成 `×` 图标按钮；二次确认簇不变）
-> 004CHANGELOG.md [2026-07-16-20]

<!--
新增条目模板：

## [ISS-NNN] 问题标题

**状态**：[发现]
**优先级**：[P2 一般]
**类型**：[功能异常]
**发现日期**：YYYY-MM-DD

**现象**：
客观描述，附可复现路径。

**后果**：
不处理会发生什么。

**初步判断**：
推测 或 已确认，附证据。

**关联**：
-> src/xxx.ts:行号
-> decisions/NNN-xxx.md（如已拍板）
-->
