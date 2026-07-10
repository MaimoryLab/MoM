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
├── src/                           # 网关服务（后端）
│   ├── index.ts                   # 进程入口：initDB → getConfig → startServer(port, runtime)
│   ├── config.ts                  # 组装 RuntimeConfig（provider + mom）+ 递归护栏 + assertModeRequirements
│   ├── config/
│   │   ├── provider-env.ts        # loadProviderConfig — 从 process.env 读 PROVIDER_* + 校验
│   │   └── mom-config-file.ts     # loadMoMConfig / saveMoMConfig — mom.config.json 读写（原子 rename）
│   ├── gateway/
│   │   ├── server.ts              # Fastify 实例、路由挂载、静态挂载 web/dist；startServer(port, runtime)
│   │   ├── messages-handler.ts    # createMessagesHandler(runtime) 构造 orchestrator；拆分 non-streaming / streaming；streaming 分支上提 SSE header + hijack + 兜底 error 帧
│   │   ├── validator.ts           # 请求体最小校验（model / messages / max_tokens）
│   │   └── sse.ts                 # parseSSELine / formatSSEEvent + createSSEParser（Phase 3 起）增量分帧器
│   ├── orchestrator/              # Phase 2 / Phase 3
│   │   ├── orchestrator.ts        # createOrchestrator(runtime) → { nonStreaming, streaming }；主链路 trigger → cache → fanout → cost → trace；透传路径也写 mom_off trace
│   │   ├── trigger.ts             # 新增 — Phase 3；isNewUserTurn / computeTriggerReason（六种 TriggerReason 标签）
│   │   └── fanout.ts              # promisePool + fanoutAdvisors + fanoutAdvisorsWithCache（命中即复用，未命中真跑再 set）
│   ├── advisor/                   # Phase 2
│   │   ├── prompts.ts             # ADVISOR_SYSTEM_PROMPT / ADVISORY_INSTRUCTION
│   │   ├── view-transformer.ts    # convertToAdvisorView / truncateToolResult
│   │   └── advisor-runtime.ts     # runAdvisor（Phase 3 起在请求前过 applyAdvisorCacheControl）
│   ├── aggregator/                # Phase 2
│   │   ├── reference-builder.ts   # buildConcatReferences / appendReferencesToLastUser
│   │   └── aggregator-runtime.ts  # runAggregatorNonStreaming / runAggregatorStreaming（Phase 3 起改 NodeJS.WritableStream + 可选 onEvent）
│   ├── cache/                     # 新增 — Phase 3
│   │   ├── cache-key.ts           # computeFanoutCacheKey / selectSignatureMessages（三段 hash：settingsHash|slotsHash|sig，slot 保原顺序不 sort）
│   │   ├── fanout-cache.ts        # createFanoutCache（Map-based TTL + LRU 手写、零第三方依赖）/ parseTTL / cloneAsCacheHit
│   │   └── cache-decorator.ts     # applyAdvisorCacheControl（system_and_3 布局；跳过合成 ADVISORY_INSTRUCTION marker）
│   ├── cost/                      # 新增 — Phase 3
│   │   └── pricing.ts             # calculateCost（缺项 warn+返回 0）/ sumUsage（4 段 Usage 汇总）；只放计价纯函数，metrics 聚合归 storage/dashboard-api
│   ├── provider/
│   │   ├── provider-client.ts     # undici POST，非流式；ProviderError；buildAuthHeaders(provider)
│   │   └── stream-forward.ts      # 流式 SSE 转发；签名 NodeJS.WritableStream + {onEvent?, log?}（Phase 3 起）；SSE header/hijack 上移到 gateway 层
│   ├── storage/
│   │   ├── db.ts                  # node:sqlite 单例；DDL 常量内联（traces / metrics_cache）
│   │   └── traces.ts              # 新增 — Phase 3；saveTrace / getTraceById / getRecentTraces
│   └── types/
│       ├── anthropic.ts           # Anthropic Messages API 请求/响应/SSE 事件类型
│       ├── mom.ts                 # ProviderConfig / MoMConfig / RuntimeConfig / Trace / AdvisorResult / TriggerReason / Logger（Phase 3）+ DEFAULT_MOM_CONFIG
│       └── index.ts               # 汇出 anthropic.ts / mom.ts
├── test/                          # node --test --import tsx 执行
│   ├── view-transformer.test.ts   # Phase 2；convertToAdvisorView / truncateToolResult 覆盖
│   ├── reference-builder.test.ts  # Phase 2；appendReferencesToLastUser 前缀引用不变量 + concat 拼接
│   ├── trigger.test.ts            # 新增 — Phase 3；isNewUserTurn 正负例 + computeTriggerReason 六种组合
│   ├── cache-key.test.ts          # 新增 — Phase 3；tool iteration 同 key / slot 顺序改 key 变 / settingsHash 生效 / per_iteration 差异 / 三段 hash 格式
│   ├── fanout-cache.test.ts       # 新增 — Phase 3；TTL 过期 / LRU 淘汰 / touch 刷新 / cloneAsCacheHit 语义
│   ├── cache-decorator.test.ts    # 新增 — Phase 3；4 个 marker 落位 / 合成 marker 被跳过 / 不足 3 条不越界 / 多 block 取最后一个
│   └── pricing.test.ts            # 新增 — Phase 3；四段单价加总 / 缺项返回 0 / 负数&NaN 归零 / sumUsage 聚合
├── web/                           # Dashboard 前端（Vite 子工程）
│   ├── package.json               # workspace 成员
│   ├── tsconfig.json
│   ├── vite.config.ts             # base:/dashboard/、dev proxy /api & /v1 → :3000
│   ├── index.html
│   └── src/
│       ├── main.tsx               # React 挂载入口
│       └── App.tsx                # 顶层组件，Phase 1 只显示 "Hello MoM"
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
