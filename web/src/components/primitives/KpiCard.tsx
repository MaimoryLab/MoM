import type { ReactNode } from 'react';
import { color, font, radius, shadow, space } from '../../theme';

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
      <div style={{ fontSize: font.size.xs, color: color.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: font.weight.medium }}>
        {label}
      </div>
      <div style={{ fontSize: font.size.kpi, fontWeight: font.weight.semibold, color: accentColor, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: font.size.sm, color: color.textMuted, lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
