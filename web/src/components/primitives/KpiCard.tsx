import type { ReactNode } from 'react';
import { color, radius, shadow, space } from '../../theme';

type Props = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'default' | 'mom' | 'positive' | 'negative';
};

export function KpiCard({ label, value, hint, accent = 'default' }: Props) {
  const accentColor =
    accent === 'mom'      ? color.mom      :
    accent === 'positive' ? color.positive :
    accent === 'negative' ? color.negative :
    color.textPrimary;

  return (
    <div
      style={{
        background: color.surface,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        border: `1px solid ${color.border}`,
        padding: space.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: space.sm,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12, color: color.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 34, fontWeight: 600, color: accentColor, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: color.textMuted, lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
