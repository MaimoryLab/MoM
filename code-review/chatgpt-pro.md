# MoM 业务逻辑静态 Code Review

本结论仅基于本次上传的 `repomix-mom-review-full.txt` 做静态分析，没有把它当成可执行仓库，也没有执行测试或构建。上传说明中 `tsx`、`tsc` 缺失导致的命令失败只代表依赖环境未就绪，不计作代码失败；但我在测试源码与当前类型/实现之间发现了独立的静态不一致。

## 1. Executive Summary

* **当前结论：可做受控 demo，不适合真实 Claude Code 日常内部试用，更不可生产。** 纯文本、非流式、最后一条为普通 user 文本、关闭本地 fanout cache 时，主链路有较大概率正常工作；一旦进入多轮工具调用、extended thinking、跨 session cache 或流式错误路径，存在多项“HTTP 成功但业务结果错误”的风险。
* **最严重的 cache bug 是 key 与 value 的输入不一致。** `user_turn` key 排除了本轮 tool results，但 cache miss 时 advisor 实际读取完整 tool results，并把结果写回这个前缀 key。重启或 TTL 过期发生在工具迭代中时，后续不同 tool result、甚至其他 session，可能复用由旧工具结果生成的 references。
* **references 的落点不符合工具状态机安全边界。** 最后一条是 `tool_result` 时，代码把 references 作为额外文本塞入同一个 user message；最后一条是 assistant 时，代码凭空追加一个 user message。前者改变了 tool-result turn 的用户语义，后者可能破坏 pending `tool_use` 或 assistant prefill。
* **advisor 并没有看到完整 Claude Code 请求上下文。** 它只收到经过 flatten 的 messages；原始 `system`、工具定义、tool IDs、图片和未知 content block 均丢失。因此 advisor 很容易生成“看似合理、实际基于错误上下文”的 references。
* **streaming 当前不是可靠的 Anthropic 语义代理。** 它对每个 Buffer 独立 UTF-8 解码，可能在中文/emoji 跨 chunk 时静默损坏文本；它在 thinking block start 时就按 signature 判定是否合法，因此无法正确处理 signature 后续才到达的合法流；同时没有把 `event:error`、缺失 `message_stop`、客户端断开建模为明确终态。
* **passthrough 不等价于直连 provider。** 请求协议头没有透传，成功响应会被 normalization，SSE 被 parse→normalize→重新编码；流式 provider 非 2xx 因过早 hijack 变成 HTTP 200 + SSE error，provider 的重试/限流响应头也全部丢失。
* **trace 目前只能视为“不完全的调用会计记录”，不能视为真实请求结果的唯一真相源。** 它没有实际 aggregator request、references、响应正文、客户端是否完整收到结果等信息；系统性 DB schema 不兼容又会被吞错，造成请求成功但 trace 全部消失。
* **文档与测试基线不可信。** README/PLAN 顶部仍说 Phase 1 或 Phase 2/3 未开始；架构文档仍声称字节级 SSE；测试未纳入 TypeScript typecheck，且部分测试继续引用已删除的 `cost_usd` 和旧版 `AdvisorResult.error: string`。

---

# 2. Business Logic Findings

## P0

### 未发现无条件影响全部请求的全局 P0

默认 `mom_mode=off`、普通 non-streaming JSON 路径并非必然不可用。不过以下 P1 在“Claude Code + tool loop + streaming”这一项目核心使用场景中，可能呈现接近 P0 的效果，因此仍然阻止生产发布。

---

## P1 — 必须修

### P1-1：`user_turn` cache 违反“key 覆盖真实输入”的基本不变量

**影响**

在工具迭代冷启动、进程重启或 TTL 过期后，advisor 会读取当前完整 tool results，但结果被存入一个不包含这些 tool results 的 key。随后：

* 下一次工具迭代可能复用旧工具结果导出的 references；
* 不同 session 只要初始 user 前缀相同，也可能复用这些 references；
* tool result 可能包含仓库代码、命令输出或其他敏感数据，因此存在跨 session 内容泄漏；
* benchmark/eval 的成本与质量会依执行顺序变化，后跑 session 获得前一 session 的 cache 优惠。

**触发场景**

1. user 提问；
2. assistant 调工具；
3. 网关重启或 cache TTL 过期；
4. 带 tool result A 的请求进入；
5. advisor 基于完整历史和 A 生成 references；
6. cache key 却只签名到最初 user message；
7. tool result B 或另一 session 命中该 key。

`selectSignatureMessages()` 在 `user_turn` 下截断到最后一条不含 `tool_result` 的 user message；但 `runFanoutStage()` 把完整 `body.messages` 交给 advisor，cache miss 后又无条件把结果写回该 key。  

cache 又是 `createOrchestrator()` 闭包内的进程级全局 cache，不含 session scope；现有测试甚至明确把跨 session 共享固化为预期。 

**建议修法**

* cache key 必须对 advisor 的**实际完整输入**做签名。
* `user_turn` 的 tool-iteration miss 有三种安全选择：

  1. 基于完整 messages 运行 advisor，并只写入 per-iteration key；
  2. 基于 user-turn signature messages 运行 advisor，保证 value 与 key 一致；
  3. 基于完整 messages 运行但不回填 user-turn cache。
* 默认按 `session_id` 或显式 `cache_namespace` 隔离；跨 session 共享必须成为显式 opt-in。
* cache entry 增加 `generation_input_hash`、`origin_gateway_request_id`、`cache_age_ms`，命中前校验。
* 对 benchmark/eval 默认使用 `fanout_mode=off`，避免跨样本污染。

---

### P1-2：reference builder 会改坏 tool flow 和 assistant prefill 语义

**影响**

函数名叫 `appendReferencesToLastUser`，实现却只检查**最后一条 message**：

* 最后一条是 user `tool_result` 时，在同一个 user message 末尾插入 references 文本。这会把“工具结果回填”改成“工具结果 + 新用户指令”，可能让 aggregator 把 references 当成比工具结果更新、更高优先级的指令。
* 最后一条是 assistant 时，凭空追加 user message。如果 assistant 正在等待 `tool_result`，这可能产生没有对应 result 的 pending `tool_use`；如果最后一条 assistant 是 prefill，则 continuation 语义被彻底改成新一轮 user turn。

代码路径和测试都明确固化了这两种行为。 

**触发场景**

* Claude Code 完成任意工具调用后发回 `tool_result`；
* 并行 tool calls 的批量结果；
* assistant prefill；
* 最后一条 assistant 含 `tool_use` 但工具尚未返回；
* 用户在 tool-result message 中同时附带新文本指令。

**建议修法**

* 不再把 references 写进用户 message。
* 将 references 放入独立的、明确标记为“不可信参考材料”的新增 system block；原始 user/tool messages 完全不改。
* 在实现 protocol-aware placement 前：

  * 尾部含 `tool_result` 时应绕过 MoM reference injection，或使用安全的 system-block 路径；
  * 尾部是 assistant 时应显式 bypass 或返回可识别的 validation error，不能合成 user。
* 增加 tool pairing 校验：每个 pending `tool_use.id` 必须有对应 `tool_result.tool_use_id`。
* 用户文本和 references 必须分离，不能让模型把 advisor 输出误认成用户原话。

---

### P1-3：SSE 增量解析可能静默破坏中文和 emoji；valid streaming thinking 也可能被删

**影响一：UTF-8 chunk 边界损坏**

`createSSEParser.push()` 对每个 Buffer 单独调用 `chunk.toString('utf8')`。当一个中文字符或 emoji 的多字节 UTF-8 编码跨两个网络 chunk 时，独立解码可能插入替换字符。JSON 仍可能解析成功，因此客户端拿到的是**成功但文字已损坏**的回答。

现有 chunking 测试只使用 ASCII SSE 文本，没有用原始 Buffer 在中文/emoji 字节中间切分。

**影响二：合法 thinking 流无法在 start 时判定签名**

normalizer 在 `content_block_start` 时立刻检查 thinking block 是否已有非空 signature；没有就把该 index 标记为永久丢弃。对“thinking 内容先流出、signature 在后续 delta 才到达”的合法流形态，这会把本可重放的 thinking 和 signature 一起删除。

类型只建模了 `text_delta` 和 `input_json_delta`，没有 `thinking_delta` / `signature_delta`；现有测试仅覆盖人为构造的 `signature:null` start，没有“后续 signature_delta 使 thinking 合法”的场景。 

这会导致 streaming 与 non-streaming 不等价：non-streaming 完整响应有 signature 时会保留 thinking，而 streaming 可能提前删除。

**建议修法**

* 使用 `StringDecoder` 或流式 `TextDecoder(..., { stream:true })`，在 EOF 时显式 flush。
* thinking block 必须缓存到 `content_block_stop`，收集 `thinking_delta` 和 `signature_delta` 后再决定保留或删除。
* 若产品明确决定“不向客户端返回 thinking”，则 non-streaming 和 streaming 应采用完全相同的策略，并明确可能影响 tool continuation；不能一边保留 signed thinking、一边在 streaming 早删。
* SSE 类型补齐 thinking/signature delta，增加真实事件顺序测试。

---

### P1-4：streaming 的“成功/错误/取消”终态不可信，客户端结果与 trace 会分叉

**影响**

当前 collector：

* 只要看到过 `message_start` 就能 `build()` 出响应；
* 不处理 `event:error`；
* 不要求收到 `message_stop`；
* 不记录 malformed event；
* 不记录客户端是否完整接收；
* 对 tool input 的 `input_json_delta` 也不组装。

因此下列情况都可能被记为 success：

* provider 发出 `event:error` 后正常关闭连接；
* 网络在 `message_stop` 前干净 EOF；
* 客户端中途关闭；
* 某个 malformed JSON frame 被 fallback 转发；
* 只收到 message_start 和部分内容。

collector 的 default 分支忽略 error 与 message_stop，`build()` 仅检查 `base`。

passthrough streaming 的 status 只看 `passthroughStream()` 是否抛异常，不检查 collector 是否形成完整终态。

此外：

* upstream body error 时先 `output.end()`，随后 catch 想写 error frame时已经太晚，客户端只看到突然 EOF；
* output `close` 会销毁 upstream，然后按成功 resolve，客户端取消可能被记为 success。

**建议修法**

`passthroughStream()` 应返回结构化的 `StreamOutcome`，至少包含：

* `terminal: message_stop | error_event | transport_error | client_canceled | incomplete_eof`
* `saw_message_start`
* `saw_message_stop`
* `provider_error`
* `parse_error_count`
* `bytes_forwarded`
* `client_delivery_complete`

Trace status 至少扩展为 `success / error / partial / canceled / cache_hit`。收到 `event:error` 或 EOF 前无 `message_stop` 时，不得记录 success。

---

### P1-5：`mom_mode !== always` 并不等价于直连 provider

**影响**

body 的大部分字段会保留，但协议层并非 direct passthrough：

1. handler 没有把 inbound headers 传进 provider 层；
2. provider 层只重新构造 auth、content-type、accept；
3. `anthropic-beta`、客户端 `anthropic-version`、request-id、retry-after、限流响应头均无法透传；
4. x-api-key 模式固定使用 `anthropic-version: 2023-06-01`；
5. non-streaming 成功响应会过滤 thinking block；
6. streaming 在 provider 响应之前就 hijack，provider 401/429/500 最终是 HTTP 200 + SSE error；
7. SSE 全量 parse、normalize、JSON.stringify，不是原流。

相关路径：   

non-streaming provider 错误的 status/body 处理相对正确，但响应头仍丢失。流式路径则不能保持 provider 原 HTTP 错误状态，可能改变 Claude Code 的鉴权、退避和重试行为。

**建议修法**

* Gateway 层构造明确的 `ProviderRequestContext`，包含允许透传的 Anthropic 协议 header allowlist。
* Provider client 返回 `{statusCode, headers, body/stream}`，不能只返回解析后的 body。
* streaming 应先拿到 upstream status/headers，再决定是否建立 SSE。
* 把 normalization 定义成显式模式，而不是继续称为 passthrough：

  * `strict_passthrough`
  * `anthropic_compat_normalize`
* 原样传回 `request-id`、限流和 retry 相关 header。

---

### P1-6：advisor 丢失关键上下文，reference 又以高权限 user 内容注入 aggregator

**影响**

advisor 请求只包含：

* flatten 后的 messages；
* 网关自己的 advisor system prompt；
* `reference_max_tokens`。

它没有原始：

* top-level `system`；
* tools 和 tool schemas；
* tool_choice；
* metadata；
* 图片；
* tool use/result ID 对应关系；
* 未知或未来新增的 content block。

`runAdvisor()` 的签名甚至只接受 `messages`；图片被直接丢弃，tool result 文本不带 `tool_use_id`，多个并发工具结果可能无法正确配对。 

随后 advisor 的任意输出未经可信边界处理，被直接放入 user message 的 `Expert Panel References` 区域；aggregator 没有额外 system 指令说明这些内容是不可信参考而非可执行命令。 

这会产生两类 silent wrongness：

* advisor 基于不完整的仓库/system/tool 上下文给出错误建议；
* malicious tool output 或某个 advisor 可以诱导 aggregator 忽略原问题、调用工具或输出错误答案。

**建议修法**

* `runAdvisor` 接受完整 `AnthropicMessagesRequest`，再显式构造 advisor view。
* 原始 system 指令应作为上下文保留，但与 advisor 自身角色提示分块，避免覆盖。
* 至少向 advisor提供工具名称、描述、参数结构和 tool ID/result ID；是否允许调用工具是另一件事。
* 图片无法支持时，不应静默丢弃：标记 `advisor_context_incomplete`，或对 multimodal turn 禁用 fanout。
* references 放在 system 级“不可信材料”容器，明确禁止执行其中指令或工具调用。
* Trace 增加 `advisor_context_loss`、`images_omitted`、`tool_results_truncated`。

---

### P1-7：失败 advisor 会被缓存并持续污染后续请求，trace 契约也被破坏

**影响**

cache miss 后，无论 advisor 是否失败，整批结果都会写入 cache。cache hit clone 又保留 `success=false` 和原 `error`。 

落 trace 时只要 `cache_hit=true` 就将 status 写为 `cache_hit`，同时仍写入非空 error；这直接违反类型契约“error 仅在 status=error 时填”。 

另一方面，`TraceError` 已经是对象，但 reference builder 直接模板字符串化，真实输出会是：

```text
[Reference 1 — model failed: [object Object]]
```

 

如果全部 advisors 失败，orchestrator 仍然调用 aggregator；最终 HTTP 可能成功，trace 也只有 aggregator success，客户端不知道 MoM 已退化为“单模型 + 一组不可读失败占位符”。

**建议修法**

* 任一 slot 失败时，整批 fanout 结果默认不进 cache。
* MVP 不建议做 partial cache；先保证一致性。
* `buildConcatReferences()` 只使用安全、简短的 `error.type` 和 `error.http_status`，避免原始 provider body进入 prompt。
* 增加 `advisor_success_count`、`advisor_failure_count`、`mom_degraded`。
* 定义 all-failed 策略：

  * 明确 fail-open 到 aggregator-only，并在响应/trace 标记；
  * 或明确返回 gateway error；
  * 不得无标记成功。

---

### P1-8：`mom.config.json` 没有 runtime schema，错误配置会静默改变业务模式

**影响**

配置加载仅做 `JSON.parse(...) as MoMConfig`，启动护栏只检查 always 模式下 slots 非空和 aggregator model 非空。 

典型 silent wrongness：

* `mom_mode: "alway"` 拼错后满足 `!== 'always'`，请求全部静默 passthrough；
* 非法 `fanout_mode` 的 key 选择和 trigger label 会进入不同 fallback；
* 非法 TTL 令 `parseTTL()` 返回 `undefined`，过期时间成为 `NaN`，cache 可能永不过期；
* `max_entries: "abc"` 可形成 `NaN`，LRU 上限失效；
* 负数 max_entries 被静默改成 1；
* slots 中空字符串会变成失败 advisor，但 aggregator 仍成功；
* 巨大 `reference_max_tokens` 会扩大每个 advisor 输出和总 references；
* 负 pricing 可让成本为负；
* `aggregation_mode:"judge"`、`advisor.tools_enabled:true`、`comparison.enabled:true` 都会被接受，但当前 runtime 不实现对应行为；
* `mom_mode:auto` 被声明但按 off 处理。

TTL 和 max entry 的当前处理可见：

配置类型暴露了多个尚未生效的业务字段。

**建议修法**

启动时做完整 schema validation 和版本迁移，至少拒绝：

* 未知 enum；
* 当前未实现的模式或 enabled flag；
* 空/非字符串/重复 slot；
* 超过上限的 slot 数量；
* 非正整数或超出范围的 reference budget；
* 非法 TTL/max entries；
* 非有限、负数 pricing；
* 缺 currency 或混合 currency 未声明；
* 非 URL provider base URL。

不支持的功能应该启动失败，而不是成功启动后无效。

---

### P1-9：旧 SQLite schema 会导致“请求成功、trace 全丢”，且错误被吞

**影响**

`initDB()` 使用 `CREATE TABLE IF NOT EXISTS`，没有 schema version 和 migration。旧表存在时不会增加、删除或调整列。当前 insert 使用新列集；如果旧 schema 仍含无 default 的 `cost_usd` 或更早结构，每次 trace insert 都可能失败。 

所有 trace save error 又被 `writeTrace()` 吞掉，客户端照常成功。

项目文档自己要求 schema 变化后删除 `mom.db` 重建，证明当前没有迁移路径。

**触发场景**

任何从旧 Phase 3/ISS-009/ISS-010 数据库直接升级的用户。

**建议修法**

* 引入 `PRAGMA user_version` 或 schema migrations 表。
* 启动时迁移；不能迁移就明确 fail-fast。
* 系统性 schema mismatch 不应进入普通“trace save failure容忍”分支。
* `/healthz` 增加 storage write/readiness 状态。
* 为一次 gateway request 增加完整性标记，避免只落 advisor、没有 aggregator 时被误解。

---

### P1-10：服务监听 `0.0.0.0`，但消息入口和 trace API 均无认证

**影响**

任何能访问端口的调用者都可以：

* 使用网关内的 provider API key消耗模型额度；
* 指定任意 passthrough model；
* 发起大量 fanout；
* 查询已知 session ID 的 trace；
* 通过大请求和长流耗尽资源。

路由注册没有认证，服务默认绑定所有网络接口。 

**建议修法**

* 本地模式默认只监听 `127.0.0.1`。
* 非 localhost 模式强制 gateway auth token。
* 增加并发、速率和每 session 限额。
* Trace API 与消息入口分权限。
* 在完成这些之前，不能标注为生产可用。

---

## P2 — 建议一周内修

| 问题                                                | 业务影响                                                                                                                                                    | 证据与建议                                                                                                                         |           |                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------- |
| **References 没有全局 token budget**                  | `reference_max_tokens` 同时作为每个 advisor 的输出上限和每条 reference 的截断上限，N 个 advisor 最终可形成约 N 倍 references；4 chars/token 对中文明显不可靠，可能造成 provider context overflow。 | 当前只按每条 `tokenBudget × 4` 截断，没有总预算。应使用 tokenizer、预留原 prompt 与 aggregator output 空间，并按 slot 分配全局预算。                             |           |                                                                 |
| **Aggregator 换模型却盲目复制全部 model-specific 字段**       | `thinking`、未知 beta 字段或某模型专属参数可能被带给另一 aggregator model，造成参数被忽略、语义变化或请求失败。                                                                                | `...original` 后只覆盖 model/messages。应有 provider/model capability adapter。                                                       |           |                                                                 |
| **Trace 不是完整事实源**                                 | 没有 messages、实际 references、响应正文、客户端交付状态、cache origin；只能做近似调用/usage 会计，无法解释“为什么答案错”。                                                                      | `TraceRequest` 只保存 summary 和 settings snapshot。建议增加受控的 redacted payload、hash、reference hash、stream outcome 和 gateway outcome。 |           |                                                                 |
| **Trace 中 requested model 被当作实际模型**               | provider 若解析 alias 或动态路由，`selected_model` 仍是请求中的 slot/model，trace 与 pricing 可能记错实际服务模型。                                                                 | `response_summary` 不含 `response.model`。字段应改名 `requested_upstream_model`，新增 `response_model`。                                  |           |                                                                 |
| **Trace 顺序与重复 slot 不可还原**                         | cache-hit advisors 共用同一毫秒时间戳，查询仅按 `started_at` 排序；重复模型没有 advisor index，Dashboard 无法可靠恢复 reference 顺序。                                                   | 增加 `sequence_no` / `advisor_index`，查询加入确定性排序。                                                                                 |           |                                                                 |
| **Session ID 写入与查询规则不一致**                         | POST 入口接受任何非空字符串；GET trace 只接受 UUID。非 UUID trace 会成功落盘但永远无法通过 API 查询。UUID 大小写也未统一。                                                                      | 入口和查询必须使用同一个 validator，并统一 lowercase。                                                                                         |           |                                                                 |
| **Pricing 看起来精确，实际上含估算与陈旧值**                      | `cache_write=input×1.25` 是估算；无 cached_price 时写 0；默认同步只补缺失、不更新已有价格。Dashboard 可能显示精确小数但业务成本错误。                                                            | Pricing snapshot 增加 `quality: exact                                                                                           | estimated | missing`、`fetched_at`、上游 source；provider adapter 决定 cache 定价。   |
| **Trigger reason 混合了 turn 类型和 cache 结果**          | 新 user turn 只因跨 session cache hit，就被标记为 `skipped_tool_iteration`；含“新用户文本 + tool_result”的 message 也一律被判工具迭代。Dashboard/eval 会误解。                          | 将其拆成 `turn_kind`、`cache_outcome`、`cache_scope` 三个独立字段。                                                                        |           |                                                                 |
| **MoM streaming 在 advisor fanout 期间无任何事件**        | handler 已进入 streaming，但 aggregator stream 要等所有 advisors 完成；慢 slot 期间无 ping，可能触发客户端/反代 idle timeout。客户端断开也不会取消 advisor 成本。                               | 增加 gateway ping、总 deadline、每 slot deadline、AbortSignal 和 client disconnect propagation。                                       |           |                                                                 |
| **重复 advisor slots 语义不清**                         | README 明确允许重复，但没有 per-slot temperature/prompt/id，通常只是对同一模型重复扣费；trace 又无法区分第几个相同 slot。                                                                   | 使用 `{id, model, temperature, system_prompt}` slot 对象，或暂时拒绝重复。                                                                 |           |                                                                 |
| **本地 fanout cache 与 provider prompt cache 名称易混淆** | `cache_hit` 表示本地 advisor result cache；`usage.cache_read_tokens` 表示上游 prompt cache。Dashboard 很容易混合两个比率。                                                  | 字段改为 `fanout_cache_hit` 和 `provider_cache_read_tokens`；cache-hit 行不是实际 upstream HTTP call，也应在 API 契约中突出。                      |           |                                                                 |
| **测试和文档与实现漂移**                                    | 当前测试绿灯即便出现，也不能代表当前业务契约被验证。                                                                                                                              | 详见 Test Gap Matrix。                                                                                                           |           |                                                                 |

---

## P3 — 长期优化

* `tool_use_count` 同时统计 `tool_use` 和 `tool_result`，会把工具调用次数放大。
* `reasoning_tokens` 永远为 0、`reasoning_per_million` 永远 null；字段看起来支持但实际上是占位。
* 每条 N+1 trace 都深拷贝完整 `MoMConfig`，包括整个 pricing table，数据膨胀明显。
* 每次 trace INSERT 都重新 prepare statement。
* SSE parser 丢弃 `id:`、`retry:`、comment heartbeat，EOF 时丢弃未以空行结束的最后一帧。
* SSE JSON parse fallback 没有正确重建多行 `data:`。
* `/trace/requests` 无分页或上限，长 session 会返回大量重复 settings snapshot。
* provider base URL 仅做非空校验，`/v1/messages` 路径重复或非法 URL 直到请求时才暴露。

---

# 3. Request Flow Audit

| 链路                            | 审查结果                                                                                                                                                           | 结论                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Passthrough non-streaming** | 请求 body 基本原样进入 provider，provider 非 2xx 的 status/body 基本能返回；但请求协议 header、provider response headers 丢失，成功 body 会经过 thinking normalization，并由 JSON 重新序列化。         | **部分符合。属于“语义代理 + normalization”，不等价于直连。**                                    |
| **Passthrough streaming**     | 过早设 SSE/hijack；非 2xx 变 HTTP 200 error event；全部 SSE parse/reencode；有 UTF-8、thinking、终态、error-event、client-cancel 风险。                                            | **不符合直连语义。当前是最高风险链路之一。**                                                     |
| **MoM non-streaming**         | Aggregator 的原始 system/tools/top-level字段得到保留，前缀 message 也基本保留；但 advisor 丢上下文，references 注入位置不安全，all-failed 可无标记成功，cache 可能复用错误 references。                      | **普通文本可 demo；真实 tool flow 不安全。**                                             |
| **MoM streaming**             | 继承全部 MoM non-streaming 风险，再叠加 valid thinking、Unicode、终态和无 heartbeat 问题。                                                                                        | **不建议用于真实 Claude Code agent loop。**                                          |
| **Advisor cache miss/hit**    | `off` 不读写 cache，业务最可预测；`per_iteration` 的 key 与完整 messages 基本一致，但仍跨 session 共享且会缓存失败；`user_turn` 正常首轮命中是有意的质量/成本折中，但 cold tool-iteration miss 存在 key/value 不一致。 | **当前最安全模式是 `off`；其次是 session-scoped `per_iteration`。`user_turn` 必须修后再默认启用。** |

### 各 cache mode 的业务语义

* **`off`**：每轮真跑 advisors，结果正确性最容易解释，但成本最高。
* **`per_iteration`**：完整 messages 参与 key；对于工具结果变化的 agent loop 更符合“input 决定 output”。仍需 session scope、失败不缓存和 config validation。
* **`user_turn`**：有意复用同一 user turn 的早期 references，因此本就可能与最新 tool results 不一致。当前实现又在 miss recovery 时把“看过新 tool results”的值塞回旧前缀 key，超出了正常 stale-cache trade-off，属于真正的 correctness bug。

---

# 4. Protocol Semantics Audit

| 协议元素                     | 当前行为                                                                                 | 判断                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **messages**             | passthrough body基本保留；aggregator 改写最后一条 message 或追加 user；advisor flatten全部消息。         | Aggregator prefix 保留是正确方向，但尾部改写不满足工具状态机安全性。                   |
| **system**               | passthrough/aggregator 保留原 system；advisor 完全替换为网关 advisor prompt。                    | Advisor 丢失 Claude Code 的核心上下文。                                |
| **tools / tool_choice**  | Aggregator 通过 `...original` 保留；advisor 不携带工具定义，`tools_enabled` 也不生效。                 | Aggregator 可以继续工具调用；advisor 对工具语境认知不足。                        |
| **assistant `tool_use`** | Aggregator prefix 保留；last assistant 时额外合成 user references。                           | Pending tool-use/prefill 可能被破坏。                               |
| **user `tool_result`**   | Aggregator 在同一 user message 追加 references；advisor 转成不含 tool ID 的普通文本。                | 结果与调用的关联被弱化，tool-result turn 被混入新指令。                          |
| **图片/未知 blocks**         | passthrough/aggregator运行时通常保留；advisor 静默丢弃。                                          | Multimodal MoM 结果不可信。                                         |
| **SSE event**            | parse→normalize→re-encode；忽略 comments/id/retry；valid thinking 与 UTF-8 有风险。           | 不属于字节级或严格语义级透传。                                               |
| **usage**                | non-streaming 直接读 provider；streaming 合并 message_start/message_delta；本地 cache hit 归零。 | happy path 基本可用；error/partial/in-band-error 下不可信。             |
| **stop_reason**          | non-streaming 保留；streaming 取 message_delta 或 message_start。                          | 无 `message_stop` 也可被记 success，终态验证不足。                         |
| **cache_control**        | Aggregator 前缀 marker 基本保留；最后一条 message 被修改；advisor 重新生成 system+3 markers。            | 对 aggregator prefix 的处理方向正确；但协议 header 不透传可能使 marker 能力与直连不同。 |
| **thinking**             | non-streaming signed thinking 保留、unsigned过滤；streaming start时过早判定。                    | streaming 与 non-streaming 不等价。                                |
| **provider error**       | non-streaming status/body基本保留；streaming通常变成 200+SSE error，midstream 可能只有 EOF。        | 流式错误语义不合格。                                                    |
| **response headers**     | 未返回 provider request-id、rate-limit、retry-after 等。                                    | Claude Code 的诊断与重试行为可能改变。                                     |

---

# 5. Silent Wrongness Risks

以下场景最值得作为上线前故障演练：

1. **TTL 在 tool iteration 中过期**：advisor 看到了 result A，结果写入只含初始 user prompt 的 key；下一次 result B 复用 A。
2. **另一个 session 问了同样的初始问题**：命中前一 session cache，eval 成本和质量受执行顺序影响。
3. **user message 同时含 tool_result 和新用户文本**：被判为旧 tool iteration，新文本不进入 user-turn key。
4. **valid streaming thinking 的 signature 后到**：thinking block 在 start 时已被永久丢弃。
5. **中文或 emoji 跨网络 chunk**：客户端收到替换字符，但请求仍成功。
6. **provider 发 SSE `event:error` 后正常 EOF**：客户端看见错误，trace 可能记录 success。
7. **stream 在 `message_stop` 前结束**：只要有 message_start，trace 仍可形成响应。
8. **客户端主动中断**：upstream 被 destroy，但 trace 可能是 success。
9. **单个 advisor 短暂 502**：失败结果被缓存 5m/1h，持续向 aggregator 注入失败占位。
10. **全部 advisors 失败**：aggregator 仍返回 200，客户端不知道 MoM 已退化。
11. **`mom_mode` 拼写错误**：所有请求静默变 passthrough。
12. **设置 `aggregation_mode=judge` 或 `tools_enabled=true`**：配置被接受，但行为不生效。
13. **从旧版本直接复用 mom.db**：trace insert 全失败，响应仍成功。
14. **发送非 UUID `X-Session-ID`**：trace 落盘成功，但查询 API 永远拒绝该 ID。
15. **pricing 同步脚本再次运行但未加 overwrite**：旧价格继续保留，成本图看起来精确但已过时。
16. **provider 实际路由到 alias 背后的另一个模型**：trace 和 pricing 仍按请求 alias 记录。
17. **重复 advisor slots**：实际付费多次，但 trace 无 slot index，Dashboard 无法解释引用顺序。
18. **trace 写盘失败或磁盘满**：用户拿到答案，eval/dashboard 无记录。

---

# 6. Test Gap Matrix

首先需要注意：根 `typecheck` 只包含 `src/**/*.ts`，tests 不参与 TypeScript 检查；`npm test` 由 `tsx` 直接转译。 

这已经造成实际漂移：

* orchestrator cost 测试仍访问已从 `TraceRequest` 删除的 `cost_usd`；
* reference-builder 测试仍用 `error:string` 且构造缺少多个必填字段的旧版 `AdvisorResult`，从而没有模拟真实的 `TraceError` object。

因此现有测试不能直接当作当前业务契约的可信证明。

| 领域                       | 现有覆盖                                                              | 真正缺失的业务测试                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool flow                | 测试了 tool_result 后追加 text、last assistant 后追加 user；但把危险行为当成功断言。     | `references_must_not_modify_tool_result_turn`；`pending_tool_use_requires_matching_tool_result`；`assistant_prefill_must_be_preserved_or_rejected`           |
| User-turn cache          | 覆盖“tool iteration 同 key”和 TTL 数据结构过期。                             | `tool_iteration_cache_miss_must_not_store_full_context_under_prefix_key`；result A/B 变化测试                                                                   |
| Cross-session cache      | 现有测试明确要求跨 session 共享。                                             | `cache_scope_is_session_by_default`；`eval_sessions_do_not_contaminate_cost_or_latency`                                                                     |
| Mixed text + tool_result | trigger 测试把它固定为非新 turn。                                           | `user_intervention_with_tool_result_starts_new_semantic_turn`                                                                                              |
| Advisor context          | 覆盖 flatten 后能看到所有 messages。                                       | `advisor_receives_original_system_context`；`advisor_receives_tool_schema_and_ids`；`multimodal_turn_disables_or_preserves_images`                           |
| Reference injection      | 覆盖顺序与字符截断。                                                        | `advisor_reference_cannot_override_user_instruction`；`global_reference_budget_is_enforced`；`slot_name_and_content_are_escaped`                             |
| Failed advisors          | 有 advisor error 和 clone preserve error 测试。                        | `failed_batch_is_not_cached`；`all_advisors_failed_has_explicit_degraded_outcome`；真实 `TraceError` 格式测试                                                      |
| UTF-8 streaming          | chunking 测试仅 ASCII、按字符串切分。                                        | `sse_utf8_split_at_every_byte_boundary_chinese_emoji`                                                                                                      |
| Thinking streaming       | 覆盖 signature:null 的 artificial unsigned block。                    | `valid_thinking_signature_delta_is_preserved`；`streaming_and_nonstreaming_thinking_policy_are_equivalent`                                                  |
| SSE terminal state       | 覆盖 pre-stream 502 和 network failure。                              | `error_event_marks_trace_error`；`eof_without_message_stop_is_partial`；`client_disconnect_is_canceled`；`body_error_emits_terminal_error_if_possible`        |
| Observer isolation       | 未覆盖。                                                              | `observer_throw_does_not_duplicate_or_drop_client_event`                                                                                                   |
| Header passthrough       | 未覆盖。                                                              | `anthropic_beta_and_version_forwarding`；`retry_after_and_request_id_returned`                                                                              |
| Streaming HTTP status    | 未覆盖 handler 级行为。                                                  | `provider_429_before_stream_preserves_http_status`                                                                                                         |
| Provider protocol drift  | 未覆盖 200 JSON error、unknown delta、multi-line data、EOF final frame。 | 对应四个 provider compatibility tests                                                                                                                          |
| Config                   | 只有 config source mtime。                                           | `invalid_mom_mode_fails_startup`；`invalid_ttl_fails_startup`；`unsupported_judge_mode_rejected`；`reference_budget_capped`；`empty_or_duplicate_slots_policy` |
| DB migration             | 只有新 schema CRUD。                                                  | `old_trace_schema_migrates_or_fails_startup`；`systematic_trace_failure_fails_health_check`                                                                 |
| Trace fidelity           | 覆盖 N+1、session query、usage。                                       | `trace_terminal_matches_client_terminal`；`advisor_index_order_is_deterministic`；`response_model_is_recorded`；`non_uuid_session_roundtrip_policy`           |
| Pricing                  | 覆盖数学函数和快照。                                                        | `estimated_price_is_flagged`；`missing_cached_price_is_not_exact_zero`；`sync_updates_changed_prices`；`mixed_currency_rejected_or_separated`                 |
| Test contract            | tests 不 typecheck。                                                | 新增严格 `tsconfig.test.json`，使 tests 与当前 public types 同步校验                                                                                                    |

---

# 7. 文档与实现一致性

## 明确不一致

1. README 英文和中文顶部都仍写“当前 Phase 1，只做 passthrough”，但同一 README 后面又给出了 `mom_mode=always`、fanout cache 和 pricing 的当前配置说明。  
2. PLAN 阶段表仍把 Phase 2、3 标记为待开始，而源代码已经实现 fanout/cache/trace。
3. `001ARCHITECTURE.md` 声称 SSE 主链路字节级转发、observer 只旁路观察；实际代码 parse、normalize、reformat，observer 抛错还可能导致同一事件再写一次 fallback。  
4. “Aggregator 字节级透传”本身也用词不准确：Fastify 已把入站 JSON 解析成对象，provider client 再 `JSON.stringify`，最多是前缀对象/字段语义保留，不是原始字节保留。

## 文档中正确的边界

Dashboard 当前确实是 mock-first preview，没有消费真实后端 API 或 SSE；不能把 Live、Pipeline、Cost 页面当成已接真实 trace 的功能。 

---

# 8. Remediation Plan

## 当天必须修

1. **临时关闭危险 cache 行为**

   * 默认切到 `fanout_mode=off`；
   * 或至少把 cache key 加 session scope；
   * tool-iteration miss 不得写回 user-turn prefix key；
   * 任一 advisor 失败时不缓存。

2. **给 tool flow 加硬护栏**

   * 尾部是 assistant 时禁止合成 user references；
   * 尾部含 tool_result 时不在该 message 中追加文本；
   * 在 protocol-aware system-block 注入完成前，对这些请求绕过 references。

3. **修 SSE UTF-8 与终态**

   * 流式 decoder；
   * `message_stop` 必须作为 success 条件；
   * `event:error` 必须转为 error outcome；
   * client close 记录 canceled；
   * observer 异常不能影响客户端字节。

4. **临时禁用或正确处理 streaming thinking normalization**

   * 在支持 signature_delta buffering 前，不得声称兼容 signed thinking；
   * extended-thinking 请求可以暂时走明确拒绝或非流式路径。

5. **禁止 unsupported config**

   * `aggregation_mode=judge`、`tools_enabled=true`、`comparison.enabled=true`、`mom_mode=auto` 应明确拒绝或从当前 schema 移除。
   * 完整校验 enum、slots、TTL、max entries、reference budget、pricing。

6. **修 advisor failure 语义**

   * 使用 `error.message` 或安全状态码；
   * all-failed 明确 degraded/fail-open/fail-closed；
   * trace status 与 error invariant 保持一致。

7. **数据库启动检查**

   * 检测旧 schema；
   * 迁移或 fail-fast，不能继续吞掉全部写入失败。

8. **缩小暴露面**

   * 默认只绑定 localhost；
   * 非 localhost 强制认证。

## 一周内修

1. 重构 provider client，支持 request headers、response status/headers 和延迟建立 SSE。
2. 将 advisor 输入升级为 full-request-aware view，纳入 system、工具 schema、tool IDs 和 multimodal policy。
3. References 改成 system 级不可信材料，加入全局 token budget 和真实 tokenizer。
4. 引入完整 StreamOutcome 状态机、heartbeat、deadline、AbortSignal、backpressure。
5. Trace 增加：

   * gateway outcome；
   * stream terminal；
   * advisor index；
   * response model；
   * cache origin；
   * reference/request/response hash 或可控 redacted snapshot。
6. Pricing 增加 exact/estimated/missing 标志和 provider-specific adapter。
7. 新增 test typecheck，清理全部 `cost_usd` 和旧 `AdvisorResult` fixtures。
8. 统一 README、PLAN、ARCHITECTURE、API 文档中的当前状态与术语。

## 后续优化

* Partial advisor cache 和逐 slot retry。
* Provider/model capability registry。
* Durable/batched trace writer 与 retention。
* Dashboard 真实 API 接入后再定义 metrics；严禁直接用 mock 字段倒逼错误的 trace 结论。
* 多币种成本分组或显式汇率系统。
* 运行时 config 热更新时的 cache generation 与 pricing version 管理。

---

# 9. Review Verdict

## 当前级别：**可 demo**

建议只在以下受控边界内 demo：

* 纯文本请求；
* 最后一条 message 是普通 user 文本；
* `stream=false`；
* 不启用 extended thinking；
* `fanout_mode=off`；
* `aggregation_mode=concat`；
* `advisor.tools_enabled=false`；
* fresh DB；
* 只监听 localhost；
* 不把 Dashboard mock 的质量、成本或 pipeline 数据宣称为真实运行结果。

## 当前不满足“可内部试用”

真实 Claude Code 内部试用通常包含频繁 tool use、streaming、thinking、长 session 和进程重启；这些正好覆盖当前最危险的 cache、reference placement 和 SSE 路径。至少完成“当天必须修”全部项目，并通过对应业务测试后，才适合限定团队内部试用。

## 当前不可生产

生产前置条件是：

* tool state machine 不被 references 改写；
* cache key 与实际 advisor 输入严格一致，且 session/namespace 策略明确；
* streaming 在 Unicode、thinking、error、EOF、cancel 下语义正确；
* passthrough 的 header/status/response 约定明确；
* config 和 DB schema fail-fast；
* trace 能区分 success、partial、error、canceled，并能代表客户端实际收到的终态；
* 网关鉴权、限流、deadline、取消传播和持久化健康检查到位；
* 测试被严格 typecheck，且不再依赖已经删除的字段。

**业务正确性总判断：目前核心架构方向成立，但 tool flow、user-turn cache 和 streaming 三条主轴尚未达到“请求成功即可相信结果正确”的标准。**
