import { useEffect, useState } from 'react';
import { I18nProvider } from './i18n/context';
import { Sidebar, type PageKey } from './components/layout/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { LivePage } from './pages/LivePage';
import { PipelinePage } from './pages/PipelinePage';
import { CostPage } from './pages/CostPage';
import { SettingsPage } from './pages/SettingsPage';
import { LiveJobProvider } from './hooks/useLiveRun';
import { KioskProvider, useKiosk } from './hooks/useKioskMode';
import { useI18n } from './i18n/context';
import { color, font, shadow, space } from './theme';

const PAGES: PageKey[] = ['overview', 'live', 'pipeline', 'cost', 'settings'];

interface Route {
  page: PageKey;
  turn: string | null;
}

function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = raw.split('?');
  const page = PAGES.includes(path as PageKey) ? (path as PageKey) : 'overview';
  const params = new URLSearchParams(query);
  return { page, turn: params.get('turn') };
}

function formatHash(page: PageKey, turn?: string | null): string {
  const qs = turn ? `?turn=${encodeURIComponent(turn)}` : '';
  return `#${page}${qs}`;
}

export function navigateTo(page: PageKey, turn?: string | null) {
  const next = formatHash(page, turn);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Router() {
  const route = useHashRoute();
  const { page, turn } = route;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: color.bg }}>
      <Sidebar active={page} onNavigate={(p) => navigateTo(p)} />
      <main style={{ flex: 1, minWidth: 0 }}>
        {page === 'overview' && <OverviewPage />}
        {page === 'live'     && <LivePage />}
        {page === 'pipeline' && <PipelinePage turnFromUrl={turn} />}
        {page === 'cost'     && <CostPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
      <KioskOverlay />
    </div>
  );
}

function KioskOverlay() {
  const kiosk = useKiosk();
  const { t } = useI18n();
  if (!kiosk.enabled) return null;
  const phaseLabel = kiosk.phase === 'overview' ? t.nav.overview
    : kiosk.phase === 'live' ? t.nav.live
    : t.nav.pipeline;
  return (
    <div
      style={{
        position: 'fixed', bottom: space.lg, right: space.lg, zIndex: 100,
        background: color.surface, border: `1px solid ${color.mom}`,
        borderRadius: 999, padding: `${space.sm} ${space.md}`,
        boxShadow: shadow.raised, fontSize: font.size.xs, color: color.textPrimary,
        display: 'inline-flex', alignItems: 'center', gap: space.sm,
        fontFamily: font.sans, pointerEvents: 'none',
      }}
    >
      <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color.mom, animation: 'kioskPulseRing 1.8s ease-out infinite' }} />
      <span style={{ fontWeight: font.weight.semibold }}>{t.kiosk.running}</span>
      <span style={{ color: color.textSecondary }}>·</span>
      <span>{phaseLabel}</span>
      {kiosk.queueLength > 0 && (
        <>
          <span style={{ color: color.textSecondary }}>·</span>
          <span style={{ color: color.textMuted }}>{kiosk.queueLength}</span>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <LiveJobProvider>
        <KioskProvider>
          <Router />
        </KioskProvider>
      </LiveJobProvider>
    </I18nProvider>
  );
}
