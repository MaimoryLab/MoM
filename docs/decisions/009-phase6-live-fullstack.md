# 009. Phase 6 Live 全链路：judge compare + baseline 并发 + 专用入口

**日期**：2026-07-14
**状态**：已决策
**关联 Issue**：ISS-033

## 背景

Phase 5.0 交付了 Live Compare 预览版（`web/src/pages/LivePage.tsx`），5 个预置 prompt × 中英各一套 MoM/Baseline/Judge 完整脚本内嵌在 `web/src/mock/live-samples.ts`。所有内容——MoM 长回复、Baseline 长回复、5 维 judge 分、advisor previews——都是 mock。真实产品语义应当是"用户输入 prompt → MoM 走 orchestrator 主链路 → baseline 并发单模型调用 → judge 对两输出打 5 维分 → Live 页三卡实时呈现"。

Phase 4 已经把 `/api/comparison/:trace_id` 挂了个 501 占位（`src/dashboard-api/comparison-api.ts`），`comparison.enabled` 字段已在 MoMConfig 里，`comparisons` 表不存在，`src/judge/` 目录不存在。PLAN.md Phase 6 段落已给了初步构想（`runJudge` / `runJudgeCompare` / baseline 异步 / 501 移除），本轮把它落成可运行的完整链路。

进入设计前，四个"决定长期形状"的分叉与用户对齐（AskUserQuestion 两轮共 6 题）：

| # | 分叉 | 决策 |
|---|---|---|
| 1 | 范围（只做 Live 全链路 / Live+Cost+Settings / 五页全接真） | 只做 Live 全链路 |
| 2 | 响应文本 + judge JSON 落哪儿（新表 comparisons / 扩 TraceRequest.role / 混合） | 新表 comparisons |
| 3 | aggregation_mode: judge 本轮做不做（本轮做 / 一并 / 共用引擎分两 prompt） | 本轮只做 judge compare，未完成项写 PLAN7.md |
| 4 | 预置定位（模板 / 移除 / 直接跑 + 输入框旁挂） | 直接跑 + 输入框旁挂 |
| 5 | 调用时序（并发 / 严格串行 / MoM 同步 + baseline+judge 完全后台） | MoM+baseline 并发，Promise.allSettled 后触发 judge |
| 6 | MoM 输出渲染（真 SSE / 都非流+前端打字机 / MoM+baseline 都真流） | 真 SSE |

另外 5 项由 Claude 自主拍板并向用户 review 通过（见 ISS-033）：

| # | 自主决策 | 理由 |
|---|---|---|
| A | Judge 5 维沿用前端 UI 已有的 `correctness / completeness / depth / clarity / usefulness` | 前端 JudgeRadar + i18n 字典 + mock 已按此实现，若切 PLAN.md 原写的 `efficiency / safety` 需重画整套 UI |
| B | Judge prompt 里 MoM/Baseline 匿名为 Response A/B，服务端随机映射后回填 | 避免 judge 因看到 "MoM aggregator" 字样产生倾向 |
| C | 每次 Run 都生成新 session_id + gateway_request_id | Live 演示"这次 Run 与上次无关"；前端从 SSE 首帧 `event: created` 拿到 gwId |
| D | Ranking chart 推 PLAN7，本轮保留 mock + "Preview · Phase 7" 标签 | 依赖 aggregator-only + fable5 两组额外调用 + 相对排名归一算法，明显超出 judge compare 范围 |
| E | 预置按钮 click 立即 Run（不填入 textarea）；textarea 独立处理自定义 prompt；`mock/live-samples.ts` 只保留 5 preset 的 prompt 文本，mock 回复/judge 分/advisor previews 全删 | 与"预置直接跑 + 输入框旁挂"UX 决策一致；mock 文件剩余职责明确 |

## 被否定的方案

### 方案 A：Live 页共用 `/v1/messages`，`comparison.enabled=true` 时任何调用都跑 baseline+judge

否定原因：违反"Claude Code 主客户端零受影响"约束。`/v1/messages` 是 Claude Code 主客户端的唯一入口，Phase 3 已经每 turn 落 N+1 条 TraceRequest；若 comparison.enabled 全局生效，Claude Code 长会话每 turn 会额外发 2 次上游调用（baseline + judge），成本翻倍且 latency 影响主链路。新增 `POST /api/live/run` 专用入口把 Live 页与主链路解耦，`comparison.enabled` 在本轮实际只控制 `/api/live/run` 内部是否发起 baseline+judge。

### 方案 B：`/v1/messages` 上加 `X-Enable-Comparison` header

否定原因：header 是"客户端可携带"的开关，Claude Code 或其他客户端可能因误配或调试导致 baseline+judge 意外触发；Live 页需要的是 comparison 的**服务端主动编排**（并发 MoM+baseline、汇总后 judge、单条 SSE 推 8 类事件），与 `/v1/messages`"透明代理 + orchestrator 主链路"的语义天然不同。分开路径比统一路径的行为可预测性更高。

### 方案 C：把 baseline 响应文本、judge JSON、mom 累计文本塞进 TraceRequest.role 新值下

否定原因：`traces.data` 列（JSON blob）当前只存 `TraceRequest`（含 `request_summary` 与 `response_summary` 但**不含 body / references_appended / 文本正文**）；把 baseline 长文本（几 KiB）+ MoM 长文本（几 KiB）+ judge 完整 JSON 塞进去，`traces` 表会以 turn 为单位膨胀 10 倍，且违反 `TraceRequest` 只装"上游 HTTP 调用元数据"的既定语义（decision 004 traces snapshot scope）。用独立 `comparisons` 表按 gateway_request_id 一行一 turn，元数据（usage / pricing / latency）落 TraceRequest（`role='baseline'` / `role='judge'`），文本正文与 judge JSON 落 comparisons，是干净的层级切分。

### 方案 D：Judge 5 维用 PLAN.md 原写的 `correctness / depth / clarity / efficiency / safety`

否定原因：前端 `web/src/i18n/dict.ts:live.judgeDim`、`web/src/components/charts/JudgeRadar.tsx`、`web/src/mock/live-samples.ts` 三处都按 `correctness / completeness / depth / clarity / usefulness` 实现。切换 5 维需要:改前端 UI 5 维标签 + 中英翻译 + 5 处 mock 分数迁移;PLAN.md 原写的 `efficiency` 与 `safety` 在 code review 场景下语义弱(短链服务设计题的 efficiency 是什么?safety 是什么?)。前端已用维度是"用户可读性 + 覆盖度"导向,与 Live 页评分叙事更贴。

### 方案 E：MoM SSE + baseline SSE，两条流同时推

否定原因:PLAN.md Phase 6 明文"Baseline call 是否 streaming:否 —— Live 页只需最终文本 + usage,不需要流"。展会现场"MoM 实时流出 + baseline 稍后一次性落下"的节奏对比更强,不必两栏都流。

### 方案 F：Judge 完成后单独走 `GET /api/comparison/:gwId/stream` SSE 旁听

否定原因:发起方与订阅方是同一 tab,单流够用。旁听 SSE 是"分享链接 / 跨 tab"的需求,本轮不做;真需要再另开 issue(已记入 PLAN7)。

### 方案 G：把 baseline call 与 judge compare 都写成 fire-and-forget 后台任务,MoM 主链路不等它们

否定原因:Live 页视觉承诺是"三卡对比",若 baseline / judge 没完成就断 SSE,前端只能轮询;单条 SSE 直接推 `baseline_done` / `judge_done` 语义更直观,且 Node 单进程内 `await Promise.allSettled([mom, baseline])` + `await runJudgeCompare()` 的编排代价远低于两条 SSE 的连接管理。

### 方案 H：`aggregation_mode: judge`(结构化整合替代 concat)本轮一并做

否定原因:结构化整合与 judge compare 是两条独立 judge prompt,一并落地 = 一次要写 2 条 prompt(JUDGE_INTEGRATION_PROMPT + JUDGE_COMPARE_PROMPT)、2 条 safeJsonParse 分支、2 处 orchestrator 分支(aggregation_mode 切换 + baseline 触发时机);任何一条 prompt 判分不稳都会拖累另一条。本轮先只做 judge compare(Live 页雷达强需求),integration 分支推 PLAN7,单独一轮迭代 prompt。

### 方案 I：Ranking chart 用 preset-联动的 mock,与本轮 judge compare 同时切真

否定原因:Ranking chart 是"最近 10 turn 相对排名",数据源需要**同时** MoM + Aggregator-only + Fable5 三家的成绩。当前 orchestrator 只跑 MoM 主链路 + baseline(单模型),没有 aggregator-only 与 fable5 baseline;且"相对排名"需要判分归一算法(N 家绝对分 → 排名 1..N),与 judge compare 的"2 家 5 维"是不同问题。本轮保留 mock 数据 + 页面顶挂"Preview · Phase 7"标签,后续单独一轮做。

## 决策

采纳方案 A(见 ISS-033 方案讨论段)。核心分层与关键约定固定如下(与 001ARCHITECTURE 一致的陈述式):

### 分层与调用链

```
Live 页 [Run / 预置 click]
    │  POST /api/live/run  { prompt, baseline_on, lang }
    ▼
Live API 层(src/gateway/live-api.ts)
    │  分配 gwId + sid  →  SSE 首帧 `event: created`
    ▼
Live Runtime(src/live/live-runtime.ts)
    │
    ├─ orchestrator.streaming(anthropicReq, sid, spliceWriter, log)
    │    ⇢ MoM 主链路(fanout advisor → aggregator SSE)
    │    ⇢ 现有 N+1 TraceRequest 落库(role=advisor/aggregator)
    │    ⇢ spliceWriter 一路吐给 HTTP response、一路给 observer 累积 momText
    │
    ├─ baselineCall(anthropicReq, baseline_model, provider) [并发]
    │    ⇢ 单模型 non-streaming
    │    ⇢ 落 role='baseline' TraceRequest
    │
    │  await Promise.allSettled([mom, baseline])
    │
    ├─ runJudgeCompare({ momText, baselineText, lang, judge, provider })
    │    ⇢ 匿名 A/B + temperature=0 + JSON-only
    │    ⇢ safeJsonParse(raw) fallback 到正则抽 { }
    │    ⇢ 落 role='judge' TraceRequest
    │
    └─ live-store.upsertComparison(...)
       每阶段完成:emit SSE event + 更新 comparisons 表 status
```

### 存储 schema

```sql
CREATE TABLE IF NOT EXISTS comparisons (
  gateway_request_id  TEXT PRIMARY KEY,
  session_id          TEXT,
  lang                TEXT NOT NULL,
  prompt_text         TEXT NOT NULL,
  started_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  status              TEXT NOT NULL,   -- pending | mom_done | baseline_done | judge_done | error
  mom_text            TEXT,
  mom_finished_at     INTEGER,
  mom_usage_json      TEXT,
  mom_cost_usd        REAL,
  baseline_model      TEXT,
  baseline_text       TEXT,
  baseline_finished_at INTEGER,
  baseline_usage_json TEXT,
  baseline_cost_usd   REAL,
  baseline_error_json TEXT,
  judge_model         TEXT,
  judge_finished_at   INTEGER,
  judge_scores_json   TEXT,           -- {mom:{5维}, baseline:{5维}}
  judge_verdict       TEXT,
  judge_fallback      INTEGER DEFAULT 0,
  judge_error_json    TEXT
);
```

### SSE 事件 8 种

| event | data 形状 | 何时 emit |
|---|---|---|
| `created` | `{gateway_request_id, session_id}` | 请求进入 Live Runtime 前 |
| `mom_delta` | `{text: "..."}` | orchestrator SSE 累积到 text_delta 时(经 observer 转化) |
| `mom_done` | `{text_full, usage, cost_usd, latency_ms}` | orchestrator streaming 完成 |
| `baseline_done` | `{text, model, usage, cost_usd, latency_ms}` | baseline call 成功 |
| `baseline_error` | `{message}` | baseline 抛错(judge 仍会跑,只是没有 baseline 侧输入) |
| `judge_done` | `{scores:{mom,baseline}, verdict_summary, fallback}` | judge parse 成功(fallback=true 时是降级但 JSON 抽出成功) |
| `judge_error` | `{message}` | judge 完全失败(HTTP / JSON 都挂) |
| `end` | `{status}` | SSE 流关闭前最后一帧 |

### API 契约

- `POST /api/live/run` → 单条 SSE 连接;响应头 `X-Gateway-Request-ID` 立即回,body 是 event-stream
- `GET /api/comparison/:gateway_request_id` → 一次性拿 comparisons 表全量 snapshot(用于二次进入 Live 页)
- 移除 `GET /api/comparison/:trace_id`(Phase 4 的 501 占位)

## 影响

- 前端:LivePage 大改;新增 `useLiveRun.ts` hook + `postLiveRun / getComparison / JudgeScores / ComparisonEvent` wrappers;精简 `mock/live-samples.ts` 到只留 prompt 文本;i18n 补 3 个 key(pending / cancel / textarea placeholder)
- 后端:新增 `src/judge/*` + `src/live/*` + `src/gateway/live-api.ts`;`src/types/mom.ts` 扩展 `TraceRequest.role` union + `JudgeCompareResult` 类型;`src/storage/db.ts` 加 `comparisons` 表 schema;`src/gateway/server.ts` 挂载新路由 + 移除 comparison-api.ts 的 501 占位(整个 dashboard-api/comparison-api.ts 直接删除,live-api 接手)
- 文档:001/002/006 全更新;PLAN.md Phase 6 从 "📝 略写" 改为 "🚧 部分完成";新建 PLAN7.md 汇总未做项;004CHANGELOG 追加
- 测试:`test/judge-parse.test.ts`(safeJsonParse 分支覆盖)+ `test/live-runtime.test.ts`(baseline 失败降级 / MoM 抛错终止 / judge 失败仍 emit end)
