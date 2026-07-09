# MoM (Mixture of Models)

<div align="center">

[中文版](README.md) · [English](README.en.md)

</div>

MoM 是位于 Claude Code 与 provider 之间的独立 HTTP 网关。它把每一次 Claude Code 请求 fan-out 到多个廉价 advisor 模型，把它们的 references 拼给一个 aggregator 模型，用组合的方式逼近旗舰模型的能力。入口与出口都是 Anthropic Messages API，Claude Code 无需任何改动，只需把 `ANTHROPIC_BASE_URL` 指向 MoM。

当前处于 Phase 1（骨架 + 协议透传），网关本身尚不做 MoM 逻辑，等价于直连 provider。后续阶段依次接入 fan-out、references 拼接、缓存、trace 落盘与 Dashboard。分阶段计划见 [`PLAN.md`](PLAN.md)。

---

## 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | >= 22.13.0 |
| npm | 随 Node 22 自带（用于 workspaces） |

SQLite 通过 Node 内置模块 `node:sqlite` 使用，无需另装、无 native 编译。

---

## 安装

```bash
git clone <this-repo>
cd MoM
npm install
```

---

## 配置

Phase 1 尚无 Dashboard 设置表单，用 Node 内置 SQLite 修改 `settings` 单行（无需另装 sqlite3 CLI）：

```bash
node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('mom.db');
db.prepare('UPDATE settings SET data = json_set(data, ?, ?, ?, ?, ?, ?) WHERE id = 1')
  .run('\$.provider.base_url', 'https://your-provider/anthropic',
       '\$.provider.api_key',  '<your-key>',
       '\$.provider.auth_style', 'bearer');
"
```

`auth_style` 可选 `bearer`（`Authorization: Bearer <key>`，兼容 OpenRouter / DeepSeek / Kimi 等）或 `x-api-key`（Anthropic 官方）。

---

## 启动

```bash
# 构建前端（可选：不构建时 /dashboard/ 会返回占位 HTML）
npm run build:web

# 启动网关（默认端口 3000）
npm run dev
```

Claude Code 侧：

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
claude
```

访问 `http://localhost:3000/dashboard/` 可看到前端骨架。

---

## 相关文档

- [分阶段实施计划](PLAN.md)
- [架构说明](docs/001ARCHITECTURE.md)
- [目录结构](docs/002STRUCTURE.md)
- [变更记录](docs/004CHANGELOG.md)
- [开发与测试](docs/005DEVELOPMENT.md)
