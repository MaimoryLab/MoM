// Shared building blocks used by LivePage. Post-ISS-049 ChatPage was folded
// into Live so there's only one consumer, but the split into small pieces
// (StatusStrip / MomColumn / BaselineColumn / JudgeCard / CostCard /
// PresetsList / ComposerBar / RunSelect) keeps LivePage's JSX readable.

import { Card } from '../components/primitives/Card';
import { Button } from '../components/primitives/Button';
import { MarkdownBody } from '../components/primitives/MarkdownBody';
import { JudgeRadar } from '../components/charts/JudgeRadar';
import { useI18n } from '../i18n/context';
import { useTypewriter } from '../hooks/useTypewriter';
import { formatCost, formatLatency, formatTokens } from '../i18n/format';
import { humanizeModelName } from '../lib/model-name';
import { color, font, radius, space } from '../theme';
import type {
  ComparisonBaselineSnapshot,
  ComparisonListItem,
  ComparisonMomSnapshot,
  ComparisonResponse,
  PresetEntry,
} from '../lib/api';

export const EMPTY_JUDGE_SCORES = {
  correctness: 0, completeness: 0, depth: 0, clarity: 0, usefulness: 0,
};

const USER_PROMPT_CLIP = 140;

// Fixed height for the MoM / Baseline output boxes so the two columns stay
// the same size regardless of which one has content first — Baseline is
// often the first to stream in and would otherwise stretch its column
// while MoM's still-empty column stayed short.
const OUTPUT_BOX_HEIGHT = 380;

function clipPrompt(text: string): string {
  const t = text.trim();
  return t.length > USER_PROMPT_CLIP ? t.slice(0, USER_PROMPT_CLIP) + '…' : t;
}

// ---------------------------------------------------------------------------
// StatusStrip — top status band. When we have a comparison, prefer showing the
// user's own prompt to the audience over the internal status label. Fall back
// to the label only when the prompt isn't loaded yet (pre-first-snapshot).
// ---------------------------------------------------------------------------

export function StatusStrip({
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
  const prompt = live?.prompt ?? null;
  return (
    <Card>
      <div style={{ display: 'flex', gap: space.md, alignItems: 'baseline', flexWrap: 'wrap' }}>
        {prompt ? (
          <span style={{ fontSize: font.size.sm, color: color.textPrimary, flex: 1, minWidth: 0 }}>
            <span style={{ color: color.textSecondary, fontSize: font.size.xs, letterSpacing: '0.04em', textTransform: 'uppercase', marginRight: space.sm }}>
              {t.live.userPromptLabel}
            </span>
            <span style={{ fontWeight: font.weight.medium }}>{clipPrompt(prompt)}</span>
          </span>
        ) : (
          <span style={{ fontSize: font.size.sm, color: color.textPrimary }}>
            <strong>{statusLabel}</strong>
          </span>
        )}
        <span style={{ fontSize: font.size.xxs, color: color.textMuted, fontFamily: 'ui-monospace, monospace' }}>
          {statusLabel}{polling ? ' · ' + t.live.submittedHint : ''}
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

// ---------------------------------------------------------------------------
// Two output columns — MoM + Baseline.
// ---------------------------------------------------------------------------

export function MomColumn({ snap, typewriter, cursorOn }: { snap: ComparisonResponse | null; typewriter?: boolean; cursorOn?: boolean }) {
  const { t, lang } = useI18n();
  const mom = snap?.mom ?? null;
  const advisors = snap?.advisors_snapshot ?? [];
  const aggregator = snap?.aggregator_model ?? null;
  const advisorsLabel = advisors.length > 0
    ? advisors.map(humanizeModelName).join(' · ')
    : t.live.emptyModel;
  const aggregatorLabel = aggregator ? humanizeModelName(aggregator) : t.live.emptyModel;
  return (
    <OutputCard
      title={t.live.momTitle}
      subtitle={
        <ModelSubtitle rows={[
          { label: t.live.momModels, value: advisorsLabel },
          { label: t.live.aggregatorModel, value: aggregatorLabel },
        ]} />
      }
      body={mom?.text ?? ''}
      typewriter={typewriter}
      cursor={cursorOn ? 'mom' : null}
      footer={
        mom ? (
          <StatsRow latencyMs={mom.latency_ms} tokens={mom.usage.output_tokens} costUsd={mom.cost_usd ?? 0} lang={lang} />
        ) : snap?.mom_error ? (
          <span style={{ color: color.negative, fontSize: font.size.sm }}>{t.live.errorTitle}: {snap.mom_error.message}</span>
        ) : snap ? (
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.pendingBaseline}</span>
        ) : null
      }
    />
  );
}

export function BaselineColumn({ snap, typewriter, cursorOn }: { snap: ComparisonResponse | null; typewriter?: boolean; cursorOn?: boolean }) {
  const { t, lang } = useI18n();
  const baseline = snap?.baseline ?? null;
  const rawModel = baseline?.model ?? snap?.baseline_model_snapshot ?? null;
  const modelLabel = rawModel ? humanizeModelName(rawModel) : t.live.emptyModel;
  const errorMsg = snap?.baseline_error?.message ?? null;
  return (
    <OutputCard
      title={t.live.baselineTitle}
      subtitle={
        <ModelSubtitle rows={[
          { value: t.live.baselineSingleCall },
          { value: modelLabel },
        ]} />
      }
      body={baseline?.text ?? ''}
      typewriter={typewriter}
      cursor={cursorOn ? 'baseline' : null}
      footer={
        baseline ? (
          <StatsRow latencyMs={baseline.latency_ms} tokens={baseline.usage.output_tokens} costUsd={baseline.cost_usd ?? 0} lang={lang} />
        ) : errorMsg ? (
          <span style={{ color: color.negative, fontSize: font.size.sm }}>{t.live.errorTitle}: {errorMsg}</span>
        ) : snap ? (
          <span style={{ color: color.textMuted, fontSize: font.size.sm }}>{t.live.pendingBaseline}</span>
        ) : null
      }
    />
  );
}

function OutputCard({
  title, subtitle, body, footer, typewriter, cursor,
}: {
  title: string;
  subtitle: React.ReactNode;
  body: string;
  footer: React.ReactNode;
  typewriter?: boolean;
  cursor?: 'mom' | 'baseline' | null;
}) {
  const visible = useTypewriter(body, { active: !!typewriter, msPerChar: 14 });
  const shown = typewriter ? visible : body;
  const cursorProp: 'mom' | 'baseline' | null | undefined = typewriter && shown !== body ? cursor : cursor;
  return (
    <Card title={title} subtitle={subtitle}>
      <MarkdownBody text={shown} cursor={cursorProp ?? null} height={OUTPUT_BOX_HEIGHT} />
      {footer && (
        <div style={{ display: 'flex', gap: space.md, fontSize: font.size.sm, color: color.textSecondary, alignItems: 'center' }}>
          {footer}
        </div>
      )}
    </Card>
  );
}

// Two-line model info sits under the card title. Both MoM and Baseline pass
// exactly two rows so the two card headers keep the same height and the
// answer bodies below line up. A row without a label renders just its value
// (used by Baseline's descriptive first line, "single-model call").
function ModelSubtitle({ rows }: { rows: Array<{ label?: string; value: string }> }) {
  const rowStyle = { fontSize: font.size.xs, color: color.textSecondary, fontFamily: 'ui-monospace, monospace' } as const;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((row, i) => (
        <span key={i} style={rowStyle}>
          {row.label ? `${row.label}: ${row.value}` : row.value}
        </span>
      ))}
    </span>
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

// ---------------------------------------------------------------------------
// Judge radar + cost compare row — shared between viewer and chat.
// ---------------------------------------------------------------------------

export function JudgeCard({ snap }: { snap: ComparisonResponse | null }) {
  const { t } = useI18n();
  return (
    <Card title={t.live.judgeTitle} subtitle={t.live.judgeSubtitle}>
      <JudgeRadar
        mom={snap?.judge?.scores.mom ?? EMPTY_JUDGE_SCORES}
        baseline={snap?.judge?.scores.baseline ?? EMPTY_JUDGE_SCORES}
      />
      <JudgeStatusFooter snap={snap} />
    </Card>
  );
}

function JudgeStatusFooter({ snap }: { snap: ComparisonResponse | null }) {
  const { t } = useI18n();
  const err = snap?.judge_error?.message ?? null;
  if (err) {
    return <p style={{ margin: 0, color: color.negative, fontSize: font.size.xs }}>{t.live.errorTitle}: {err}</p>;
  }
  if (!snap?.judge) {
    return <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.xs }}>{t.live.pendingJudge}</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {snap.judge.verdict_summary && (
        <p style={{ margin: 0, color: color.textSecondary, fontSize: font.size.xs, lineHeight: 1.5 }}>
          {snap.judge.verdict_summary}
        </p>
      )}
      {snap.judge.fallback && (
        <p style={{ margin: 0, color: color.textMuted, fontSize: font.size.xxs, fontStyle: 'italic' }}>
          {t.live.judgeFallbackNote}
        </p>
      )}
    </div>
  );
}

export function CostCard({ snap }: { snap: ComparisonResponse | null }) {
  const { t, lang } = useI18n();
  const mom = snap?.mom ?? null;
  const baseline = snap?.baseline ?? null;
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
    <Card title={t.live.costTitle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <CostRow label={t.live.momTitle}      value={mom ? formatCost(momCost, lang) : '—'}      bar={bar(momCost, color.mom)} />
        <CostRow label={t.live.baselineTitle} value={baseline ? formatCost(baselineCost, lang) : '—'} bar={bar(baselineCost, color.flagship)} />
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
    </Card>
  );
}

function CostRow({ label, value, bar }: { label: string; value: string; bar: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px', alignItems: 'center', gap: space.md, fontSize: font.size.sm }}>
      <span style={{ color: color.textSecondary }}>{label}</span>
      {bar}
      <span style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: color.textPrimary }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PresetsList — one prompt per row, rendered above the composer in the
// empty state. Clicking a row fires the preset immediately (matches the old
// ChatPage grid behavior, minus the multi-column layout).
// ---------------------------------------------------------------------------

export function PresetsList({
  presets, presetsError, onPreset, busy,
}: {
  presets: PresetEntry[];
  presetsError: string | null;
  onPreset: (p: PresetEntry) => void;
  busy: boolean;
}) {
  const { t, lang } = useI18n();
  if (presetsError) {
    return <span style={{ fontSize: font.size.sm, color: color.negative }}>{t.live.errorTitle}: {presetsError}</span>;
  }
  if (presets.length === 0) {
    return <span style={{ fontSize: font.size.sm, color: color.textMuted }}>{t.live.presetsEmpty}</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, width: '100%' }}>
      <span style={{ fontSize: font.size.xs, color: color.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {t.live.presetsHint}
      </span>
      {presets.map((p) => (
        <button
          key={p.id}
          onClick={() => onPreset(p)}
          disabled={busy}
          style={{
            appearance: 'none',
            textAlign: 'left',
            border: `1px solid ${color.border}`,
            background: color.surface,
            color: color.textPrimary,
            padding: `${space.sm} ${space.md}`,
            borderRadius: radius.md,
            fontSize: font.size.sm,
            lineHeight: 1.5,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            transition: 'border-color 120ms ease',
          }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.borderColor = color.mom; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = color.border; }}
        >
          <span style={{ display: 'inline-block', fontSize: font.size.xxs, color: color.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: space.sm }}>
            {lang === 'zh' ? p.title_zh : p.title_en}
          </span>
          <span style={{ color: color.textPrimary }}>
            {clipPrompt(lang === 'zh' ? p.zh : p.en)}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer — a plain input row (textarea + send button). Rendered inline by
// the caller; the empty state centers it on screen. No sticky positioning.
// ---------------------------------------------------------------------------

const COMPOSER_MIN_HEIGHT = 96;

export function Composer({
  prompt, onPromptChange, onSubmit, busy,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const disabled = busy;
  const canSend = !disabled && prompt.trim().length > 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space.sm,
        background: color.surface,
        border: `1px solid ${color.borderStrong}`,
        borderRadius: radius.lg,
        padding: `${space.sm} ${space.sm} ${space.sm} ${space.md}`,
        minHeight: COMPOSER_MIN_HEIGHT,
        boxShadow: '0 4px 24px rgba(20, 26, 46, 0.06)',
      }}
    >
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        placeholder={t.live.inputPlaceholder}
        disabled={disabled}
        rows={2}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontFamily: font.sans,
          fontSize: font.size.base,
          lineHeight: 1.5,
          color: color.textPrimary,
          padding: `${space.sm} 0`,
          minHeight: 40,
          maxHeight: 200,
        }}
      />
      <Button variant="primary" onClick={onSubmit} disabled={!canSend}>
        {busy ? t.live.submitPending : `${t.live.submit} ▶`}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunSelect — the "pick a past run" dropdown shared by Live + Chat + Pipeline
// (Pipeline still uses its own for now, but shape is identical).
// ---------------------------------------------------------------------------

export function RunSelect({
  value, items, error, onChange, placeholder, label, emptyLabel, onNew,
}: {
  value: string | null;
  items: ComparisonListItem[];
  error: string | null;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  emptyLabel: string;
  onNew?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' | 'ghost' };
}) {
  const newVariant = onNew?.variant ?? 'primary';
  if (error) {
    return <span style={{ fontSize: font.size.xs, color: color.negative }}>{error}</span>;
  }
  if (items.length === 0) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
        <span style={{ fontSize: font.size.xs, color: color.textMuted }}>{emptyLabel}</span>
        {onNew && (
          <Button variant={newVariant} onClick={onNew.onClick}>+ {onNew.label}</Button>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: font.size.sm, color: color.textSecondary }}>
        <span>{label}</span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            appearance: 'none', height: 36, padding: `0 ${space.md}`,
            background: color.surface, border: `1px solid ${color.borderStrong}`,
            borderRadius: radius.md, fontSize: font.size.sm, color: color.textPrimary,
            cursor: 'pointer', minWidth: 260, maxWidth: 420,
          }}
        >
          <option value="" disabled>{placeholder}</option>
          {items.map((it) => (
            <option key={it.gateway_request_id} value={it.gateway_request_id}>
              {new Date(it.started_at).toLocaleTimeString()} · {clipPrompt(it.prompt).slice(0, 40)}
            </option>
          ))}
        </select>
      </label>
      {onNew && (
        <Button variant={newVariant} onClick={onNew.onClick}>+ {onNew.label}</Button>
      )}
    </div>
  );
}

// Type re-exports for consumers.
export type {
  ComparisonListItem,
  ComparisonResponse,
  ComparisonMomSnapshot,
  ComparisonBaselineSnapshot,
  PresetEntry,
};
