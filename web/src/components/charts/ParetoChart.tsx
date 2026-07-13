import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Scatter, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { paretoData, paretoFrontier } from '../../mock/benchmarks';
import { color, font, shadow } from '../../theme';
import { useI18n } from '../../i18n/context';

// Recharts ComposedChart with cartesian axes: scatter for models,
// dashed line for the Pareto frontier.

export function ParetoChart() {
  const { t } = useI18n();
  const models = paretoData.map((p) => ({
    ...p,
    label: t.models[p.labelKey],
    size: p.isMoM ? 260 : 130,
  }));
  const other = (id: string) => models.filter((m) => m.id === id);
  return (
    <div style={{ width: '100%', height: 420 }}>
      <ResponsiveContainer>
        <ComposedChart margin={{ top: 20, right: 30, bottom: 36, left: 48 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="cost"
            domain={[0, 20]}
            ticks={[0, 5, 10, 15, 20]}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            label={{ value: t.overview.paretoAxisX, position: 'insideBottom', fill: color.textSecondary, fontSize: font.size.xs, offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="score"
            domain={[60, 90]}
            ticks={[60, 70, 80, 90]}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            label={{ value: t.overview.paretoAxisY, angle: -90, position: 'left', fill: color.textSecondary, fontSize: font.size.xs, offset: 10 }}
          />
          <ZAxis type="number" dataKey="size" range={[80, 300]} />
          <Tooltip content={<ParetoTooltip />} cursor={{ stroke: color.border }} />
          <Legend wrapperStyle={{ fontSize: font.size.xs, paddingTop: 10 }} />
          <Line
            data={paretoFrontier}
            dataKey="score"
            stroke={color.mom}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            dot={false}
            legendType="none"
            isAnimationActive={false}
            connectNulls
          />
          <Scatter name={t.models.momComposite}  data={models.filter((m) => m.isMoM)} fill={color.mom}      shape="star"     />
          <Scatter name={t.models.flagship}      data={other('fable5')}                fill={color.flagship} shape="circle"   />
          <Scatter name={t.models.gpt5}          data={other('gpt5')}                  fill={color.flagship} shape="square"   />
          <Scatter name={t.models.sonnet46}      data={other('sonnet46')}              fill={color.flagship} shape="triangle" />
          <Scatter name={t.models.haiku45}       data={other('haiku45')}               fill={color.flagship} shape="diamond"  />
          <Scatter name={t.models.aggregatorOnly} data={other('aggOnly')}              fill={color.aggregatorOnly} shape="cross" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ParetoTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label?: string; cost: number; score: number } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  if (d.label == null) return null; // frontier polyline
  return (
    <div style={{
      background: color.surface,
      border: `1px solid ${color.border}`,
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: font.size.xs,
      boxShadow: shadow.raised,
      color: color.textPrimary,
    }}>
      <div style={{ fontWeight: font.weight.semibold, marginBottom: 3 }}>{d.label}</div>
      <div style={{ color: color.textSecondary }}>score {d.score.toFixed(1)} · cost ${d.cost.toFixed(2)}/1M</div>
    </div>
  );
}
