# Potential Gateway Bugs To Review

> 范围：以下条目只关注网关基础语义可能产生的问题，不评价 MoM 业务设计本身。每一项都按“可能是 bug，需要核查/修复”的方式记录。

## P1: `/v1/messages` 之外的 Anthropic API 请求可能直接 404

- 现象：当前服务只注册了 `POST /v1/messages`，没有通用 `/v1/*` 透传。
- 可能影响：Claude Code 或 Anthropic SDK 如果调用 `/v1/models`、`/v1/messages/count_tokens` 或其他兼容端点，请求会在网关层失败，而不是转发到 provider。
- 证据位置：`src/gateway/server.ts`
- 建议核查：确认目标客户端实际会调用哪些 Anthropic API 端点；至少补齐模型列表和 count_tokens 的透传测试。

## P1: Provider URL 被硬编码为 `/v1/messages`

- 现象：上游 provider URL 构造固定返回 `${base}/v1/messages`。
- 可能影响：即使未来路由层新增其他 `/v1/*` 端点，底层 provider 调用仍可能错误打到 messages endpoint。
- 证据位置：`src/provider/provider-client.ts`
- 建议核查：将 provider URL 构造改成基于当前请求 path，或至少把 messages 专用 client 与通用 passthrough client 分开。

## P1: Anthropic 语义 headers 未透传

- 现象：上游请求只设置 `content-type`、`accept` 和 provider auth header，没有保留客户端传入的 `anthropic-version`、`anthropic-beta` 等协议相关 headers。
- 可能影响：provider 看到的请求和客户端直连时不同，可能导致 beta 能力、prompt caching、token counting、工具相关行为不一致。
- 证据位置：`src/provider/provider-client.ts`
- 建议核查：构造 header 时过滤 hop-by-hop/auth headers，但保留 Anthropic 协议语义 headers；补测试确认 `anthropic-beta` 能到达 provider。

## P1: Streaming 路径会解析并重写 SSE，不是真正透传

- 现象：streaming 响应会经过 SSE parser、JSON parse、normalizer，再重新 `formatSSEEvent` 输出。
- 可能影响：原始 SSE 帧格式、字段、事件边界、多行 data、注释、`id:`、`retry:` 等信息可能丢失或变化；客户端看到的流不再等价于 provider 原始流。
- 证据位置：`src/provider/stream-forward.ts`、`src/gateway/sse.ts`
- 建议核查：明确 streaming 是否允许被改写；如果目标是 passthrough，默认应 raw pipe，只把观察逻辑放在旁路。

## P1: Streaming provider 非 2xx 可能被客户端视为 HTTP 200

- 现象：gateway 先设置 SSE header 并 hijack，provider 非 2xx 后写入 `event: error` 帧，但 HTTP status 可能已经无法正确表达 provider 的 401/429/500。
- 可能影响：客户端、SDK、监控、重试策略可能把 provider 错误误判为成功 HTTP 请求，只在 SSE payload 中看到错误。
- 证据位置：`src/gateway/messages-handler.ts`、`src/provider/stream-forward.ts`
- 建议核查：provider response status 到达后再决定下游 status；非 2xx streaming 错误需要有一致的 HTTP/SSE 错误契约。

## P1: 透传模式会修改 provider 响应内容

- 现象：non-streaming provider response 会经过 `normalizeAnthropicResponse`，丢弃 unsigned `thinking` blocks。
- 可能影响：`mom_mode !== "always"` 下，走网关与直连 provider 的响应内容不同；如果客户端依赖这些 block，可能出现兼容性问题。
- 证据位置：`src/provider/provider-client.ts`、`src/provider/anthropic-normalize.ts`
- 建议核查：确认这是否是有意的 provider 兼容策略；如果是，应作为显式配置或清晰契约，而不是默认“透传”行为。

## P2: SSE parser 忽略标准字段和注释

- 现象：当前 parser 只处理 `event:` 和 `data:`，忽略其他 SSE 字段。
- 可能影响：如果 provider 返回 `id:`、`retry:`、comment heartbeat 或其他兼容字段，下游客户端无法收到，可能影响重连、调试或兼容行为。
- 证据位置：`src/gateway/sse.ts`
- 建议核查：如果 streaming 仍要 parse，应完整保留或转发未知字段；否则改成 raw pipe。

## P2: Provider 响应 JSON parse 失败会变成 gateway error

- 现象：non-streaming 成功响应直接 `JSON.parse(text)`，没有在 parse 错误里保留 provider status/content-type/body preview。
- 可能影响：provider 返回空 body、非 JSON body、HTML 错误页但 status 为 2xx 时，客户端看到的是 gateway error，trace 也可能不能准确表达 provider 行为。
- 证据位置：`src/provider/provider-client.ts`
- 建议核查：补 malformed provider response 测试；错误信息应包含安全的 body preview 和 provider status。

## P2: 请求日志可能记录敏感 body

- 现象：Fastify 默认 request logging 开启，项目没有明显的安全日志过滤层。
- 可能影响：prompt、tool result、模型请求内容、header 信息可能进入日志，造成隐私或安全问题。
- 证据位置：`src/gateway/server.ts`
- 建议核查：确认日志实际输出字段；增加安全日志构造函数，只记录 shape、大小、模型、状态、耗时，不记录 prompt/auth 内容。

## P2: Trace 查询接口无鉴权

- 现象：`GET /trace/requests?session_id=...` 直接返回 trace 数据。
- 可能影响：如果服务暴露在非本机可信网络，任何知道或猜到 session id 的调用方都可能读取请求元数据、模型、usage、错误和配置快照。
- 证据位置：`src/gateway/trace-api.ts`
- 建议核查：明确该接口只允许本机/内部网络访问，或增加鉴权/开关。

## P2: Provider 请求缺少显式超时与取消传播

- 现象：provider HTTP 请求未设置明确 timeout 或 AbortSignal；客户端断开时也没有明显传播取消到 provider 请求。
- 可能影响：provider hang、网络半开、客户端取消后，上游请求可能继续占用资源，导致并发耗尽或成本浪费。
- 证据位置：`src/provider/provider-client.ts`、`src/provider/stream-forward.ts`
- 建议核查：增加 request timeout、stream idle timeout、client disconnect abort，并补 provider hang 测试。

## P2: 配置文件缺少 schema 校验

- 现象：`data/mom.config.json` 读取后直接 `JSON.parse(raw) as MoMConfig`。
- 可能影响：非法 enum、负数 TTL/max_entries、错误类型、缺字段可能到运行时才表现为奇怪错误，而不是启动时明确失败。
- 证据位置：`src/config/mom-config-file.ts`
- 建议核查：增加运行时 schema 校验；启动时 fail fast，并给出可操作错误信息。

## P3: 文档与代码契约不一致，可能掩盖真实 bug

- 现象：部分文档仍描述旧字段或旧阶段行为，例如 `cost_usd`、Phase 1 透传状态等。
- 可能影响：review、测试、调用方会依据错误契约判断行为，导致“测试失败到底是代码错还是文档错”难以区分。
- 证据位置：`README.md`、`docs/005DEVELOPMENT.md`、相关 cost 测试。
- 建议核查：先收敛当前真实契约，再同步 README、development docs 和测试断言。
