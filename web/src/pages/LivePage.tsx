import { useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { Badge } from '../components/primitives/Badge';
import { Button } from '../components/primitives/Button';
import { JudgeRadar } from '../components/charts/JudgeRadar';
import { RankingChart } from '../components/charts/RankingChart';
import { useI18n } from '../i18n/context';
import { PRESET_ORDER, type PresetKey, getPresetPrompt } from '../mock/live-samples';
import { formatCost, formatLatency, formatTokens } from '../i18n/format';
import { color, font, radius, space } from '../theme';
import { useLiveRun } from '../hooks/useLiveRun';
import { useTypewriter } from '../hooks/useTypewriter';
import type { ComparisonBaselineSnapshot, ComparisonMomSnapshot } from '../lib/api';

const EMPTY_SCORES = {
  correctness: 0, completeness: 0, depth: 0, clarity: 0, usefulness: 0,
};

export function LivePage() {
  const { t, lang } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [baselineOn, setBaselineOn] = useState(true);
  const live = useLiveRun();

  const submit = (text: string) => {
    const p = text.trim();
    if (!p || live.running) return;
    live.run({ prompt: p, baseline_on: baselineOn, lang });
  };
  const onSubmit = () => submit(prompt);
  const onPreset = (key: PresetKey) => submit(getPresetPrompt(key, lang));

  const showBaseline = baselineOn;
  const judgeScores = live.judge?.scores ?? { mom: EMPTY_SCORES, baseline: EMPTY_SCORES };

  return (
    <PageShell
      title={t.nav.live}
      subtitle={lang === 'zh'
        ? 'MoM 输出 vs Baseline 输出，同一 prompt 并排跑；旁边挂 Judge 打分与成本对比。'
        : 'MoM output vs Baseline output side by side on the same prompt; scored by an independent judge.'}
      actions={
        <div style={{ display: 'flex', gap: space.sm }}>
          {live.running && (
            <Button variant="secondary" onClick={live.cancel}>
              {t.live.cancel}
            </Button>
          )}
          <Button variant="primary" onClick={onSubmit} disabled={live.running || prompt.trim().length === 0}>
            {live.running ? t.live.running : t.live.run + ' ▶'}
          </Button>
        </div>
      }
    >
      <PromptShelf
        onSelect={onPreset}
        prompt={prompt}
        onPromptChange={setPrompt}
        baselineOn={baselineOn}
        onBaselineToggle={setBaselineOn}
        disabled={live.running}
      />
      <div style={{ display: 'grid', gridTemplateColumns: showBaseline ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: space.md }}>
        <MomColumn text={live.momText} mom={live.mom} running={live.running} error={live.momError} />
        {showBaseline && (
          <BaselineColumn baseline={live.baseline} error={live.baselineError} running={live.running} />
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.md }}>
        <Card title={t.live.judgeTitle} subtitle={t.live.judgeSubtitle}>
          <JudgeRadar mom={judgeScores.mom} baseline={judgeScores.baseline} />
          <JudgeStatusFooter
            hasJudge={!!live.judge}
            fallback={live.judge?.fallback ?? false}
            error={live.judgeError}
            verdict={live.judge?.verdict_summary ?? null}
          />
        </Card>
        <Card title={t.live.costTitle}>
          <CostCompare mom={live.mom} baseline={live.baseline} />
        </Card>
      </div>
      <Card
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
            {t.live.rankingTitle}
            <Badge tone="mom">{t.live.rankingPreviewBadge}</Badge>
          </span>
        }
        subtitle={t.live.rankingSubtitle}
      >
        <RankingChart preset={PRESET_ORDER[0]} />
      </Card>
    </PageShell>
  );
}

function MomColumn({
  text,
  mom,
  running,
  error,
}: {
  text: string;
  mom: ComparisonMomSnapshot | null;
  running: boolean;
  error: string | null;
}) {
  const { t, lang } = useI18n();
  const showCursor = running && !mom;
  return (
    <OutputCard
      kind="mom"
      titleBadge={<Badge tone="mom">3 {t.live.advisors}</Badge>}
      title={t.live.momTitle}
      subtitle={t.live.momSubtitle}
      body={text}
      showCursor={showCursor}
      footer={
        mom ? (
          <StatsRow latencyMs={mom.latency_ms} tokens={mom.usage.output_tokens} costUsd={mom.cost_usd ?? 0} lang={lang} />
        ) : running ? (
          <span style={{ color: color.textSecondary, fontSize: font.size.sm }}>{t.live.running}</span>
        ) : error ? (
          <span style={{ color: color.negative, fontSize: font.size.sm }}>{t.live.errorTitle}: {error}</span>
        ) : (
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.waitingForRun}</span>
        )
      }
    />
  );
}

function BaselineColumn({
  baseline,
  error,
  running,
}: {
  baseline: ComparisonBaselineSnapshot | null;
  error: string | null;
  running: boolean;
}) {
  const { t, lang } = useI18n();
  const { text: shown, done } = useTypewriter(baseline?.text ?? '', {
    runId: baseline?.latency_ms ?? 0,
    tickMs: baseline ? Math.max(6, baseline.latency_ms / Math.max((baseline.text.length || 1) / 4, 1)) : 28,
    charsPerTick: 4,
    autoStart: !!baseline,
  });
  const body = baseline ? shown : '';
  return (
    <OutputCard
      kind="baseline"
      title={t.live.baselineTitle}
      subtitle={<span>{t.live.baselineSubtitle} · <code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted }}>{baseline?.model ?? '—'}</code></span>}
      body={body}
      showCursor={!!baseline && !done}
      footer={
        baseline ? (
          <StatsRow latencyMs={baseline.latency_ms} tokens={baseline.usage.output_tokens} costUsd={baseline.cost_usd ?? 0} lang={lang} />
        ) : running ? (
          <span style={{ color: color.textSecondary, fontSize: font.size.sm }}>{t.live.pendingBaseline}</span>
        ) : error ? (
          <span style={{ color: color.negative, fontSize: font.size.sm }}>{t.live.errorTitle}: {error}</span>
        ) : (
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.waitingForRun}</span>
        )
      }
    />
  );
}

function OutputCard({
  kind,
  title,
  titleBadge,
  subtitle,
  body,
  showCursor,
  footer,
}: {
  kind: 'mom' | 'baseline';
  title: string;
  titleBadge?: React.ReactNode;
  subtitle: React.ReactNode;
  body: string;
  showCursor: boolean;
  footer: React.ReactNode;
}) {
  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
          {title}
          {titleBadge}
        </span>
      }
      subtitle={subtitle}
    >
      <pre
        style={{
          margin: 0,
          background: color.bgSubtle,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          padding: space.md,
          fontSize: font.size.sm,
          lineHeight: 1.55,
          color: color.textPrimary,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          minHeight: 260,
          maxHeight: 420,
          overflow: 'auto',
        }}
      >
        {body}
        {showCursor && (
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 18,
              background: kind === 'mom' ? color.mom : color.flagship,
              marginLeft: 2,
              verticalAlign: 'text-bottom',
              animation: 'blink 1s steps(1) infinite',
            }}
          />
        )}
      </pre>
      <div style={{ display: 'flex', gap: space.md, fontSize: font.size.sm, color: color.textSecondary, alignItems: 'center' }}>
        {footer}
      </div>
    </Card>
  );
}

function StatsRow({
  latencyMs,
  tokens,
  costUsd,
  lang,
}: {
  latencyMs: number;
  tokens: number;
  costUsd: number;
  lang: 'zh' | 'en';
}) {
  const { t } = useI18n();
  return (
    <>
      <span>⏱ {formatLatency(latencyMs, lang)}</span>
      <span>· {formatTokens(tokens)} {t.live.stats.tokens}</span>
      <span>· {formatCost(costUsd, lang)}</span>
    </>
  );
}

function JudgeStatusFooter({
  hasJudge,
  fallback,
  error,
  verdict,
}: {
  hasJudge: boolean;
  fallback: boolean;
  error: string | null;
  verdict: string | null;
}) {
  const { t } = useI18n();
  if (error) {
    return <p style={{ margin: 0, color: color.negative, fontSize: font.size.xs }}>{t.live.errorTitle}: {error}</p>;
  }
  if (!hasJudge) {
    return <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.xs }}>{t.live.pendingJudge}</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {verdict && <p style={{ margin: 0, color: color.textSecondary, fontSize: font.size.xs, lineHeight: 1.5 }}>{verdict}</p>}
      {fallback && <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.xxs, fontStyle: 'italic' }}>{t.live.judgeFallbackNote}</p>}
    </div>
  );
}

function PromptShelf({
  onSelect,
  prompt,
  onPromptChange,
  baselineOn,
  onBaselineToggle,
  disabled,
}: {
  onSelect: (p: PresetKey) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
  baselineOn: boolean;
  onBaselineToggle: (v: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <Card title={t.live.shelfTitle} subtitle={t.live.shelfHint}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
        {PRESET_ORDER.map((key) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            disabled={disabled}
            style={{
              appearance: 'none',
              border: `1px solid ${color.border}`,
              background: color.surface,
              color: color.textPrimary,
              padding: '10px 16px',
              borderRadius: radius.md,
              fontSize: font.size.sm,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontWeight: font.weight.regular,
              transition: 'all 120ms ease',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {t.presets[key].title}
          </button>
        ))}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={t.live.inputPlaceholder}
        disabled={disabled}
        rows={4}
        style={{
          width: '100%',
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          padding: space.md,
          fontFamily: font.sans,
          fontSize: font.size.sm,
          lineHeight: 1.5,
          background: color.surface,
          color: color.textPrimary,
          resize: 'vertical',
          outline: 'none',
        }}
      />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: font.size.sm, color: color.textSecondary, cursor: 'pointer' }}>
        <input type="checkbox" checked={baselineOn} onChange={(e) => onBaselineToggle(e.target.checked)} disabled={disabled} />
        {t.live.baselineToggle}
        <span style={{ color: color.textMuted, fontSize: font.size.xs }}>· {t.live.baselineHint}</span>
      </label>
    </Card>
  );
}

function CostCompare({
  mom,
  baseline,
}: {
  mom: ComparisonMomSnapshot | null;
  baseline: ComparisonBaselineSnapshot | null;
}) {
  const { t, lang } = useI18n();
  const momCost = mom?.cost_usd ?? 0;
  const baselineCost = baseline?.cost_usd ?? 0;
  const savedPct = baselineCost > 0
    ? Math.round((1 - momCost / baselineCost) * 100)
    : 0;
  const dLatency = (mom?.latency_ms ?? 0) - (baseline?.latency_ms ?? 0);
  const barMax = Math.max(momCost, baselineCost) || 1;
  const bar = (v: number, c: string) => (
    <div style={{ height: 10, background: color.gridLine, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${(v / barMax) * 100}%`, height: '100%', background: c, borderRadius: 4, transition: 'width 400ms ease' }} />
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <Row label={t.live.momTitle}      value={mom ? formatCost(momCost, lang) : '—'}      bar={bar(momCost, color.mom)} />
      <Row label={t.live.baselineTitle} value={baseline ? formatCost(baselineCost, lang) : '—'} bar={bar(baselineCost, color.flagship)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: space.sm, borderTop: `1px solid ${color.border}` }}>
        <div>
          <div style={{ fontSize: font.size.xs, color: color.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t.live.costSaved}</div>
          <div style={{ fontSize: font.size.h2, fontWeight: font.weight.semibold, color: color.positive, letterSpacing: '-0.02em' }}>
            {baseline && mom ? `−${savedPct}%` : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: font.size.xs, color: color.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t.live.latencyDelta}</div>
          <div style={{ fontSize: font.size.md, fontWeight: font.weight.medium, color: dLatency > 0 ? color.negative : color.positive, letterSpacing: '-0.02em' }}>
            {baseline && mom ? `${dLatency > 0 ? '+' : ''}${(dLatency / 1000).toFixed(1)}s` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bar }: { label: string; value: string; bar: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px', alignItems: 'center', gap: space.md, fontSize: font.size.sm }}>
      <span style={{ color: color.textSecondary }}>{label}</span>
      {bar}
      <span style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>{value}</span>
    </div>
  );
}
