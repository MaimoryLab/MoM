import type { ReactNode } from 'react';
import { color, font, radius } from '../../theme';

type Tone = 'neutral' | 'mom' | 'positive' | 'negative' | 'info';

type Props = {
  tone?: Tone;
  children: ReactNode;
};

const map: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral:  { bg: color.bgSubtle, fg: color.textPrimary, border: color.border },
  mom:      { bg: color.momSoft,  fg: color.mom,         border: color.momSoft },
  positive: { bg: '#DFF0E6',      fg: color.positive,    border: '#C7E4D2' },
  negative: { bg: '#FBDDD9',      fg: color.negative,    border: '#F5C4BE' },
  info:     { bg: '#DDE6F7',      fg: color.info,        border: '#C6D3EE' },
};

export function Badge({ tone = 'neutral', children }: Props) {
  const c = map[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 26,
        padding: '0 10px',
        fontSize: font.size.xs,
        fontWeight: font.weight.medium,
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
