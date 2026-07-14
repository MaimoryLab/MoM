# 010. Phase 7 Live Markdown + Pipeline 真时序 + Live→Pipeline 联动 + Ranking 伪随机占位

**日期**：2026-07-14
**状态**：已决策
**关联 Issue**：ISS-034

## 背景

Phase 6（ISS-033）打通 Live 页 MoM + Baseline + Judge 实时对比后，剩余观感缺口有四类：

1. **LivePage MoM/Baseline 输出用 `<pre>` 直吐字符串**：LLM 回复常含 markdown（代码块 / 表格 / 列表），观感差。
2. **PipelinePage 完全 mock**：`web/src/mock/pipeline-trace.ts` 提供 canned 时序 + advisor 文本 + Diff modal 静态 JSON；与真实 turn 完全隔离。
3. **Live 与 Pipeline 两页无联动**：用户在 Live 页 Run 完想看流程只能手动切标签，无叙事纽带。
4. **Ranking 卡数据静态**：9 条固定历史 + 5 preset 联动的第 10 条；每次 Run 视觉不变。

进入设计前，四个"决定长期形状"的分叉与用户对齐（AskUserQuestion 两轮共 5 题）：

| # | 分叉 | 决策 |
|---|---|---|
| 1 | 本轮范围（Live+Pipeline / +Cost+Settings / 全 PLAN7 项） | 只做 Live + Pipeline |
| 2 | Pipeline 数据源入口（Live Run 联动+下拉 / 只下拉 / 只 Live 联动） | Live Run 联动 + 下拉双入口 + URL 参数 |
| 3 | Pipeline 时序回放（真实相对时序回放 / 固定动画） | 真实相对时序回放 |
| 4 | Ranking 卡（真 3 家判分 / 伪随机占位 + MoM 靠前 + markdown 输出框） | 伪随机占位 + MoM 偏置 rank 1/2 + LivePage MoM/Baseline markdown 渲染 |

另外 3 项由 Claude 自主拍板并向用户 review 通过：

| # | 自主决策 | 理由 |
|---|---|---|
| A | 不引入 React Router，用 hash + URLSearchParams 手工解析 | Router 改造 20 行内可控；App.tsx 已有 5 页手工切换；新加 `?turn=<gwId>` 参数解析成本 <30 行 |
| B | 时序压缩阈值 `TIMELINE_CAP_MS=5000`；`rawTotal > cap` 时全 startMs/endMs 按 `cap/rawTotal` 比例缩放 | 真实 turn 可能 8-30s，展会节奏差；等比压缩保留"advisor 并发 → assembly → aggregator"相对节奏；页顶显示"真实耗时 Xs → 5s"标注 |
| C | Ranking 用 `mulberry32(hashSeed(gwId))` 决定性伪随机；MoM rank 1/2 概率 70%/30%；其余两家在剩余 rank 上均匀 | seed=gwId 保证同一 Run 视觉稳定；MoM 偏置符合展会叙事；无 gwId 时用 seed=`'preview'` 保留 preview 数据 |

## 被否定的方案

### 方案 A：LivePage 输出用 `dangerouslySetInnerHTML` + `marked` 转 HTML

否定原因：LLM 输出属于外部内容，直接注入 HTML 面临 XSS 风险；`marked` 需额外配 sanitizer；react-markdown 默认 sanitize，扩展点更清晰。

### 方案 B：引入 `react-syntax-highlighter` 高亮代码块

否定原因：包体积对比 —— 当前 vite 产物 826 KB gzip 235 KB，加语法高亮会翻倍。展会体验中"代码块用等宽字体展示"已经足够，语法着色属于锦上添花，Phase 8+ 单独评估。

### 方案 C：Pipeline 页用 React Router 3.x / react-router-dom 6

否定原因：项目已有的手工路由（App.tsx 里 5 个 `page === 'X' && <XPage />` 分支）改动最小；引入 react-router 需要 `<BrowserRouter>` / `<Routes>` / `<Route>` / `<Link>` 全套改造 + Sidebar 组件重写。手工 hash 解析 20 行内可控，无额外依赖。

### 方案 D：Pipeline 页不做时序压缩，等真时序播完

否定原因：真实 turn 可能 8-30s（advisor 冷启动 + 大模型 aggregator），展会现场"点 Run → 看 30 秒" 太慢；等比压缩保留了相对节奏（advisor 并发窗口 / assembly 短暂 / aggregator 长）这个视觉信号，只压缩了绝对时长。5s 是"看得清 4 阶段" 与 "不无聊"的折中。

### 方案 E：Pipeline 页时序按每节点固定 1s，与真实无关

否定原因：等同于"更换 mock 数据而已"，浪费了 `/api/traces/by-gateway/:gwId` 提供的真实 started_at / finished_at 信息。等比压缩既能看真实相对节奏，又控制总时长。

### 方案 F：Ranking 卡本轮完全隐藏

否定原因：LivePage 布局已锁定 6 卡（PromptShelf / MoM / Baseline / Judge / Cost / Ranking）；隐藏 1 卡视觉重心失衡。伪随机占位保留卡片位置 + "Preview · Phase 7" 标签是"承诺后续做"的诚实标注。

### 方案 G：Ranking 用 `Math.random()` 每次重新 shuffle

否定原因：破坏 React 重渲的一致性（同一 gwId 每次 render 数据不同）；useMemo(() => ..., [seed]) 缓存要求纯函数。mulberry32 决定性伪随机是标准做法。

### 方案 H：Pipeline TurnSelect 拉全部 role 的 traces

否定原因：`GET /api/traces?role=aggregator` 直接过滤到 N+1 组的 anchor（每 turn 一条 aggregator），下拉选项数量 = turn 数量。若拉全部 role，20 条上限只能覆盖 5-7 个 turn（每个 turn 有 N advisor + 1 aggregator），观感差。

### 方案 I：Diff Modal 完整展示 aggregator 消息（含 concat 后 references）

否定原因：`TraceRequest` 只存 `request_summary`（message_count / max_tokens / tool_use_count）与 `response_summary`（id / stop_reason），**不存 body**（decision 004 traces snapshot scope）。要拿完整 concat 后 references 文本需要新增字段，属于展会后深化。本轮 Diff Modal 展示概要 + advisor previews 已能说明"references 是如何拼进上下文的"意图。

## 决策

采纳前四个用户决策 + 三个自主决策（见 ISS-034 方案讨论段）。核心实现分层：

### 前端新增

- `web/src/components/primitives/MarkdownBody.tsx` — react-markdown + remark-gfm 封装
  - 默认 sanitize；不开 `rehype-raw`
  - 代码块用 `ui-monospace`，不引 syntax highlighter
  - 支持流式增量渲染（同一组件同一 text prop 变化即 re-render）
  - 可选 `cursor` prop 在末尾显示闪烁光标

- `web/src/lib/timing.ts` — 纯函数库
  - `compressTimeline(spans, capMs=TIMELINE_CAP_MS)` → `{ nodes, totalMs, compressedFromMs }`
  - `nodeStatusAt(startMs, endMs, elapsed)` → `'pending' | 'running' | 'done'`
  - `TIMELINE_CAP_MS = 5000`

- `web/src/lib/rankSeed.ts` — 纯函数库
  - `hashSeed(str)` — FNV-1a 32-bit
  - `mulberry32(seed)` — 决定性伪随机
  - `weightedPick(r, options)` — 加权抽签

### 前端改造

- `web/src/App.tsx`：`Router` 改 hash-based；`useHashRoute()` hook 解析 `#<page>?turn=<gwId>`；导出 `navigateTo(page, turn?)`；PipelinePage 收 `turnFromUrl` prop
- `web/src/pages/LivePage.tsx`：MomColumn/BaselineColumn 用 MarkdownBody 替换 `<pre>`；结果卡下方加 "→ 查看请求流程" 按钮（仅 `live.gatewayRequestId` 就绪后可点）；RankingChart prop 从 `preset` 改为 `seed=live.gatewayRequestId ?? 'preview'`
- `web/src/pages/PipelinePage.tsx`：完全重写主组件；`TurnSelect` 拉 `/api/traces?limit=20&role=aggregator`；选中拉 `/api/traces/by-gateway/:gwId`；`buildTurnData` 组装 ViewNode 列表；`FanoutFlow` / `PassthroughFlow` 两种视图；Diff Modal 从真 trace 组装
- `web/src/components/charts/RankingChart.tsx`：prop `preset` → `seed`；`useMemo(() => getRankingSeries(seed), [seed])`
- `web/src/mock/live-ranking.ts`：改为 `getRankingSeries(seed)` 纯函数；MoM rank 分布 70%/30%；其余两家均匀分配剩余 rank

### 后端

零改动。所有 Phase 7 依赖的 API（`/api/traces?role=aggregator` / `/api/traces/by-gateway/:gwId` / `/api/live/run` / `/api/comparison/:gwId`）均在 Phase 4 与 Phase 6 已就位。

### 关键约定

- **时序压缩**：`rawTotal > 5s` 时按 `5s/rawTotal` 比例缩放所有节点 startMs/endMs；否则原样。页顶显示"真实耗时"标注让用户知道被压缩了
- **passthrough turn 兼容**：若 by-gateway 返回只含 role='passthrough' 单条 trace，Pipeline 页显示 `PassthroughFlow`（单节点 + 说明），不显示 fan-out 视图
- **URL 语义**：`#pipeline?turn=<gwId>` — LivePage `navigateTo('pipeline', gwId)` 更新 hash；PipelinePage `useEffect([turnFromUrl])` 同步 selectedGwId；下拉切换只更新组件 state，不改 URL（避免频繁 hashchange 打断 useEffect 重跑）
- **Ranking seed 语义**：`seed=live.gatewayRequestId` 时 Run 完成后视觉 refresh；`seed='preview'` 时（未 Run）显示稳定的 preview 数据

## 后续

见 [`PLAN.md#Phase 8`](../../PLAN.md) 与 [`PLAN7.md`](../../PLAN7.md)：

- **Phase 8-01**：aggregation_mode=judge 结构化整合
- **Phase 8-02**：Ranking 卡真 3 家判分（aggregator-only + Fable5 + MoM）
- **Phase 8-03/04**：Cost / Settings 页真数据接入
- **Phase 8-05/06/07**：判分深化（judge 段建模 / 匿名映射日志 / 失败降级率）
- **Phase 8-08**：跨 tab / 分享链接 SSE 旁听
