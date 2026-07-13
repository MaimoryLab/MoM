# 002. Dashboard 4K 适配 + 展会自动循环 demo 模式

## 背景

Phase 5.0 决策（decision 007）中明确"不做暗色主题、不做 4K 兼容、不做自动 demo 循环"，均推到本 followup。

- **4K 兼容**：Phase 5.0 字号系统用 `rem`，主画布在 1920×1080 大屏调优；4K 屏（3840×2160）实测未做，可能存在字号偏小 / 图表 padding 不匹配的问题
- **自动 demo 循环**：展会现场若无主讲人（或主讲人短暂离场），Dashboard 若能自动 5 页轮播 + Live 页自动播放预置 prompt，能承接观众自主浏览动线

## 触发条件

以下任一：

- 展会前 1 周确认现场大屏是 4K
- 首次展会结束后收集到"观众自主浏览时 Dashboard 卡在同一页"的反馈
- 用户显式请求"加个自动 demo 循环模式"

## 方案概述

**4K 适配**：
- 全局字号 `html { font-size: clamp(14px, 0.9vw, 24px) }`，实际渲染在 1080p ~14px、4K ~24px 之间线性放大
- 图表容器高度用 `clamp` 或 `vh` 而非固定 px
- 表格/卡片 padding 用 `rem` 已就位，只需 `theme.ts` 中 spacing 常量改 `rem` 表达（当前是 px 数字）
- Recharts 的 `ResponsiveContainer` 已经处理宽度，只需验证极端宽高比下 tooltip 位置正常

**自动 demo 循环**：
- URL query flag `?demo=1` 触发
- App 层增加 `useDemoLoop()` hook：读 flag、setInterval 20s、循环切页（Overview → Live → Pipeline → Cost → Overview）
- Live 页在 demo 模式下自动从 prompt shelf 挑一个开始播放，播完自动切到下一个 prompt
- Pipeline 页在 demo 模式下自动触发 Replay
- 主讲人按任意键 / 移动鼠标 → 退出 demo 循环（`document.visibilitychange` + `mousemove` 监听）

## 风险与依赖

- 4K 屏下 Recharts 的 tooltip 位置可能超出画布——需现场验证
- Demo 循环下 mock 数据脚本若长度不一，循环切换体验会跳跃——需要把 5 个 prompt 的假流式播放时长统一到约 15s
- 自动循环会持续占用 CPU（打字机 + 图表 hover 动画），大屏散热若在展台内部机箱需评估

## 与当前实施的关系

Phase 5.0 无此功能；触发前 Dashboard 现场使用需要主讲人操作。切换路径：加 `useDemoLoop` hook + `?demo=1` 拦截 + spacing 常量表达式改成 rem clamp，成本 < 1 天。不做的成本：主讲人离场时 Dashboard 静止在一页，观众可能误认为项目停摆。
