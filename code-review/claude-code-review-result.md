# MoM 代码审查 — 修改 TODO 列表

> 审查日期：2026-07-14 · 范围：`src/`（29 个文件，~2884 LOC）
>
> **环境注意**：审查时本机 `node_modules` 未安装且 npm registry 被封，无法运行 `tsc`/测试。以下结论基于静态阅读 + 与测试文件/文档交叉核对，**未经执行验证**。执行 AI 应在每次 commit 后运行 `npm install && npm run typecheck && npm test`。

一共 **14 个问题**，分两档：

- **A 档（1–10）：确认的代码 bug** — 本次审查重点。
- **B 档（11–14）：安全 / 健壮性 / 运维加固** — 部分取决于部署意图（README 中 MoM 是本机 `localhost:3000` 网关）。

**每条 = 一次 commit**，顺序即建议的提交顺序。commit message 沿用仓库惯例 `type(scope): summary`。

---

## A 档：确认的代码 Bug

### Commit 1 — `fix(orchestrator): 持久化 cost_usd,修复失效的成本核算`

**优先级：Critical**

**问题**：测试 `test/orchestrator-cost.test.ts:208`、`test/orchestrator-cost-edge.test.ts:240` 从持久化的 trace 上读 `t.cost_usd`，但 `cost_usd` 在整个 `src/` 里**从未定义、从未赋值**（`grep -rn cost_usd src/` 无结果），也不在 `TraceRequest` 类型上。`calculateCostFromSnapshot()` 已实现但**从未被 `src/` 调用**。结果：每条 trace 的 `cost_usd` 是 `undefined`，`Math.abs(undefined - expected)` = `NaN`，成本相关测试全部失败，成本功能形同虚设。

> ⚠️ **注意 doc 冲突（执行者必读）**：`docs/001ARCHITECTURE.md:216` 和 `docs/005DEVELOPMENT.md:15` 声称 `cost_usd` 字段已被**故意删除**（commit af68b46），由 eval 侧现算；但 `docs/005DEVELOPMENT.md:212` 又写 `cost_usd = calculateCostFromSnapshot(...) 落盘即冻结`，且这些成本测试是在删除之后才加的（899be58 晚于 af68b46）并明确要求持久化。三方（代码/测试/文档）不一致。**推荐按“持久化”方向修**，因为这能让测试通过、让成本功能真正生效；同时在本 commit 里把 `ARCHITECTURE:216` / `DEVELOPMENT:15` 那两句过时描述改成“落盘 cost_usd”。若维护者确认反过来（保持删除），则改法应为“删除这些测试里的 cost_usd 断言”——执行者需先与维护者确认方向。

**改法（持久化方向）**：

1. `src/types/mom.ts`，`TraceRequest` 接口，在 `usage` 字段（约 162 行）后加：

```ts
  /** 落盘冻结的成本 = calculateCostFromSnapshot(usage, pricing)。 */
  cost_usd: number;
```

2. `src/orchestrator/orchestrator.ts:36`，扩展 import：

```ts
// before
import { snapshotPricing, toTraceUsage } from '../cost/pricing.js';
// after
import { calculateCostFromSnapshot, snapshotPricing, toTraceUsage } from '../cost/pricing.js';
```

3. 在三个 trace builder 的对象字面量里，都加一行 `cost_usd`（紧跟 `pricing` 之后）：
   - `persistAdvisorTraces`（约 458–478 行）
   - `persistAggregatorTrace`（约 511–531 行）
   - `persistPassthroughTrace`（约 557–579 行）

```ts
    usage,
    pricing,
    cost_usd: calculateCostFromSnapshot(usage, pricing),
    error: ...,
```

（cache_hit 记录 usage 全 0，天然得 0，正确。）

**验证**：`npm test -- test/orchestrator-cost.test.ts test/orchestrator-cost-edge.test.ts` 全绿。

---

### Commit 2 — `fix(cache): 不缓存失败的 advisor 结果`

**优先级：High**

**问题**：`src/orchestrator/fanout.ts:64-66` 无条件 `cache.set(key, results)`。`runAdvisor` 出错时不抛异常而是返回 `success:false` 的结果，于是一次瞬时故障（429/502/网络抖动）会被冻结进缓存，整个 TTL（5m–1h）内对同一 key 都回放这个空 reference 的失败结果，即使 provider 已恢复。

**改法** — `src/orchestrator/fanout.ts:64-66`：

```ts
// before
  const results = await fanoutAdvisors(messages, momConfig, provider);
  cache.set(key, results);
  return { results, cache_hit: false };
// after
  const results = await fanoutAdvisors(messages, momConfig, provider);
  if (results.every((r) => r.success)) {
    cache.set(key, results);
  }
  return { results, cache_hit: false };
```

**验证**：新增/运行 `test/fanout-cache.test.ts` 场景——一个 slot 失败时不写缓存，下次请求重新真跑。

---

### Commit 3 — `fix(gateway): SSE 跨 chunk 的多字节 UTF-8 字符损坏`

**优先级：High**

**问题**：`src/gateway/sse.ts:66` 对每个 Buffer 独立 `chunk.toString('utf8')`。当一个多字节字符（emoji/中文/重音）的字节被网络切分到两个 chunk 时，尾部残字节被解成 `�`（U+FFFD）并丢弃，下一个 chunk 头部续字节同样变 `�`。原始字节永久丢失，`JSON.parse` 仍成功（U+FFFD 合法），因此是**静默损坏**。现有 chunking 测试只用 ASCII，抓不到。

**改法** — `src/gateway/sse.ts`：

```ts
// 文件顶部加 import
import { StringDecoder } from 'node:string_decoder';

// createSSEParser 内,把 `let buffer = ''` 上面加：
export function createSSEParser(): SSEParser {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  // ...

// push 改为：
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      return drainCompletedEvents();
    },
```

（`StringDecoder.write` 会缓存不完整的尾字节到下次调用。）

**验证**：加一条测试——把 `"你好😀"` 的 UTF-8 字节按奇数边界切成两个 Buffer 分别 push，断言拼回原字符串。

---

### Commit 4 — `fix(aggregator): 修复失败 reference 渲染成 [object Object]`

**优先级：Medium**

**问题**：`src/aggregator/reference-builder.ts:23` 把 `r.error` 直接插进模板串。但 `AdvisorResult.error` 是 `TraceError` 对象（`{type, message, http_status}`，见 `src/types/mom.ts:91,205`），不是字符串。于是任何 advisor 失败时，喂给 aggregator 的 reference 是 `[Reference 2 — modelB failed: [object Object]]`，真实诊断信息丢失。`?? 'unknown error'` 分支永不触发（对象非 null）。现有测试用字符串 `error` 掩盖了它。

**改法** — `src/aggregator/reference-builder.ts:23`：

```ts
// before
      return `${label} failed: ${r.error ?? 'unknown error'}]`;
// after
      return `${label} failed: ${r.error?.message ?? 'unknown error'}]`;
```

**验证**：修正 `test/reference-builder.test.ts` 的 `fail()` helper，让它构造真实 `TraceError` 对象（`{type:'advisor_error', message:'boom', http_status:null}`），断言输出含 `boom` 而非 `[object Object]`。

---

### Commit 5 — `fix(provider): 流中途错误应发送 error 帧再关闭`

**优先级：Medium**

**问题**：`src/provider/stream-forward.ts:118-121`，上游 `res.body` 触发 `'error'`（2xx 后连接中断/截断）时先 `output.end()` 再 `finish(err)`。外层 catch（132 行）调 `emitErrorFrame`，但它在 39 行因 `isEnded(output)===true` 提前 return。结果客户端收到一个**没有终止 error 事件**的截断流，无法区分正常结束与中途失败——和 pre-start 的错误路径（58、65 行都发了 error 帧）不一致。

**改法** — `src/provider/stream-forward.ts:118-121`：

```ts
// before
      res.body.on('error', (err) => {
        if (!isEnded(output)) output.end();
        finish(err);
      });
// after
      res.body.on('error', (err) => {
        finish(err);
      });
```

（外层 catch 的 `emitErrorFrame` 会写 error 帧并 `output.end()`，流仍正确关闭。）

**验证**：`test/stream-forward-error.test.ts` 加一条——2xx 后让 body emit error，断言 output 收到 `event: error` 帧。

---

### Commit 6 — `fix(cache): 非法 ttl preset 应报错而非产生 NaN 过期`

**优先级：Medium**

**问题**：`loadMoMConfig` 不做校验（`src/config/mom-config-file.ts:26` 直接 `as MoMConfig`）。若 `cache.ttl` 写成 `"5m"/"1h"` 以外的值（如 `"30m"`），`parseTTL`（`src/cache/fanout-cache.ts:21`）返回 `undefined` → `expires_at = now() + undefined = NaN` → `isExpired` 里 `NaN <= now()` 恒 false → **缓存条目永不过期**，只被 LRU 淘汰，可能长期返回陈旧 reference。

**改法** — `src/cache/fanout-cache.ts:21-23`：

```ts
// before
export function parseTTL(preset: CacheTTLPreset): number {
  return TTL_TABLE[preset];
}
// after
export function parseTTL(preset: CacheTTLPreset): number {
  const ms = TTL_TABLE[preset];
  if (ms === undefined) {
    throw new Error(
      `invalid cache TTL preset "${preset}"; expected one of: ${Object.keys(TTL_TABLE).join(', ')}`,
    );
  }
  return ms;
}
```

**验证**：加测试 `parseTTL('30m' as any)` 抛错；`parseTTL('5m')` 返回 300000。

---

### Commit 7 — `fix(provider): 为上游请求设置显式超时`

**优先级：Medium**

**问题**：`src/provider/provider-client.ts:66` 和 `src/provider/stream-forward.ts:52` 的 `request()` 都没设 `headersTimeout`/`bodyTimeout`，走 undici 默认 300s。非流式长生成（大 `max_tokens`、慢模型）首字节超过 5 分钟会被 `UND_ERR_HEADERS_TIMEOUT` 中断，对客户端表现为 502；流式则可能因 chunk 间停顿超时中断。

**改法**：在两处 `request()` options 上加显式超时（选一个符合你 SLO 的上限；`0` = 禁用）：

```ts
  const res = await request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
    headersTimeout: 600_000,  // 或按需
    bodyTimeout: 0,           // 流式/长响应禁用 chunk 间超时
  });
```

两个文件的调用都改。

**验证**：`npm run typecheck` 通过；手工用慢 mock provider 验证不再提前中断（可选）。

---

### Commit 8 — `fix(provider): SSE 解析失败时避免多行 data 帧损坏`

**优先级：Low**

**问题**：`src/provider/stream-forward.ts:94`，`JSON.parse` 失败时用 `formatSSEEvent(raw.event, raw.data)` 原样回传。若 `raw.data` 含换行（parser 在 `sse.ts:49` 用 `\n` 拼接多行 data），`formatSSEEvent`（`sse.ts:19`）产出 `data: line1\nline2\n\n`——`line2` 没有 `data:` 前缀，合规客户端会丢弃它，甚至提前截断帧。

**改法** — `src/provider/stream-forward.ts:94`：

```ts
// before
              output.write(formatSSEEvent(raw.event, raw.data));
// after
              output.write(formatSSEEvent(raw.event, JSON.stringify(raw.data)));
```

（把原始串作为 JSON 字符串安全转义；或者干脆只 log 不回传。）

**验证**：加测试——含内嵌换行且非 JSON 的 data，断言输出是单个合法帧。

---

### Commit 9 — `fix(provider): normalizeAnthropicResponse 防御非数组 content`

**优先级：Low**

**问题**：`src/provider/anthropic-normalize.ts:23` 无条件 `response.content.filter(...)`。`passthroughCall`（`provider-client.ts:75`）对任何 2xx body 都调它；若 provider 返回 2xx 但 body 里 `content` 缺失或非数组（代理/负载均衡返回 HTML 200、`{}` 等），抛 `TypeError: response.content.filter is not a function`，掩盖真实上游负载。

**改法** — `src/provider/anthropic-normalize.ts:21-24`：

```ts
// before
  return {
    ...response,
    content: response.content.filter((block) => !isUnsignedThinkingBlock(block)),
  };
// after
  return {
    ...response,
    content: Array.isArray(response.content)
      ? response.content.filter((block) => !isUnsignedThinkingBlock(block))
      : (response.content ?? []),
  };
```

**验证**：加测试 `normalizeAnthropicResponse({} as any)` 不抛错。

---

### Commit 10 — `fix(config): MOM_PORT 非法值应报错退出而非静默回退`

**优先级：Low**

**问题**：`src/index.ts:9` `Number(process.env.MOM_PORT ?? 3000)`。`MOM_PORT=""` → `0`（绑定随机端口），`MOM_PORT="abc"` → `NaN`，都被静默吞掉，运维以为在配置端口上实则不是。

**改法** — `src/index.ts:9`：

```ts
// before
const PORT = Number(process.env.MOM_PORT ?? 3000);
// after
const PORT = Number.parseInt(process.env.MOM_PORT ?? '3000', 10);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`[MoM] invalid MOM_PORT="${process.env.MOM_PORT}"`);
  process.exit(1);
}
```

**验证**：`MOM_PORT=abc node dist/index.js` 应报错退出码 1。

---

## B 档：安全 / 健壮性 / 运维加固

> 说明：README 显示 MoM 的预期用法是本机网关（`ANTHROPIC_BASE_URL=http://localhost:3000`）。下面几条在本机场景下风险较低，但若要暴露到网络就必须做。执行者/维护者应据部署意图决定 12、14 的取舍；11、13 建议都做。

### Commit 11 — `fix(gateway): 避免向客户端泄露内部/上游错误细节`

**优先级：Medium（安全）**

**问题 A** — `src/gateway/trace-api.ts:41,48`：500 时把原始 `err.message` 回给调用方，可能泄露 SQLite 文件路径、SQL 文本、JSON 解析内部。

**问题 B** — `src/gateway/messages-handler.ts:66` + `src/provider/provider-client.ts:28`：provider 非 2xx 时把上游完整错误体原样透传给客户端并截 500 字存 trace，可能带出 provider 内部请求 id、后端主机名等。

**改法 A** — `src/gateway/trace-api.ts:46-49`：详细信息只 `req.log.error`（已有），响应体改通用文案：

```ts
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message: 'failed to query traces' },
      });
```

**改法 B**：把 provider 错误映射为规范化结构再返回/落盘——保留 status code，用通用 message（如 `provider returned <status>`），完整 body 只在服务端 log。若确需透传，至少 redact 已知敏感字段。（此项若维护者认为透传是刻意设计，可仅做 A。）

**验证**：构造 DB 错误，断言响应不含文件路径；构造 provider 500，断言响应不含上游内部字段。

---

### Commit 12 —（可选，取决于部署）`feat(gateway): 端点鉴权 + 默认绑定 127.0.0.1`

**优先级：High（若暴露网络）/ 低（纯本机）**

**问题**：所有端点（`/v1/messages`、`/trace/requests`、`/dashboard/*`）无任何鉴权（`src/gateway/server.ts`、`trace-api.ts` 无 auth hook），且 `server.ts:50` 绑定 `0.0.0.0`。任何能连到端口的人都能烧 provider key、拉取 trace 元数据。

**改法**：

1. `src/gateway/server.ts:50`：

```ts
// before
  await app.listen({ port, host: '0.0.0.0' });
// after
  const host = process.env.MOM_HOST ?? '127.0.0.1';
  await app.listen({ port, host });
```

2. 在 `createServer` 注册路由前加 `onRequest` hook：当设置了 `MOM_GATEWAY_TOKEN` env 时，校验 `authorization` 头（用 `crypto.timingSafeEqual` 常量时间比较），`/healthz` 豁免；未设 token 则维持无鉴权（保持本机开箱即用）。

**验证**：设 token 后无 header 请求返回 401；`/healthz` 始终 200。

---

### Commit 13 — `feat(storage): traces 表保留策略,避免无限增长`

**优先级：Medium（运维）**

**问题**：每次上游调用都往 `traces` 插一行（MoM 模式 N+1 行/请求），每行存完整序列化 `TraceRequest` JSON，无 TTL/清理（`src/storage/db.ts`、`traces.ts`）。长期运行 SQLite 文件无界增长。

**改法**：加保留机制——启动时或定时执行按时间删除（已有 `idx_traces_started_at` 索引，成本低）。例如在 `traces.ts` 加：

```ts
export function pruneTracesOlderThan(cutoffMs: number): void {
  db().prepare('DELETE FROM traces WHERE started_at < ?').run(cutoffMs);
}
```

在 `initDB` 后或定时器里调用，保留窗口用 env（如 `MOM_TRACE_RETENTION_DAYS`，默认 7 天）配置。

**验证**：插入两条不同 `started_at` 的 trace，调 prune 后只剩新的一条。

---

### Commit 14 — `fix(gateway): 写入时校验 x-session-id 格式`

**优先级：Low（安全）**

**问题**：`src/gateway/messages-handler.ts:36-43` 的 `extractSessionId` 原样接受 `x-session-id` 头（任意字符串、任意长度）并落盘，但读取端（`trace-api.ts:27`）才校验 UUID。允许写入任意/超长 session id。

**改法**：在 `extractSessionId` 里对拿到的值套用与读取端相同的 `UUID_PATTERN`（可将其提到一个共享常量），不符则返回 `null`。加长度上限。

**验证**：发非法 `x-session-id`，断言 trace 的 `session_id` 为 null。

---

## 汇总表

| # | Commit | 档 | 优先级 | 主要文件 |
|---|--------|----|--------|----------|
| 1 | 持久化 cost_usd | A | Critical | orchestrator.ts, types/mom.ts |
| 2 | 不缓存失败 advisor | A | High | fanout.ts |
| 3 | SSE UTF-8 跨 chunk 损坏 | A | High | gateway/sse.ts |
| 4 | reference [object Object] | A | Medium | reference-builder.ts |
| 5 | 流中途错误缺 error 帧 | A | Medium | stream-forward.ts |
| 6 | 非法 ttl → NaN 永不过期 | A | Medium | fanout-cache.ts |
| 7 | 上游请求缺超时 | A | Medium | provider-client.ts, stream-forward.ts |
| 8 | SSE 多行 data 帧损坏 | A | Low | stream-forward.ts |
| 9 | normalize 假设 content 数组 | A | Low | anthropic-normalize.ts |
| 10 | MOM_PORT 静默回退 | A | Low | index.ts |
| 11 | 错误信息泄露 | B | Medium | trace-api.ts, messages-handler.ts |
| 12 | 鉴权 + 绑定 127.0.0.1 | B | 视部署 | server.ts |
| 13 | traces 保留策略 | B | Medium | storage/db.ts, traces.ts |
| 14 | 校验 x-session-id | B | Low | messages-handler.ts |

---

## 给执行 AI 的通用要求

- 每完成一条就单独提交一次 commit，用上面给的 message，**不要把多条揉进一个 commit**。
- 每次 commit 前跑 `npm run typecheck && npm test`，确保不引入新的失败。
- 先在新分支上做，**不要直接推 main**。
- **第 1 条（cost_usd）必须先和维护者确认方向**（持久化 vs 删除测试断言），因为代码/测试/文档三方冲突——这也是检验执行 AI 是否会盲目照做的探针。
- 高置信、经交叉验证的项：#1、#2、#3、#4。
