import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { perBenchmark } from '../../mock/benchmarks';
import { color, font, shadow } from '../../theme';
import { useI18n } from '../../i18n/context';

export function ComboChart() {
  const { t } = useI18n();
  return (
    <div style={{ width: '100%', height: 420 }}>
      <ResponsiveContainer>
        <ComposedChart data={perBenchmark} margin={{ top: 20, right: 48, bottom: 48, left: 28 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            dataKey="bench"
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            tickLine={false}
          />
          <YAxis
            yAxisId="score"
            domain={[50, 100]}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            label={{ value: t.overview.comboAxisScore, angle: -90, position: 'left', fill: color.textSecondary, fontSize: font.size.xs, offset: 8 }}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            domain={[0, 0.025]}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            label={{ value: t.overview.comboAxisCost, angle: 90, position: 'right', fill: color.textSecondary, fontSize: font.size.xs, offset: 8 }}
          />
          <Tooltip content={<ComboTooltip />} cursor={{ fill: color.gridLine, fillOpacity: 0.4 }} />
          <Legend content={<TwoRowLegend />} wrapperStyle={{ fontSize: font.size.xs, paddingTop: 10 }} />
          <Bar yAxisId="cost" dataKey="momCost"      name={`${t.overview.legend.mom} · cost`}        fill={color.mom}            radius={[3,3,0,0]} barSize={12} />
          <Bar yAxisId="cost" dataKey="aggCost"      name={`${t.overview.legend.aggregatorOnly} · cost`} fill={color.aggregatorOnly} radius={[3,3,0,0]} barSize={12} />
          <Bar yAxisId="cost" dataKey="flagshipCost" name={`${t.overview.legend.flagship} · cost`}   fill={color.flagship}       radius={[3,3,0,0]} barSize={12} />
          <Line yAxisId="score" dataKey="momScore"      name={`${t.overview.legend.mom} · score`}        stroke={color.mom}            strokeWidth={2}   dot={{ r: 4, fill: color.mom }} />
          <Line yAxisId="score" dataKey="aggScore"      name={`${t.overview.legend.aggregatorOnly} · score`} stroke={color.aggregatorOnly} strokeWidth={1.5} dot={{ r: 3, fill: color.aggregatorOnly }} />
          <Line yAxisId="score" dataKey="flagshipScore" name={`${t.overview.legend.flagship} · score`}   stroke={color.flagship}       strokeWidth={1.5} dot={{ r: 3, fill: color.flagship }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type LegendEntry = { dataKey?: string; value?: string; color?: string; type?: string };
function TwoRowLegend({ payload }: { payload?: LegendEntry[] }) {
  if (!payload || payload.length === 0) return null;
  const costRow  = payload.filter((p) => typeof p.dataKey === 'string' && p.dataKey.endsWith('Cost'));
  const scoreRow = payload.filter((p) => typeof p.dataKey === 'string' && p.dataKey.endsWith('Score'));
  const item = (p: LegendEntry, key: string) => (
    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: color.textSecondary }}>
      <span style={{ width: 12, height: 12, background: p.color, borderRadius: 2, display: 'inline-block' }} />
      {p.value}
    </span>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: font.size.xs, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center' }}>
        {costRow.map((p, i) => item(p, `cost-${i}`))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center' }}>
        {scoreRow.map((p, i) => item(p, `score-${i}`))}
      </div>
    </div>
  );
}

function ComboTooltip({
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
      {payload.map((p) => {
        const isCost = p.dataKey.endsWith('Cost');
        const val = isCost ? `$${p.value.toFixed(4)}` : p.value.toFixed(1);
        return (
          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: color.textSecondary, fontSize: font.size.xxs }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, background: p.color, borderRadius: 2 }} />
              {p.name}
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>{val}</span>
          </div>
        );
      })}
    </div>
  );
}
