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
├── data/                          # gitignore；业务配置与本地状态存放目录（`benchmarks.json` 显式白名单入库）
│   ├── mom.config.json            # MoMConfig 持久化（首次启动自动写入 DEFAULT_MOM_CONFIG）
│   └── benchmarks.json            # 新增 — Phase 4；评测组维护，Overview 页 Pareto/柱图/heroStats 静态数据；ISS-044 起 per_benchmark 每行增 gpt_score/gpt_cost 双字段（当前占位 0）
├── scripts/                       # 新增 — ISS-010；一次性运维脚本
│   └── sync-pricing.mjs           # 拉取 provider `/v1/models`，把 per-token 价格换算成 per-1M-tokens ModelPricing 灌进 mom.config.json.pricing_table；`--currency`（默认 CNY）+ `--overwrite` / `--dry-run`
├── src/                           # 网关服务（后端）
│   ├── index.ts                   # 进程入口：initDB → getConfig → startServer(port, runtime)
│   ├── config.ts                  # 组装 RuntimeConfig（provider + mom）+ assertModeRequirements
│   ├── config/
│   │   ├── provider-env.ts        # loadProviderConfig — 从 process.env 读 PROVIDER_* + 校验
│   │   └── mom-config-file.ts     # loadMoMConfig / saveMoMConfig — mom.config.json 读写（原子 rename）
│   ├── gateway/
│   │   ├── server.ts              # Fastify 实例、路由挂载、静态挂载 web/dist；startServer(port, runtime, { momConfigPath, benchmarksPath })；Phase 4 起挂载所有 /api/* 路由 + OrchestratorHolder
│   │   ├── messages-handler.ts    # createMessagesHandler(holder) — 通过 holder.get() 拿最新 orchestrator，支持 POST /api/config 后 hot reload；从 X-Session-ID header 提取 sessionId；拆分 non-streaming / streaming；streaming 分支上提 SSE header + hijack + 兜底 error 帧
│   │   ├── trace-api.ts           # 新增 — ISS-011；registerTraceAPI(app) 注册 GET /trace/requests?session_id=<uuid>（eval 视角批量查询）
│   │   ├── live-api.ts            # 更新 — ISS-035 / ISS-055；POST /api/live/run 改 202 + submitLiveTurn 后台跑；GET /api/comparisons 最近 20 job 列表；GET /api/comparison/:gwId 快照（含 3 快照模型 id + mom_error）；DELETE /api/comparison/:gwId 事务删除 comparison + 同 gwId traces（ISS-055）
│   │   ├── presets-api.ts         # 新增 — ISS-035；GET /api/presets 读 data/presets.json（缺失/非法 → 空数组）
│   │   ├── validator.ts           # 请求体最小校验（model / messages / max_tokens）
│   │   └── sse.ts                 # parseSSELine / formatSSEEvent + createSSEParser（Phase 3 起）增量分帧器
│   ├── orchestrator/              # Phase 2 / Phase 3 / Phase 4
│   │   ├── orchestrator.ts        # createOrchestrator(runtime) → { nonStreaming(body, sessionId, log), streaming(body, sessionId, output, log) }；主链路 trigger → cache → fanout → cost；每次上游调用后落一条 TraceRequest（advisor N 条 + aggregator 1 条；aggregator 抛错时也补落 error trace）；透传路径落 role='passthrough' TraceRequest
│   │   ├── orchestrator-holder.ts # 新增 — Phase 4；createOrchestratorHolder(runtime) → { get(), getRuntime()（Phase 6 起，供 live-api 拿最新 runtime）, rebuild() } — mutable holder 支撑 POST /api/config 后 hot reload orchestrator（丢弃旧 fanout cache）
│   │   ├── trigger.ts             # 新增 — Phase 3；isNewUserTurn / computeTriggerReason（七种 TriggerReason 标签）
│   │   └── fanout.ts              # promisePool + fanoutAdvisors + fanoutAdvisorsWithCache（off 时绕过 cache；命中即复用，未命中真跑再 set）
│   ├── advisor/                   # Phase 2
│   │   ├── prompts.ts             # ADVISOR_SYSTEM_PROMPT / ADVISORY_INSTRUCTION（ISS-031 重写）；AGGREGATOR_GUIDANCE / AGGREGATOR_REFERENCES_HEADER（ISS-031 新增，供 reference-builder 注入）
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
│   ├── dashboard-api/             # 新增 — Phase 4；Dashboard REST API 命名空间 /api/*
│   │   ├── config-api.ts          # GET/POST /api/config；provider 只读脱敏；POST 走 assertMoMConfigShape + assertModeRequirements + saveMoMConfig + orchestratorHolder.rebuild
│   │   ├── traces-api.ts          # GET /api/traces（分页+过滤）/ /api/traces/:request_id / /api/traces/by-gateway/:gateway_request_id；TraceSummary 剥离 settings_snapshot
│   │   ├── metrics-api.ts         # GET /api/metrics — computeMetrics 纯函数聚合 5 段（summary / per_turn / by_role / cache_hit_by_model / timeline）；实时 SQL 聚合
│   │   ├── benchmarks-api.ts      # GET /api/benchmarks — 读 data/benchmarks.json，ENOENT 返 200 空态，malformed 返 500
│   ├── judge/                        # 新增 — Phase 6（ISS-033）；判分子系统（当前只有 judge compare；aggregation_mode=judge 的结构化整合推 PLAN7）
│   │   ├── judge-prompt.ts          # JUDGE_COMPARE_PROMPT_EN / _ZH（匿名 A/B、JSON-only、5 维定义）+ buildJudgeCompareUserMessage(拼 prompt + Response A + Response B)
│   │   ├── judge-parse.ts           # parseJudgeCompare(raw) — 二阶段：strict JSON.parse → 失败退到正则抽首个 {...} 块；clamp 5 维分到 [0,100]；两条都挂返 null
│   │   └── judge-runtime.ts         # runJudgeCompare({lang, prompt, momText, baselineText, judge, provider, rand?}) → JudgeCompareResult；始终不抛，error 归入返回值 error 字段
│   ├── live/                         # 新增 — Phase 6（ISS-033）；Live Compare 编排 + comparisons 存储；ISS-035 起去 SSE 改异步 job
│   │   ├── live-types.ts            # ComparisonRecord / ComparisonMomRow / ComparisonBaselineRow / ComparisonJudgeRow / ComparisonStatus；ISS-035 加 ComparisonMomErrorRow + 3 快照字段
│   │   ├── live-store.ts            # comparisons 表 CRUD；ISS-035 起 createComparison 收 3 快照参数 + updateComparisonMomError + listRecentComparisons；deserialize 把 JSON blob 反塞回 ComparisonRecord；ISS-055 追加 deleteComparison(gwId)
│   │   ├── baseline.ts              # runBaselineCall(original, baselineModel, provider) → BaselineResult；单模型 non-streaming，不抛，error 归 result.error
│   │   └── live-runtime.ts          # ISS-035 重写：submitLiveTurn 同步 createComparison + 立即返回 gwId；runLiveTurn 后台并发跑 orchestrator.nonStreaming + baseline + judge，落 comparisons + 3 类 TraceRequest（含 response_text / last_user_text 文本字段）
│   ├── provider/
│   │   ├── anthropic-normalize.ts # 过滤不可安全回传的 unsigned thinking blocks；SSE content block index 连续重映射
│   │   ├── provider-client.ts     # undici POST，非流式；ProviderError；buildAuthHeaders(provider)；响应 normalization
│   │   └── stream-forward.ts      # 流式 SSE parse + normalization + 转发；签名 NodeJS.WritableStream + {onEvent?, log?}
│   ├── storage/
│   │   ├── db.ts                  # node:sqlite 单例；DDL 常量内联（traces 表 ISS-009 起 14 列 + 3 个索引 / metrics_cache；ISS-033 新增 comparisons 表：PK gateway_request_id + mom/baseline/judge 三段字段 + 2 个索引）
│   │   └── traces.ts              # 新增 — Phase 3；ISS-009 起 saveTraceRequest / getTraceRequestById / getTraceRequestsBySessionId / getRecentTraceRequests；ISS-055 追加 deleteTracesByGatewayRequestId（DELETE /api/comparison 事务的一半）
│   └── types/
│       ├── anthropic.ts           # Anthropic Messages API 请求/响应/SSE 事件类型
│       ├── mom.ts                 # ProviderConfig / MoMConfig / RuntimeConfig / TraceRequest（role Phase 6 起 union 加 'baseline' | 'judge'；TraceErrorType 加 baseline_error | judge_error） / TraceUsage / PricingSnapshot / TraceError / RequestSummary / ResponseSummary / AdvisorResult / AggregatorResult / JudgeScores / JudgeCompareResult（Phase 6） / JudgeResult（保留给 PLAN7 integration） / BaselineResult / TriggerReason / Logger + DEFAULT_MOM_CONFIG
│       ├── dashboard-api.ts       # 新增 — Phase 4；ConfigResponse / SaveConfigRequest/Response / TraceSummary / TracesListQuery/Response / TraceByGatewayResponse / MetricsResponse / BenchmarksResponse / ApiErrorEnvelope；Phase 6 追加 LiveRunRequest / ComparisonResponse / ComparisonStatus / JudgeScoresApi / ComparisonMomSnapshot / ComparisonBaselineSnapshot / ComparisonJudgeSnapshot / ComparisonUsage；ISS-035 追加 LiveRunSubmitResponse / ComparisonListItem / ComparisonListResponse / PresetEntry / PresetsResponse + ComparisonResponse 加 3 快照字段 + mom_error；删除 LiveRunEvent SSE union
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
│   ├── trace-api.test.ts          # 新增 — ISS-011；GET /trace/requests 400 缺参 / 400 非 UUID / 200 空数组 / 200 升序 / session 隔离
│   ├── dashboard-api-config.test.ts     # 新增 — Phase 4；maskApiKey / assertMoMConfigShape / GET-POST /api/config / rebuild orchestrator observable
│   ├── dashboard-api-traces.test.ts     # 新增 — Phase 4；/api/traces 分页+过滤+排序 / :id 404 / by-gateway 空数组不 404
│   ├── dashboard-api-metrics.test.ts    # 新增 — Phase 4；computeMetrics 空表/mixed/window/cost null 语义 + HTTP 400/200
│   └── dashboard-api-benchmarks.test.ts # 新增 — Phase 4；normalizeBenchmarks / loadBenchmarksFromDisk ENOENT/malformed / HTTP 200/500
├── web/                           # Dashboard 前端（Vite 子工程）
│   ├── package.json               # workspace 成员；依赖 react / react-dom / recharts
│   ├── tsconfig.json
│   ├── vite.config.ts             # base:/dashboard/、dev proxy /api & /v1 → :3000
│   ├── index.html
│   └── src/
│       ├── main.tsx               # React 挂载入口 + I18nProvider 包裹 App
│       ├── App.tsx                # 更新 — ISS-052；hash-based Router + parseHash / formatHash / navigateTo(page, turn?) / useHashRoute；#pipeline?turn=<gwId> 双入口；PipelinePage 收 turnFromUrl prop；根容器 flex-direction: column（配合 ISS-051 top bar）；顶层挂 KioskProvider 与 KioskOverlay（右下角悬浮 pill 展示轮播状态）
│       ├── theme.ts               # 色板 / 字号阶梯 / 圆角 / 阴影常量集中定义（ISS-030 改：royal-blue 冷主色 + 冷灰 advisor 色带 + 冷白底 + font.size 十档语义常量 base 18px）
│       ├── global.css             # 更新 — ISS-052；全局冷白底、base font 18px、blink / pulse-mom keyframe、字体栈；kiosk 入场动画 kioskEnterUp / kioskEnterFade / kioskPulseRing 三个 keyframes
│       ├── i18n/                  # 新增 — ISS-028；自研 i18n（不引入 i18next）
│       │   ├── dict.ts            # 中英双语字典（术语保留英文，叙述性文字本地化）
│       │   ├── context.tsx        # I18nProvider + useI18n；语言持久化 localStorage
│       │   └── format.ts          # 成本 / 延迟 / token 数按 locale 格式化
│       ├── hooks/                 # 新增 — ISS-028
│       │   ├── useLiveRun.ts      # 更新 — ISS-035 / ISS-055；LiveJobProvider + useLiveJob(Context)：submitLiveRun 触发后 3s 轮询 getComparison(gwId)；state 提到 App 层，切页面不丢；ISS-055 起 tick 识别 ApiError.status===404 → 停轮询清 state（防止删除后无限 404 循环）
│       │   ├── useKioskMode.ts    # 更新 — ISS-052 / ISS-055；KioskProvider phase machine（overview → live 分阶段 → pipeline → next）+ fetchQueueDetailed(listComparisons ∩ listTraces role=aggregator) + 全局 pointerdown/keydown/hashchange/visibility hidden 停止；notifyLiveAnswerDone 由两侧打字机 onDone 计数推进阶段；ISS-055 追加 invalidateQueue(gwId) + phaseRef，删除命中当前 gwId 时重取队列并从当前 phase 重进
│       │   ├── useTypewriter.ts   # 新增 — ISS-052；按字符递增的通用打字机 hook（active/msPerChar/onDone）；kiosk 期间 Live MoM/Baseline 与 Pipeline advisor/aggregator preview 都消费它
│       │   └── useEventSource.ts  # 空壳，签名与未来 SSE 一致；未消费
│       ├── pages/                 # 新增 — ISS-028；五页（ISS-049 起：Chat 页合并进 Live）
│       │   ├── OverviewPage.tsx   # Pareto 主图 + benchmark combo 副图 + 3 KPI（效果层）
│       │   ├── LivePage.tsx       # 更新 — ISS-052 / ISS-055；两态单页 + kiosk 分支：kiosk.enabled 时永远走 KioskResultView（按 kiosk.liveStep 分阶段揭示 StatusStrip / MoM+Baseline / Judge / Cost，snap 未就位时显示 loading 占位），不再落到 EmptyState；kiosk 期间隐藏顶部 RunSelect；KioskStartButton 在 ResultView 底部"查看请求流程"旁；useEffect 监听 kiosk.currentGwId 触发 live.select；ISS-055 起 handleDelete + jobsBumpKey/deleting/deleteError 状态，删除后 live.reset + 触发历史列表重取 + kiosk.invalidateQueue
│       │   ├── live-shared.tsx    # 更新 — ISS-052 / ISS-054 / ISS-055；MomColumn / BaselineColumn 加 typewriter / cursorOn；OutputCard 内接入 useTypewriter，autoScroll 跟随文本增长；typewriter 完成走 kiosk.notifyLiveAnswerDone 推进阶段；ISS-054 起 MomColumn 用新 pendingMom key + PendingLabel shine 组件；ISS-055 起 StatusStrip 加内联「删除 → 取消/确认」簇（onDelete / deleting / deleteError 三 prop）
│       │   ├── PipelinePage.tsx   # 更新 — ISS-052；AdvisorCard / AggregatorCard 接入 useTypewriter，kiosk.enabled && status==='done' 时 preview 打字机 + scrollRef 自动滚到底；turn.nodes.length===0 时显示提示卡片而非光秃箭头
│       │   ├── CostPage.tsx       # 节省 banner + 4 KPI + 每轮堆叠柱 + 饼图 + cache 命中矩阵 + 累计时间线
│       │   └── SettingsPage.tsx   # 语言 / Provider 只读 / Aggregator / Advisor slots / Judge / Comparison / Pricing
│       ├── components/            # 新增 — ISS-028
│       │   ├── layout/            # Sidebar (ISS-051 起改为顶部横排 sticky top bar，layout.topBarHeight=72；ISS-052 加 KioskButton pill) / PageShell
│       │   ├── primitives/        # Card / KpiCard / Badge / Button / MarkdownBody (Phase 7 起，react-markdown + remark-gfm 封装；ISS-036 加 flush prop 用于嵌入已有容器不双滚动；ISS-052 加 autoScroll prop：text 变化时 scrollTop = scrollHeight，配合打字机)
│       │   └── charts/            # Pareto / ScoreBarChart / CostBarChart / JudgeRadar / CostStackedBar / CostPie / CacheHitBars / CostTimeline / RankingChart (ISS-029; Phase 7 起 prop 从 preset 改为 seed；ISS-036 起 YAxis domain 加对称 padding [0.6, 3.4] 避免 rank 3 贴 X 轴；ISS-044 起 ComboChart 拆成 ScoreBarChart + CostBarChart，Pareto 仅保留 fable5/gpt56Sol/mom/aggOnly 四家)
│       ├── mock/                  # 新增 — ISS-028；Phase 5.0 伪数据（Phase 5.1 逐步替换为 lib/api.ts）
│       │   ├── benchmarks.ts      # Pareto 6 点（MoM + 4 flagship + Aggregator-only）+ per-benchmark combo；ISS-038 起 ParetoPoint.cost 换成 costCny (¥/次问答)
│       │   ├── live-ranking.ts    # ISS-029 起；Phase 7 起改为 getRankingSeries(seed) 纯函数（mulberry32 + hashSeed + weightedPick 生成 10 turn；MoM rank 分布 70%/30% rank 1/2；其余两家均匀）
│       │   ├── pipeline-trace.ts  # ISS-028 起；Phase 7 起数据源退休（PipelinePage 改走真 trace），保留 PipelineCopy 类型与 Diff modal fallback 字符串（Phase 8 可清）
│       │   ├── cost.ts            # 32 turns session 成本 + cache 命中
│       │   └── config.ts          # Settings 初值 + 模型下拉候选
│       └── lib/                   # 新增 — Phase 4（ISS-032）
│           ├── api.ts             # Dashboard API 类型镜像 + typed fetch wrappers（getConfig/saveConfig/listTraces/getTrace/getTracesByGateway/getMetrics/getBenchmarks/getComparison/postLiveRun）
│           ├── timing.ts          # 新增 — Phase 7（ISS-034）；compressTimeline(spans, capMs=5000) + nodeStatusAt(startMs, endMs, elapsed) + TIMELINE_CAP_MS
│           └── rankSeed.ts        # 新增 — Phase 7（ISS-034）；hashSeed(str) FNV-1a + mulberry32(seed) 决定性伪随机 + weightedPick(r, options)
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

_目前无待创建目录。_ Phase 6 已引入 `src/judge/` 与 `src/live/`；`aggregation_mode=judge` 的结构化整合仍在 `src/judge/` 下补 `judge-integration-prompt.ts` + `judge-integration-runtime.ts` 即可（详见 `../PLAN7.md#plan7-01`）。

> 约定：每新增或删除文件/目录后更新本文件。
