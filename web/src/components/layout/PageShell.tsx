import type { ReactNode } from 'react';
import { color, font, layout, space } from '../../theme';

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageShell({ title, subtitle, desc, actions, children }: Props) {
  return (
    <div
      style={{
        maxWidth: layout.contentMaxWidth,
        margin: '0 auto',
        padding: `${layout.contentPaddingY}px ${layout.contentPaddingX}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: space.lg,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: space.md,
          borderBottom: `1px solid ${color.border}`,
          paddingBottom: space.md,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: font.size.h1, fontWeight: font.weight.semibold, color: color.textPrimary, letterSpacing: '-0.02em' }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ margin: 0, fontSize: font.size.md, color: color.textSecondary, lineHeight: 1.5, maxWidth: 960 }}>
              {subtitle}
            </p>
          )}
          {desc && (
            <p style={{ margin: 0, fontSize: font.size.xxs, color: color.textMuted, lineHeight: 1.5, maxWidth: 960 }}>
              {desc}
            </p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: space.sm }}>{actions}</div>}
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
        {children}
      </div>
    </div>
  );
}
