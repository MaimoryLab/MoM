import { useMemo } from 'react';
import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { getRankingSeries, type RankRow } from '../../mock/live-ranking';
import { color, font, shadow } from '../../theme';
import { useI18n } from '../../i18n/context';

type Props = {
  seed: string;
};

export function RankingChart({ seed }: Props) {
  const { t, lang } = useI18n();
  const data = useMemo(() => getRankingSeries(seed), [seed]);
  return (
    <div style={{ width: '100%', height: 380 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 20, right: 48, bottom: 36, left: 28 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            dataKey="turn"
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            tickLine={false}
            label={{ value: t.live.rankingAxisX, position: 'insideBottom', fill: color.textSecondary, fontSize: font.size.xs, offset: -6 }}
          />
          <YAxis
            reversed
            domain={[1, 3]}
            ticks={[1, 2, 3]}
            allowDecimals={false}
            stroke={color.axisLabel}
            tick={{ fontSize: font.size.xxs, fill: color.axisLabel }}
            label={{ value: t.live.rankingAxisY, angle: -90, position: 'left', fill: color.textSecondary, fontSize: font.size.xs, offset: 8 }}
          />
          <Tooltip content={<RankTooltip lang={lang} labels={t.overview.legend} />} cursor={{ stroke: color.border }} />
          <Legend wrapperStyle={{ fontSize: font.size.xs, paddingTop: 10 }} />
          <Line dataKey="mom"            name={t.overview.legend.mom}            stroke={color.mom}            strokeWidth={2}   dot={{ r: 4, fill: color.mom }}            activeDot={{ r: 6 }} />
          <Line dataKey="aggregatorOnly" name={t.overview.legend.aggregatorOnly} stroke={color.aggregatorOnly} strokeWidth={1.5} dot={{ r: 3, fill: color.aggregatorOnly }} activeDot={{ r: 5 }} />
          <Line dataKey="flagship"       name={t.overview.legend.flagship}       stroke={color.flagship}       strokeWidth={1.5} dot={{ r: 3, fill: color.flagship }}       activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function RankTooltip({
  active,
  payload,
  label,
  lang,
  labels,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string; name: string; payload: RankRow }>;
  label?: number;
  lang: 'zh' | 'en';
  labels: { mom: string; aggregatorOnly: string; flagship: string };
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const promptLabel = lang === 'zh' ? row.labelZh : row.labelEn;
  const turnLabel = lang === 'zh' ? `第 ${label} 轮` : `Turn ${label}`;
  const rankSuffix = lang === 'zh' ? '名' : '';
  const rankPrefix = lang === 'zh' ? '第 ' : '#';
  return (
    <div style={{
      background: color.surface,
      border: `1px solid ${color.border}`,
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: font.size.xs,
      boxShadow: shadow.raised,
      color: color.textPrimary,
      minWidth: 240,
    }}>
      <div style={{ fontWeight: font.weight.semibold, marginBottom: 3 }}>{turnLabel}</div>
      <div style={{ color: color.textSecondary, marginBottom: 8, fontSize: font.size.xxs }}>{promptLabel}</div>
      {payload.map((p) => {
        const displayName =
          p.dataKey === 'mom' ? labels.mom :
          p.dataKey === 'aggregatorOnly' ? labels.aggregatorOnly :
          labels.flagship;
        return (
          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: color.textSecondary, fontSize: font.size.xxs }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, background: p.color, borderRadius: 2 }} />
              {displayName}
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>{rankPrefix}{p.value}{rankSuffix}</span>
          </div>
        );
      })}
    </div>
  );
}
