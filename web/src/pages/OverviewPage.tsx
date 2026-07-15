import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { KpiCard } from '../components/primitives/KpiCard';
import { ParetoChart } from '../components/charts/ParetoChart';
import { ComboChart } from '../components/charts/ComboChart';
import { useI18n } from '../i18n/context';
import benchmarks from '../../../data/benchmarks.json';
import { color, space } from '../theme';

export function OverviewPage() {
  const { t, lang } = useI18n();
  const { pareto_data: paretoData } = benchmarks;
  const scoreOf = (id: string) => paretoData.find((p) => p.id === id)?.score ?? 0;
  const momScore = scoreOf('mom');
  const fable5Score = scoreOf('fable5');
  const aggScore = scoreOf('aggOnly');
  return (
    <PageShell title={t.overview.heroTitle} subtitle={t.overview.heroSubtitle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space.md }}>
        <KpiCard
          label={t.overview.kpi.scoreFable5}
          value={<span>{fable5Score.toFixed(1)}</span>}
          hint={t.overview.kpi.scoreFable5HintFlagship}
        />
        <KpiCard
          label={t.overview.kpi.scoreMoM}
          value={<span style={{ color: color.mom }}>{momScore.toFixed(1)}</span>}
          hint={t.overview.kpi.scoreMoMHint}
          accent="mom"
        />
        <KpiCard
          label={t.overview.kpi.scoreBaseline}
          value={<span>{aggScore.toFixed(1)}</span>}
          hint={t.overview.kpi.scoreBaselineHint}
        />
      </div>
      <Card title={t.overview.comboTitle} subtitle={t.overview.comboSubtitle}>
        <ComboChart />
      </Card>
      <Card title={t.overview.paretoTitle} subtitle={t.overview.paretoSubtitle}>
        <ParetoChart />
      </Card>

    </PageShell>
  );
}
