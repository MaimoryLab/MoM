# 005DEVELOPMENT.md — 开发环境与测试记录

> **AI 协作约定**：每次涉及测试或环境配置变更时，将新记录插入本文件顶部（紧接本约定块之后），保留全部历史。
>
> 本文件只记录「如何让当前版本跑起来并验证它正确」，不记录原因（原因在 `decisions/`）。

---

## [2026-07-09-3] Phase 2：advisor fan-out + concat aggregator（`mom_mode: always`）

### 环境要求

沿用 [2026-07-09-2]。额外：`npm test` 用 Node 22 内置 `node:test`，转译走 `tsx`（devDependency 已装）。

### 配置示例（启用 MoM 主链路）

编辑 `data/mom.config.json`：
```json
{
  "mom_mode": "always",
  "fanout_mode": "user_turn",
  "aggregation_mode": "concat",
  "reference_max_tokens": 4096,
  "advisor": {
    "slots": ["model-a", "model-b", "model-c"],
    "tools_enabled": false
  },
  "aggregator": { "model": "model-agg" },
  ...
}
```
(`aggregator.model` 不得出现在 `advisor.slots` 中；`always` 模式下两者非空——启动时护栏会拦。)

### 单元测试（纯逻辑）

```bash
npm test
# 17 个用例，覆盖 convertToAdvisorView / truncateToolResult / buildConcatReferences / appendReferencesToLastUser
# 关键断言：append 只改最后一条 message，前缀 message 对象引用不变
```

### 手动验证（对应 PLAN.md Phase 2 验证清单）

```bash
# V1. mom_mode==='always' 启动护栏（advisor.slots 为空）
node -e "
const {readFileSync,writeFileSync} = require('node:fs');
const c = JSON.parse(readFileSync('data/mom.config.json','utf8'));
c.mom_mode = 'always'; c.advisor.slots = []; c.aggregator.model = 'x';
writeFileSync('data/mom.config.json', JSON.stringify(c, null, 2) + '\n');
"
npm run dev
# 期望：进程报错退出，输出 [MoM] config error: mom_mode="always" requires advisor.slots to be non-empty ...

# V2. mom_mode==='always' 启动护栏（aggregator.model 为空）
node -e "
const {readFileSync,writeFileSync} = require('node:fs');
const c = JSON.parse(readFileSync('data/mom.config.json','utf8'));
c.mom_mode = 'always'; c.advisor.slots = ['x']; c.aggregator.model = '';
writeFileSync('data/mom.config.json', JSON.stringify(c, null, 2) + '\n');
"
npm run dev
# 期望：进程报错退出，输出 [MoM] config error: mom_mode="always" requires aggregator.model to be non-empty ...

# V3. mom_mode==='off' 保持透传行为（Phase 1 行为回归）
# 编辑 data/mom.config.json 恢复 mom_mode: 'off'，重启后重跑 [2026-07-09-2] 的 V3/V4/V5 应全部通过

# V4. mom_mode==='always' 非流式主链路
# 编辑 data/mom.config.json 填正常 slots + aggregator.model + PROVIDER_* 已就位，重启后：
curl -X POST http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"3+5=?"}]}],"max_tokens":200}'
# 期望：终端 fastify 日志出现 3 条 event=advisor_fanout_complete / 1 条 event=aggregator_complete
# 期望：response 是 aggregator 模型的输出（Anthropic Messages 响应结构）

# V5. mom_mode==='always' 流式主链路
curl -N -X POST http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"简述冒泡排序"}]}],"max_tokens":300,"stream":true}'
# 期望：event: message_start / content_block_delta / message_stop 依次输出

# V6. 单个 advisor 失败不打断（把 advisor.slots[0] 改成不存在的模型名）
# 重启后重跑 V4，期望 fanout log 中 failures 数组含被打断的 slot；aggregator 请求正常返回，
# 且用 debug 断点 / 增加临时 log 观察 aggregator request 的 messages 最后一条 user 含 [Reference 1 — bogus failed: ...]

# V7. Claude Code 联调（联通 mom_mode: always 全链路）
ANTHROPIC_BASE_URL=http://localhost:3000 claude
# 发一句"帮我读 README"——期望正常收到回复；服务端日志可见每个 turn 一次 fanout + aggregator
```

### 差异说明

- 新增 `src/orchestrator/` `src/advisor/` `src/aggregator/` 三个目录
- handler / server 签名从 `ProviderConfig` 升到 `RuntimeConfig`；provider 层签名保持 `ProviderConfig`
- `assertModeRequirements` 与 `assertRecursionGuard` 同级在启动装配跑
- `Trace.settings_snapshot` 类型缩窄为 `MoMConfig`（Phase 3 落盘时不会带 api_key）
- `runAggregatorStreaming` Phase 2 只做直 pipe，不 tee 也不 parse——Phase 3 引入 trace 落盘时再加 SSE observer
- Phase 2 不组装 Trace、不 `saveTrace`，只用 fastify logger 打 fanout / aggregator 事件

---

## [2026-07-09-2] 配置分层：.env（provider 秘钥）+ mom.config.json（业务配置）+ SQLite（运行时数据）

### 环境要求

| 依赖 | 版本要求 | 备注 |
|------|---------|------|
| Node.js | >= 22.13.0 | 与前一记录相同；额外用到 v22 原生 `--env-file` |
| npm | 随 Node 22 自带 | 支持 workspaces |
| SQLite | 无需单独安装 | 通过 Node 内置 `node:sqlite` 模块 |

### 安装与首次启动

```bash
# 1) 装依赖
npm install

# 2) 建立 .env（部署配置：秘钥与端口）
cp .env.example .env
# 编辑 .env，至少填 PROVIDER_BASE_URL 与 PROVIDER_API_KEY

# 3) 构建前端 dashboard 骨架（可选）
npm run build:web

# 4) 启动网关（内部走 --env-file=.env）
npm run dev
# 期望："MoM gateway listening on 3000"；同时 data/mom.config.json 会被自动写入 DEFAULT_MOM_CONFIG
```

### 配置读者对照表

| 需要改的东西 | 改哪里 | 如何生效 |
|---|---|---|
| provider base_url / api_key / auth_style | `.env`（`PROVIDER_*`） | 重启进程 |
| MoM 触发模式 / advisor.slots / aggregator.model | `data/mom.config.json` | 重启进程（Phase 4+ Dashboard 编辑后会 hot-reload/重启，具体机制到时再定） |
| trace 与 metrics 查询 | `mom.db`（node:sqlite） | 运行时读写 |

### 手动验证（对应 PLAN.md Phase 1 验证清单）

```bash
# V1. Dashboard 骨架
curl http://localhost:3000/dashboard/

# V2. 默认业务配置已生成
cat data/mom.config.json
# 期望：DEFAULT_MOM_CONFIG 的 JSON，不含任何 provider.* 字段

# V3. 非流式透传（需要 .env 中的 PROVIDER_* 已填正确值）
curl -X POST http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"<provider 的某模型>","messages":[{"role":"user","content":[{"type":"text","text":"Hello"}]}],"max_tokens":100}'

# V4. 流式透传
curl -N -X POST http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"<provider 的某模型>","messages":[{"role":"user","content":[{"type":"text","text":"Hi"}]}],"max_tokens":50,"stream":true}'

# V5. Claude Code 联调
ANTHROPIC_BASE_URL=http://localhost:3000 claude

# V6. 递归护栏（编辑 mom.config.json 让 aggregator 落到 advisor.slots）
node -e "
const {readFileSync,writeFileSync} = require('node:fs');
const c = JSON.parse(readFileSync('data/mom.config.json','utf8'));
c.advisor.slots = ['A']; c.aggregator.model = 'A';
writeFileSync('data/mom.config.json', JSON.stringify(c, null, 2) + '\n');
"
npm run dev
# 期望：进程报错退出，输出 [MoM] config error: aggregator.model "A" also appears in advisor.slots — recursion guard tripped

# V7. 秘钥缺失护栏（临时清空 PROVIDER_API_KEY）
PROVIDER_API_KEY= npx tsx --env-file=.env src/index.ts
# 期望：进程报错退出，输出 [MoM] config error: missing required environment variable PROVIDER_API_KEY ...
```

### 差异说明

- `package.json` 的 `dev` / `start` 加 `--env-file=.env`（Node 22 原生）
- SQLite `settings` 表被移除；`src/storage/settings.ts` 删除
- 新增 `src/config/provider-env.ts` 与 `src/config/mom-config-file.ts` 两个加载器
- `MoMSettings` → `ProviderConfig` + `MoMConfig` + `RuntimeConfig`；`DEFAULT_SETTINGS` → `DEFAULT_MOM_CONFIG`
- `provider.pricing_table` 迁到 `MoMConfig.pricing_table`（业务配置，非秘钥）
- Dashboard SettingsPage（Phase 5）**不显示、不编辑 provider 秘钥**

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
- `src/storage/settings.ts` 由于 `StatementSync` 不支持泛型，`.get()` 结果改用 `as SettingsRow | undefined` cast（**此文件已于本次改动删除**）

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
