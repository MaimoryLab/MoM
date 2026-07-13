# 001. Dashboard API 字段形状与 mock 类型对齐

## 背景

Phase 5.0 交付时 Dashboard 前端全部走 `web/src/mock/*` 假数据，`mock/{live-samples,pipeline-trace,cost,benchmarks,config}.ts` 里定义的字段形状是"前端想要的"数据结构。Phase 4 Dashboard REST API 尚未设计，需等 API schema 落地后回填。诞生于 decision 007（Dashboard 五页预览版）"已知代价 1"。

## 触发条件

Phase 4 Dashboard API 开始设计时。具体信号：`src/dashboard-api/` 目录被创建，或 PLAN 中 Phase 4 状态由 `待实施` 转为 `进行中`。

## 方案概述

- 以 `web/src/mock/*` 的现有 TS 类型作为 API 响应 schema 的初稿输入
- 逐个字段对照：后端能否从 SQLite `traces` 表 / `trace_requests` 表直接聚合出来？
  - 能直接查到 → API 直接返回；前端删掉 mock 保留类型定义
  - 后端信息不足 → 决策：改 API schema 补字段（如 pipeline 节点粒度耗时需拆解 SSE 事件时间戳） OR 改前端降级（如 judge 5 维打分退化为总分单值）
  - 需要额外调用 → 如 `runJudgeCompare` 是否与 `runJudge` 复用同一次 judge 调用还是独立调（Phase 6 决策）
- 新增 `web/src/lib/api.ts` 承载真实 fetch + SSE 消费，逐页替换 `mock/*` import
- `hooks/useEventSource.ts` 空壳填充：接收 SSE 事件流，映射到 `LivePage` / `PipelinePage` 的 store

## 风险与依赖

- Phase 4 `GET /api/traces` / `GET /api/traces/:id` / `GET /api/comparison/:trace_id` / `GET /api/metrics` 全部落地是前置项
- Phase 6 `runJudge` / `runJudgeCompare` / baseline 异步调用完成是 Live 页真数据前置项
- 部分 mock 数据（如 benchmarks Pareto 三点）依赖评测组给结果，非纯 API 事项——保持 mock 或走独立 `GET /api/benchmarks` 由评测组维护

## 与当前实施的关系

Phase 5.0 已交付纯 mock 版本，构建通过、五页 + i18n 全跑通；本 followup 是 Phase 5.1 的核心工作。当前兜底：mock 数据永远可用，回填过程中任何页面单独切换到真数据不影响其他页面。切换路径：`import { xxx } from '../mock/xxx'` → `import { xxx } from '../lib/api'`，逐文件替换。
