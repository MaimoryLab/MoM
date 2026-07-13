import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { KpiCard } from '../components/primitives/KpiCard';
import { CostStackedBar } from '../components/charts/CostStackedBar';
import { CostPie } from '../components/charts/CostPie';
import { CacheHitBars } from '../components/charts/CacheHitBars';
import { CostTimeline } from '../components/charts/CostTimeline';
import { useI18n } from '../i18n/context';
import { sessionCost } from '../mock/cost';
import { color, radius, space } from '../theme';

export function CostPage() {
  const { t, lang } = useI18n();
  return (
    <PageShell title={t.nav.cost} subtitle={t.cost.scopeNote}>
      <SavedBanner
        title={t.cost.savedBannerTitle}
        baselineLabel={t.cost.baselineLabel}
        momLabel={t.cost.momLabel}
        savedSuffix={t.cost.savedBannerSuffix}
        lang={lang}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: space.md }}>
        <KpiCard label={t.cost.kpi.total}      value={`$${sessionCost.momTotalUsd.toFixed(2)}`} />
        <KpiCard label={t.cost.kpi.avgPerTurn} value={`$${sessionCost.avgPerTurnUsd.toFixed(3)}`} />
        <KpiCard label={t.cost.kpi.cacheHit}   value={`${Math.round(sessionCost.overallCacheHitRate * 100)}%`} accent="positive" />
        <KpiCard label={t.cost.kpi.turnsRun}   value={`${sessionCost.turnsRun}`} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: space.md }}>
        <Card title={t.cost.perTurnTitle} subtitle={t.cost.perTurnSubtitle}>
          <CostStackedBar />
        </Card>
        <Card title={t.cost.byRoleTitle} subtitle={t.cost.byRoleSubtitle}>
          <CostPie />
        </Card>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: space.md }}>
        <Card title={t.cost.cacheByModelTitle} subtitle={t.cost.cacheByModelSubtitle}>
          <CacheHitBars />
        </Card>
        <Card title={t.cost.timelineTitle} subtitle={t.cost.timelineSubtitle}>
          <CostTimeline />
        </Card>
      </div>
    </PageShell>
  );
}

function SavedBanner({
  title, baselineLabel, momLabel, savedSuffix, lang,
}: {
  title: string; baselineLabel: string; momLabel: string; savedSuffix: string; lang: 'en' | 'zh';
}) {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${color.momSoft} 0%, ${color.surface} 100%)`,
        border: `1px solid ${color.mom}`,
        borderRadius: radius.lg,
        padding: `${space.xl} ${space.xxl}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.xl,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
        <div style={{ fontSize: 12, color: color.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: space.xl }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: color.textMuted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{baselineLabel}</span>
            <span style={{ fontSize: 28, color: color.textMuted, fontFamily: 'ui-monospace, monospace', textDecoration: 'line-through', textDecorationColor: color.textMuted }}>
              ${sessionCost.baselineTotalUsd.toFixed(2)}
            </span>
          </div>
          <span style={{ fontSize: 22, color: color.textMuted }}>→</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: color.mom, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 500 }}>{momLabel}</span>
            <span style={{ fontSize: 44, fontWeight: 600, color: color.mom, fontFamily: 'ui-monospace, monospace', letterSpacing: '-0.02em' }}>
              ${sessionCost.momTotalUsd.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: color.positive, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
          {lang === 'zh' ? savedSuffix : `${savedSuffix}`}
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, color: color.positive, letterSpacing: '-0.04em', lineHeight: 1 }}>
          −{sessionCost.savedPct}%
        </div>
      </div>
    </div>
  );
}
