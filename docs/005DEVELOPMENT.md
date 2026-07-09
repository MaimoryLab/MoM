# 005DEVELOPMENT.md — 开发环境与测试记录

> **AI 协作约定**：每次涉及测试或环境配置变更时，将新记录插入本文件顶部（紧接本约定块之后），保留全部历史。
>
> 本文件只记录「如何让当前版本跑起来并验证它正确」，不记录原因（原因在 `decisions/`）。

---

## [2026-07-09] 存储层切换到 node:sqlite（Node 内置）

### 环境要求

| 依赖 | 版本要求 | 备注 |
|------|---------|------|
| Node.js | >= 22.13.0 | `node:sqlite` 从 v22.13.0 起脱离 experimental，无需 flag |
| npm | 随 Node 22 自带 | 支持 workspaces |
| SQLite | 无需单独安装 | 通过 Node 内置 `node:sqlite` 模块，零第三方依赖、零 native 编译 |

### 差异说明

- `package.json` 移除 `better-sqlite3` 与 `@types/better-sqlite3`；`engines.node` 从 `>=20` 提升到 `>=22.13.0`
- `src/storage/db.ts` 用 `DatabaseSync` 打开数据库，DDL 直接以模板字符串常量 `SCHEMA` 内联在同文件；不再需要独立 `schema.sql` 与 build 期拷贝
- `src/storage/settings.ts` 由于 `StatementSync` 不支持泛型，`.get()` 结果改用 `as SettingsRow | undefined` cast

---

## [2026-07-08] Phase 1 骨架 — 透传网关 + Dashboard "Hello MoM"

### 环境要求

| 依赖 | 版本要求 | 备注 |
|------|---------|------|
| Node.js | >= 20 | 使用 `node:` 内建模块与 undici 6 |
| npm | 随 Node 20 自带 | 支持 workspaces |
| SQLite | 无需单独安装 | 通过 better-sqlite3 内嵌 |

### 安装与启动

```bash
# 根目录一次装齐前后端依赖
npm install

# 构建前端（可选：不构建时访问 /dashboard/ 会看到占位 HTML）
npm run build:web

# 启动网关（默认 :3000；改端口用 MOM_PORT=xxxx）
npm run dev
```

预期看到 `MoM gateway listening on 3000`。

### 配置 provider

Phase 1 尚无 Dashboard 表单，通过 Node 内置 SQLite 直接改（无需另装 sqlite3 CLI）：

```bash
node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('mom.db');
db.prepare('UPDATE settings SET data = json_set(data, ?, ?, ?, ?, ?, ?) WHERE id = 1')
  .run('\$.provider.base_url', 'https://api.deepseek.com/anthropic',
       '\$.provider.api_key',  'sk-xxx',
       '\$.provider.auth_style', 'bearer');
console.log(db.prepare('SELECT data FROM settings WHERE id = 1').get());
"
```

若本机已装 `sqlite3` CLI，也可以：

```bash
sqlite3 mom.db "UPDATE settings SET data = json_set(data,
  '\$.provider.base_url', 'https://api.deepseek.com/anthropic',
  '\$.provider.api_key',  'sk-xxx',
  '\$.provider.auth_style', 'bearer') WHERE id = 1"
```

### 手动验证（对应 PLAN.md Phase 1 验证清单）

```bash
# 1. Dashboard 骨架
curl http://localhost:3000/dashboard/
# 期望：HTML；浏览器打开可见 "Hello MoM"

# 2. Settings 默认值已落库
node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('mom.db').prepare('SELECT data FROM settings WHERE id = 1').get())"
# 期望：DEFAULT_SETTINGS 的 JSON

# 3. 非流式透传
curl -X POST http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"<provider 的某模型>","messages":[{"role":"user","content":[{"type":"text","text":"Hello"}]}],"max_tokens":100}'
# 期望：provider 返回，结构符合 AnthropicMessagesResponse

# 4. 流式透传
curl -N -X POST http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"<provider 的某模型>","messages":[{"role":"user","content":[{"type":"text","text":"Hi"}]}],"max_tokens":50,"stream":true}'
# 期望：content-type: text/event-stream，逐条 event: message_start / content_block_delta / message_stop

# 5. Claude Code 联调
ANTHROPIC_BASE_URL=http://localhost:3000 claude
# 期望：正常收到回复（此时等价于直连 provider）

# 6. 递归护栏
node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('mom.db');
db.prepare(\"UPDATE settings SET data = json_set(data, '\$.aggregator.model', 'A', '\$.advisor.slots', json('[\\\"A\\\"]')) WHERE id = 1\").run();
"
npm run dev
# 期望：进程报错退出，输出 [MoM] config error: aggregator.model "A" also appears in advisor.slots
```

### 已知限制

- 尚未接入自动化测试框架；Phase 1 全部依赖 PLAN.md 中列出的手动验证清单
- Provider 侧需要真实的 Anthropic 兼容 endpoint（DeepSeek Anthropic 兼容层 / OpenRouter / Kimi / Anthropic 官方等）
- Streaming 网关向客户端已开始写入后再遇到 provider 网络错误，只能通过 SSE `event: error` 帧告知，无法回退到 HTTP 错误码

---

<!--
写作规范：
- 新条目插入顶部（紧接约定块之后），旧条目向下移
- 日期格式：YYYY-MM-DD
- 环境要求只写结论，不写为什么选这个版本
- 测试命令必须可复制执行，无歧义
- 已知限制：写客观事实，不写"未来会修复"
-->
