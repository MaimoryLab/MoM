// Bilingual dictionary. Technical terms (token, MoM, Advisor, Aggregator,
// Baseline, Judge, Pareto, cache, SSE, benchmarks) stay in English on both
// tracks. Prose is localized naturally, not literally.

export type Lang = 'zh' | 'en';

type Dict = typeof en;

export const en = {
  brand: {
    name: 'MoM',
    tagline: 'Mixture of Models',
    version: 'v0.1 · preview',
  },
  nav: {
    overview: 'Overview',
    live: 'Live Compare',
    pipeline: 'Pipeline',
    cost: 'Cost',
    settings: 'Settings',
  },
  lang: { en: 'EN', zh: '中' },

  overview: {
    heroTitle: 'Approaching flagship, at a fraction of the cost.',
    heroSubtitle:
      'Three inexpensive advisors, one aggregator — closing the gap with frontier models without the price tag.',
    kpi: {
      scoreOfFlagship: 'of Fable 5 avg score',
      costVsFlagship: 'vs Fable 5 cost',
      latency: 'latency (honest)',
      latencyNote: 'we admit the trade-off',
    },
    paretoTitle: 'Cost × Quality frontier',
    paretoSubtitle: 'MoM sits on the frontier — high score, low cost.',
    paretoAxisX: 'Cost ($ / 1M output token)',
    paretoAxisY: 'Avg benchmark score',
    comboTitle: 'Per-benchmark breakdown',
    comboSubtitle: 'Score lines vs cost bars, across six public benchmarks.',
    comboAxisScore: 'Score',
    comboAxisCost: 'Cost ($ / 1k token)',
    legend: {
      mom: 'MoM (ours)',
      aggregatorOnly: 'Aggregator only',
      flagship: 'Fable 5',
    },
  },

  live: {
    shelfTitle: 'Try one of these',
    shelfHint: 'Click a preset or type your own.',
    inputPlaceholder: 'Ask anything…',
    run: 'Run',
    running: 'Running…',
    baselineToggle: 'Also run baseline comparison',
    baselineHint: 'Adds one extra call for the demo — cost of showing the win.',
    momTitle: 'MoM',
    momSubtitle: '3 advisors + aggregator',
    baselineTitle: 'Baseline',
    baselineSubtitle: 'single flagship call',
    stats: {
      latency: 'latency',
      output: 'output',
      cost: 'cost',
      tokens: 'tokens',
    },
    judgeTitle: 'Judge verdict',
    judgeSubtitle: 'Scored by an independent judge model across 5 dimensions.',
    judgeDim: {
      correctness: 'Correctness',
      completeness: 'Completeness',
      depth: 'Depth',
      clarity: 'Clarity',
      usefulness: 'Usefulness',
    },
    costTitle: 'Cost comparison',
    costSaved: 'You saved',
    latencyDelta: 'Latency Δ',
    waitingForRun: 'Click Run to start a demo turn.',
    advisors: 'advisors',
  },

  pipeline: {
    title: 'Pipeline',
    subtitle: 'How one MoM turn actually runs — advisors fan out, guidance folds in, aggregator answers.',
    replay: 'Replay',
    speed: 'Speed',
    turnLabel: 'Turn',
    stage: {
      user: 'User prompt',
      advisor: 'Advisor',
      assembly: 'Context assembly',
      assemblyDetail: 'system_and_3 layout · 4 cache breakpoints',
      aggregator: 'Aggregator',
      final: 'Final answer',
    },
    diffButton: 'Show context diff',
    diffTitle: 'Context assembly diff',
    diffSubtitle: 'Left: original messages · Right: with references guidance folded in.',
    diffBefore: 'Before (original last user message)',
    diffAfter: 'After (with references appended)',
    close: 'Close',
    status: {
      pending: 'waiting',
      running: 'running',
      done: 'done',
    },
    cacheHit: 'cache hit',
  },

  cost: {
    savedBannerTitle: 'Total saved this session',
    savedBannerSuffix: 'saved',
    baselineLabel: 'Baseline',
    momLabel: 'MoM',
    kpi: {
      total: 'Total cost',
      avgPerTurn: 'Avg / turn',
      cacheHit: 'Cache hit rate',
      turnsRun: 'Turns run',
    },
    perTurnTitle: 'Cost per turn',
    perTurnSubtitle: 'Stacked by role — advisors vs aggregator.',
    byRoleTitle: 'Cost share by role',
    byRoleSubtitle: 'Where the money went inside a MoM turn.',
    cacheByModelTitle: 'Cache hit rate by model',
    cacheByModelSubtitle: 'Higher is better — advisor cache holds the fan-out cheap.',
    timelineTitle: 'Cost over time',
    timelineSubtitle: 'MoM per-turn cost over the current session.',
    scopeNote:
      'Scope: MoM internal cost only (3 advisors + aggregator). Baseline and judge shown separately.',
  },

  settings: {
    title: 'Settings',
    subtitle: 'Configure MoM behaviour. Provider secrets live in .env and are read-only here.',
    saveButton: 'Save',
    cancelButton: 'Cancel',
    saved: 'Settings saved (preview only, no backend wired).',
    section: {
      language: 'Language',
      provider: 'Provider (from .env)',
      aggregator: 'Aggregator',
      advisors: 'Advisor slots',
      judge: 'Judge & Baseline',
      pricing: 'Pricing table',
    },
    language: {
      description: 'Controls Dashboard UI language and the language MoM uses when talking to Claude Code.',
      option: { en: 'English', zh: '中文' },
    },
    provider: {
      baseUrl: 'Base URL',
      auth: 'Auth style',
      key: 'API key',
      locked: 'locked',
      hint: 'Edit provider secrets in .env, not here.',
    },
    aggregator: {
      model: 'Model',
    },
    advisor: {
      slot: 'Slot',
      remove: 'Remove',
      add: 'Add slot',
      model: 'Model',
    },
    judge: {
      judgeModel: 'Judge model',
      baselineModel: 'Baseline model',
      enable: 'Enable baseline comparison',
      enableHint: 'Adds one extra call per turn for the demo panel.',
    },
    pricing: {
      model: 'Model',
      input: 'Input $ / 1M',
      output: 'Output $ / 1M',
    },
  },

  common: {
    seconds: 's',
    milliseconds: 'ms',
    delta: 'Δ',
    of: 'of',
    saved: 'saved',
    vs: 'vs',
  },

  benchmarks: {
    MMLU: 'MMLU',
    HumanEval: 'HumanEval',
    GSM8K: 'GSM8K',
    BBH: 'BBH',
    MATH: 'MATH',
    GPQA: 'GPQA',
  },

  models: {
    momComposite: 'MoM (ours)',
    aggregatorOnly: 'Aggregator only',
    flagship: 'Fable 5',
    gpt5: 'GPT-5',
    sonnet46: 'Sonnet 4.6',
    haiku45: 'Haiku 4.5',
  },

  presets: {
    binarySearch: {
      title: 'Rust binary search',
      prompt: 'Write a generic binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize> in idiomatic Rust with a doc comment and one edge-case note.',
    },
    cap: {
      title: 'CAP theorem',
      prompt: 'Explain the CAP theorem to a mid-level backend engineer in under 200 words. Give one concrete example per trade-off.',
    },
    refactor: {
      title: 'Refactor snippet',
      prompt: 'Refactor this Python function for readability and add types. def f(x,y,z):\\n  r=[]\\n  for i in range(len(x)):\\n    if x[i]>y: r.append(x[i]*z)\\n  return r',
    },
    race: {
      title: 'Debug race condition',
      prompt: 'A Node.js worker occasionally writes the same message twice to Redis. Given a fan-out queue with N consumers, list 3 likely root causes and how to verify each.',
    },
    urlShort: {
      title: 'Design a URL shortener',
      prompt: 'Sketch the high-level design of a URL shortener that handles 5k writes/sec. Cover ID scheme, storage, cache, and one failure mode.',
    },
  },
};

export const zh: Dict = {
  brand: {
    name: 'MoM',
    tagline: '多模型协同网关',
    version: 'v0.1 · 预览版',
  },
  nav: {
    overview: '总览',
    live: '实时对比',
    pipeline: '请求流程',
    cost: '成本分析',
    settings: '设置',
  },
  lang: { en: 'EN', zh: '中' },

  overview: {
    heroTitle: '性能追平最强旗舰模型，成本减半。',
    heroSubtitle: '三个臭皮匠顶个诸葛亮，半价成本追平最强模型。',
    kpi: {
      scoreOfFlagship: '达到 Fable 5 平均分',
      costVsFlagship: '相比 Fable 5 成本',
      latency: '额外延迟',
      latencyNote: '单次请求可接受',
    },
    paretoTitle: '成本 × 效果',
    paretoSubtitle: 'MoM 落在前沿上——分数高，成本低。',
    paretoAxisX: '成本（$ / 1M 输出 token）',
    paretoAxisY: '平均 benchmark 分数',
    comboTitle: '各 benchmark 拆解',
    comboSubtitle: '覆盖六个公开 benchmark。',
    comboAxisScore: '分数',
    comboAxisCost: '成本（$ / 1k token）',
    legend: {
      mom: 'MoM（GLM 5.2 + Kimi k2.7 + DeepSeek V4 flash(agggregator)）',
      aggregatorOnly: 'DeepSeek V4 flash',
      flagship: 'Fable 5',
    },
  },

  live: {
    shelfTitle: '试试这些',
    shelfHint: '点一个预置问题，或者自己输入。',
    inputPlaceholder: '想问点什么……',
    run: '发送',
    running: '运行中……',
    baselineToggle: '同步跑 Baseline 输出',
    baselineHint: '效果对比。',
    momTitle: 'MoM',
    momSubtitle: '3 个 advisor + aggregator',
    baselineTitle: 'Baseline',
    baselineSubtitle: '单次旗舰模型调用',
    stats: {
      latency: '耗时',
      output: '输出',
      cost: '成本',
      tokens: 'token',
    },
    judgeTitle: 'Judge 打分',
    judgeSubtitle: '由独立 Judge 模型从 5 个维度打分。',
    judgeDim: {
      correctness: '准确性',
      completeness: '完整度',
      depth: '深度',
      clarity: '清晰度',
      usefulness: '实用性',
    },
    costTitle: '成本对比',
    costSaved: '节省了',
    latencyDelta: '延迟差',
    waitingForRun: '点"发送"开始一次演示。',
    advisors: '个 advisor',
  },

  pipeline: {
    title: '请求流程',
    subtitle: '一次 MoM 调用到底做了什么——advisor 并发出手，guidance 拼进上下文，aggregator 最后作答。',
    replay: '重播',
    speed: '速度',
    turnLabel: '第几轮',
    stage: {
      user: '用户请求',
      advisor: 'Advisor',
      assembly: '上下文装配',
      assemblyDetail: 'system_and_3 布局 · 4 个 cache 断点',
      aggregator: 'Aggregator',
      final: '最终回复',
    },
    diffButton: '查看上下文 diff',
    diffTitle: '上下文装配 diff',
    diffSubtitle: '左边是原始 messages，右边是拼入 references 之后。',
    diffBefore: '装配前（原始最后一条 user message）',
    diffAfter: '装配后（追加 references）',
    close: '关闭',
    status: {
      pending: '等待中',
      running: '进行中',
      done: '已完成',
    },
    cacheHit: 'cache 命中',
  },

  cost: {
    savedBannerTitle: '本次会话共节省',
    savedBannerSuffix: '节省',
    baselineLabel: 'Baseline',
    momLabel: 'MoM',
    kpi: {
      total: '总成本',
      avgPerTurn: '平均每轮',
      cacheHit: 'Cache 命中率',
      turnsRun: '已运行轮次',
    },
    perTurnTitle: '每轮成本',
    perTurnSubtitle: '按角色堆叠——advisor 与 aggregator 分开算。',
    byRoleTitle: '按角色的成本占比',
    byRoleSubtitle: '一次 MoM 调用里，钱花在哪。',
    cacheByModelTitle: '各模型 Cache 命中率',
    cacheByModelSubtitle: '越高越好——advisor 命中缓存才能撑起低成本的 fan-out。',
    timelineTitle: '成本随时间变化',
    timelineSubtitle: '本次会话中 MoM 每轮成本走势。',
    scopeNote:
      '口径：只算 MoM 内部成本（3 个 advisor + aggregator），Baseline 与 Judge 单独展示。',
  },

  settings: {
    title: '设置',
    subtitle: '配置 MoM 的运行方式。Provider 秘钥来自 .env，这里只读。',
    saveButton: '保存',
    cancelButton: '取消',
    saved: '设置已保存（预览版无后端接入）。',
    section: {
      language: '语言',
      provider: 'Provider（来自 .env）',
      aggregator: 'Aggregator',
      advisors: 'Advisor 列表',
      judge: 'Judge 与 Baseline',
      pricing: '定价表',
    },
    language: {
      description: '控制 Dashboard 界面语言，以及 MoM 与 Claude Code 交互时使用的语言。',
      option: { en: 'English', zh: '中文' },
    },
    provider: {
      baseUrl: 'Base URL',
      auth: '认证方式',
      key: 'API key',
      locked: '只读',
      hint: 'Provider 秘钥请在 .env 中修改，此处不可编辑。',
    },
    aggregator: {
      model: '模型',
    },
    advisor: {
      slot: '槽位',
      remove: '移除',
      add: '添加槽位',
      model: '模型',
    },
    judge: {
      judgeModel: 'Judge 模型',
      baselineModel: 'Baseline 模型',
      enable: '启用 Baseline 对比',
      enableHint: '为演示每次多调一次，代价换效果。',
    },
    pricing: {
      model: '模型',
      input: '输入 $ / 1M',
      output: '输出 $ / 1M',
    },
  },

  common: {
    seconds: '秒',
    milliseconds: '毫秒',
    delta: 'Δ',
    of: '/',
    saved: '节省',
    vs: '对比',
  },

  benchmarks: {
    MMLU: 'MMLU',
    HumanEval: 'HumanEval',
    GSM8K: 'GSM8K',
    BBH: 'BBH',
    MATH: 'MATH',
    GPQA: 'GPQA',
  },

  models: {
    momComposite: 'MoM（我们）',
    aggregatorOnly: '仅 Aggregator',
    flagship: 'Fable 5',
    gpt5: 'GPT-5',
    sonnet46: 'Sonnet 4.6',
    haiku45: 'Haiku 4.5',
  },

  presets: {
    binarySearch: {
      title: 'Rust 二分查找',
      prompt: '用 Rust 写一个泛型 binary_search<T: Ord>(slice: &[T], target: &T) -> Option<usize>，加一段文档注释，并指出一个边界情况。',
    },
    cap: {
      title: 'CAP 定理',
      prompt: '用 200 字以内向一位中级后端工程师解释 CAP 定理，每个 trade-off 举一个具体例子。',
    },
    refactor: {
      title: '重构代码片段',
      prompt: '重构这段 Python 代码提高可读性并补上类型标注。def f(x,y,z):\\n  r=[]\\n  for i in range(len(x)):\\n    if x[i]>y: r.append(x[i]*z)\\n  return r',
    },
    race: {
      title: '排查竞态问题',
      prompt: '一个 Node.js worker 偶尔把同一条消息写两遍到 Redis。fan-out 队列有 N 个消费者，列出 3 个最可能的根因，以及各自的验证方式。',
    },
    urlShort: {
      title: '设计短链服务',
      prompt: '设计一个每秒处理 5k 写请求的短链服务，覆盖 ID 方案、存储、缓存，以及一个可能的故障模式。',
    },
  },
};

export const dicts: Record<Lang, Dict> = { en, zh };
