// Anthropic-style cream palette + low-saturation warm accents.
// All chart / component colors reference this file — never hardcode elsewhere.

export const color = {
  // surfaces
  bg: '#FAF9F5',
  bgSubtle: '#F5F2E9',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',

  // text
  textPrimary: '#1F1B16',
  textSecondary: '#7A7168',
  textMuted: '#A69C90',

  // lines & dividers
  border: '#E8E3D8',
  borderStrong: '#D6CFC0',

  // brand / MoM highlight
  mom: '#C96442',       // Anthropic coral, primary CTA + MoM series
  momSoft: '#F5DDD1',   // fill / halo for MoM

  // series colors (low-saturation, warm)
  aggregatorOnly: '#C4A574', // 单纯 aggregator baseline
  flagship: '#8B8680',       // Fable 5 / flagship compare

  advisorA: '#B8A88A',
  advisorB: '#A8998C',
  advisorC: '#C9B79C',

  // semantic
  positive: '#6B8E6F',
  negative: '#B96E5A',
  info: '#7A8AA6',

  // charts
  gridLine: '#EDE7DB',
  axisLabel: '#8A8177',
} as const;

export const font = {
  sans: `"Söhne", ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif`,
  mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
} as const;

export const radius = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
} as const;

export const shadow = {
  card: '0 1px 2px rgba(31, 27, 22, 0.04), 0 1px 3px rgba(31, 27, 22, 0.06)',
  raised: '0 4px 12px rgba(31, 27, 22, 0.08)',
  hover: '0 6px 20px rgba(31, 27, 22, 0.10)',
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
  sidebarWidth: 220,
  contentMaxWidth: 1440,
  contentPaddingX: 32,
  contentPaddingY: 32,
} as const;
