import type { ReactNode } from 'react';
import { color, radius } from '../../theme';

type Tone = 'neutral' | 'mom' | 'positive' | 'negative' | 'info';

type Props = {
  tone?: Tone;
  children: ReactNode;
};

const map: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral:  { bg: '#F5F0E4', fg: color.textPrimary,   border: color.border },
  mom:      { bg: color.momSoft, fg: color.mom,       border: color.momSoft },
  positive: { bg: '#E4EFE0', fg: color.positive,      border: '#D8E7D2' },
  negative: { bg: '#F5DED5', fg: color.negative,      border: '#EFCEC2' },
  info:     { bg: '#E4E8EF', fg: color.info,          border: '#D5DBE7' },
};

export function Badge({ tone = 'neutral', children }: Props) {
  const c = map[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 8px',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1,
        borderRadius: radius.sm,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
