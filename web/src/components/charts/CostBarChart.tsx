import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import benchmarks from '../../../../data/benchmarks.json';
import { color, font, shadow } from '../../theme';
import { useI18n } from '../../i18n/context';
import { normalizeBenchmarkRows } from '../../lib/benchmark-data';

// Round up to the next "nice" step so the axis hugs the real max without
// wasting the top of the chart. Step scales with magnitude: 0.01 / 0.1 / 1 /
// 5 / 10 / 50 depending on how large the values are.
function axisMax(value: number): number {
  if (value <= 0) return 1;
  const step =
    value < 0.1 ? 0.01 :
    value < 1   ? 0.1  :
    value < 10  ? 1    :
    value < 50  ? 5    :
    value < 100 ? 10   :
    50;
  return Math.ceil(value / step) * step;
}

const STATIC_PER_BENCHMARK = normalizeBenchmarkRows(benchmarks.per_benchmark);

export function CostBarChart() {
  const { t } = useI18n();
  const { costDomain, costDecimals } = useMemo(() => {
    // Filter out placeholder zeros in a not-yet-filled series so a single
    // 0-cost bar doesn't drag the max down or force the ceiling logic to
    // pick an inappropriate magnitude.
    const costs = STATIC_PER_BENCHMARK
      .flatMap((row) => [row.momCost, row.aggCost, row.flagshipCost, row.gptCost])
      .filter((v) => v > 0);
    const maxCost = costs.length > 0 ? Math.max(...costs) : 1;
    return {
      costDomain: [0, axisMax(maxCost)] as [number, number],
      costDecimals: maxCost < 0.1 ? 3 : maxCost < 10 ? 1 : 0,
    };
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
            tickFormatter={(v: string) => t.overview.benchLabels[v] ?? v}
            tick={{ fontSize: 11, fill: color.axisLabel }}
            tickLine={false}
          />
          <YAxis
            domain={costDomain}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            tickFormatter={(v: number) => `¥${v.toFixed(costDecimals)}`}
            label={{ value: t.overview.comboAxisCost, angle: -90, position: 'left', fill: color.textSecondary, fontSize: font.size.xs, offset: 8 }}
          />
          <Tooltip content={<CostTooltip benchLabels={t.overview.benchLabels} />} cursor={{ fill: color.gridLine, fillOpacity: 0.4 }} isAnimationActive={false} />
          <Legend content={<SingleRowLegend />} wrapperStyle={{ fontSize: font.size.md, paddingTop: 10 }} />
          <Bar dataKey="flagshipCost" name={t.overview.legend.flagship}        fill={color.rankFlagship}   radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
          <Bar dataKey="gptCost"      name={t.overview.legend.gpt56Sol}        fill={color.coralRed}       radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
          <Bar dataKey="momCost"      name={t.overview.legend.mom}             fill={color.mom}            radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
          <Bar dataKey="aggCost"      name={t.overview.legend.aggregatorOnly}  fill={color.aggregatorOnly} radius={[3,3,0,0]} barSize={10} isAnimationActive={false} />
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
        <span key={`c-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: color.textSecondary }}>
          <span style={{ width: 16, height: 16, background: p.color, borderRadius: 3, display: 'inline-block' }} />
          {p.value}
        </span>
      ))}
    </div>
  );
}

function CostTooltip({
  active,
  payload,
  label,
  benchLabels,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string; name: string }>;
  label?: string;
  benchLabels?: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const displayLabel = (label && benchLabels?.[label]) || label;
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
      <div style={{ fontWeight: font.weight.semibold, marginBottom: 6 }}>{displayLabel}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: color.textSecondary, fontSize: font.size.xxs }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: p.color, borderRadius: 2 }} />
            {p.name}
          </span>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>¥{p.value.toFixed(4)}</span>
        </div>
      ))}
    </div>
  );
}
