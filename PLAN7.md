# PLAN7 — 阶段六未完成项 + 后续待办

> 本文列出 Phase 6(ISS-033)有意留到下一轮的所有事项。写作风格遵循 `PLAN.md` 惯例(陈述句、只写事实、不写理由推导 — 推导在 `docs/decisions/009-phase6-live-fullstack.md`)。
>
> 每一项都是 Phase 6 已识别但明确未做,不是新想法。

## 阶段六完成范围回顾(实况)

Phase 6 本轮(ISS-033)完成:

- 后端:`src/judge/*`(prompt / parse / runtime)、`src/live/*`(runtime / events / store / types)、`src/gateway/live-api.ts`(POST `/api/live/run` + GET `/api/comparison/:gwId`)、`src/storage/db.ts` `comparisons` 表、`src/types/mom.ts` `TraceRequest.role` 加 `'baseline' | 'judge'`
- 前端:LivePage 大改(预置直接跑 + textarea + Baseline checkbox + Run/Cancel + 真 SSE MoM 增量 + baseline_done 后打字机 + judge_done 后 radar)、`web/src/hooks/useLiveRun.ts`、`web/src/lib/api.ts` 补 SSE + comparison wrappers、`mock/live-samples.ts` 精简到只留 prompt 文本
- 文档:001/002/006 更新、PLAN.md Phase 6 状态、CHANGELOG、decisions/009

## 未完成项

### PLAN7-01. Aggregation mode `judge` — Judge 结构化整合替代 concat

原 PLAN.md Phase 6 目标之一。当前 orchestrator 只支持 `aggregation_mode: 'concat'`;`aggregation_mode: 'judge'` 生效意味着 fanout advisor 后不直接拼接 references,而是先跑一次 judge 调用输出 5 类结构化摘要(`consensus / disagreements / partial_coverage / unique_insights / blind_spots`)塞进 aggregator。

**要做**:
- `src/judge/judge-integration-prompt.ts`(`JUDGE_INTEGRATION_PROMPT_EN` / `JUDGE_INTEGRATION_PROMPT_ZH`)
- `src/judge/judge-integration-runtime.ts:runJudgeIntegration(results, momConfig, provider)`
- `src/aggregator/reference-builder.ts` 分支:`aggregation_mode === 'judge'` 时 references 走结构化 5 类而非 concat
- Judge 解析失败(safeJsonParse + 正则均失败)降级到 concat,`TraceRequest` 加 `judge_integration_fallback: boolean` flag(Cost 页需要区分"降级 turn"占比)
- 落 role='judge_integration' 的 TraceRequest(usage / pricing / cost_usd 计入 `total_cost_usd`)

**依赖**:本轮 `src/judge/*` 已就位;`callJudge(prompt, messages, settings)` 可提炼成通用引擎(integration 与 compare 只是不同 prompt)。

### PLAN7-02. Ranking chart 真数据(Aggregator-only + Fable5 + 相对排名)

Live 页底部 `RankingChart` 目前读 `web/src/mock/live-ranking.ts` 的 9 条历史 + preset-联动的第 10 条。真数据需要同时跑 MoM + Aggregator-only + Fable5 三家,由 judge 归一化到 rank 1..3。

**要做**:
- 后端:`src/live/live-runtime.ts` 在 `baseline_on=true` 且开启 ranking 收集时,额外并发发起 `aggregator-only`(只跑 aggregator 不带 references)与 `fable5-baseline`(用固定 Fable 5 模型)两条调用;判分 prompt 扩展为"3 家 5 维,输出各家 rank"
- 存储:`comparisons` 表加 `ranking_json TEXT`(记录三家 rank 1..3);或新表 `rankings`
- 前端:`RankingChart` 换用 `getComparison(gwId).ranking` 拉真数据;移除 "Preview · Phase 7" 标签
- 历史 9 turn 采用真跑积累(展会前多敲几次预置);或另开脚本回放

**依赖**:PLAN7-01 无需完成(结构化整合与排名判分是两个 prompt);但 judge 引擎最好抽通用后再加。

### PLAN7-03. Cross-tab / 分享链接 SSE 旁听

当前 `POST /api/live/run` 单连接 SSE 内推 8 类事件,发起方与订阅方是同一 tab。跨 tab 或"分享链接"场景需要:

**要做**:
- 新增 `GET /api/comparison/:gateway_request_id/stream`(SSE)
- 服务端 `src/live/live-bus.ts`(EventEmitter)在 comparison 更新时向所有订阅了同一 gwId 的连接推事件
- 前端从 URL 或 localStorage 恢复 gwId 后,若 comparison 尚未完成走 `/stream` 端点旁听

**依赖**:`live-bus` 是新组件,不与已交付路径耦合。

### PLAN7-04. Cost 页真数据接入

Cost 页(`web/src/pages/CostPage.tsx`)当前读 `web/src/mock/cost.ts` 的 32 turns session 成本 + cache 命中。真数据源已在 `/api/metrics`:

**要做**:
- Page 内 `useEffect` 拉 `getMetrics('all', 32)`
- SavedBanner / KPI 四卡 / CostStackedBar / CostPie / CacheHitBars / CostTimeline 全部映射到 `MetricsResponse`
- 空态:`traces` 为空时显示"跑几个真请求以看到成本分析"文案
- `mock/cost.ts` 删除

**依赖**:后端 `/api/metrics` 已就位(Phase 4)。

### PLAN7-05. Settings 页真数据接入

Settings 页(`web/src/pages/SettingsPage.tsx`)当前读 `web/src/mock/config.ts`,Save 按钮 setState + toast 不写盘。真数据源已在 `/api/config`:

**要做**:
- Page 内 `useEffect` 拉 `getConfig()`;Save 按钮改调 `saveConfig(mom)`
- 保留 Language 卡本地 state(那部分是前端 UI 语言,与后端 config 无关)
- Provider 卡展示 `getConfig().provider`(遮罩 api_key)
- `mock/config.ts` 删除

**依赖**:后端 `/api/config` 已就位(Phase 4);hot reload 语义(POST 后 orchestrator rebuild)也已就位。

### PLAN7-06. Pipeline 页真时序回放

Pipeline 页当前读 `web/src/mock/pipeline-trace.ts` 的 canned 时序 + Diff modal 静态 JSON。真数据源:`/api/traces/by-gateway/:gateway_request_id`:

**要做**:
- Page 顶新增"选择 turn"下拉,从 `/api/traces?limit=20&role=aggregator` 拉最近 20 个 gateway_request_id
- 选中后拉 `/api/traces/by-gateway/:gwId`,得到 N+1 条 upstream trace(advisor N 条 + aggregator 1 条)
- 时序动画从真 trace 的 `started_at / finished_at` 反演各节点状态
- Diff modal:aggregator trace 的 `settings_snapshot.aggregator` 与 advisor trace 的 messages 拼接展示

**依赖**:后端 `/api/traces/by-gateway/:gwId` 已就位(Phase 4)。

### PLAN7-07. Cost 页 Judge 段建模

Cost 页当前 mock 里没有 judge 段(4 段堆叠柱只有 Advisor A/B/C + Aggregator)。Phase 6 已经引入 `role='judge'` TraceRequest,`/api/metrics.summary.total_usage.judge` 会有非零值:

**要做**:
- `CostStackedBar` 加第 5 段 judge(judge 成本仅 Live 页 Run 有,非 turn 常规成本 — 需要说明)
- 4 段/5 段切换开关:`total_cost_usd += judge_integration.cost_usd`(仅 PLAN7-01 完成后有 integration 成本);`comparison_cost_usd`(judge_compare + baseline)独立展示,不进 total
- 需要 dashboard-api 层区分:`ByRoleRow` 已按 role group,但 judge_integration vs judge_compare 两类要在 metrics-api 层判定(基于 gateway_request_id 是否 in comparisons 表)

**依赖**:PLAN7-01 完成后才有意义(否则 total_cost_usd 里 judge 段永远为 0)。

### PLAN7-08. Judge 匿名映射日志留档

Phase 6 本轮 judge prompt 里 MoM/Baseline 匿名为 Response A/B,服务端随机映射后回填。当前实现在 memory 中一次性映射后落 `comparisons.judge_scores_json`(标签已 demap 回 mom/baseline)。为后期分析 model bias:

**要做**:
- `comparisons` 表加 `judge_ab_mapping TEXT`(`{a: 'mom' | 'baseline'}`),记录本次随机分配
- 展会后跑数据分析:同一 prompt 多次 Run,统计 judge 打分是否与 A/B 位置相关

**依赖**:纯字段扩展,兼容改动。

### PLAN7-09. Judge 失败降级 flag 上 Dashboard Cost 页

Phase 6 已经在 comparisons 表落 `judge_fallback: 0 | 1`(safeJsonParse 直失败但正则抽出的场景)。Cost 页需要区分"降级 turn"占比:

**要做**:
- Cost 页新增 KPI 卡"Judge 降级率"
- `/api/metrics` 补 `summary.judge_fallback_rate`
- Live 页 judge_done 事件已带 `fallback` flag,前端可以 tooltip 说明"本轮 judge 解析走了 fallback 分支"

**依赖**:后端 metrics-api 扩展。

## 优先级建议

- **展会前必做**:PLAN7-04 / PLAN7-05(Cost + Settings 页真数据,让 Dashboard 一致性观感提上来)
- **展会前锦上添花**:PLAN7-02(Ranking 真数据 — Live 页视觉完整)
- **展会后**:PLAN7-01(aggregation_mode=judge)、PLAN7-06(Pipeline 真时序)、PLAN7-07/08/09(判分深化)
- **视需要**:PLAN7-03(分享链接场景才需要)

## 未列入 PLAN7 的项(Phase 8+ 或永久搁置)

- CLI / NPM 包 / Claude Code 插件形态(PLAN.md 已说远期)
- 多 provider(PLAN.md 已说远期)
- `mom_mode: auto`(PLAN.md 已否定,间歇性触发破坏缓存前缀)
- Manual 触发指令 `/mom on|off`(PLAN.md 已否定,产品定位无感触发)
