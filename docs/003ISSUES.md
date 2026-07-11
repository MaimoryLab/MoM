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
