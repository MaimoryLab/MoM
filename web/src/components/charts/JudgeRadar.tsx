import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { color, font } from '../../theme';
import { useI18n } from '../../i18n/context';
import type { JudgeScores } from '../../mock/live-samples';

type Props = {
  mom: JudgeScores;
  baseline: JudgeScores;
};

export function JudgeRadar({ mom, baseline }: Props) {
  const { t } = useI18n();
  const data = [
    { dim: t.live.judgeDim.correctness,  mom: mom.correctness,  baseline: baseline.correctness  },
    { dim: t.live.judgeDim.completeness, mom: mom.completeness, baseline: baseline.completeness },
    { dim: t.live.judgeDim.depth,        mom: mom.depth,        baseline: baseline.depth        },
    { dim: t.live.judgeDim.clarity,      mom: mom.clarity,      baseline: baseline.clarity      },
    { dim: t.live.judgeDim.usefulness,   mom: mom.usefulness,   baseline: baseline.usefulness   },
  ];
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
          <Radar name="MoM"      dataKey="mom"      stroke={color.mom}      fill={color.mom}      fillOpacity={0.22} strokeWidth={2} />
          <Radar name="Baseline" dataKey="baseline" stroke={color.flagship} fill={color.flagship} fillOpacity={0.10} strokeWidth={1.5} strokeDasharray="4 3" />
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
