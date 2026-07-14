# Business Bug Triage

> 目的：从 `code-review/` 现有 review 结果里，筛出真正值得当前关注的“业务逻辑可能存在 bug”的项。
>
> 筛选标准：只有会影响现有网关请求语义、Claude Code / Anthropic 协议兼容、tool flow、streaming、cache、references、trace 可信度的项，才放入“优先核查”。偏新增能力、长期治理、安全加固、运维增强、文档同步的项先暂不考虑。

## 优先核查：业务逻辑 Bug 候选

### P1: `user_turn` cache key 与 advisor 实际输入不一致

- 来源：`chatgpt-pro.md` P1-1
- 为什么是业务 bug：cache key 只覆盖到真实 user turn，但 cache miss 时 advisor 可能读取完整 tool results，再把结果写回 user-turn key。之后不同 tool result 或不同 session 可能复用旧 references。
- 可能后果：请求成功，但 aggregator 参考的是错误工具结果或其他 session 的上下文。
- 建议优先级：最高。

### P1: References 注入位置可能破坏 tool flow

- 来源：`chatgpt-pro.md` P1-2
- 为什么是业务 bug：最后一条是 `tool_result` 时，references 被追加进同一个 user message；最后一条是 assistant 时，代码会合成一个新的 user message。
- 可能后果：Claude Code 的 tool_use/tool_result 状态机被改写，aggregator 把 references 当成新用户指令或破坏 pending tool call。
- 建议优先级：最高。

### P1: Streaming SSE 解析可能损坏中文/emoji

- 来源：`claude-code-review-result.md` Commit 3、`chatgpt-pro.md` P1-3
- 为什么是业务 bug：SSE parser 对每个 Buffer 独立 `toString('utf8')`，多字节字符跨 chunk 时可能变成替换字符。
- 可能后果：客户端收到的回答文本被静默损坏，但请求仍显示成功。
- 建议优先级：高。

### P1: Streaming thinking normalization 可能错误删除合法内容

- 来源：`chatgpt-pro.md` P1-3
- 为什么是业务 bug：streaming 时在 `content_block_start` 就判断 thinking block 是否有 signature；如果 signature 后续才通过 delta 到达，合法 thinking 可能被提前丢弃。
- 可能后果：streaming 与 non-streaming 行为不一致，extended thinking / continuation 语义可能错。
- 建议优先级：高。

### P1: Streaming 终态不可信，错误/截断/取消可能被记录为成功

- 来源：`claude-code-review-result.md` Commit 5、`chatgpt-pro.md` P1-4
- 为什么是业务 bug：collector 不要求 `message_stop`，不处理 `event:error`，中途 EOF、客户端断开、provider error event 都可能被当成成功或部分成功。
- 可能后果：客户端收到截断流或错误流，但 trace / 网关状态显示 success。
- 建议优先级：高。

### P1: `mom_mode !== always` 不是严格透传

- 来源：`compare-to-mom2-result.md` 中 header、response normalization、SSE rewrite、HTTP status 项；`chatgpt-pro.md` P1-5
- 为什么是业务 bug：透传模式仍会丢协议 headers、改写 non-streaming content、重写 SSE，并可能把 provider streaming 非 2xx 变成 HTTP 200 + SSE error。
- 可能后果：走网关和直连 provider 的行为不一致，Claude Code 的 beta 能力、重试、限流、thinking、SSE 处理可能被改变。
- 建议优先级：高。

### P1: Anthropic 语义 headers 未透传

- 来源：`compare-to-mom2-result.md`
- 为什么是业务 bug：`anthropic-version`、`anthropic-beta` 等 headers 可能影响 provider 实际行为。
- 可能后果：prompt caching、beta 能力、token counting、工具相关协议行为和直连不一致。
- 建议优先级：高。

### P1: Streaming provider 非 2xx 可能被客户端视为 HTTP 200

- 来源：`compare-to-mom2-result.md`
- 为什么是业务 bug：handler 先进入 SSE/hijack，provider 401/429/500 后只写 error event，HTTP status 可能不再表达真实错误。
- 可能后果：SDK、客户端重试、监控和 eval 误判请求成功。
- 建议优先级：高。

### P1: Advisor 输入丢失关键上下文

- 来源：`chatgpt-pro.md` P1-6
- 为什么是业务 bug：advisor 只看 flatten 后的 messages，可能丢失 top-level system、tools schema、tool IDs、图片、未知 content block。
- 可能后果：advisor 给出基于不完整上下文的 references，aggregator 最后仍成功返回，但答案质量或方向错误。
- 建议优先级：高。

### P1: 失败 advisor 结果会被缓存

- 来源：`claude-code-review-result.md` Commit 2、`chatgpt-pro.md` P1-7
- 为什么是业务 bug：一次 provider 抖动/429/502 产生的失败 reference 可能在 TTL 内持续被复用。
- 可能后果：后续请求持续收到失败 advisor references，即使 provider 已恢复。
- 建议优先级：高。

### P1: Advisor 失败 reference 可能渲染成 `[object Object]`

- 来源：`claude-code-review-result.md` Commit 4、`chatgpt-pro.md` P1-7
- 为什么是业务 bug：`TraceError` 对象被直接模板字符串化。
- 可能后果：aggregator 看到不可读的失败信息，无法合理判断 advisor 失败原因。
- 建议优先级：中。

### P1: 配置缺少 runtime schema，非法配置可能静默改变行为

- 来源：`claude-code-review-result.md` Commit 6、`compare-to-mom2-result.md`、`chatgpt-pro.md` P1-8
- 为什么是业务 bug：`mom_mode` 拼错可能静默变透传；非法 TTL 可能让 cache 永不过期；未实现的 flag 可能被接受但无效果。
- 可能后果：用户以为在跑 MoM/某个模式，实际行为完全不同。
- 建议优先级：高。

### P2: References 没有全局 token budget

- 来源：`chatgpt-pro.md` P2
- 为什么算业务 bug 候选：如果多个 advisor 的 references 总量过大，aggregator 请求可能超上下文或挤掉原始问题空间。
- 可能后果：请求失败、截断、或 aggregator 注意力被 references 淹没。
- 建议优先级：中。不是新增功能，是现有 references 拼接策略的正确性问题。

### P2: Aggregator 换模型时盲目复制原请求 model-specific 字段

- 来源：`chatgpt-pro.md` P2
- 为什么算业务 bug 候选：`...original` 后只覆盖 model/messages，原请求里某些模型专属参数可能被带给另一个 aggregator model。
- 可能后果：provider 忽略参数、报错，或生成行为与预期不一致。
- 建议优先级：中。

### P2: `/v1/messages` 之外的 Anthropic API 请求可能 404

- 来源：`compare-to-mom2-result.md`
- 为什么算业务 bug 候选：如果目标客户端实际调用 `/v1/models`、`/v1/messages/count_tokens` 等端点，当前网关不是完整兼容网关。
- 可能后果：Claude Code / SDK 某些流程直接失败。
- 建议优先级：中。先确认真实客户端是否依赖这些端点；如果不依赖，可降级。

### P2: Provider URL 硬编码 `/v1/messages`

- 来源：`compare-to-mom2-result.md`
- 为什么算业务 bug 候选：这是上一个问题的底层原因。一旦新增其他端点，底层请求仍可能打错路径。
- 可能后果：非 messages 请求被错误转发到 messages endpoint。
- 建议优先级：中。与上一项一起处理。

### P2: SSE 多行 data / 标准字段处理不完整

- 来源：`claude-code-review-result.md` Commit 8、`compare-to-mom2-result.md`
- 为什么算业务 bug 候选：当前 parser 忽略 `id:`、`retry:`、comment，JSON parse 失败 fallback 时多行 data 可能被错误重建。
- 可能后果：SSE 客户端行为与 provider 原始流不一致。
- 建议优先级：中低。若改为 raw pipe，此项自然消失。

## 可以暂时不考虑：不是当前业务逻辑 Bug 的项

### 暂不考虑: `cost_usd` 是否落盘

- 来源：`claude-code-review-result.md` Commit 1、`chatgpt-pro.md` 测试漂移
- 原因：这是 trace/eval 成本契约冲突，不直接影响模型请求的业务回答正确性。并且当前文档有“由 eval/dashboard 现算”的说法，不能简单按测试改回落盘。
- 处理建议：先确定成本契约；不要把它混入业务逻辑 bug 修复批次。

### 暂不考虑: 请求日志可能记录敏感 body

- 来源：`compare-to-mom2-result.md`
- 原因：这是安全/隐私风险，不是“请求成功但业务结果错误”的逻辑 bug。
- 处理建议：安全 review 单独排期。

### 暂不考虑: Trace API 无鉴权

- 来源：`compare-to-mom2-result.md`、`chatgpt-pro.md` P1-10
- 原因：这是安全/部署暴露面问题，不是业务逻辑正确性问题。
- 处理建议：如果要非 localhost 部署，再作为安全必修项处理。

### 暂不考虑: 服务监听 `0.0.0.0`

- 来源：`chatgpt-pro.md` P1-10
- 原因：部署安全问题，不影响请求语义本身。
- 处理建议：和鉴权、限流一起归入部署安全 checklist。

### 暂不考虑: Provider 请求缺少显式超时 / 取消传播

- 来源：`claude-code-review-result.md` Commit 7、`compare-to-mom2-result.md`
- 原因：这是稳定性/资源控制问题。会导致挂起或浪费成本，但不是现有业务逻辑结果错误的核心。
- 处理建议：可在稳定性 hardening 阶段处理；若真实遇到长流中断，再提升优先级。

### 暂不考虑: Provider 响应 JSON parse 失败处理不够好

- 来源：`compare-to-mom2-result.md`、`claude-code-review-result.md` Commit 9
- 原因：这是异常防御和错误可诊断性问题。只有 provider 返回 2xx malformed body 时触发。
- 处理建议：低优先级补测试即可。

### 暂不考虑: Trace 不是完整事实源

- 来源：`chatgpt-pro.md` P2
- 原因：这是可观测性能力不足，不直接改变模型请求结果。
- 处理建议：等核心请求语义稳定后再扩展 trace 字段。

### 暂不考虑: Trace selected_model / alias / response_model 不精确

- 来源：`chatgpt-pro.md` P2
- 原因：影响成本和观测准确性，不直接影响回答正确性。
- 处理建议：归入 eval/dashboard 精度问题。

### 暂不考虑: Trace 顺序、重复 slot 可还原性不足

- 来源：`chatgpt-pro.md` P2
- 原因：主要影响 dashboard/eval 展示和排查，不是当前业务请求结果错误。
- 处理建议：等 trace schema 调整时一起做。

### 暂不考虑: Session ID 写入和查询规则不一致

- 来源：`chatgpt-pro.md` P2
- 原因：影响 trace 查询，不影响请求响应本身。
- 处理建议：trace API 契约修正时处理。

### 暂不考虑: Pricing 精确度、过期价格、币种问题

- 来源：`chatgpt-pro.md` P2
- 原因：影响成本统计，不影响模型回答逻辑。
- 处理建议：成本/eval 专项处理。

### 暂不考虑: Trigger reason 字段拆分

- 来源：`chatgpt-pro.md` P2
- 原因：影响 dashboard/eval 对事件的解释，不直接影响请求结果。
- 处理建议：观测模型重构时处理。

### 暂不考虑: MoM streaming 在 advisor fanout 期间无事件

- 来源：`chatgpt-pro.md` P2
- 原因：这是用户体验/idle timeout/stability 问题，不是 references 或 answer 语义必错。
- 处理建议：如果实际客户端/反代有 idle timeout，再提升优先级。

### 暂不考虑: 重复 advisor slots 语义不清

- 来源：`chatgpt-pro.md` P2
- 原因：更像配置设计/成本效率问题。除非确认重复 slot 是误配置且导致质量问题，否则不算核心 bug。
- 处理建议：schema 校验时决定允许还是拒绝。

### 暂不考虑: 本地 fanout cache 与 provider prompt cache 命名混淆

- 来源：`chatgpt-pro.md` P2
- 原因：命名和 dashboard 解释问题，不影响运行逻辑。
- 处理建议：API 清理时处理。

### 暂不考虑: DB migration / 旧 SQLite schema

- 来源：`chatgpt-pro.md` P1-9
- 原因：升级/运维问题。它会导致 trace 丢失，但不直接改变当前请求答案。
- 处理建议：如果项目要给已有用户升级，再进入必修；当前业务逻辑 bug 批次先不处理。

### 暂不考虑: 文档与代码契约不一致

- 来源：`compare-to-mom2-result.md`、`chatgpt-pro.md`
- 原因：文档漂移会误导 review，但不是代码业务逻辑 bug 本身。
- 处理建议：修完核心 bug 后统一同步。

## 建议的修复顺序

1. 修 cache key/value 不一致、失败 advisor 不缓存、非法 TTL/schema 校验。
2. 修 references 注入位置，避免破坏 tool_result / assistant prefill。
3. 修 streaming：UTF-8 decoder、terminal outcome、error event、provider 非 2xx status。
4. 修 passthrough 语义：headers 透传、是否允许 normalization、SSE 是否 raw pipe。
5. 修 advisor context loss：至少保留 system/tool schema/tool IDs，或在不支持时明确禁用 MoM。
6. 再处理 references 总预算、aggregator 参数兼容、非 `/v1/messages` 端点。

## 当前最小高价值核查集

如果只想先抓最可能造成“请求成功但结果错”的问题，建议先写这些测试：

1. `user_turn_cache_miss_does_not_store_tool_result_value_under_user_prefix_key`
2. `references_are_not_appended_inside_tool_result_message`
3. `last_assistant_message_does_not_synthesize_user_reference_message`
4. `sse_utf8_split_multibyte_characters_preserve_text`
5. `sse_error_event_marks_stream_outcome_error`
6. `provider_429_streaming_does_not_look_like_http_200_success`
7. `failed_advisor_results_are_not_cached`
8. `advisor_failure_reference_uses_trace_error_message_not_object_string`
9. `invalid_mom_mode_or_ttl_fails_startup`
10. `anthropic_beta_header_reaches_provider`
