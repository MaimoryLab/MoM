import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { perTurn } from '../../mock/cost';
import { color } from '../../theme';

export function CostStackedBar() {
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={perTurn} margin={{ top: 12, right: 20, bottom: 24, left: 8 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            dataKey="turn"
            stroke={color.axisLabel}
            tick={{ fontSize: 10, fill: color.axisLabel }}
            tickLine={false}
            interval={3}
          />
          <YAxis
            stroke={color.axisLabel}
            tick={{ fontSize: 10, fill: color.axisLabel }}
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number) => `$${value.toFixed(4)}`}
            contentStyle={{
              background: color.surface, border: `1px solid ${color.border}`,
              borderRadius: 8, fontSize: 12, color: color.textPrimary,
            }}
            cursor={{ fill: color.gridLine, fillOpacity: 0.4 }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar dataKey="advisorA"   name="Advisor A"  stackId="cost" fill={color.advisorA} />
          <Bar dataKey="advisorB"   name="Advisor B"  stackId="cost" fill={color.advisorB} />
          <Bar dataKey="advisorC"   name="Advisor C"  stackId="cost" fill={color.advisorC} />
          <Bar dataKey="aggregator" name="Aggregator" stackId="cost" fill={color.mom} radius={[3,3,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
