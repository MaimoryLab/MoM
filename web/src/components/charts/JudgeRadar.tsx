import { useMemo } from 'react';
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { color, font } from '../../theme';
import { useI18n } from '../../i18n/context';

export interface JudgeScoresShape {
  correctness: number;
  completeness: number;
  depth: number;
  clarity: number;
  usefulness: number;
}

type Props = {
  mom: JudgeScoresShape;
  baseline: JudgeScoresShape;
};

export function JudgeRadar({ mom, baseline }: Props) {
  const { t } = useI18n();
  // Memoize the rows so hover-triggered re-renders of any ancestor don't hand
  // Recharts a fresh `data` array each time (which would trigger
  // getDerivedStateFromProps → updateId bump → full state reset).
  const data = useMemo(() => [
    { dim: t.live.judgeDim.correctness,  mom: mom.correctness,  baseline: baseline.correctness  },
    { dim: t.live.judgeDim.completeness, mom: mom.completeness, baseline: baseline.completeness },
    { dim: t.live.judgeDim.depth,        mom: mom.depth,        baseline: baseline.depth        },
    { dim: t.live.judgeDim.clarity,      mom: mom.clarity,      baseline: baseline.clarity      },
    { dim: t.live.judgeDim.usefulness,   mom: mom.usefulness,   baseline: baseline.usefulness   },
  ], [
    t.live.judgeDim.correctness, t.live.judgeDim.completeness,
    t.live.judgeDim.depth, t.live.judgeDim.clarity, t.live.judgeDim.usefulness,
    mom.correctness, mom.completeness, mom.depth, mom.clarity, mom.usefulness,
    baseline.correctness, baseline.completeness, baseline.depth, baseline.clarity, baseline.usefulness,
  ]);
  return (
    <div style={{ width: '100%', height: 340 }}>
      <ResponsiveContainer>
        <RadarChart data={data} margin={{ top: 16, right: 28, bottom: 12, left: 28 }} outerRadius="72%">
          <PolarGrid stroke={color.gridLine} />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: font.size.xs, fill: color.textSecondary }} />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fontSize: font.size.xxs, fill: color.textMuted }}
            axisLine={false}
            tickCount={5}
          />
          <Radar name="MoM"      dataKey="mom"      stroke={color.mom}      fill={color.mom}      fillOpacity={0.22} strokeWidth={2}   isAnimationActive={false} />
          <Radar name="Baseline" dataKey="baseline" stroke={color.flagship} fill={color.flagship} fillOpacity={0.10} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
          <Legend wrapperStyle={{ fontSize: font.size.xs, paddingTop: 6 }} />
          <Tooltip
            contentStyle={{
              background: color.surface, border: `1px solid ${color.border}`,
              borderRadius: 8, fontSize: font.size.xs, color: color.textPrimary,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
