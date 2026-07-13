import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { timeline } from '../../mock/cost';
import { color } from '../../theme';

export function CostTimeline() {
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <AreaChart data={timeline} margin={{ top: 12, right: 20, bottom: 20, left: 8 }}>
          <defs>
            <linearGradient id="momCostFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={color.mom} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color.mom} stopOpacity={0.02} />
            </linearGradient>
          </defs>
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
            formatter={(v: number) => `$${v.toFixed(4)}`}
            contentStyle={{
              background: color.surface, border: `1px solid ${color.border}`,
              borderRadius: 8, fontSize: 12, color: color.textPrimary,
            }}
            cursor={{ stroke: color.border }}
          />
          <Area type="monotone" dataKey="cost" stroke={color.mom} strokeWidth={2} fill="url(#momCostFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
