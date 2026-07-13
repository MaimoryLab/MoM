# 007. Dashboard 前端拆五页 + mock-first 预览版 + 自研 i18n

**日期**：2026-07-12
**状态**：已决策
**关联 Issue**：ISS-028

## 背景

Phase 4 Dashboard API 未落地，团队要在展会前先出 Dashboard。原 PLAN Phase 5 只写了三层——"设置层 / 日志调试层（Traces）/ 用户展示层（Metrics）"——且列为 `📝 略写`，Phase 6 又列了一个独立的"对比展示层"。这套布局在展会讲解叙事上撑不住：观众心智路径是"先看效果 → 现场证明 → 想懂原理 → 看成本 → 最后配置"，三层没有承载效果对比 + 现场对比 + 过程可视化的位置，Metrics 页同时塞"效果 KPI + 成本 KPI + 图表"信息密度过高。

同时 Phase 4 API 还没设计，schema 需要参照前端消费的数据形状反推，不能等后端定完再做前端；且展会至少覆盖中英文观众，i18n 必须一开始就在设计里。

用户明确了目的："展会展示项目效果，是为了让观众相信 MoM 可行、有效、效果好"，并同意由 assistant 从第一性原理提议展示逻辑（不必迎合原 PLAN 三层）。

## 被否定的方案

### 方案 A：沿用 PLAN 原三层（Settings / Traces / Metrics），Phase 6 补对比展示层

否定原因：叙事上撑不住展会主线。三层里 Metrics 既要塞"MoM vs Flagship 的效果对比"又要塞"每轮成本剖析 + cache 命中矩阵 + 累计时间线"，信息密度过高、观众抓不住重点；Traces（详情视图 4 栏）是开发调试形态，观众看不懂 references 拼接位置；Phase 6 再补一个对比页会让顶层导航变六项，动线更乱。

### 方案 B：一页浏览（单 scroll page 塞所有内容）

否定原因：展会大屏（1920×1080）主讲人需要"点一下就整屏切场景"的动线控制，长滚动页在讲解节奏上不可控，观众也无法快速定位当前讲到哪一节；同时 Live 页和 Pipeline 页有独立动画状态（打字机 / 节点激活），塞进同一滚动流会导致离屏动画被暂停/重置，观感割裂。

### 方案 C：等 Phase 4 API 落地后再做前端

否定原因：Phase 4 的 API schema（`GET /api/comparison/:trace_id` 返回什么、`baseline_result` / `judge_score` 字段结构、Live 页的 SSE 事件粒度）本身就应该由前端消费需求反推。先做后端等于替前端猜数据形状，UI 落地后会反复调整 schema。且展会时间紧，前端预览版可以完全用 mock 数据先行推进，锁定 UI 后回填 API。

### 方案 D：图表库选 D3 / uPlot / 自写 SVG

否定原因：D3 学习曲线过陡（本 phase 只有 mock 数据的静态图 + hover），uPlot 快但需要写更多胶水；本 phase 需求是"5 张图、每张都是标准形态（散点 / combo / 雷达 / 堆叠柱 / 饼图 / 时间线 / 横向条）、需要动画 + hover tooltip"。Recharts 是这个场景下写起来最快、且默认样式最接近 Anthropic 品牌调性的选项，展会不追极致渲染性能。

### 方案 E：i18n 引入 i18next / react-i18next

否定原因：预览版只有 5 页、字典条目 < 200 条、无需要复数规则 / 命名空间懒加载 / ICU 消息格式，i18next 引入的复杂度（Provider 嵌套、Suspense、bundle 增量 ~40KB）在本阶段没有价值。自研一个 `dict.ts` + `useI18n()` context + `format.ts` 三个文件足以覆盖。远期真需要复杂 i18n 特性再换。

### 方案 F：展会现场加暗色主题 / 4K 兼容 / 自动循环 demo 模式

否定原因：现场大屏白底奶油色在观众距离 3-5 米时对比度比暗色主题稳定得多（现场光线不可控，暗色主题在强反光下反而看不清）；4K 兼容当前项目字号系统已用 `rem`，clamp 调整可以 Phase 5.1 再做；"自动循环 demo 模式"用户没确定要不要，先不做——若要加只需一个 `?demo=1` query flag，成本 < 半天。三件事都推到 Phase 5.1（真数据接入时一并评估）。

## 最终决策

Phase 5 拆两阶段：

1. **Phase 5.0（本次交付）** — 出 mock 数据驱动的**设计预览版**：
   - **五页**：Overview 总览 / Live Compare 实时对比 / Pipeline 请求流程 / Cost 成本分析 / Settings 设置。原 Traces 页被 Live + Pipeline 吸收（advisor 全文 / references 拼接位置 / aggregator messages 快照通过 Pipeline 节点抽屉展示），原 Metrics 页拆成 Overview（效果 KPI + Pareto + combo）+ Cost（成本 KPI + 每轮堆叠 + cache 矩阵）
   - **图表库**：Recharts；不做暗色主题；不做自动 demo 循环
   - **i18n**：自研 `dict.ts` + `useI18n()` context + `format.ts`；术语（token / cache hit / latency / SSE / Aggregator / Advisor / Judge）保留英文，叙述性文字（"本会话总成本 / 节省 / 正在思考"）本地化；切换语言同步切换 `mock/live-samples.ts` 里预置 prompt 与回复的语言；默认语言取 `navigator.language`
   - **视觉**：Anthropic 官网调性——奶油底 `#FBF7EE` + 主色 clay orange `#C96442`；图表三色带 MoM = clay / Baseline = slate `#7A8A99` / Flagship = moss `#5F8C6B`；辅助 `#B8A175`（judge）+ `#9C8CB3`（cache）
   - **数据来源**：全部走 `web/src/mock/*`；`hooks/useEventSource.ts` 留空壳、签名与未来 SSE 一致；`hooks/useTypewriter.ts` 前端播放假流式
   - **交付边界**：五页可切换 + 双语可切换 + 主要动画可跑；`npm --prefix web run build` 通过

2. **Phase 5.1（Phase 4 API 到位后回填）** — 用 `web/src/lib/api.ts` 替换 `mock/*`；`useEventSource` 接 SSE 拿真流式 / 真 trace；4K 适配、`?demo=1` 循环模式按需评估

Phase 6 相应改为"Judge 模式 + Baseline **后端**接入"（Dashboard 端 UI 已在 5.0 完成），只填后端数据管道（`runJudge` 结构化整合 + `runJudgeCompare` 5 维打分 + baseline 异步调用 + `GET /api/comparison/:trace_id`）。

## 已知代价

### 代价 1: 预览版数据全部为 mock，Phase 5.1 回填时可能发现字段形状与后端不匹配
`mock/{live-samples,pipeline-trace,cost,benchmarks,config}.ts` 里的类型是前端"想要"的数据形状，Phase 4 API 落地时可能发现某些字段后端拿不到（如 pipeline 节点粒度耗时是否能从 SSE 事件序列还原、judge 5 维打分是否要一个 judge 调用同时输出结构化整合 + 对比打分）；届时要么改 API 补字段、要么改前端降级。
**Followup**: `future-plans/001-dashboard-api-shape-reconciliation.md`

### 代价 2: 自研 i18n 无法处理复杂本地化特性
无复数规则、无 ICU 消息格式、无命名空间懒加载；`dict.ts` 是双语平铺 map，条目多了容易漏译；数字/货币格式化通过 `format.ts` 手动写，locale 覆盖不全。
**Followup**: 暂不追踪（预览版 < 200 条字典 + 简单数字格式化足以覆盖，展会后若真要复杂 i18n 再换 i18next）

### 代价 3: Recharts 打包体积 ~200KB gzipped
超过项目其他前端依赖之和；SSR 首屏首图渲染耗时增加。
**Followup**: 暂不追踪（本项目 Dashboard 非首屏关键，且 SPA 场景仅在 Overview 首次进入时付一次成本，展会现场直接开着页面，冷启动代价不敏感）

### 代价 4: 五页动线要求主讲人严格按顺序讲解
Overview → Live → Pipeline → Cost → Settings 顺序讲效果最佳，主讲人若跳讲会失去叙事张力（"先看结果、再看现场证明、再讲原理"）；比一页浏览的自由度低。
**Followup**: 暂不追踪（本次决策的核心就是要"叙事主线明确 > 浏览自由度"，跳讲损失是明确接受的代价）

### 代价 5: Baseline 对比默认开启会额外扣 provider 费用
Live Compare 页顶部 "Baseline 对比"开关默认双开（Comparison + Judge），意味着每次现场演示 = 1 次 MoM + 1 次 baseline + 1 次 judge，token 消耗 ~2.5x 单次 MoM。
**Followup**: 暂不追踪（用户在需求描述里明确说"这是可以牺牲的，因为 Dashboard 目的就是展示效果"，且 Settings 页留了开关可关）

## 不在本期范围

### 项 1: 真实 SSE / 真实 trace 接入
Phase 5.0 只做 mock 数据 + 前端播放的假流式；Phase 5.1 或 Phase 4 API 落地后再接。
**Followup**: PLAN Phase 5.1（同一 phase 内演进，不再单独开 issue）

### 项 2: 暗色主题
现场大屏白底奶油色对比度更稳定，本期不做。
**Followup**: 暂不追踪（若展会后有独立部署（非现场大屏）场景再评估）

### 项 3: 4K 分辨率兼容
字号系统当前用 `rem`，Phase 5.1 再评估是否需要 clamp。
**Followup**: `future-plans/002-dashboard-4k-and-demo-loop.md`

### 项 4: 自动 demo 循环模式（每 20s 自动切页 + 触发 Live 播放）
用户说"可以有可以没有"，未落地。若要加，成本 < 半天（`?demo=1` query flag + setInterval + 切页副作用）。
**Followup**: `future-plans/002-dashboard-4k-and-demo-loop.md`

### 项 5: Provider 秘钥编辑 UI
Settings 页 Provider 状态只读展示 `bearer / dee****` 遮罩摘要，秘钥编辑仍走 `.env`。规范延续 Phase 1 的配置边界约束。
**Followup**: 暂不追踪（配置边界是本项目 P0 约束，不接受 Dashboard 编辑秘钥）
