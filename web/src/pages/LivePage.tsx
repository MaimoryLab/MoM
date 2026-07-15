import { useEffect, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { Badge } from '../components/primitives/Badge';
import { Button } from '../components/primitives/Button';
import { MarkdownBody } from '../components/primitives/MarkdownBody';
import { JudgeRadar } from '../components/charts/JudgeRadar';
import { RankingChart } from '../components/charts/RankingChart';
import { useI18n } from '../i18n/context';
import { formatCost, formatLatency, formatTokens } from '../i18n/format';
import { color, font, radius, space } from '../theme';
import { useLiveJob } from '../hooks/useLiveRun';
import { navigateTo } from '../App';
import {
  getPresets,
  listComparisons,
  type ComparisonBaselineSnapshot,
  type ComparisonListItem,
  type ComparisonMomSnapshot,
  type ComparisonResponse,
  type PresetEntry,
} from '../lib/api';

const EMPTY_SCORES = {
  correctness: 0, completeness: 0, depth: 0, clarity: 0, usefulness: 0,
};

export function LivePage() {
  const { t, lang } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [baselineOn, setBaselineOn] = useState(true);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ComparisonListItem[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const live = useLiveJob();

  // Presets — hidden when list empty (file missing or badly-shaped).
  useEffect(() => {
    let cancelled = false;
    getPresets()
      .then((res) => { if (!cancelled) setPresets(res.presets); })
      .catch((err) => { if (!cancelled) setPresetsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  // Job list — auto-refresh whenever `live.current` transitions (submit / poll snapshot).
  useEffect(() => {
    let cancelled = false;
    listComparisons(20)
      .then((res) => { if (!cancelled) setJobs(res.items); })
      .catch((err) => { if (!cancelled) setJobsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [live.current?.gateway_request_id, live.current?.status]);

  const busy = live.polling;

  const submit = (text: string) => {
    const p = text.trim();
    if (!p || busy) return;
    live.submit({ prompt: p, baseline_on: baselineOn, lang });
  };
  const onSubmit = () => submit(prompt);
  const onPreset = (preset: PresetEntry) => {
    const text = lang === 'zh' ? preset.zh : preset.en;
    setPrompt(text);
    submit(text);
  };

  const current = live.current;
  const currentGw = current?.gateway_request_id ?? null;

  return (
    <PageShell
      title={t.nav.live}
      subtitle={lang === 'zh'
        ? 'MoM 输出 vs Baseline 输出：任务在后台执行，切页面不丢；左侧提交或从历史里选，右侧看结果。'
        : 'MoM output vs Baseline output. Runs execute in the background — switch pages freely; submit on the left, view results on the right.'}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: space.md, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          <Composer
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={onSubmit}
            baselineOn={baselineOn}
            onBaselineToggle={setBaselineOn}
            presets={presets}
            presetsError={presetsError}
            onPreset={onPreset}
            busy={busy}
          />
          <JobsCard
            items={jobs}
            error={jobsError}
            selectedGw={currentGw}
            onSelect={(gw) => live.select(gw)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          <StatusStrip live={live.current} polling={live.polling} transportError={live.transportError} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space.md }}>
            <MomColumn snap={current} />
            <BaselineColumn snap={current} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.md }}>
            <Card title={t.live.judgeTitle} subtitle={t.live.judgeSubtitle}>
              <JudgeRadar
                mom={current?.judge?.scores.mom ?? EMPTY_SCORES}
                baseline={current?.judge?.scores.baseline ?? EMPTY_SCORES}
              />
              <JudgeStatusFooter live={current} />
            </Card>
            <Card title={t.live.costTitle}>
              <CostCompare mom={current?.mom ?? null} baseline={current?.baseline ?? null} />
            </Card>
          </div>
          {current && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => navigateTo('pipeline', current.gateway_request_id)}>
                {t.live.viewPipeline} →
              </Button>
            </div>
          )}
          <Card
            title={t.live.rankingTitle}
            subtitle={t.live.rankingSubtitle}
            actions={<Badge tone="neutral">{t.live.rankingPreviewBadge}</Badge>}
          >
            <RankingChart seed={currentGw ?? 'preview'} />
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function Composer({
  prompt, onPromptChange, onSubmit, baselineOn, onBaselineToggle,
  presets, presetsError, onPreset, busy,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
  baselineOn: boolean;
  onBaselineToggle: (v: boolean) => void;
  presets: PresetEntry[];
  presetsError: string | null;
  onPreset: (p: PresetEntry) => void;
  busy: boolean;
}) {
  const { t, lang } = useI18n();
  const disabled = busy;
  return (
    <Card title={t.live.shelfTitle} subtitle={presetsError ? t.live.errorTitle : t.live.shelfHint}>
      {presets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => onPreset(p)}
              disabled={disabled}
              style={{
                appearance: 'none',
                border: `1px solid ${color.border}`,
                background: color.surface,
                color: color.textPrimary,
                padding: '8px 12px',
                borderRadius: radius.md,
                fontSize: font.size.xs,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {lang === 'zh' ? p.title_zh : p.title_en}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={t.live.inputPlaceholder}
        disabled={disabled}
        rows={4}
        style={{
          width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.md,
          padding: space.md, fontFamily: font.sans, fontSize: font.size.sm,
          lineHeight: 1.5, background: color.surface, color: color.textPrimary,
          resize: 'vertical', outline: 'none',
        }}
      />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: font.size.sm, color: color.textSecondary, cursor: 'pointer' }}>
        <input type="checkbox" checked={baselineOn} onChange={(e) => onBaselineToggle(e.target.checked)} disabled={disabled} />
        {t.live.baselineToggle}
        <span style={{ color: color.textMuted, fontSize: font.size.xs }}>· {t.live.baselineHint}</span>
      </label>
      <Button
        variant="primary"
        onClick={onSubmit}
        disabled={busy || prompt.trim().length === 0}
      >
        {busy ? t.live.submitPending : `${t.live.submit} ▶`}
      </Button>
    </Card>
  );
}

function JobsCard({
  items, error, selectedGw, onSelect,
}: {
  items: ComparisonListItem[];
  error: string | null;
  selectedGw: string | null;
  onSelect: (gw: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Card title={t.live.jobsTitle} subtitle={t.live.jobsHint}>
      {error && <p style={{ color: color.negative, fontSize: font.size.xs, margin: 0 }}>{error}</p>}
      {items.length === 0 && !error && (
        <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.sm }}>{t.live.jobsEmpty}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }}>
        {items.map((it) => (
          <button
            key={it.gateway_request_id}
            onClick={() => onSelect(it.gateway_request_id)}
            style={{
              appearance: 'none', textAlign: 'left', cursor: 'pointer',
              border: `1px solid ${selectedGw === it.gateway_request_id ? color.mom : color.border}`,
              background: selectedGw === it.gateway_request_id ? color.momSoft : color.surface,
              padding: `${space.sm} ${space.md}`,
              borderRadius: radius.md,
              display: 'flex', flexDirection: 'column', gap: 2,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: font.size.xxs, color: color.textMuted }}>
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>{it.gateway_request_id.slice(0, 8)}</code>
              <span>{new Date(it.started_at).toLocaleTimeString()}</span>
            </div>
            <div style={{ fontSize: font.size.sm, color: color.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.prompt}
            </div>
            <StatusPill status={it.status} />
          </button>
        ))}
      </div>
    </Card>
  );
}

function StatusPill({ status }: { status: ComparisonListItem['status'] }) {
  const { t } = useI18n();
  const labelOf: Record<ComparisonListItem['status'], string> = {
    pending: t.live.statusRunning,
    mom_done: t.live.statusMomDone,
    baseline_done: t.live.statusBaselineDone,
    judge_done: t.live.statusJudgeDone,
    error: t.live.statusError,
  };
  const toneOf: Record<ComparisonListItem['status'], string> = {
    pending: color.textMuted,
    mom_done: color.textSecondary,
    baseline_done: color.textSecondary,
    judge_done: color.positive,
    error: color.negative,
  };
  return (
    <span style={{ fontSize: font.size.xxs, color: toneOf[status], fontFamily: 'ui-monospace, monospace' }}>
      {labelOf[status]}
    </span>
  );
}

function StatusStrip({
  live, polling, transportError,
}: {
  live: ComparisonResponse | null;
  polling: boolean;
  transportError: string | null;
}) {
  const { t } = useI18n();
  if (!live && !polling && !transportError) {
    return (
      <Card>
        <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.emptyResult}</span>
      </Card>
    );
  }
  const statusLabel = live
    ? {
        pending: t.live.statusPending,
        mom_done: t.live.statusMomDone,
        baseline_done: t.live.statusBaselineDone,
        judge_done: t.live.statusJudgeDone,
        error: t.live.statusError,
      }[live.status]
    : t.live.statusPending;
  return (
    <Card>
      <div style={{ display: 'flex', gap: space.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: font.size.sm, color: color.textPrimary }}>
          <strong>{statusLabel}</strong>
          {polling && <span style={{ marginLeft: space.sm, color: color.textMuted }}>· {t.live.submittedHint}</span>}
        </span>
        {transportError && (
          <span style={{ fontSize: font.size.xs, color: color.negative }}>
            {t.live.transportErrorLabel}: {transportError}
          </span>
        )}
        {live?.mom_error && (
          <span style={{ fontSize: font.size.xs, color: color.negative }}>
            {t.live.momErrorLabel}: {live.mom_error.message}
          </span>
        )}
      </div>
    </Card>
  );
}

function MomColumn({ snap }: { snap: ComparisonResponse | null }) {
  const { t, lang } = useI18n();
  const mom = snap?.mom ?? null;
  const advisors = snap?.advisors_snapshot ?? [];
  const aggregator = snap?.aggregator_model ?? null;
  return (
    <OutputCard
      kind="mom"
      titleBadge={<Badge tone="mom">{advisors.length} {t.live.advisors}</Badge>}
      title={t.live.momTitle}
      subtitle={
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{t.live.momSubtitle}</span>
          {snap && (
            <span style={{ fontSize: font.size.xxs, color: color.textMuted, fontFamily: 'ui-monospace, monospace' }}>
              {t.live.momModels}: {advisors.length > 0 ? advisors.join(' · ') : t.live.unknownModel}
              {' — '}
              {t.live.aggregatorModel}: {aggregator ?? t.live.unknownModel}
            </span>
          )}
        </span>
      }
      body={mom?.text ?? ''}
      footer={
        mom ? (
          <StatsRow latencyMs={mom.latency_ms} tokens={mom.usage.output_tokens} costUsd={mom.cost_usd ?? 0} lang={lang} />
        ) : snap?.mom_error ? (
          <span style={{ color: color.negative, fontSize: font.size.sm }}>{t.live.errorTitle}: {snap.mom_error.message}</span>
        ) : (
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.pendingBaseline}</span>
        )
      }
    />
  );
}

function BaselineColumn({ snap }: { snap: ComparisonResponse | null }) {
  const { t, lang } = useI18n();
  const baseline = snap?.baseline ?? null;
  const modelLabel = baseline?.model ?? snap?.baseline_model_snapshot ?? t.live.unknownModel;
  const errorMsg = snap?.baseline_error?.message ?? null;
  return (
    <OutputCard
      kind="baseline"
      title={t.live.baselineTitle}
      subtitle={
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{t.live.baselineSubtitle}</span>
          <span style={{ fontSize: font.size.xxs, color: color.textMuted, fontFamily: 'ui-monospace, monospace' }}>
            {t.live.baselineModel}: {modelLabel}
          </span>
        </span>
      }
      body={baseline?.text ?? ''}
      footer={
        baseline ? (
          <StatsRow latencyMs={baseline.latency_ms} tokens={baseline.usage.output_tokens} costUsd={baseline.cost_usd ?? 0} lang={lang} />
        ) : errorMsg ? (
          <span style={{ color: color.negative, fontSize: font.size.sm }}>{t.live.errorTitle}: {errorMsg}</span>
        ) : snap?.baseline_model_snapshot === null ? (
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.waitingForRun}</span>
        ) : (
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.pendingBaseline}</span>
        )
      }
    />
  );
}

function OutputCard({
  kind, title, titleBadge, subtitle, body, footer,
}: {
  kind: 'mom' | 'baseline';
  title: string;
  titleBadge?: React.ReactNode;
  subtitle: React.ReactNode;
  body: string;
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
      <MarkdownBody text={body} cursor={null} />
      <div style={{ display: 'flex', gap: space.md, fontSize: font.size.sm, color: color.textSecondary, alignItems: 'center' }}>
        {footer}
      </div>
    </Card>
  );
}

function StatsRow({
  latencyMs, tokens, costUsd, lang,
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

function JudgeStatusFooter({ live }: { live: ComparisonResponse | null }) {
  const { t } = useI18n();
  const err = live?.judge_error?.message ?? null;
  if (err) {
    return <p style={{ margin: 0, color: color.negative, fontSize: font.size.xs }}>{t.live.errorTitle}: {err}</p>;
  }
  if (!live?.judge) {
    return <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.xs }}>{t.live.pendingJudge}</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {live.judge.verdict_summary && (
        <p style={{ margin: 0, color: color.textSecondary, fontSize: font.size.xs, lineHeight: 1.5 }}>
          {live.judge.verdict_summary}
        </p>
      )}
      {live.judge.fallback && (
        <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.xxs, fontStyle: 'italic' }}>
          {t.live.judgeFallbackNote}
        </p>
      )}
    </div>
  );
}

function CostCompare({
  mom, baseline,
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
