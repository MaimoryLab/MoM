import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { byRole } from '../../mock/cost';
import { color, font } from '../../theme';

const COLORS: Record<string, string> = {
  advisorA:   color.advisorA,
  advisorB:   color.advisorB,
  advisorC:   color.advisorC,
  aggregator: color.mom,
};

const LABELS: Record<string, string> = {
  advisorA:   'Advisor A',
  advisorB:   'Advisor B',
  advisorC:   'Advisor C',
  aggregator: 'Aggregator',
};

// Rows built once at module load — stable reference so re-renders don't hand
// Recharts a fresh `data` array (which would bump updateId and reset chart state).
const STATIC_ROWS = byRole.map((r) => ({ name: LABELS[r.role], value: r.value, role: r.role }));

export function CostPie() {
  const data = STATIC_ROWS;
  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="82%"
            paddingAngle={2}
            stroke={color.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.role} fill={COLORS[d.role]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number) => `¥${v.toFixed(3)}`}
            contentStyle={{
              background: color.surface, border: `1px solid ${color.border}`,
              borderRadius: 8, fontSize: font.size.xs, color: color.textPrimary,
            }}
          />
          <Legend wrapperStyle={{ fontSize: font.size.xs }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
