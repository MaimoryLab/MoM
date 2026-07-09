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

配置分两层，分工明确：

- **`.env`**（部署配置 / 秘钥）：provider 秘钥、监听端口、数据文件路径
- **`data/mom.config.json`**（业务配置）：MoM 触发模式、advisor slots、aggregator 模型、定价表 等；不含任何秘钥

先建 `.env`：

```bash
cp .env.example .env
# 编辑 .env，至少填 PROVIDER_BASE_URL 与 PROVIDER_API_KEY
# PROVIDER_AUTH_STYLE 默认 bearer；官方 Anthropic 用 x-api-key
```

`data/mom.config.json` 首次启动时自动生成 `DEFAULT_MOM_CONFIG`，之后可以直接手工 `vi` 编辑，或者通过 Phase 5 上线的 Dashboard 表单编辑。Dashboard 不编辑秘钥——秘钥永远只改 `.env`。

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
