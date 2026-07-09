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
