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

## [ISS-003] Trace.settings_snapshot 类型带 RuntimeConfig 会把 api_key 写进 SQLite

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
-> decisions/003-trace-snapshot-scope.md
-> 004CHANGELOG.md [2026-07-09-3]

---

## [ISS-004] Phase 2 主链路（Advisor 视图 + Fan-out + Concat 拼接）尚未实现

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
-> 004CHANGELOG.md [2026-07-09-3]

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
