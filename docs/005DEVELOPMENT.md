# 005DEVELOPMENT.md — 开发环境与测试记录

> **AI 协作约定**：每次涉及测试或环境配置变更时，将新记录插入本文件顶部（紧接本约定块之后），保留全部历史。
>
> 本文件只记录「如何让当前版本跑起来并验证它正确」，不记录原因（原因在 `decisions/`）。

---

## [2026-07-12-3] fanout_mode=off + thinking normalization 手动测试指导

### 概念速览(**这轮新增**)

- **`fanout_mode='off'`(af33818)**:显式关掉 fanout cache。每次入口请求都真跑 N 个 advisor + 1 个 aggregator,`trigger_reason='fanout_cache_off'`。用于 A/B 对照 / debug 抽风缓存行为
- **thinking normalization(af33818)**:provider 返回的 `thinking` block 若 `signature` 缺失 / 空 → 从响应中过滤;流式帧同时过滤 `content_block_start/delta/stop` 并重映射后续 index 保持连续
- **`cost_usd` 字段删除(af68b46)**:`TraceRequest` 不再存 cost。`pricing`(含 `currency`)+ `usage` 落盘,eval 侧现算 `cost = pricing × usage`。数据库表 schema 也删了 `cost_usd` 列——早期 SQL 查询语句会失败(见 ISS-026)
- **`ModelPricing.currency` 字段(af68b46)**:pricing_table 每条 model 带 currency,orchestrator 不假设 USD;sync-pricing 脚本默认 CNY

### 单元测试

```bash
npm test
# 123 例(97 基线 + 本轮新增 26 例):
#   - anthropic-normalize-edge:16 例(unsigned 边界 / index remap / SSE 集成)
#   - stream-forward-chunking:4 例(1..4096 字节 chunk 无重复无丢失)
#   - fanout-off:5 例(R1+R2 双真跑 / trigger_reason / cache 未污染 / off vs user_turn 对比)
```

### 手动 e2e 测试(基于 [2026-07-12-1] 的 M1–M7 之后追加)

前置沿用 [2026-07-12-1]。切换 `data/mom.config.json` 的 `fanout_mode` 需要重启网关(`tsx watch` 不监听 data/)。

---

**M8(`fanout_mode='off'` 全量真跑对比 `user_turn` 缓存路径)**

```bash
# 1) 把 fanout_mode 改成 off,重启
node -e "
const {readFileSync,writeFileSync}=require('node:fs');
const c=JSON.parse(readFileSync('data/mom.config.json','utf8'));
c.fanout_mode='off';
writeFileSync('data/mom.config.json', JSON.stringify(c,null,2)+'\n');
"
MOM_PORT=3010 npm run dev &
sleep 2

# 2) 用同一 session 发一次 R1
export S1=$(uuidgen | tr '[:upper:]' '[:lower:]')
curl -sS -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  -H "x-session-id: $S1" \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"off-mode probe M8"}]}],"max_tokens":80}' \
  -o /dev/null -w "M8-R1 HTTP %{http_code}\n"

# 3) 发一次 tool iteration R2
cat > /tmp/m8-r2.json <<EOF
{"model":"any","max_tokens":80,"messages":[
  {"role":"user","content":[{"type":"text","text":"off-mode probe M8"}]},
  {"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"probe","input":{}}]},
  {"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}
]}
EOF
curl -sS -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  -H "x-session-id: $S1" \
  --data-binary @/tmp/m8-r2.json \
  -o /dev/null -w "M8-R2 HTTP %{http_code}\n"

# 4) 查 trace:R1 + R2 每轮都是 N advisor + 1 aggregator,全部 trigger_reason='fanout_cache_off',cache_hit 全 false
curl -sS "http://localhost:3010/trace/requests?session_id=$S1" | \
  jq '.requests | group_by(.trigger_reason) | map({trigger_reason: .[0].trigger_reason, n: length})'
# 期望:{ trigger_reason: "fanout_cache_off", n: (N+1)*2 }
```

**M9(切回 `user_turn` 对比 provider 调用次数)**

```bash
pkill -f "tsx watch --env-file=.env src/index.ts"; sleep 1
node -e "
const {readFileSync,writeFileSync}=require('node:fs');
const c=JSON.parse(readFileSync('data/mom.config.json','utf8'));
c.fanout_mode='user_turn';
writeFileSync('data/mom.config.json', JSON.stringify(c,null,2)+'\n');
"
MOM_PORT=3010 npm run dev &
sleep 2

# 同 M8 的两次请求,新 session
export S2=$(uuidgen | tr '[:upper:]' '[:lower:]')
curl -sS -X POST http://localhost:3010/v1/messages -H 'content-type: application/json' -H "x-session-id: $S2" \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"off-mode probe M8"}]}],"max_tokens":80}' \
  -o /dev/null -w "M9-R1 HTTP %{http_code}\n"
curl -sS -X POST http://localhost:3010/v1/messages -H 'content-type: application/json' -H "x-session-id: $S2" \
  --data-binary @/tmp/m8-r2.json \
  -o /dev/null -w "M9-R2 HTTP %{http_code}\n"

curl -sS "http://localhost:3010/trace/requests?session_id=$S2" | \
  jq '.requests | group_by(.trigger_reason) | map({trigger_reason: .[0].trigger_reason, n: length})'
# 期望:R2 的 advisor 全部 trigger_reason='skipped_tool_iteration' / cache_hit=true / status='cache_hit';R2 aggregator 是 'skipped_tool_iteration' / cache_hit=false / status='success'(aggregator 永远真跑)
```

**M10(thinking normalization 端到端 — 需要 provider 侧启用 thinking)**

如果 provider 支持 extended thinking(如 Claude 3.7+),发一条:

```bash
curl -sSN -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  -H "x-session-id: $(uuidgen | tr '[:upper:]' '[:lower:]')" \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"用一句话给我一个 42 的哲学解释"}]}],"max_tokens":600,"stream":true,"thinking":{"type":"enabled","budget_tokens":300}}' \
  -o /tmp/m10.sse -w "M10 HTTP %{http_code}\n"

# 检查:如果 provider 返回的 thinking block 缺 signature,应该被过滤掉
grep -c "^event: content_block_start" /tmp/m10.sse
grep -c "\"type\":\"thinking\"" /tmp/m10.sse  # 剩下的 thinking 都是 signed
grep -c "thinking_delta" /tmp/m10.sse         # 若过滤掉,应为 0(或很少)
```

期望:客户端拿到的字节序不含"内部推理内容",thinking_delta 数量为 0 或对应 signed thinking 的量。

**M11(现算 cost — 没有 cost_usd 列了)**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('mom.db');
// 现算 pricing × usage
const rows = db.prepare(\`
  SELECT session_id, role, status, cache_hit, data
  FROM traces
  WHERE session_id = ?
\`).all('$S1');
let total = 0;
for (const r of rows) {
  const t = JSON.parse(r.data);
  if (!t.pricing) continue;
  const u = t.usage;
  const p = t.pricing;
  const cost = (u.input_tokens * p.input_per_million
             + u.output_tokens * p.output_per_million
             + u.cache_creation_tokens * p.cache_write_per_million
             + u.cache_read_tokens * (p.cache_read_per_million ?? 0))
             / 1_000_000;
  total += cost;
  console.log(\`  role=\${t.role.padEnd(12)} slot=\${t.selected_model.padEnd(10)} cost=\${cost.toFixed(8)} currency=\${p.currency}\`);
}
console.log('session total:', total);
"
```

期望:每条 trace 现算 cost 与在 fanout=off 场景下一致(每条 advisor 都是真实数字);currency 字段来自 pricing_table 的 `--currency`(默认 CNY,可能是 USD)。

---

### 已知问题(本轮发现)

以下问题**登记但未修复**——见 `003ISSUES.md` ISS-021..027:
- **ISS-021 [P2]**:passthroughStream 主链路已不是字节级 pipe(af33818 改成 parse→normalize→重编码)
- **ISS-022 [P3]**:delta/stop 未见 start 时 pass-through
- **ISS-023/024 [P3]**:off 模式下 `selectSignatureMessages` / `isNewTurn` 存在无用计算
- **ISS-025 [P3]**:SSE parse 失败 fallback 压掉 multi-line data
- **ISS-026 [P3]**:005DEVELOPMENT.md `[2026-07-10-1]` 仍写 `total_cost_usd` SQL 会报错(建议直接跑 M11 现算方式)
- **ISS-027 [P3]**:001ARCHITECTURE.md 未列 `fanout_cache_off` 第 7 种 trigger_reason

以及 PR #11 待合入的 **ISS-015..020**(af33818 未解决,预期):
- **ISS-015 [P1]**:fanout cache 缓存失败 slot 导致 tool iteration cache_hit 后 error 沿用
- **ISS-016 [P1]**:`buildConcatReferences` `[object Object]` 占位符(reference-builder.ts:23 未改)
- **ISS-017 [P3]**:`tool_use_count` 混算 tool_use + tool_result
- **ISS-018 [P3]**:`reasoning_tokens` 硬编码 0
- **ISS-019 [P2]**:af68b46 部分解决(cost_usd 删除后,`pricing IS NULL` 直接区分)——**可考虑关闭**
- **ISS-020 [P3]**:cache_hit response_summary=null 但 origin 溯源缺 hook

### 复核结论

**af33818(cache-off + thinking normalize)**:未解决 ISS-015..020,预期(改动轴不同)。**引入 ISS-021..025 五条新问题**,其中 ISS-021 P2 需要与 001ARCHITECTURE 承诺对齐决策
**af68b46(sync-pricing + drop cost_usd)**:**部分解决 ISS-019**(cost_usd 字段消失,`pricing IS NULL` 天然区分 pricing 缺失)——待 PR #11 合并后可关闭该条

---

## [2026-07-12-2] provider thinking block normalization

- 普通与流式 provider 响应均过滤缺失有效 `signature` 的 thinking blocks；signed thinking 原样保留。
- SSE 过滤后会重映射后续 content block index，避免下游收到不连续索引。
- 验证：`npm run typecheck` 通过，`npm test` 97/97 通过；覆盖 unsigned/signed thinking 与 SSE index remap。

---

## [2026-07-12-1] `fanout_mode=off` 完全关闭本地 fanout cache

- `mom_mode=always` 仍执行 advisor fan-out 与 aggregator；仅跳过 fanout cache 的 `get` / `set`。
- 每个请求和 tool iteration 都真实调用 advisors，日志为 `event=fanout_cache_off` / `trigger_reason=fanout_cache_off` / `cache_hit=false`。
- 修改 `data/mom.config.json` 后需重启；运行中的进程不会热加载 JSON 配置。
- 验证：`npm run typecheck` 通过，`npm test` 97/97 通过；包含 cache 方法一旦被调用就抛错的回归测试。

---

## [2026-07-11-1] ISS-010：pricing sync 脚本 + 币种从数据源带出 + 去掉 cost_usd 字段

### 环境要求

沿用 [2026-07-10-1]。新增依赖：无。脚本用 `undici` 走 provider `/v1/models`。

### pricing_table 灌入（新姿势，取代旧内联脚本）

```bash
npm run sync-pricing              # 默认 currency=CNY，只补齐缺失项，写入 data/mom.config.json
npm run sync-pricing -- --dry-run # 只打印将写入什么，不落盘
npm run sync-pricing -- --overwrite    # 强制覆盖已有条目（谨慎使用，会覆盖手改的价格）
npm run sync-pricing -- --currency USD # 换 provider 时传入对应币种；paigod 默认 CNY
```

- 脚本从 `.env` 读 `PROVIDER_BASE_URL` / `PROVIDER_API_KEY` / `PROVIDER_AUTH_STYLE`
- `cache_write` 按 Anthropic 惯例估算为 `input * 1.25`（provider `/v1/models` 未暴露该字段）
- 本地 pricing_table 里已存在但 provider 不再列出的模型条目**不会**被删除，仅打印 `SKIP unknown-to-provider`

### `ModelPricing` / `PricingSnapshot` 结构变化

`ModelPricing` 从 4 字段升为 5 字段：新增 `currency: string`（ISO 4217；数据源属性）。`PricingSnapshot.currency` 从字面量 `'USD'` 拓宽为 `string`，由 `snapshotPricing` 从 `ModelPricing.currency` 忠实带出——网关不再假设币种。

### 删除的字段（DB / API 契约同步破坏性变更）

- `TraceRequest.cost_usd` 删除；SQLite `traces` 表 `cost_usd` 列删除
- `Metrics.total_cost_usd` / `Metrics.baseline_cost_usd` 删除（Phase 4/6 未开工，届时按需重新设计）
- eval / dashboard 层用 `pricing × usage` 现算成本（`SUM(json_extract(data, '$.usage.input_tokens') * json_extract(data, '$.pricing.input_per_million') / 1e6) + ...`），符合 eval 需求文档"eval 负责聚合"原则

**本地 `mom.db` 需要删掉重建**（列数变了；ISS-009 之前的迁移策略已明确：Phase 3 主链路刚合并、无生产数据）：

```bash
rm -f mom.db
npm run dev   # initDB 会自动重建
```

### 自检自测关键片段

```bash
npm run typecheck         # 期望退出码 0
npm run build             # 期望退出码 0
npm run sync-pricing -- --dry-run  # 期望列出 provider 覆盖到的模型 pricing
# 编辑器打开 data/mom.config.json 确认 pricing_table 全部条目带 currency=CNY
```

启动网关后跑一次 `curl` 打 `/v1/messages` 应看到：
- 日志里 `event=pricing_missing` warn **消失**
- SQLite `traces` 表里 `SELECT json_extract(data, '$.pricing.currency') FROM traces LIMIT 5;` 返回 `CNY`

---

## [2026-07-10-1] Phase 3：trigger + fanout cache + cache_control + cost + trace + SDK 解耦

### 环境要求

沿用 [2026-07-09-2]（Node ≥ 22.13、无第三方 sqlite/dotenv/p-limit/lru-cache 依赖）。新增依赖：无。所有 Phase 3 新增能力（cache / trigger / cost / trace）均以纯函数或 Map-based 数据结构实现。

Git worktree 隔离场景下，**每个 worktree 都要单独 `npm install`**——worktree 共享 git 历史但不共享 `node_modules`；跑 `npm run dev` 前先在该 worktree 根目录执行一次 `npm install`。

### 关键新配置字段

`data/mom.config.json` 需确保以下字段填齐（首次启动 `DEFAULT_MOM_CONFIG` 会写入默认值）：
- `fanout_mode`: `off`（完全绕过本地 fanout cache）| `user_turn`（默认）| `per_iteration`
- `cache.ttl`: `5m` | `1h`；`cache.max_entries`: 建议 100–1000
- `pricing_table`: `{ [modelName]: { input, output, cache_write, cache_read } }`，单位 USD per million tokens；缺失项 log warn + 该模型 cost 计 0

Fanout cache 位于**进程内 Map**（`src/cache/fanout-cache.ts`），跨进程重启不保留；相邻请求想命中同一 key 必须在同一进程内连续发送。

### 单元测试（纯逻辑，56 例）

```bash
npm test
# 覆盖：view-transformer / reference-builder / trigger / cache-key / fanout-cache / cache-decorator / pricing
# 关键断言：
#   - fanout cache 在 slot 顺序改变时 key 变（避免"复用即错位"）
#   - user_turn 模式下 tool iteration 与前一次真实 user 命中同 key
#   - cache-decorator system_and_3 布局跳过合成 ADVISORY_INSTRUCTION marker
#   - Map-based LRU 淘汰最旧、touch on get 刷新
```

### 手动验证（对应 PLAN.md Phase 3 验证清单）

前置：`.env` 里 `PROVIDER_*` 已配好，`data/mom.config.json` 的 `mom_mode: always`、`advisor.slots` 3 个可用模型、`aggregator.model` 1 个不冲突的模型；`pricing_table` 若为空，见下方「pricing_table 灌入」小节先补齐。启动网关：

```bash
# 若 3000 被占用，用 MOM_PORT 换端口
MOM_PORT=3010 npm run dev
# 期望："MoM gateway listening on 3010"
```

网关不需要重启的验证按 V1 → V5 顺序连发（同一进程内 cache 才能命中）；V6 需要改配置重启，放最后。所有 curl 都发到网关本身，不是 provider。

---

**V1（`user_turn` MISS + fanout，全链路）**

目的：确认新 user turn 触发一次完整 fanout，advisor 与 aggregator 都真跑。

```bash
curl -sS -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"cache-probe-hello"}]}],"max_tokens":80}' \
  -o /dev/null -w "V1 HTTP %{http_code}\n"
```

期望：`HTTP 200`。网关日志两条：
- `event=fanout_miss` / `trigger_reason=user_turn` / `is_new_turn=true` / `slot_count=3` / `failures=[]` / `duration_ms` 数千到数万毫秒（advisor 真跑）
- `event=aggregator_complete` / `trigger_reason=user_turn` / `cache_hit=false`

---

**V2（`skipped_tool_iteration` HIT，缓存命中）**

目的：同一 turn 后追加 assistant tool_use + user tool_result，`user_turn` 模式截前缀签名，应命中 V1 建的缓存。**必须在同一 gateway 进程内，且紧接在 V1 之后**。

```bash
cat > /tmp/v2.json <<'EOF'
{"model":"any","max_tokens":80,"messages":[
  {"role":"user","content":[{"type":"text","text":"cache-probe-hello"}]},
  {"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"probe","input":{}}]},
  {"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}
]}
EOF
curl -sS -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  --data-binary @/tmp/v2.json \
  -o /dev/null -w "V2 HTTP %{http_code}\n"
```

期望：`HTTP 200`。网关日志：
- `event=fanout_hit` / `trigger_reason=skipped_tool_iteration` / `is_new_turn=false` / `duration_ms=0` 或 `1`（advisor 未真跑）
- `event=aggregator_complete` / `cache_hit=true`
- 总耗时约等于单次 aggregator 调用（数秒），显著低于 V1

---

**V3（不同 user 内容，MISS 且新 key）**

目的：改 user 文本触发新签名，缓存重新 set。

```bash
curl -sS -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"7*6=?"}]}],"max_tokens":80}' \
  -o /dev/null -w "V3 HTTP %{http_code}\n"
```

期望：`HTTP 200`。网关 `event=fanout_miss` / `trigger_reason=user_turn`，`duration_ms` 数千到数万毫秒。

---

**V4（`tool_iteration_cache_miss`，关键降级修复）**

目的：首请求即 tool_result（模拟进程重启后 tool iteration 冷启 / 首请求即带 tool_result），期望 orchestrator 补跑 fanout 并写缓存，aggregator 拿到非空 references；如果这里退化到 aggregator 空 references，就是 ISS-005 修的关键 bug 复发。

```bash
cat > /tmp/v4.json <<'EOF'
{"model":"any","max_tokens":200,"messages":[
  {"role":"user","content":[{"type":"text","text":"a fresh unseen prompt 1234abcd"}]},
  {"role":"assistant","content":[{"type":"tool_use","id":"tool_x","name":"search","input":{"q":"something"}}]},
  {"role":"user","content":[{"type":"tool_result","tool_use_id":"tool_x","content":"result-body"}]}
]}
EOF
curl -sS -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  --data-binary @/tmp/v4.json \
  -o /dev/null -w "V4 HTTP %{http_code}\n"
```

期望：`HTTP 200`。网关 `event=fanout_miss` / `trigger_reason=tool_iteration_cache_miss` / `is_new_turn=false` / `failures=[]`（advisor 真跑）。

---

**V5（streaming 主链路）**

目的：`stream:true` 时 aggregator 侧走 SSE 转发 + trace observer 组装。

```bash
curl -sSN -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"any","messages":[{"role":"user","content":[{"type":"text","text":"用一句话简述冒泡排序"}]}],"max_tokens":200,"stream":true}' \
  -o /tmp/v5.sse -w "V5 HTTP %{http_code}\n"

# 检查 SSE 事件类型齐全
for e in message_start content_block_start content_block_delta content_block_stop message_delta message_stop; do
  c=$(grep -c "^event: $e" /tmp/v5.sse)
  echo "$e: $c"
done
```

期望：`HTTP 200`；六种事件各出现 ≥ 1 次，`content_block_delta` 数十次以上。网关日志末尾 `event=aggregator_stream_complete`。

---

**V6（`mom_off`，透传，需重启）**

目的：`mom_mode !== 'always'` 走 Phase 1 透传，无 fanout / aggregator 事件，但仍落一条 trace（`mom_triggered=false / trigger_reason=mom_off`）供 Phase 4 metrics 用作分母。

```bash
# 1) Ctrl+C 停掉当前 gateway，或
pkill -f "tsx watch --env-file=.env src/index.ts"; sleep 1

# 2) 切模式（tsx watch 不监听 data/，必须手动重启）
node -e "
const {readFileSync,writeFileSync}=require('node:fs');
const c=JSON.parse(readFileSync('data/mom.config.json','utf8'));
c.mom_mode='off';
writeFileSync('data/mom.config.json', JSON.stringify(c,null,2)+'\n');
"

# 3) 重启
MOM_PORT=3010 npm run dev &  # 或在新窗口跑非后台版
sleep 2

# 4) 发一条请求（这里 model 字段必须是 provider 侧存在的真实模型名，因为要透传）
curl -sS -X POST http://localhost:3010/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"<provider 已有的模型名>","messages":[{"role":"user","content":[{"type":"text","text":"say hi"}]}],"max_tokens":50}' \
  -o /dev/null -w "V6 HTTP %{http_code}\n"
```

期望：`HTTP 200`。网关日志只有 `incoming request` + `request completed`，**无** `fanout_*` / `aggregator_*` 事件。

---

跑完 V6 后测试完成，把 `mom_mode` 改回 `always` 并重启网关，以恢复常态：

```bash
pkill -f "tsx watch --env-file=.env src/index.ts"; sleep 1
node -e "
const {readFileSync,writeFileSync}=require('node:fs');
const c=JSON.parse(readFileSync('data/mom.config.json','utf8'));
c.mom_mode='always';
writeFileSync('data/mom.config.json', JSON.stringify(c,null,2)+'\n');
"
```

### 数据库校验

V1–V6 全部跑完后，检查 trace 表。

```bash
# 1) 全量列表 + 分布
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('mom.db');
console.log('total:', db.prepare('SELECT COUNT(*) c FROM traces').get().c);
console.log('--- rows ---');
for (const r of db.prepare('SELECT trigger_reason, mom_triggered, ROUND(total_cost_usd, 6) cost, total_latency_ms FROM traces ORDER BY timestamp').all())
  console.log(JSON.stringify(r));
console.log('--- counts by trigger_reason ---');
for (const r of db.prepare('SELECT trigger_reason, COUNT(*) c FROM traces GROUP BY trigger_reason').all())
  console.log(JSON.stringify(r));
"

# 2) settings_snapshot 无 provider 秘钥泄漏
node -e "
const {DatabaseSync}=require('node:sqlite');
const {data}=new DatabaseSync('mom.db').prepare('SELECT data FROM traces LIMIT 1').get();
const t=JSON.parse(data);
if (JSON.stringify(t.settings_snapshot).includes('api_key')) throw new Error('LEAK');
console.log('ok keys:', Object.keys(t.settings_snapshot).sort());
"
```

期望：
- 总数 ≥ 6（V1–V6 各一条；V5 streaming 也会落）
- `trigger_reason` 分组覆盖 `user_turn` / `skipped_tool_iteration` / `tool_iteration_cache_miss` / `mom_off` 四种（V3、V5 也归 `user_turn`，故此值可能出现多次）
- 命中 trace 的 `cost` 显著低于对应 MISS trace（advisor usage 归零）
- `mom_off` trace `cost=0` / `mom_triggered=0`
- 泄漏检查输出的 keys 集合 = `MoMConfig` 字段（`advisor` / `aggregation_mode` / `aggregator` / `cache` / `comparison` / `cost_tradeoff` / `fanout_mode` / `judge` / `mom_mode` / `pricing_table` / `reference_max_tokens`），**不含** `provider`

### pricing_table 灌入

首次启动 `pricing_table` 为空，网关每次请求会打 `event=pricing_missing` warn 且相关模型 `cost=0`。当前 provider（`apiproxy.paigod.work`）的 `/v1/models` 响应里带 `price.{input_price, output_price, cached_price}`（per-token USD），一次性灌入 config 的临时脚本：

```bash
node -e '
const fs = require("node:fs");
const https = require("node:https");
const key = require("fs").readFileSync(".env","utf8").match(/PROVIDER_API_KEY=(.+)/)[1].trim();
const base = require("fs").readFileSync(".env","utf8").match(/PROVIDER_BASE_URL=(.+)/)[1].trim();
https.get(base + "/v1/models", {headers:{authorization:"Bearer "+key}}, res => {
  let buf = ""; res.on("data", d => buf += d);
  res.on("end", () => {
    const json = JSON.parse(buf);
    const config = JSON.parse(fs.readFileSync("data/mom.config.json","utf8"));
    const wanted = [
      ...config.advisor.slots, config.aggregator.model,
      config.judge?.model, config.comparison?.baseline_model,
    ].filter(Boolean);
    const pricing = {};
    for (const id of wanted) {
      const m = json.data.find(x => x.id === id);
      if (!m || !m.price) { console.warn("no price for", id); continue; }
      pricing[id] = {
        input:       +(m.price.input_price  * 1e6).toFixed(4),
        output:      +(m.price.output_price * 1e6).toFixed(4),
        cache_write: +(m.price.input_price  * 1e6 * 1.25).toFixed(4),
        cache_read:  +(m.price.cached_price * 1e6).toFixed(4),
      };
    }
    config.pricing_table = pricing;
    fs.writeFileSync("data/mom.config.json", JSON.stringify(config,null,2)+"\n");
    console.log("pricing_table updated:", Object.keys(pricing));
  });
});
'
```

灌完重启网关，之后请求日志不再有 `pricing_missing` warn，trace `total_cost_usd` 变为正数。

**未追踪的演进项**：这段脚本目前是运维一次性操作，需沉淀为 `scripts/sync-pricing.mjs` 并接入 Dashboard「同步价格」按钮；provider 侧 `price` 字段结构非跨 provider 通用，多 provider 演进时需要写适配层。数据源永远落到 `data/mom.config.json`，网关运行时不现拉 provider（避免延迟与可用性耦合）。后续会在 003ISSUES.md 单独开条目追踪。

### 成本分账（Phase 3 精算示例）

以固定 usage `input_tokens=10, output_tokens=5`（每个 advisor）+ `input_tokens=10, output_tokens=5`（aggregator）为例，`pricing_table` 中 `adv-a/b/c` 单价 `1/2/3` input、`5/10/15` output（USD/M tokens），`agg-x` 单价 `0.5` input / `2` output：

- 非命中 trace `total_cost_usd = 3 * (10 * slot_input + 5 * slot_output) / 1_000_000 + (10 * 0.5 + 5 * 2) / 1_000_000`
- 命中 trace `total_cost_usd` 只等于 aggregator 部分（advisor usage 归零）
- `mom_off` trace `total_cost_usd = 0`（透传路径不知道 provider 内 usage）

### trace 表结构演进

当前 traces 表列结构与 JSON payload 属 Phase 3 初版，Phase 4 dashboard-api 前需按新格式重构。此前落盘的 trace 记录可能因缺字段无法回溯分析（cache 命中细节、references 快照、cost 分层等）。后续会在 003ISSUES.md 单独开条目追踪。

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
# 期望：终端 fastify 日志出现 1 条 event=advisor_fanout_complete（含 slot_count=3、failures=[]）/ 1 条 event=aggregator_complete
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
