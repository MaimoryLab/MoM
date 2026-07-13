import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { getRankingSeries, type RankRow } from '../../mock/live-ranking';
import type { PresetKey } from '../../mock/live-samples';
import { color } from '../../theme';
import { useI18n } from '../../i18n/context';

type Props = {
  preset: PresetKey;
};

export function RankingChart({ preset }: Props) {
  const { t, lang } = useI18n();
  const data = getRankingSeries(preset);
  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 20, right: 40, bottom: 30, left: 20 }}>
          <CartesianGrid stroke={color.gridLine} strokeDasharray="2 4" />
          <XAxis
            dataKey="turn"
            stroke={color.axisLabel}
            tick={{ fontSize: 11, fill: color.axisLabel }}
            tickLine={false}
            label={{ value: t.live.rankingAxisX, position: 'insideBottom', fill: color.textSecondary, fontSize: 12, offset: -6 }}
          />
          <YAxis
            reversed
            domain={[1, 3]}
            ticks={[1, 2, 3]}
            allowDecimals={false}
            stroke={color.axisLabel}
            tick={{ fontSize: 11, fill: color.axisLabel }}
            label={{ value: t.live.rankingAxisY, angle: -90, position: 'left', fill: color.textSecondary, fontSize: 12, offset: 8 }}
          />
          <Tooltip content={<RankTooltip lang={lang} labels={t.overview.legend} />} cursor={{ stroke: color.border }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
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
      padding: '8px 10px',
      fontSize: 12,
      boxShadow: '0 4px 12px rgba(31, 27, 22, 0.08)',
      color: color.textPrimary,
      minWidth: 200,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{turnLabel}</div>
      <div style={{ color: color.textSecondary, marginBottom: 6, fontSize: 11 }}>{promptLabel}</div>
      {payload.map((p) => {
        const displayName =
          p.dataKey === 'mom' ? labels.mom :
          p.dataKey === 'aggregatorOnly' ? labels.aggregatorOnly :
          labels.flagship;
        return (
          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: color.textSecondary, fontSize: 11 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, background: p.color, borderRadius: 2 }} />
              {displayName}
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>{rankPrefix}{p.value}{rankSuffix}</span>
          </div>
        );
      })}
    </div>
  );
}
