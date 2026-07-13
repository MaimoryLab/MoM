// Royal-blue cool palette, tuned for a 1080p exhibition panel viewed at 3–4 m.
// All chart / component colors reference this file — never hardcode elsewhere.

export const color = {
  // surfaces
  bg: '#EDF1FC',
  bgSubtle: '#C5D3F0',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',

  // text
  textPrimary: '#1A1D2E',
  textSecondary: '#5B6478',
  textMuted: '#8791A6',

  // lines & dividers
  border: '#E4E7F0',
  borderStrong: '#C9CFDD',

  // brand / MoM highlight (royal blue)
  mom: '#3E5BDB',       // primary MoM series + CTA + brand
  momSoft: '#DBE3F9',   // fill / halo for MoM

  // series colors (cool, low-saturation)
  aggregatorOnly: '#7D8AB0', // 灰蓝,内部 aggregator baseline
  flagship: '#8891A5',       // 冷中灰,Fable 5 / flagship compare

  advisorA: '#5A6FE0',
  advisorB: '#6D7AC0',
  advisorC: '#8A93D1',

  // semantic
  positive: '#3E9E6E',
  negative: '#D14E4E',
  info: '#4A78D4',

  // charts
  gridLine: '#E4E7F0',
  axisLabel: '#7A8299',
} as const;

export const font = {
  sans: `"Söhne", ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif`,
  mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  // 展厅字号阶梯 (base 18px)。改一处全站生效,避免各组件散点写死。
  size: {
    xxs: 14,      // 从 10/11 提到 14:轴标签 / legend / footer 版本号
    xs: 15,       // 从 12/13 提到 15:KPI label / caption
    sm: 16,       // 从 14 提到 16:侧栏项 / 正文次要
    base: 18,     // 正文基准
    md: 20,       // 卡片标题 / 强调段
    lg: 22,       // 分区小标题
    xl: 26,       // sidebar brand
    h2: 30,       // 卡片内的中标题
    h1: 36,       // 页面主标题 (26/28 → 36)
    kpi: 44,      // KPI 数字 (32/34 → 44)
    kpiHero: 56,  // 单卡巨大数字
    kpiUltra: 84, // 特大 hero 数字 (72 → 84)
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

export const radius = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
} as const;

export const shadow = {
  card:   '0 1px 2px rgba(20, 26, 46, 0.05), 0 1px 3px rgba(20, 26, 46, 0.06)',
  raised: '0 4px 12px rgba(20, 26, 46, 0.08)',
  hover:  '0 6px 20px rgba(20, 26, 46, 0.10)',
} as const;

export const space = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
} as const;

export const layout = {
  sidebarWidth: 244,      // 220 → 244 给放大字号留空间
  contentMaxWidth: 1520,  // 1440 → 1520
  contentPaddingX: 32,
  contentPaddingY: 32,
} as const;
