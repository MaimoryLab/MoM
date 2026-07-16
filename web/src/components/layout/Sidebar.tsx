import { useI18n } from '../../i18n/context';
import { color, font, layout, shadow, space } from '../../theme';

export type PageKey = 'overview' | 'live' | 'pipeline' | 'cost' | 'settings';

const ORDER: PageKey[] = ['overview', 'live', 'pipeline'];

type Props = {
  active: PageKey;
  onNavigate: (page: PageKey) => void;
};

export function Sidebar({ active, onNavigate }: Props) {
  const { t, lang, setLang } = useI18n();
  return (
    <header
      style={{
        height: layout.topBarHeight,
        flex: `0 0 ${layout.topBarHeight}px`,
        borderBottom: `1px solid ${color.border}`,
        background: color.bgSubtle,
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `0 ${space.xl}`,
        gap: space.lg,
        fontFamily: font.sans,
      }}
    >
      <BrandBlock name={t.brand.name} tagline={t.brand.tagline} />
      <nav style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {ORDER.map((key) => (
          <NavItem
            key={key}
            active={key === active}
            label={t.nav[key]}
            onClick={() => onNavigate(key)}
          />
        ))}
      </nav>
      <FooterBlock
        version={t.brand.version}
        lang={lang}
        langEn={t.lang.en}
        langZh={t.lang.zh}
        onLang={setLang}
      />
    </header>
  );
}

function BrandBlock({ name, tagline }: { name: string; tagline: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          background: color.mom,
          display: 'inline-block',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.textPrimary, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          {name}
        </span>
        <span style={{ fontSize: font.size.xxs, color: color.textMuted, letterSpacing: '0.02em', lineHeight: 1.1 }}>
          {tagline}
        </span>
      </div>
    </div>
  );
}

function FooterBlock({
  version,
  lang,
  langEn,
  langZh,
  onLang,
}: {
  version: string;
  lang: 'en' | 'zh';
  langEn: string;
  langZh: string;
  onLang: (l: 'en' | 'zh') => void;
}) {
  const pill = (isActive: boolean): React.CSSProperties => ({
    appearance: 'none',
    border: 'none',
    background: isActive ? color.surface : 'transparent',
    color: isActive ? color.textPrimary : color.textMuted,
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: font.size.xs,
    fontWeight: font.weight.medium,
    cursor: 'pointer',
    boxShadow: isActive ? shadow.card : 'none',
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
      <div
        style={{
          display: 'inline-flex',
          background: color.bgSubtle,
          borderRadius: 8,
          padding: 3,
          gap: 2,
        }}
      >
        <button onClick={() => onLang('en')} style={pill(lang === 'en')}>{langEn}</button>
        <button onClick={() => onLang('zh')} style={pill(lang === 'zh')}>{langZh}</button>
      </div>
      <div style={{ fontSize: font.size.xxs, color: color.textMuted, letterSpacing: '0.03em' }}>{version}</div>
    </div>
  );
}

function NavItem({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        appearance: 'none',
        border: 'none',
        background: active ? color.surface : 'transparent',
        color: active ? color.textPrimary : color.textSecondary,
        borderRadius: 8,
        padding: '8px 16px',
        textAlign: 'center',
        fontSize: font.size.sm,
        fontWeight: active ? font.weight.semibold : font.weight.regular,
        cursor: 'pointer',
        boxShadow: active ? shadow.card : 'none',
        letterSpacing: '-0.005em',
        transition: 'background 120ms ease',
      }}
    >
      {label}
    </button>
  );
}
