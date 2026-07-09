# 002. 配置分层：env 装秘钥，config.json 装业务配置，SQLite 只装运行时数据

**日期**：2026-07-09
**状态**：已决策
**关联 Issue**：ISS-002

## 背景

Phase 1 现状把所有可配项——`provider.base_url` / `provider.api_key` / `provider.auth_style`、以及 `advisor.slots` / `aggregator.model` / `pricing_table` / `cache.*` / `comparison.*` 等业务字段——统一封装成 `MoMSettings`，序列化后塞进 SQLite `settings` 表的 JSON blob。项目**没有 `.env` 文件、没有 `process.env.PROVIDER_API_KEY` 之类的读取路径**。

这个选型隐含了一个未言明的架构假设："Dashboard 是唯一的配置适配层，settings 只有一个统一编辑对象"。PLAN 后续阶段继承同一假设：Phase 2 的 `buildAuthHeaders(settings)` 直接从 `settings.provider` 读秘钥；Phase 5 的 SettingsPage 计划"表单绑定 `MoMSettings` 所有字段"——把 api_key 也当作浏览器表单字段编辑。

实测中暴露出来的具体后果见 ISS-002 现象/后果段。核心矛盾是：**部署配置（秘钥）与业务配置（模型选择、触发模式）天然是不同的读者与生命周期**，不该共用一个存储层。

进 Phase 2 之前解决，改动面最小（只 Phase 1 的 4-5 处调用点）；进 Phase 2 之后再改，会顺带撕开 provider-client 与 Dashboard 设置表单。

## 被否定的方案

### 方案 B：秘钥继续放 SQLite，补一个"首次启动时从 env 覆盖 SQLite"的 fallback
否定原因：解决了"首次填 key 的摩擦"，但没解决秘钥旅行（`mom.db` 依然带着秘钥字段，只是有时会被 env 覆盖）。"两个真实来源相互覆盖"是配置管理的经典反模式——运行时行为取决于加载顺序，与文件是否已存在有关，重启后可能出现"env 里改了但 SQLite 里还是旧值"的静默错误。

### 方案 C：所有配置塞一份纯 JSON 文件（含 api_key），完全放弃 env
否定原因：秘钥仍然旅行在项目文件里，与"塞 SQLite"相比只是换了容器。不解决"备份共享含秘钥、部署时反直觉、CI/Docker 不自然"这三条根因。

### 方案 D：引入 `dotenv` 包读取 .env
否定原因：Node 22.6+ 原生支持 `--env-file=.env`，Phase 1 已把 `engines.node` 顶到 22.13.0；再引一个第三方包做同样的事情，是白白增加供应链攻击面。

### 方案 E：保留现状，只改文档告诉用户"生产环境请自己在 SQLite 里改 api_key"
否定原因：把架构问题当作文档问题处理，只是把成本转嫁给每一个使用者。且不解决 PLAN Phase 5 SettingsPage 把 api_key 作为浏览器表单字段的连带问题。

## 最终决策

配置按"读者与生命周期"分三层，各归各家：

| 层 | 承载 | 谁读 | 谁改 | 存储 |
|---|---|---|---|---|
| L1 部署配置 | `provider.base_url` / `provider.api_key` / `provider.auth_style` | provider-client | 部署者 | **`.env`**（Node 22 `--env-file`；`.env` gitignore，仓库含 `.env.example`） |
| L2 业务配置 | `mom_mode` / `fanout_mode` / `aggregation_mode` / `reference_max_tokens` / `advisor` / `aggregator` / `judge` / `cache` / `comparison` / `cost_tradeoff` / `provider.pricing_table` | 各 runtime | Dashboard 用户 或 手工编辑 | **`data/mom.config.json`**（原子 rename 写入；gitignore） |
| L3 运行时数据 | `traces` / `metrics_cache` | Trace 查询 / metrics 聚合 | 网关自身 | **`mom.db`**（node:sqlite） |

配套结构变化：
- 拆 `MoMSettings` 为 `ProviderConfig`（L1）+ `MoMConfig`（L2，不含 provider.\*），`RuntimeConfig = { provider: ProviderConfig; mom: MoMConfig }`——网关内部各层拿到自己需要的那一半
- 删除 SQLite `settings` 表；`src/storage/settings.ts` 删除
- 新增 `src/config/provider-env.ts` 与 `src/config/mom-config-file.ts` 两个独立加载器
- `pricing_table` 归 L2：它是"业务定价、非秘钥、非部署环境相关，Dashboard 明确要编辑"
- `provider.pricing_table` 迁移后从 `ProviderConfig` 中剔除，改属 `MoMConfig.pricing_table`——保持"L1 里只有部署时定死的东西"这一原则
- Dashboard SettingsPage（Phase 5）明确**不显示、不编辑秘钥字段**，只只读展示"当前 provider base_url 状态"

## 已知代价

### 代价 1: 用户要学两处配置的边界
用户第一次跑要装两个东西：`.env`（部署配置）和 `data/mom.config.json`（业务配置）。相比"改一处 SQL 就跑"多了一步认知成本。缓解：`.env.example` 提交到仓库、`005DEVELOPMENT.md` 给出最短 quickstart（cp .env.example .env → 填 3 个字段 → npm run dev）。
**Followup**: 暂不追踪

### 代价 2: `provider.pricing_table` 从 provider 名空间迁出
Phase 1 的 `MoMSettings.provider.pricing_table` 在语义上属于业务配置（Dashboard 编辑对象），但字段命名放在了 provider 里。迁移后归 `MoMConfig.pricing_table`，与 provider 名空间解耦。Phase 3 的 `src/cost/pricing.ts` 从 `settings.provider.pricing_table` 改读 `momConfig.pricing_table`——路径调整、语义不变。
**Followup**: 暂不追踪

### 代价 3: `RuntimeConfig` 传递面比原 `MoMSettings` 多一层结构
原来函数签名 `foo(settings: MoMSettings)`，现在或者 `foo(cfg: RuntimeConfig)`、或者按需拆成 `foo(providerCfg, momCfg)`。Phase 1 的 4-5 处调用点手动 rewire；Phase 2+ 的新增调用点在编写时就按分层习惯组织参数。可接受，是"参数意图更清晰"的价值取代"字段少一层嵌套"的便利。
**Followup**: 暂不追踪

### 代价 4: `MOM_DB_PATH` 与 `MOM_PORT` 与新 provider env 三者混在同一个 `.env`
`.env` 里会同时出现 `PROVIDER_BASE_URL`、`PROVIDER_API_KEY`、`PROVIDER_AUTH_STYLE`、`MOM_PORT`、`MOM_DB_PATH`、`MOM_CONFIG_PATH`（新）。文件里字段多一些不算复杂——按前缀分组即可（`PROVIDER_*` / `MOM_*`）。
**Followup**: 暂不追踪

### 代价 5: `.env` 加载依赖 Node 22.6+ 的 `--env-file` flag
`--env-file` 从 v20.6.0 引入、v22.6+ 稳定。项目 `engines.node` 已经 `>=22.13.0`（node:sqlite 决策决定），无新增下限。
**Followup**: 暂不追踪
