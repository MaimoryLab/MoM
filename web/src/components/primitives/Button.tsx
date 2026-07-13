import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { color, radius, space } from '../../theme';

type Variant = 'primary' | 'secondary' | 'ghost';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({ variant = 'secondary', children, style, ...rest }: Props) {
  const base = {
    height: 36,
    padding: `0 ${space.md}`,
    borderRadius: radius.md,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    transition: 'all 120ms ease',
    lineHeight: 1,
    letterSpacing: '-0.005em',
  } as const;

  const skins: Record<Variant, React.CSSProperties> = {
    primary: {
      background: color.mom,
      color: '#FFF',
      border: `1px solid ${color.mom}`,
    },
    secondary: {
      background: color.surface,
      color: color.textPrimary,
      border: `1px solid ${color.borderStrong}`,
    },
    ghost: {
      background: 'transparent',
      color: color.textSecondary,
      border: '1px solid transparent',
    },
  };

  return (
    <button style={{ ...base, ...skins[variant], ...style }} {...rest}>
      {children}
    </button>
  );
}
