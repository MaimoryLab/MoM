# 003 — Claude Code 走网关时也 fork baseline + judge

## 背景

来自 ISS-035 讨论 Q6。用户在改 Live 页时问：如果 Claude Code 通过 MoM 网关 (`/v1/messages`) 发问，Dashboard 能不能像 Live 页那样把 baseline 对比 + judge 打分也带上？当前架构里两条路径完全独立：

- `/v1/messages` 走 orchestrator，落 `traces` 表（advisor + aggregator + passthrough）
- `/api/live/run` 走 `live-runtime`，额外 fork baseline + judge，落 `comparisons` 表

Pipeline 页读的是 `traces`，所以从 Claude Code 触发的请求，Pipeline 页可以完整展示（流程图 + Diff 弹窗，ISS-035 已让真实文本可见）。但 Live 页读的是 `comparisons`，Claude Code 的请求不落这张表，Live 页看不到对比与打分。

## 触发条件

任一：
- 用户明确希望展会现场用 Claude Code 演示"真实使用场景 + 实时对比效果"
- 出现"我想批量看 Claude Code 用了 MoM 一整天，MoM 到底比 flagship 好在哪"的需求
- 判定 provider 侧配额有充分冗余可以承担 3× 成本膨胀

## 方案概述（方案 Y）

`/v1/messages` handler 在 orchestrator 完成 fanout+aggregator 之后，判定 `trigger_reason === 'user_turn'` 时，异步 fork baseline + judge：

```
orchestrator.streaming/nonStreaming(body, ...)  // 主链路：advisor + aggregator + 落 traces
  └── if (trigger_reason === 'user_turn' && mom.comparison.trigger_on_gateway_requests) {
        queueMicrotask(async () => {
          const baseline = await runBaselineCall(body, mom.comparison.baseline_model, provider);
          const judge = await runJudgeCompare({momText, baselineText, judge: mom.judge, provider});
          // 写 comparisons + 额外 baseline/judge traces
        });
      }
```

fork 与主链路完全解耦：主链路先给 Claude Code 回响应，baseline+judge 后台跑，跑完写库，Live 页轮询 `GET /api/comparisons` 时能看到这条对比记录。

**只在 user_turn 边界 fork**：Claude Code 一次对话通常包含几十次 `/v1/messages`（每次 tool_use 迭代一次），只有 user_turn（真正的用户提问轮）的 aggregator 输出才是"MoM 的最终答案"，跟 baseline 对比才有意义；tool 迭代中间轮是 passthrough，跟 baseline 对比等于"passthrough vs baseline"，没意义。

### 与已有代码的复用

- `runBaselineCall` 已经存在（`src/live/baseline.ts`），直接复用
- `runJudgeCompare` 已经存在（`src/judge/judge-runtime.ts`），直接复用
- `createComparison / updateComparisonMom / updateComparisonBaseline / updateComparisonJudge` 已经存在（`src/live/live-store.ts`），需要新加"从 orchestrator 层调用"的入口，因为 orchestrator 拿到 MoM 输出的时机与 Live 页不同

### 关键 config 开关

`mom.config.json` 加：

```jsonc
"comparison": {
  "enabled": true,
  "baseline_model": "…",
  "trigger_on_gateway_requests": false   // ← 新加，默认 false
}
```

**默认 false** —— 用户必须明确开启，避免"某天路过 Claude Code 用了两小时，账单翻了 3 倍"这种意外。开启后前端 SettingsPage 应显示明显的成本提示。

## 风险与依赖

1. **成本翻倍**：每个 user_turn 从 "1 aggregator 调用" 变成 "1 aggregator + 1 baseline + 1 judge = 3× 成本"。default false 是必需的保护。
2. **provider rate limit**：3 advisors + 1 aggregator + 1 baseline + 1 judge = 每 user_turn 6 次 provider 调用。若 provider 侧有并发上限，实测前需要 canary 一批小 prompt。
3. **传染错误面**：baseline / judge 失败不能影响主链路。用 `queueMicrotask + try/catch` 严格隔离。
4. **traces 表暴增**：一次 user_turn 从"N+1 条 trace"变成"N+3 条"。查询 Pipeline 页时要区分 baseline / judge role（当前 role 枚举已经涵盖，无需 schema 变动）。
5. **Comparison 页容量**：Live 页 `GET /api/comparisons` 现在 limit=20，前端展示最近 20 条。开启后一小时内可能积累几十条，需要考虑分页与过滤。

## 与当前实施的关系

**当前兜底方案**：
- Pipeline 页可以看 Claude Code 的完整链路（advisor / aggregator / passthrough），Diff 弹窗看到拼接前后文本 —— ISS-035 已实现
- Live 页只服务 Dashboard 端手动提交的对比任务，展会讲解走"提交 Prompt → 后台跑 → 结果异步显示"叙事

**切换路径**：本方案实施后，`/v1/messages` 路径也会产生 `comparisons` 行；前端 Live 页可通过 `comparisons.origin: 'dashboard' | 'gateway'` 字段（届时新加）区分并可选筛选。核心 comparison schema / GET /api/comparison 契约不需破坏性变更。

## 关联

- ISS-035（本讨论的诞生地）
- `src/orchestrator/orchestrator.ts` — 未来实施时改动主入口
- `src/live/live-runtime.ts` — 共享 baseline+judge finalize 逻辑
- `mom.config.json` — 新增 `comparison.trigger_on_gateway_requests`
