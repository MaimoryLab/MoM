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
│   ├── index.ts                   # 进程入口：initDB → getConfig → startServer
│   ├── config.ts                  # 组装 RuntimeConfig（provider + mom）+ 递归护栏（assertRecursionGuard）
│   ├── config/
│   │   ├── provider-env.ts        # loadProviderConfig — 从 process.env 读 PROVIDER_* + 校验
│   │   └── mom-config-file.ts     # loadMoMConfig / saveMoMConfig — mom.config.json 读写（原子 rename）
│   ├── gateway/
│   │   ├── server.ts              # Fastify 实例、路由挂载、静态挂载 web/dist
│   │   ├── messages-handler.ts    # createMessagesHandler(provider) 返回 Phase 1 透传 handler
│   │   ├── validator.ts           # 请求体最小校验（model / messages / max_tokens）
│   │   └── sse.ts                 # SSE 单行解析 / 事件编码工具
│   ├── provider/
│   │   ├── provider-client.ts     # undici POST，非流式；ProviderError；buildAuthHeaders(provider)
│   │   └── stream-forward.ts      # 流式 SSE 转发；错误编码为 SSE error 帧
│   ├── storage/
│   │   └── db.ts                  # node:sqlite 单例；DDL 常量内联（仅 traces / metrics_cache）
│   └── types/
│       ├── anthropic.ts           # Anthropic Messages API 请求/响应/SSE 事件类型
│       ├── mom.ts                 # ProviderConfig / MoMConfig / RuntimeConfig / Trace / AdvisorResult + DEFAULT_MOM_CONFIG
│       └── index.ts               # 汇出 anthropic.ts / mom.ts
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

- `src/orchestrator/`：Phase 2 引入的主调度（fanout / trigger / aggregation）
- `src/advisor/`：Phase 2 引入的 advisor 视图转换与调用
- `src/aggregator/`：Phase 2 引入的 aggregator 调用与 references 拼接
- `src/judge/`：Phase 6 引入的 judge 调用
- `src/cache/`：Phase 3 引入的 fanout 缓存与 cache_control 装饰
- `src/dashboard-api/`：Phase 4 引入的 REST API
- `src/cost/`：Phase 3 引入的成本计算

> 约定：每新增或删除文件/目录后更新本文件。
