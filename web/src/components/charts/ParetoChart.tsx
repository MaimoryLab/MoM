import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Scatter, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { paretoData, paretoFrontier } from '../../mock/benchmarks';
import { color } from '../../theme';
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
  return (
    <div style={{ width: '100%', height: 340 }}>
      <ResponsiveContainer>
        <ComposedChart margin={{ top: 20, right: 30, bottom: 40, left: 40 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="cost"
            domain={[0, 20]}
            ticks={[0, 5, 10, 15, 20]}
            stroke={color.axisLabel}
            tick={{ fontSize: 11, fill: color.axisLabel }}
            label={{ value: t.overview.paretoAxisX, position: 'bottom', fill: color.textSecondary, fontSize: 12, offset: 12 }}
          />
          <YAxis
            type="number"
            dataKey="score"
            domain={[60, 90]}
            ticks={[60, 70, 80, 90]}
            stroke={color.axisLabel}
            tick={{ fontSize: 11, fill: color.axisLabel }}
            label={{ value: t.overview.paretoAxisY, angle: -90, position: 'left', fill: color.textSecondary, fontSize: 12, offset: 10 }}
          />
          <ZAxis type="number" dataKey="size" range={[80, 260]} />
          <Tooltip content={<ParetoTooltip />} cursor={{ stroke: color.border }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
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
          <Scatter
            name={t.models.momComposite}
            data={models.filter((m) => m.isMoM)}
            fill={color.mom}
            shape="star"
          />
          <Scatter
            name={t.models.flagship}
            data={models.filter((m) => !m.isMoM)}
            fill={color.flagship}
          />
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
      padding: '8px 10px',
      fontSize: 12,
      boxShadow: '0 4px 12px rgba(31, 27, 22, 0.08)',
      color: color.textPrimary,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.label}</div>
      <div style={{ color: color.textSecondary }}>score {d.score.toFixed(1)} · cost ${d.cost.toFixed(2)}/1M</div>
    </div>
  );
}
