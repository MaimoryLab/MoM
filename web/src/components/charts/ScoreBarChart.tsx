import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import benchmarks from '../../../../data/benchmarks.json';
import { color, font, shadow } from '../../theme';
import { useI18n } from '../../i18n/context';
import { normalizeBenchmarkRows } from '../../lib/benchmark-data';

const STATIC_PER_BENCHMARK = normalizeBenchmarkRows(benchmarks.per_benchmark);

export function ScoreBarChart() {
  const { t } = useI18n();
  // Hug the real data range so bars fill the plot area. Placeholder zeros in a
  // not-yet-filled series (e.g. `gpt_score` before eval-team backfill) would
  // pull the domain min to 0 and squish the actual 40-60 band into the top
  // half; filter them out and floor/ceil to the nearest 10 for clean ticks.
  const scoreDomain = useMemo((): [number, number] => {
    const scores = STATIC_PER_BENCHMARK
      .flatMap((row) => [row.momScore, row.aggScore, row.flagshipScore, row.gptScore])
      .filter((v) => v > 0);
    if (scores.length === 0) return [0, 100];
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    return [
      Math.max(0, Math.floor(min / 10) * 10),
      Math.min(100, Math.ceil(max / 10) * 10),
    ];
  }, []);

  return (
    <div style={{ width: '100%', height: 380 }}>
      <ResponsiveContainer>
        <BarChart data={STATIC_PER_BENCHMARK} margin={{ top: 20, right: 32, bottom: 48, left: 28 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            dataKey="bench"
            stroke={color.axisLabel}
            interval={0}
            tick={{ fontSize: 11, fill: color.axisLabel }}
            tickLine={false}
          />
          <YAxis
            domain={scoreDomain}
            allowDecimals={false}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            label={{ value: t.overview.comboAxisScore, angle: -90, position: 'left', fill: color.textSecondary, fontSize: font.size.xs, offset: 8 }}
          />
          <Tooltip content={<ScoreTooltip />} cursor={{ fill: color.gridLine, fillOpacity: 0.4 }} isAnimationActive={false} />
          <Legend content={<SingleRowLegend />} wrapperStyle={{ fontSize: font.size.md, paddingTop: 10 }} />
          <Bar dataKey="flagshipScore" name={t.overview.legend.flagship}        fill={color.rankFlagship}   radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
          <Bar dataKey="gptScore"      name={t.overview.legend.gpt56Sol}        fill={color.coralRed}       radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
          <Bar dataKey="momScore"      name={t.overview.legend.mom}             fill={color.mom}            radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
          <Bar dataKey="aggScore"      name={t.overview.legend.aggregatorOnly}  fill={color.aggregatorOnly} radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type LegendEntry = { dataKey?: string; value?: string; color?: string; type?: string };
function SingleRowLegend({ payload }: { payload?: LegendEntry[] }) {
  if (!payload || payload.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center', fontSize: font.size.md }}>
      {payload.map((p, i) => (
        <span key={`s-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: color.textSecondary }}>
          <span style={{ width: 16, height: 16, background: p.color, borderRadius: 3, display: 'inline-block' }} />
          {p.value}
        </span>
      ))}
    </div>
  );
}

function ScoreTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string; name: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: color.surface,
      border: `1px solid ${color.border}`,
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: font.size.xs,
      boxShadow: shadow.raised,
      color: color.textPrimary,
      minWidth: 200,
    }}>
      <div style={{ fontWeight: font.weight.semibold, marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: color.textSecondary, fontSize: font.size.xxs }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: p.color, borderRadius: 2 }} />
            {p.name}
          </span>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>{p.value.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}
