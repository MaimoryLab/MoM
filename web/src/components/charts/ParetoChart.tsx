import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Scatter, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import benchmarks from '../../../../data/benchmarks.json';
import { color, font, shadow } from '../../theme';
import { useI18n } from '../../i18n/context';
import type { ParetoPoint } from '../../lib/api';

// Recharts ComposedChart with cartesian axes: scatter for models,
// dashed line for the Pareto frontier.

const MODEL_SHAPES = ['square', 'triangle', 'diamond', 'circle', 'wye'] as const;

// ISS-039: Pareto 7 个模型点各开一色,MoM 保留品牌蓝,其余 6 个从 palette 循环取。
// 与 Ranking / Cost 三色语义共享(rankFlagship / advisorB 青绿 / advisorC 紫红)+ 两个补色。
const NON_MOM_PALETTE = [
  color.aggregatorOnly, // 灰蓝 -- 内部 aggregator baseline
  color.rankFlagship,   // 琥珀橙 -- 通常是 Fable 5 flagship
  color.advisorB,       // 青绿
  color.advisorC,       // 紫红
  color.coralRed,       // 珊瑚红
  color.hookGold,       // 钩金黄
] as const;

type ModelShape = (typeof MODEL_SHAPES)[number] | 'star';

type ChartPoint = {
  id: string;
  score: number;
  cost: number;
  label: string;
  size: number;
  fill: string;
  shape: ModelShape;
};

function toChartPoint(
  point: ParetoPoint,
  translatedLabels: Readonly<Record<string, string>>,
  index: number,
  nonMomIndex: number,
): ChartPoint {
  const isMoM = point.is_mom ?? false;

  return {
    id: point.id,
    score: point.score,
    cost: point.cost,
    label:
      translatedLabels[point.label_key] ??
      point.label_key,
    size: isMoM ? 260 : 130,
    fill: isMoM ? color.mom : NON_MOM_PALETTE[nonMomIndex % NON_MOM_PALETTE.length],
    shape: isMoM
      ? 'star'
      : MODEL_SHAPES[index % MODEL_SHAPES.length],
  };
}

export function ParetoChart() {
  const { t } = useI18n();
  const { pareto_data: paretoData, pareto_frontier: paretoFrontier } = benchmarks;
  let nonMomIdx = 0;
  const models = paretoData.map((point, index) => {
    const isMoM = point.is_mom ?? false;
    return toChartPoint(point, t.models, index, isMoM ? -1 : nonMomIdx++);
  });
  const maxCost = Math.max(...models.map((model) => model.cost), 1);
  const scores = models.map((model) => model.score);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 100;
  const scoreDomain: [number, number] = [
    Math.max(0, Math.floor(minScore / 10) * 10),
    Math.min(100, Math.ceil(maxScore / 10) * 10),
  ];

  return (
    <div style={{ width: '100%', height: 420 }}>
      <ResponsiveContainer>
        <ComposedChart margin={{ top: 20, right: 30, bottom: 36, left: 48 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="cost"
            domain={[0, Math.ceil(maxCost * 1.1)]}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            label={{ value: t.overview.paretoAxisX, position: 'insideBottom', fill: color.textSecondary, fontSize: font.size.xs, offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="score"
            domain={scoreDomain}
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
          {models.map((model) => (
            <Scatter
              key={model.id}
              name={model.label}
              data={[model]}
              fill={model.fill}
              shape={model.shape}
              legendType={model.shape}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ParetoTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label?: string; costCny: number; score: number } }> }) {
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
      <div style={{ color: color.textSecondary }}>score {d.score.toFixed(1)} · cost ¥{d.costCny.toFixed(3)}/次</div>
    </div>
  );
}
