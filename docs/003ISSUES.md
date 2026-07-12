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

**状态**：[讨论中]
**优先级**：[P2 一般]
**类型**：[体验]
**发现日期**：2026-07-11

**现象**：
`data/mom.config.json.pricing_table` 目前为空，每次新增 advisor slot 或换 aggregator 模型都要人肉查 provider 定价填字段，否则 `src/cost/pricing.ts` 打 `event=pricing_missing` warn、trace 的 `cost_usd` 被记为 0（ISS-009 重构后每条 TraceRequest 内嵌 pricing / cost）。已确认当前 provider `apiproxy.paigod.work/v1/models` 响应里带 `price.{input_price, output_price, cached_price}`（per-token USD），可用作数据源。

**后果**：
- 成本分账在无 pricing 时静默降级为 0；ISS-009 交付的 `/trace/requests` 接口对 eval 侧价值受损（pricing 快照全 null，无法算成本）
- 新加模型时容易忘记补 pricing 字段
- 人工填价无法覆盖"provider 侧价格变动"场景

**初步判断**：
已确认——provider `/v1/models` 明确暴露价格字段；结构在不同 provider 间可能不同，同步器需要处理"字段命名 / 单位换算 / 缺失字段"三类差异。

**方案讨论**：（待定）
- 方案 A：一次性运维脚本 `scripts/sync-pricing.mjs`，手动执行拉取并写入 `data/mom.config.json`
- 方案 B：网关启动时可选自动同步（`sync_pricing_on_boot: true`），只补齐缺失项、不覆盖手改
- 方案 C：Phase 4 dashboard-api 暴露 `POST /api/pricing/sync`，前端 SettingsPage 加"同步价格"按钮
- 边界约束（**已由 decision 006 定死**）：pricing 冻结点是请求时深拷贝 `momConfig.pricing_table[selected_model]`。同步器只负责把 provider `/v1/models` 的价格落到 `data/mom.config.json.pricing_table`，orchestrator 读取路径不变

**关联**：
-> data/mom.config.json（pricing_table 字段）
-> src/cost/pricing.ts（消费方；ISS-009 后新增 snapshotPricing 供 orchestrator 冻结）
-> src/types/mom.ts（ModelPricing 类型 + PricingSnapshot 类型）
-> decisions/006-eval-trace-request-api.md §不在本期范围 项 1
-> PLAN.md（Phase 3 §6 "pricing 热更"，Phase 5 SettingsPage pricing_table 编辑器）

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
