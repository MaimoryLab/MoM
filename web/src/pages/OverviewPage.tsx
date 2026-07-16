import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { KpiCard } from '../components/primitives/KpiCard';
import { ParetoChart } from '../components/charts/ParetoChart';
import { ScoreBarChart } from '../components/charts/ScoreBarChart';
import { CostBarChart } from '../components/charts/CostBarChart';
import { useI18n } from '../i18n/context';
import benchmarks from '../../../data/benchmarks.json';
import { color, space } from '../theme';

export function OverviewPage() {
  const { t, lang } = useI18n();
  const { pareto_data: paretoData } = benchmarks;
  const scoreOf = (id: string) => paretoData.find((p) => p.id === id)?.score ?? 0;
  const momScore = scoreOf('mom');
  const fable5Score = scoreOf('fable5');
  const gpt56Score = scoreOf('gpt56Sol');
  const aggScore = scoreOf('aggOnly');
  return (
    <PageShell title={t.overview.heroTitle} subtitle={t.overview.heroSubtitle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: space.md }}>
        <KpiCard
          label={t.overview.kpi.scoreFable5}
          value={<span style={{ color: color.rankFlagship }}>{fable5Score.toFixed(1)}</span>}
          hint={t.overview.kpi.scoreFable5HintFlagship}
        />
        <KpiCard
          label={t.overview.kpi.scoreGpt56}
          value={<span style={{ color: color.coralRed }}>{gpt56Score.toFixed(1)}</span>}
          hint={t.overview.kpi.scoreGpt56Hint}
        />
        <KpiCard
          label={t.overview.kpi.scoreMoM}
          value={<span style={{ color: color.mom }}>{momScore.toFixed(1)}</span>}
          hint={t.overview.kpi.scoreMoMHint}
          accent="mom"
        />
        <KpiCard
          label={t.overview.kpi.scoreBaseline}
          value={<span style={{ color: color.aggregatorOnly }}>{aggScore.toFixed(1)}</span>}
          hint={t.overview.kpi.scoreBaselineHint}
        />
      </div>
      <Card title={t.overview.scoreBarTitle} subtitle={t.overview.scoreBarSubtitle}>
        <ScoreBarChart />
      </Card>
      <Card title={t.overview.costBarTitle} subtitle={t.overview.costBarSubtitle}>
        <CostBarChart />
      </Card>
      <Card title={t.overview.paretoTitle} subtitle={t.overview.paretoSubtitle}>
        <ParetoChart />
      </Card>

    </PageShell>
  );
}
