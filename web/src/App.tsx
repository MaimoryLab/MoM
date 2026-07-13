import { useState } from 'react';
import { I18nProvider } from './i18n/context';
import { Sidebar, type PageKey } from './components/layout/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { LivePage } from './pages/LivePage';
import { PipelinePage } from './pages/PipelinePage';
import { CostPage } from './pages/CostPage';
import { SettingsPage } from './pages/SettingsPage';
import { color } from './theme';

function Router() {
  const [page, setPage] = useState<PageKey>('overview');
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: color.bg }}>
      <Sidebar active={page} onNavigate={setPage} />
      <main style={{ flex: 1, minWidth: 0 }}>
        {page === 'overview' && <OverviewPage />}
        {page === 'live'     && <LivePage />}
        {page === 'pipeline' && <PipelinePage />}
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
