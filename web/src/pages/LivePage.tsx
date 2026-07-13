import { useMemo, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { Badge } from '../components/primitives/Badge';
import { Button } from '../components/primitives/Button';
import { JudgeRadar } from '../components/charts/JudgeRadar';
import { RankingChart } from '../components/charts/RankingChart';
import { useI18n } from '../i18n/context';
import { getLiveSample, PRESET_ORDER, type PresetKey } from '../mock/live-samples';
import { formatCost, formatLatency, formatTokens } from '../i18n/format';
import { color, radius, space } from '../theme';
import { useTypewriter } from '../hooks/useTypewriter';

export function LivePage() {
  const { t, lang } = useI18n();
  const [preset, setPreset] = useState<PresetKey>('binarySearch');
  const [runId, setRunId]   = useState(0);
  const [running, setRunning] = useState(false);
  const [baselineOn, setBaselineOn] = useState(true);

  const sample = useMemo(() => getLiveSample(preset, lang), [preset, lang]);

  const start = () => {
    setRunning(true);
    setRunId((n) => n + 1);
    // The typewriters below decide when the answers finish; the "running"
    // badge just tracks whether any streaming is still in flight.
    setTimeout(() => setRunning(false), Math.max(sample.mom.latencyMs, sample.baseline.latencyMs) + 200);
  };

  return (
    <PageShell
      title={t.nav.live}
      subtitle={lang === 'zh'
        ? 'MoM 输出 vs Baseline 输出，同一 prompt 并排跑；旁边挂 Judge 打分与成本对比。'
        : 'MoM output vs Baseline output side by side on the same prompt; scored by an independent judge.'}
      actions={<Button variant="primary" onClick={start} disabled={running}>{running ? t.live.running : t.live.run + ' ▶'}</Button>}
    >
      <PromptShelf preset={preset} onSelect={setPreset} baselineOn={baselineOn} onBaselineToggle={setBaselineOn} />
      <div style={{ display: 'grid', gridTemplateColumns: baselineOn ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: space.md }}>
        <OutputColumn kind="mom"
          modelLabel={sample.mom ? 'MoM' : ''}
          text={sample.mom.text} tokens={sample.mom.tokens}
          latencyMs={sample.mom.latencyMs} costUsd={sample.mom.costUsd}
          runId={runId} />
        {baselineOn && (
          <OutputColumn kind="baseline"
            modelLabel="claude-fable-5"
            text={sample.baseline.text} tokens={sample.baseline.tokens}
            latencyMs={sample.baseline.latencyMs} costUsd={sample.baseline.costUsd}
            runId={runId} />
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.md }}>
        <Card title={t.live.judgeTitle} subtitle={t.live.judgeSubtitle}>
          <JudgeRadar mom={sample.judge.mom} baseline={sample.judge.baseline} />
        </Card>
        <Card title={t.live.costTitle}>
          <CostCompare mom={sample.mom} baseline={sample.baseline} />
        </Card>
      </div>
      <Card title={t.live.rankingTitle} subtitle={t.live.rankingSubtitle}>
        <RankingChart preset={preset} />
      </Card>
    </PageShell>
  );
}

function OutputColumn({
  kind,
  modelLabel,
  text,
  tokens,
  latencyMs,
  costUsd,
  runId,
}: {
  kind: 'mom' | 'baseline';
  modelLabel: string;
  text: string;
  tokens: number;
  latencyMs: number;
  costUsd: number;
  runId: number;
}) {
  const { t, lang } = useI18n();
  // Match tickMs to latency budget so both columns finish at their real pace.
  const tickMs = Math.max(6, latencyMs / Math.max(text.length / 4, 1));
  const { text: shown, done } = useTypewriter(text, { runId, tickMs, charsPerTick: 4 });
  const title = kind === 'mom' ? t.live.momTitle : t.live.baselineTitle;
  const subtitle = kind === 'mom' ? t.live.momSubtitle : t.live.baselineSubtitle;
  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
          {title}
          {kind === 'mom' && <Badge tone="mom">3 {t.live.advisors}</Badge>}
        </span>
      }
      subtitle={<span>{subtitle} · <code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted }}>{modelLabel}</code></span>}
    >
      <pre
        style={{
          margin: 0,
          background: color.bgSubtle,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          padding: space.md,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: color.textPrimary,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          minHeight: 220,
          maxHeight: 360,
          overflow: 'auto',
        }}
      >
        {shown}
        {!done && <span style={{ display: 'inline-block', width: 6, height: 14, background: color.mom, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 1s steps(1) infinite' }} />}
      </pre>
      <div style={{ display: 'flex', gap: space.md, fontSize: 12, color: color.textSecondary, alignItems: 'center' }}>
        <span>⏱ {formatLatency(latencyMs, lang)}</span>
        <span>· {formatTokens(tokens)} {t.live.stats.tokens}</span>
        <span>· {formatCost(costUsd, lang)}</span>
      </div>
    </Card>
  );
}

function PromptShelf({
  preset,
  onSelect,
  baselineOn,
  onBaselineToggle,
}: {
  preset: PresetKey;
  onSelect: (p: PresetKey) => void;
  baselineOn: boolean;
  onBaselineToggle: (v: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Card title={t.live.shelfTitle} subtitle={t.live.shelfHint}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
        {PRESET_ORDER.map((key) => {
          const active = key === preset;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              style={{
                appearance: 'none',
                border: `1px solid ${active ? color.mom : color.border}`,
                background: active ? color.momSoft : color.surface,
                color: active ? color.mom : color.textPrimary,
                padding: '8px 12px',
                borderRadius: radius.md,
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: active ? 500 : 400,
                transition: 'all 120ms ease',
              }}
            >
              {t.presets[key].title}
            </button>
          );
        })}
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: 13, color: color.textSecondary, cursor: 'pointer' }}>
        <input type="checkbox" checked={baselineOn} onChange={(e) => onBaselineToggle(e.target.checked)} />
        {t.live.baselineToggle}
        <span style={{ color: color.textMuted, fontSize: 12 }}>· {t.live.baselineHint}</span>
      </label>
    </Card>
  );
}

function CostCompare({
  mom,
  baseline,
}: {
  mom: { latencyMs: number; costUsd: number; tokens: number };
  baseline: { latencyMs: number; costUsd: number; tokens: number };
}) {
  const { t, lang } = useI18n();
  const savedPct = Math.round((1 - mom.costUsd / baseline.costUsd) * 100);
  const dLatency = mom.latencyMs - baseline.latencyMs;
  const barMax = Math.max(mom.costUsd, baseline.costUsd);
  const bar = (v: number, c: string) => (
    <div style={{ height: 10, background: color.gridLine, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${(v / barMax) * 100}%`, height: '100%', background: c, borderRadius: 4, transition: 'width 400ms ease' }} />
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <Row label={t.live.momTitle}      value={formatCost(mom.costUsd, lang)}      bar={bar(mom.costUsd, color.mom)} />
      <Row label={t.live.baselineTitle} value={formatCost(baseline.costUsd, lang)} bar={bar(baseline.costUsd, color.flagship)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: space.sm, borderTop: `1px solid ${color.border}` }}>
        <div>
          <div style={{ fontSize: 11, color: color.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t.live.costSaved}</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: color.positive, letterSpacing: '-0.02em' }}>−{savedPct}%</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: color.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t.live.latencyDelta}</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: dLatency > 0 ? color.negative : color.positive, letterSpacing: '-0.02em' }}>
            {dLatency > 0 ? '+' : ''}{(dLatency / 1000).toFixed(1)}s
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bar }: { label: string; value: string; bar: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 80px', alignItems: 'center', gap: space.md, fontSize: 13 }}>
      <span style={{ color: color.textSecondary }}>{label}</span>
      {bar}
      <span style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>{value}</span>
    </div>
  );
}
