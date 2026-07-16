import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { perTurn } from '../../mock/cost';
import { color, font } from '../../theme';

export function CostStackedBar() {
  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={perTurn} margin={{ top: 12, right: 24, bottom: 28, left: 12 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            dataKey="turn"
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            tickLine={false}
            interval={3}
          />
          <YAxis
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number) => `$${value.toFixed(4)}`}
            contentStyle={{
              background: color.surface, border: `1px solid ${color.border}`,
              borderRadius: 8, fontSize: font.size.xs, color: color.textPrimary,
            }}
            cursor={{ fill: color.gridLine, fillOpacity: 0.4 }}
          />
          <Legend wrapperStyle={{ fontSize: font.size.xs, paddingTop: 6 }} />
          <Bar dataKey="advisorA"   name="Advisor A"  stackId="cost" fill={color.advisorA} isAnimationActive={false} />
          <Bar dataKey="advisorB"   name="Advisor B"  stackId="cost" fill={color.advisorB} isAnimationActive={false} />
          <Bar dataKey="advisorC"   name="Advisor C"  stackId="cost" fill={color.advisorC} isAnimationActive={false} />
          <Bar dataKey="aggregator" name="Aggregator" stackId="cost" fill={color.mom} radius={[3,3,0,0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
