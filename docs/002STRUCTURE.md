# 目录结构

```
MoM/
├── PLAN.md                        # 分阶段实施计划（当前主导文件）
├── README-PLAN.md                 # PLAN.md 写作规范
├── README.md                      # 中文项目说明（面向使用者）
├── README.en.md                   # 英文项目说明
├── package.json                   # npm workspaces 根（含 "workspaces": ["web"]）
├── tsconfig.json                  # 后端 TS 配置
├── .env.example                   # 部署配置模板（PROVIDER_* + MOM_*）；仓库提交
├── .gitignore
├── data/                          # gitignore；业务配置与本地状态存放目录
│   └── mom.config.json            # MoMConfig 持久化（首次启动自动写入 DEFAULT_MOM_CONFIG）
├── scripts/                       # 新增 — ISS-010；一次性运维脚本
│   └── sync-pricing.mjs           # 拉取 provider `/v1/models`，把 per-token 价格换算成 per-1M-tokens ModelPricing 灌进 mom.config.json.pricing_table；`--currency`（默认 CNY）+ `--overwrite` / `--dry-run`
├── src/                           # 网关服务（后端）
│   ├── index.ts                   # 进程入口：initDB → getConfig → startServer(port, runtime)
│   ├── config.ts                  # 组装 RuntimeConfig（provider + mom）+ 递归护栏 + assertModeRequirements
│   ├── config/
│   │   ├── provider-env.ts        # loadProviderConfig — 从 process.env 读 PROVIDER_* + 校验
│   │   └── mom-config-file.ts     # loadMoMConfig / saveMoMConfig — mom.config.json 读写（原子 rename）
│   ├── gateway/
│   │   ├── server.ts              # Fastify 实例、路由挂载、静态挂载 web/dist；startServer(port, runtime)
│   │   ├── messages-handler.ts    # createMessagesHandler(runtime) 构造 orchestrator；从 X-Session-ID header 提取 sessionId；拆分 non-streaming / streaming；streaming 分支上提 SSE header + hijack + 兜底 error 帧
│   │   ├── trace-api.ts           # 新增 — ISS-011；registerTraceAPI(app) 注册 GET /trace/requests?session_id=<uuid>（eval 视角批量查询）
│   │   ├── validator.ts           # 请求体最小校验（model / messages / max_tokens）
│   │   └── sse.ts                 # parseSSELine / formatSSEEvent + createSSEParser（Phase 3 起）增量分帧器
│   ├── orchestrator/              # Phase 2 / Phase 3
│   │   ├── orchestrator.ts        # createOrchestrator(runtime) → { nonStreaming(body, sessionId, log), streaming(body, sessionId, output, log) }；主链路 trigger → cache → fanout → cost；每次上游调用后落一条 TraceRequest（advisor N 条 + aggregator 1 条；aggregator 抛错时也补落 error trace）；透传路径落 role='passthrough' TraceRequest
│   │   ├── trigger.ts             # 新增 — Phase 3；isNewUserTurn / computeTriggerReason（七种 TriggerReason 标签）
│   │   └── fanout.ts              # promisePool + fanoutAdvisors + fanoutAdvisorsWithCache（off 时绕过 cache；命中即复用，未命中真跑再 set）
│   ├── advisor/                   # Phase 2
│   │   ├── prompts.ts             # ADVISOR_SYSTEM_PROMPT / ADVISORY_INSTRUCTION
│   │   ├── view-transformer.ts    # convertToAdvisorView / truncateToolResult
│   │   └── advisor-runtime.ts     # runAdvisor（Phase 3 起在请求前过 applyAdvisorCacheControl；ISS-009 起返回值补 started_at / finished_at / selected_model / response_summary）
│   ├── aggregator/                # Phase 2
│   │   ├── reference-builder.ts   # buildConcatReferences / appendReferencesToLastUser
│   │   └── aggregator-runtime.ts  # runAggregatorNonStreaming / runAggregatorStreaming（Phase 3 起改 NodeJS.WritableStream + 可选 onEvent；ISS-009 起返回值补 started_at / finished_at / response_summary / error?）
│   ├── cache/                     # 新增 — Phase 3
│   │   ├── cache-key.ts           # computeFanoutCacheKey / selectSignatureMessages（三段 hash：settingsHash|slotsHash|sig，slot 保原顺序不 sort）
│   │   ├── fanout-cache.ts        # createFanoutCache（Map-based TTL + LRU 手写、零第三方依赖）/ parseTTL / cloneAsCacheHit（ISS-009 起 clone 补 started_at/finished_at=Date.now() / selected_model / response_summary=null）
│   │   └── cache-decorator.ts     # applyAdvisorCacheControl（system_and_3 布局；跳过合成 ADVISORY_INSTRUCTION marker）
│   ├── cost/                      # 新增 — Phase 3
│   │   └── pricing.ts             # calculateCost / sumUsage（4 段 Usage 汇总）+ ISS-009 起 snapshotPricing / calculateCostFromSnapshot / toTraceUsage；ISS-010 起 snapshotPricing 从 ModelPricing.currency 忠实带出币种，不再假设 USD
│   ├── provider/
│   │   ├── anthropic-normalize.ts # 过滤不可安全回传的 unsigned thinking blocks；SSE content block index 连续重映射
│   │   ├── provider-client.ts     # undici POST，非流式；ProviderError；buildAuthHeaders(provider)；响应 normalization
│   │   └── stream-forward.ts      # 流式 SSE parse + normalization + 转发；签名 NodeJS.WritableStream + {onEvent?, log?}
│   ├── storage/
│   │   ├── db.ts                  # node:sqlite 单例；DDL 常量内联（traces 表 ISS-009 起 14 列 + 3 个索引 / metrics_cache）
│   │   └── traces.ts              # 新增 — Phase 3；ISS-009 起 saveTraceRequest / getTraceRequestById / getTraceRequestsBySessionId / getRecentTraceRequests
│   └── types/
│       ├── anthropic.ts           # Anthropic Messages API 请求/响应/SSE 事件类型
│       ├── mom.ts                 # ProviderConfig / MoMConfig / RuntimeConfig / TraceRequest / TraceUsage / PricingSnapshot / TraceError / RequestSummary / ResponseSummary / AdvisorResult / AggregatorResult / TriggerReason / Logger + DEFAULT_MOM_CONFIG
│       └── index.ts               # 汇出 anthropic.ts / mom.ts
├── test/                          # node --test --import tsx 执行
│   ├── view-transformer.test.ts   # Phase 2；convertToAdvisorView / truncateToolResult 覆盖
│   ├── anthropic-normalize.test.ts # unsigned/signed thinking 过滤 + SSE index remap
│   ├── reference-builder.test.ts  # Phase 2；appendReferencesToLastUser 前缀引用不变量 + concat 拼接
│   ├── trigger.test.ts            # 新增 — Phase 3；isNewUserTurn 正负例 + computeTriggerReason 六种组合
│   ├── cache-key.test.ts          # 新增 — Phase 3；tool iteration 同 key / slot 顺序改 key 变 / settingsHash 生效 / per_iteration 差异 / 三段 hash 格式
│   ├── fanout-cache.test.ts       # 新增 — Phase 3；TTL 过期 / LRU 淘汰 / touch 刷新 / cloneAsCacheHit 语义
│   ├── cache-decorator.test.ts    # 新增 — Phase 3；4 个 marker 落位 / 合成 marker 被跳过 / 不足 3 条不越界 / 多 block 取最后一个
│   ├── pricing.test.ts            # 新增 — Phase 3；四段单价加总 / 缺项返回 0 / 负数&NaN 归零 / sumUsage 聚合
│   ├── pricing-snapshot.test.ts   # 新增 — ISS-009；snapshotPricing 深拷贝 + null 分支 / toTraceUsage 5 段映射 / calculateCostFromSnapshot 全字段
│   ├── trace-storage.test.ts      # 新增 — ISS-009；saveTraceRequest / getTraceRequestById / getTraceRequestsBySessionId 升序 / session 隔离 / null session 不落入按 session 查询
│   └── trace-api.test.ts          # 新增 — ISS-011；GET /trace/requests 400 缺参 / 400 非 UUID / 200 空数组 / 200 升序 / session 隔离
├── web/                           # Dashboard 前端（Vite 子工程）
│   ├── package.json               # workspace 成员；依赖 react / react-dom / recharts
│   ├── tsconfig.json
│   ├── vite.config.ts             # base:/dashboard/、dev proxy /api & /v1 → :3000
│   ├── index.html
│   └── src/
│       ├── main.tsx               # React 挂载入口 + I18nProvider 包裹 App
│       ├── App.tsx                # 侧边栏 + useState 路由，五页切换
│       ├── theme.ts               # 色板 / 字号阶梯 / 圆角 / 阴影常量集中定义（ISS-030 改：royal-blue 冷主色 + 冷灰 advisor 色带 + 冷白底 + font.size 十档语义常量 base 18px）
│       ├── global.css             # 全局冷白底、base font 18px、blink / pulse-mom keyframe、字体栈
│       ├── i18n/                  # 新增 — ISS-028；自研 i18n（不引入 i18next）
│       │   ├── dict.ts            # 中英双语字典（术语保留英文，叙述性文字本地化）
│       │   ├── context.tsx        # I18nProvider + useI18n；语言持久化 localStorage
│       │   └── format.ts          # 成本 / 延迟 / token 数按 locale 格式化
│       ├── hooks/                 # 新增 — ISS-028
│       │   ├── useTypewriter.ts   # Live/Pipeline 假流式打字机（Phase 5.0 mock 播放）
│       │   └── useEventSource.ts  # 空壳，签名与未来 SSE 一致；Phase 5.1 接入真数据
│       ├── pages/                 # 新增 — ISS-028；五页
│       │   ├── OverviewPage.tsx   # Pareto 主图 + benchmark combo 副图 + 3 KPI（效果层）
│       │   ├── LivePage.tsx       # 预置 prompt shelf / MoM vs Baseline 并排打字机 / Judge 雷达 / 成本对比条
│       │   ├── PipelinePage.tsx   # user→3 advisor→装配→aggregator→final 动画 + Replay + 节点抽屉
│       │   ├── CostPage.tsx       # 节省 banner + 4 KPI + 每轮堆叠柱 + 饼图 + cache 命中矩阵 + 累计时间线
│       │   └── SettingsPage.tsx   # 语言 / Provider 只读 / Aggregator / Advisor slots / Judge / Comparison / Pricing
│       ├── components/            # 新增 — ISS-028
│       │   ├── layout/            # Sidebar / PageShell
│       │   ├── primitives/        # Card / KpiCard / Badge / Button
│       │   └── charts/            # Pareto / Combo / JudgeRadar / CostStackedBar / CostPie / CacheHitBars / CostTimeline / RankingChart (ISS-029)
│       └── mock/                  # 新增 — ISS-028；Phase 5.0 伪数据（Phase 5.1 逐步替换为 lib/api.ts）
│           ├── benchmarks.ts      # Pareto 6 点（MoM + 4 flagship + Aggregator-only）+ per-benchmark combo
│           ├── live-samples.ts    # 5 个预置 prompt × 中英 × MoM/Baseline/Judge 全套脚本
│           ├── live-ranking.ts    # 新增 — ISS-029；最近 10 turn 的 judge 相对排名（9 turn 历史 + preset-联动的第 10 turn）
│           ├── pipeline-trace.ts  # canned trace + 动画时序
│           ├── cost.ts            # 32 turns session 成本 + cache 命中
│           └── config.ts          # Settings 初值 + 模型下拉候选
├── docs/                          # 文档体系
│   ├── 000README.md               # 文档体系规范
│   ├── 001ARCHITECTURE.md         # 系统架构
│   ├── 002STRUCTURE.md            # 本文件
│   ├── 003ISSUES.md               # 问题追踪
│   ├── 004CHANGELOG.md            # 变更记录
│   ├── 005DEVELOPMENT.md          # 开发与测试记录
│   ├── decisions/                 # 已拍板的架构决策
│   └── future-plans/              # 已识别但暂不实施的规划
└── mom.db                         # 运行时生成的 SQLite 数据库文件（gitignored）
```

## 未创建目录（后续阶段引入）

- `src/judge/`：Phase 6 引入的 judge 调用
- `src/dashboard-api/`：Phase 4 引入的 REST API

> 约定：每新增或删除文件/目录后更新本文件。
