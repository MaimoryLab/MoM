import { useI18n } from '../../i18n/context';
import { color, font, layout, space } from '../../theme';

export type PageKey = 'overview' | 'live' | 'pipeline' | 'cost' | 'settings';

const ORDER: PageKey[] = ['overview', 'live', 'pipeline', 'cost', 'settings'];

type Props = {
  active: PageKey;
  onNavigate: (page: PageKey) => void;
};

export function Sidebar({ active, onNavigate }: Props) {
  const { t, lang, setLang } = useI18n();
  return (
    <aside
      style={{
        width: layout.sidebarWidth,
        flex: `0 0 ${layout.sidebarWidth}px`,
        borderRight: `1px solid ${color.border}`,
        background: color.bgSubtle,
        height: '100vh',
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: `${space.lg} ${space.md}`,
        gap: space.lg,
        fontFamily: font.sans,
      }}
    >
      <BrandBlock name={t.brand.name} tagline={t.brand.tagline} />
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
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
    </aside>
  );
}

function BrandBlock({ name, tagline }: { name: string; tagline: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            background: color.mom,
            display: 'inline-block',
            transform: 'translateY(1px)',
          }}
        />
        <span style={{ fontSize: 17, fontWeight: 600, color: color.textPrimary, letterSpacing: '-0.02em' }}>
          {name}
        </span>
      </div>
      <div style={{ fontSize: 11, color: color.textMuted, paddingLeft: 22, letterSpacing: '0.02em' }}>
        {tagline}
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
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    boxShadow: isActive ? '0 1px 2px rgba(31, 27, 22, 0.06)' : 'none',
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, paddingLeft: 8 }}>
      <div
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          background: '#EDE8DA',
          borderRadius: 8,
          padding: 2,
          gap: 2,
        }}
      >
        <button onClick={() => onLang('en')} style={pill(lang === 'en')}>{langEn}</button>
        <button onClick={() => onLang('zh')} style={pill(lang === 'zh')}>{langZh}</button>
      </div>
      <div style={{ fontSize: 10, color: color.textMuted, letterSpacing: '0.03em' }}>{version}</div>
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
        padding: '9px 12px',
        textAlign: 'left',
        fontSize: 14,
        fontWeight: active ? 500 : 400,
        cursor: 'pointer',
        boxShadow: active ? '0 1px 2px rgba(31, 27, 22, 0.04)' : 'none',
        letterSpacing: '-0.005em',
        transition: 'background 120ms ease',
      }}
    >
      {label}
    </button>
  );
}
