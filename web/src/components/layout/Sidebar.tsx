import { useI18n } from '../../i18n/context';
import { useKiosk } from '../../hooks/useKioskMode';
import { color, font, layout, shadow, space } from '../../theme';

const logo = new URL('../../assets/logo.svg', import.meta.url).href;

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
      <nav
        className="top-nav"
        style={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
        }}
      >
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
        kioskLabel={t.kiosk}
      />
    </header>
  );
}

function BrandBlock({ name, tagline }: { name: string; tagline: string }) {
  return (
    <div className="brand-block" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <img
        className="brand-logo"
        src={logo}
        alt={name}
        style={{ marginRight: 5 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="brand-title" style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.textPrimary, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
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
  kioskLabel,
}: {
  version: string;
  lang: 'en' | 'zh';
  langEn: string;
  langZh: string;
  onLang: (l: 'en' | 'zh') => void;
  kioskLabel: { start: string; stop: string; startHint: string; empty: string; liveStartLabel: string };
}) {
  const kiosk = useKiosk();
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
      <KioskButton
        enabled={kiosk.enabled}
        onToggle={kiosk.toggle}
        startLabel={kioskLabel.start}
        stopLabel={kioskLabel.stop}
        hint={kioskLabel.startHint}
      />
      {/*<div
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
      <div style={{ fontSize: font.size.xxs, color: color.textMuted, letterSpacing: '0.03em' }}>{version}</div>*/}
    </div>
  );
}

function KioskButton({
  enabled, onToggle, startLabel, stopLabel, hint,
}: {
  enabled: boolean;
  onToggle: () => void;
  startLabel: string;
  stopLabel: string;
  hint: string;
}) {
  return (
    <button
      className="kiosk-button"
      onClick={onToggle}
      data-kiosk-control="true"
      title={hint}
      style={{
        appearance: 'none',
        border: `1px solid ${enabled ? color.mom : color.borderStrong}`,
        background: enabled ? color.mom : color.surface,
        color: enabled ? '#fff' : color.textPrimary,
        borderRadius: 999,
        padding: '6px 14px',
        fontSize: font.size.xs,
        fontWeight: font.weight.semibold,
        cursor: 'pointer',
        boxShadow: shadow.card,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        letterSpacing: '0.02em',
        animation: enabled ? 'kioskPulseRing 1.8s ease-out infinite' : 'none',
      }}
    >
      <span aria-hidden>{enabled ? '⏸' : '▶'}</span>
      <span className="kiosk-label">{enabled ? stopLabel : startLabel}</span>
    </button>
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
