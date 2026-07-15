import { useEffect, useState } from 'react';
import { I18nProvider } from './i18n/context';
import { Sidebar, type PageKey } from './components/layout/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { LivePage } from './pages/LivePage';
import { PipelinePage } from './pages/PipelinePage';
import { CostPage } from './pages/CostPage';
import { SettingsPage } from './pages/SettingsPage';
import { color } from './theme';

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
    <div style={{ display: 'flex', minHeight: '100vh', background: color.bg }}>
      <Sidebar active={page} onNavigate={(p) => navigateTo(p)} />
      <main style={{ flex: 1, minWidth: 0 }}>
        {page === 'overview' && <OverviewPage />}
        {page === 'live'     && <LivePage />}
        {page === 'pipeline' && <PipelinePage turnFromUrl={turn} />}
        {page === 'cost'     && <CostPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Router />
    </I18nProvider>
  );
}
