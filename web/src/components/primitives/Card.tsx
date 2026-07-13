import type { CSSProperties, ReactNode } from 'react';
import { color, font, radius, shadow, space } from '../../theme';

type Props = {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  padding?: keyof typeof space;
  style?: CSSProperties;
  actions?: ReactNode;
};

export function Card({ title, subtitle, children, padding = 'lg', style, actions }: Props) {
  return (
    <section
      style={{
        background: color.surface,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        border: `1px solid ${color.border}`,
        padding: space[padding],
        display: 'flex',
        flexDirection: 'column',
        gap: space.md,
        ...style,
      }}
    >
      {(title || actions) && (
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {title && <h3 style={{ margin: 0, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.textPrimary, letterSpacing: '-0.01em' }}>{title}</h3>}
            {subtitle && <p style={{ margin: 0, fontSize: font.size.sm, color: color.textSecondary, lineHeight: 1.5 }}>{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </section>
  );
}
