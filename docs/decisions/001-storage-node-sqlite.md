# 001. 存储层从 better-sqlite3 切换到 Node 内置 node:sqlite

**日期**：2026-07-09
**状态**：已决策
**关联 Issue**：ISS-001

## 背景

Phase 1 骨架期原本按"embedded SQLite + 同步 API"选型接入了 `better-sqlite3` 作为 storage 层的驱动。实际执行 `npm install` 时发现该依赖的 native addon（node-gyp / prebuild）与较新版本的 Node 存在兼容窗口错位——要装上就得把 Node 降级到该版本 better-sqlite3 有对应 prebuild binary 的区间内。

Phase 1 只有两条 SQL 语句、两处调用（`src/storage/db.ts` 和 `src/storage/settings.ts`），此时是包袱最小的切换窗口。不切换的后果是：任何拿到仓库尝试运行的开发者/使用者都要先解决 Node 版本问题，这个门槛会显著阻碍 Phase 2+ 的实测与外部试用。

## 被否定的方案

### 方案 B：改成纯文件（JSON + JSONL）
否定原因：Phase 4 的 metrics 需要按时间窗口聚合 traces，SQL 的 `WHERE timestamp > ? GROUP BY ...` 与索引对该场景本身就是最合适的工具。放弃 SQL 换成纯文件，会把 Phase 4 的聚合逻辑推向内存全扫或自建索引，属于用不方便的地方换回可有可无的方便。Phase 1 的 JSON blob 存储形态在 Phase 4 之前的确不需要 SQL，但为此再切一次技术栈的成本高于一次切到位。

### 方案 C：`sql.js`（SQLite 编译成 WASM）
否定原因：为了保留 SQL 语义，引入 1 MB WASM 与 1-2 秒启动初始化开销；写入不会自动持久化到磁盘，必须显式 `db.export()` 到文件——每次写完都要额外一步 flush，增加了错落盘的失败面。同步 API 只是"看起来同步"，本质是把 SQLite 塞进 JS 运行时，工程复杂度不降反升。

### 方案 D：`@libsql/client`（LibSQL / Turso）
否定原因：只提供 async API。当前 `loadSettings()` 是同步的、被 `config.ts` / `messages-handler.ts` 直接调用。切到 async 会把 async 传染到整条请求链，改动面远大于问题本身。且引入的仍然是第三方 native 二进制预编译包，风险类别与 better-sqlite3 同类。

### 方案 E：保留 better-sqlite3，只锁 Node 版本到有 prebuild 的区间
否定原因：让每一个未来的开发者都要先降 Node 才能装依赖，是把成本转嫁给所有使用者以换取维持"一次决定"的稳定，方向相反。且 prebuild 覆盖是被动的——每次 Node 出新版都要重新审视一次。

## 最终决策

Storage 层驱动从 `better-sqlite3` 切换到 Node 内置模块 `node:sqlite`（`DatabaseSync`）。SQLite 引擎、schema、SQL 语句、同步 API 形态全部保留；把 `engines.node` 从 `>=20` 提升到 `>=22.13.0`（node:sqlite 从该版本起脱离 experimental）；删除 `better-sqlite3` 与 `@types/better-sqlite3` 依赖。

## 已知代价

### 代价 1: 最低 Node 版本从 20 提升到 22.13
node:sqlite 在 v22.5.0 引入时为 experimental，v22.13.0 起才脱离 flag 直接可用。因此本方案把 `engines.node` 从 `>=20` 提升到 `>=22.13.0`。相较"必须精确匹配 better-sqlite3 prebuild 窗口的某个 Node 版本"仍然是净收益——Node 22 是 LTS，22.13 已于 2025 年初发布，且此后新版本全部保持兼容。
**Followup**: 暂不追踪

### 代价 2: `prepare()` 失去 TypeScript 泛型参数
better-sqlite3 提供 `db.prepare<Params, Row>(...)` 泛型，`settings.ts` 里用了这个签名。node:sqlite 的 `StatementSync` 不带泛型，需要在调用处对 `.get()` / `.all()` 的返回值手动 `as Row | undefined` cast。影响面仅 `settings.ts` 与 Phase 3 将新增的 `traces.ts`，非侵入性。
**Followup**: 暂不追踪

### 代价 3: 没有 `db.pragma()` helper，PRAGMA 必须走 `exec()`
`db.pragma('journal_mode = WAL')` 要改成 `db.exec('PRAGMA journal_mode = WAL')`；`foreign_keys = ON` 可通过构造参数 `enableForeignKeyConstraints: true` 表达。语义与写法差异微小，且 PRAGMA 语句只在 `initDB()` 里出现一次。
**Followup**: 暂不追踪

### 代价 4: node:sqlite 官方稳定度标注为 "Release candidate"（Node 25.7 起）
截至 Node 25 官方文档仍在 "1.2 - Release candidate" 级别，理论上有 API 微调风险。但从 v22.13 到 v25 已经保持稳定，且属于 Node 官方模块——修改会以 Node 通常的兼容策略推进。相比 native addon 的编译失败风险，此风险不在同一量级。
**Followup**: 暂不追踪
