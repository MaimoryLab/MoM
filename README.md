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
git clone https://github.com/MaimoryLab/MoM.git
cd MoM
npm install
```

---

## 配置

配置分两层，分工明确：

- **`.env`**（部署配置 / 秘钥）：provider 秘钥、监听端口、数据文件路径
- **`data/mom.config.json`**（业务配置）：MoM 触发模式、advisor slots、aggregator 模型、定价表 等；不含任何秘钥

### 1. `.env`（provider 秘钥）

```bash
cp .env.example .env
# 编辑 .env，至少填 PROVIDER_BASE_URL 与 PROVIDER_API_KEY
# PROVIDER_AUTH_STYLE 默认 bearer；官方 Anthropic 用 x-api-key
```

### 2. `data/mom.config.json`（业务配置）

首次启动时会自动写入 `DEFAULT_MOM_CONFIG`——它是安全的空壳（`mom_mode=off`、`advisor.slots=[]`、`aggregator.model=""`），需要手工填模型名后 MoM 才会真的 fan-out。此后可以直接 `vi` 编辑，或者等 Phase 5 的 Dashboard 表单。Dashboard 不编辑秘钥——秘钥永远只改 `.env`。

模型名分别填在两个位置：

- `advisor.slots`：advisor 模型名数组，一个元素等于一个并发的 advisor 请求（3 个 slot 就 fan-out 3 次）
- `aggregator.model`：单个 aggregator 模型名，负责把 advisor 的 references 汇总成最终回复

模型名需要是 `.env` 里 `PROVIDER_BASE_URL` 那个 provider 侧真实存在的模型 id；slots 里的模型可以与 aggregator 相同，也可以彼此重复。

一份能直接跑 fan-out 的示例（把 `<...>` 换成 provider 侧真实的模型名即可）：

```json
{
  "mom_mode": "always",
  "fanout_mode": "user_turn",
  "aggregation_mode": "concat",
  "reference_max_tokens": 4096,
  "advisor": {
    "slots": ["<advisor-model-1>", "<advisor-model-2>", "<advisor-model-3>"],
    "tools_enabled": false
  },
  "aggregator": {
    "model": "<aggregator-model>"
  },
  "judge": {
    "model": ""
  },
  "cache": {
    "ttl": "5m",
    "max_entries": 1000
  },
  "comparison": {
    "enabled": false,
    "baseline_model": ""
  },
  "pricing_table": {},
  "cost_tradeoff": {
    "enabled": false
  }
}
```

`mom_mode` 目前有效值：`always` 每个 user turn 都触发 fan-out（推荐默认）；`off` 完全透传（`auto` 已列入类型但当前实现等价于 `off`）。`pricing_table` 留空时 trace 的 `pricing` 快照为 null、eval 侧算不出成本，但**不影响功能**；建议按下一小节一次性从 provider 灌入。字段含义见 [`docs/005DEVELOPMENT.md`](docs/005DEVELOPMENT.md)。

### 3. 首次同步定价（推荐）

`data/mom.config.json.pricing_table` 默认为空。第一次跑之前建议执行一次同步脚本，从 `.env` 里的 provider `/v1/models` 拉取当前模型价格，按 per-1M-tokens 换算后写入 `pricing_table`，之后 trace 的 `pricing.currency` / `input_per_million` / ... 字段就有值、eval 侧可以现算成本：

```bash
# 默认 currency=CNY（当前 paigod 数据源是人民币）；只补齐缺失项、不覆盖手改
npm run sync-pricing

# 换 provider 或币种时显式指定
npm run sync-pricing -- --currency USD

# 想先看要写什么、不真的落盘
npm run sync-pricing -- --dry-run
```

脚本永远不会删除本地 `pricing_table` 里 provider 不再列出的条目（只打印 `SKIP unknown-to-provider`）。加 `--overwrite` 才会覆盖已有条目。以后新增 advisor slot 或换 aggregator 模型时，重新跑一次即可。

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
