// Chat — traditional chatbot layout.
//
// Sticky composer at the bottom of the main column, messages flow above it.
// When there are no messages yet, the presets grid centers in the empty area
// so the user immediately sees "click a card or type below". No subtitle,
// no explanatory text — the UI speaks for itself.
//
// Both pages read the same LiveJobProvider Context; `baseline_on: true` is
// hard-coded so backend still runs baseline + judge and comparisons stay
// consistent between Chat and Live.

import { useEffect, useState } from 'react';
import { Button } from '../components/primitives/Button';
import { MarkdownBody } from '../components/primitives/MarkdownBody';
import { useI18n } from '../i18n/context';
import { formatCost, formatLatency, formatTokens } from '../i18n/format';
import { color, font, layout, radius, space } from '../theme';
import { useLiveJob } from '../hooks/useLiveRun';
import {
  getPresets, listComparisons,
  type ComparisonListItem, type ComparisonResponse, type PresetEntry,
} from '../lib/api';

const CONTENT_MAX_WIDTH = 860;
const COMPOSER_HEIGHT_MIN = 96;

export function ChatPage() {
  const { t, lang } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ComparisonListItem[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const live = useLiveJob();

  useEffect(() => {
    let cancelled = false;
    getPresets()
      .then((res) => { if (!cancelled) setPresets(res.presets); })
      .catch((err) => { if (!cancelled) setPresetsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

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
    live.submit({ prompt: p, baseline_on: true, lang });
    setPrompt('');
  };
  const onSubmit = () => submit(prompt);
  const onPreset = (preset: PresetEntry) => {
    const text = lang === 'zh' ? preset.zh : preset.en;
    submit(text);
  };

  const current = live.current;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        padding: `${layout.contentPaddingY}px ${layout.contentPaddingX}px ${space.xl}`,
      }}
    >
      <ChatHeader
        title={t.chat.title}
        jobs={jobs}
        jobsError={jobsError}
        currentGw={current?.gateway_request_id ?? null}
        onSelect={(gw) => live.select(gw)}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', maxWidth: CONTENT_MAX_WIDTH, width: '100%', margin: '0 auto' }}>
        <ConversationView
          snap={current}
          presets={presets}
          presetsError={presetsError}
          onPreset={onPreset}
          busy={busy}
        />
      </div>
      <ComposerBar
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={onSubmit}
        busy={busy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — title on the left, history dropdown on the right. No subtitle.
// ---------------------------------------------------------------------------

function ChatHeader({
  title, jobs, jobsError, currentGw, onSelect,
}: {
  title: string;
  jobs: ComparisonListItem[];
  jobsError: string | null;
  currentGw: string | null;
  onSelect: (gw: string) => void;
}) {
  const { t } = useI18n();
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: space.md,
        maxWidth: CONTENT_MAX_WIDTH,
        width: '100%',
        margin: '0 auto',
        paddingBottom: space.md,
        marginBottom: space.md,
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      <h1 style={{ margin: 0, fontSize: font.size.h1, fontWeight: font.weight.semibold, color: color.textPrimary, letterSpacing: '-0.02em' }}>
        {title}
      </h1>
      <HistorySelect
        value={currentGw}
        items={jobs}
        error={jobsError}
        onChange={onSelect}
        label={t.chat.historyLabel}
        placeholder={t.chat.historyPlaceholder}
        emptyLabel={t.chat.historyEmpty}
      />
    </header>
  );
}

function HistorySelect({
  value, items, error, onChange, placeholder, label, emptyLabel,
}: {
  value: string | null;
  items: ComparisonListItem[];
  error: string | null;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  emptyLabel: string;
}) {
  if (error) {
    return <span style={{ fontSize: font.size.xs, color: color.negative }}>{error}</span>;
  }
  if (items.length === 0) {
    return <span style={{ fontSize: font.size.xs, color: color.textMuted }}>{emptyLabel}</span>;
  }
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: font.size.sm, color: color.textSecondary }}>
      <span>{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none', height: 36, padding: `0 ${space.md}`,
          background: color.surface, border: `1px solid ${color.borderStrong}`,
          borderRadius: radius.md, fontSize: font.size.sm, color: color.textPrimary,
          cursor: 'pointer', minWidth: 240, maxWidth: 360,
        }}
      >
        <option value="" disabled>{placeholder}</option>
        {items.map((it) => (
          <option key={it.gateway_request_id} value={it.gateway_request_id}>
            {new Date(it.started_at).toLocaleTimeString()} · {clipShort(it.prompt, 40)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Message area.
//   - Empty state: centered presets grid (no subtitle, no "select a run" box).
//   - With current snap: user bubble on the right, MoM bubble on the left.
// ---------------------------------------------------------------------------

function ConversationView({
  snap, presets, presetsError, onPreset, busy,
}: {
  snap: ComparisonResponse | null;
  presets: PresetEntry[];
  presetsError: string | null;
  onPreset: (p: PresetEntry) => void;
  busy: boolean;
}) {
  if (!snap) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `${space.xl} 0`, minHeight: 320 }}>
        <PresetsGrid presets={presets} presetsError={presetsError} onPreset={onPreset} busy={busy} />
      </div>
    );
  }
  const mom = snap.mom;
  const err = snap.mom_error?.message ?? null;
  const pending = !mom && !err;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg, padding: `${space.lg} 0` }}>
      <UserBubble text={snap.prompt} />
      {mom && <MomBubble mom={mom} />}
      {err && <ErrorBubble text={err} />}
      {pending && <PendingBubble />}
    </div>
  );
}

function PresetsGrid({
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
    return <span style={{ fontSize: font.size.sm, color: color.textMuted }}>{t.chat.presetsEmpty}</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, width: '100%' }}>
      <span
        style={{
          fontSize: font.size.xs,
          color: color.textMuted,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        {t.chat.presetsHint}
      </span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: space.md,
        }}
      >
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
              padding: `${space.md} ${space.lg}`,
              borderRadius: radius.lg,
              fontSize: font.size.sm,
              lineHeight: 1.5,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              transition: 'border-color 120ms ease, box-shadow 120ms ease',
              minHeight: 84,
            }}
            onMouseEnter={(e) => {
              if (!busy) {
                e.currentTarget.style.borderColor = color.mom;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = color.border;
            }}
          >
            <div style={{ fontSize: font.size.xxs, color: color.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              {lang === 'zh' ? p.title_zh : p.title_en}
            </div>
            <div style={{ fontSize: font.size.sm, color: color.textPrimary, lineHeight: 1.5 }}>
              {clipShort(lang === 'zh' ? p.zh : p.en, 120)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bubbles.
// ---------------------------------------------------------------------------

function UserBubble({ text }: { text: string }) {
  return (
    <BubbleRow align="right">
      <div
        style={{
          background: color.momSoft,
          color: color.textPrimary,
          borderRadius: `${radius.lg} ${radius.sm} ${radius.lg} ${radius.lg}`,
          padding: `${space.md} ${space.lg}`,
          fontSize: font.size.base,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </BubbleRow>
  );
}

function MomBubble({ mom }: { mom: NonNullable<ComparisonResponse['mom']> }) {
  const { t, lang } = useI18n();
  return (
    <BubbleRow align="left">
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, alignItems: 'flex-start', width: '100%' }}>
        <div
          style={{
            background: color.surface,
            border: `1px solid ${color.border}`,
            color: color.textPrimary,
            borderRadius: `${radius.sm} ${radius.lg} ${radius.lg} ${radius.lg}`,
            padding: `${space.md} ${space.lg}`,
            fontSize: font.size.base,
            lineHeight: 1.6,
            width: '100%',
          }}
        >
          <MarkdownBody text={mom.text} cursor={null} flush />
        </div>
        <div style={{ display: 'flex', gap: space.md, fontSize: font.size.xs, color: color.textMuted, paddingLeft: space.sm }}>
          <span>⏱ {formatLatency(mom.latency_ms, lang)}</span>
          <span>· {formatTokens(mom.usage.output_tokens)} {t.live.stats.tokens}</span>
          <span>· {formatCost(mom.cost_usd ?? 0, lang)}</span>
        </div>
      </div>
    </BubbleRow>
  );
}

function ErrorBubble({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <BubbleRow align="left">
      <div
        style={{
          background: color.surface,
          border: `1px solid ${color.negative}`,
          color: color.negative,
          borderRadius: `${radius.sm} ${radius.lg} ${radius.lg} ${radius.lg}`,
          padding: `${space.md} ${space.lg}`,
          fontSize: font.size.sm,
        }}
      >
        {t.live.momErrorLabel}: {text}
      </div>
    </BubbleRow>
  );
}

function PendingBubble() {
  const { t } = useI18n();
  return (
    <BubbleRow align="left">
      <div
        style={{
          background: color.surface,
          border: `1px dashed ${color.border}`,
          color: color.textMuted,
          borderRadius: `${radius.sm} ${radius.lg} ${radius.lg} ${radius.lg}`,
          padding: `${space.md} ${space.lg}`,
          fontSize: font.size.sm,
        }}
      >
        {t.chat.pending}
      </div>
    </BubbleRow>
  );
}

function BubbleRow({ align, children }: { align: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', width: '100%' }}>
      <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky composer at the bottom of main. Enter to send, Shift+Enter for newline.
// ---------------------------------------------------------------------------

function ComposerBar({
  prompt, onPromptChange, onSubmit, busy,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const disabled = busy;
  const canSend = !busy && prompt.trim().length > 0;
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        maxWidth: CONTENT_MAX_WIDTH,
        width: '100%',
        margin: '0 auto',
        paddingTop: space.md,
        paddingBottom: space.md,
        background: `linear-gradient(180deg, transparent 0%, ${color.bg} 24%, ${color.bg} 100%)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: space.sm,
          background: color.surface,
          border: `1px solid ${color.borderStrong}`,
          borderRadius: radius.lg,
          padding: `${space.sm} ${space.sm} ${space.sm} ${space.md}`,
          minHeight: COMPOSER_HEIGHT_MIN,
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
    </div>
  );
}

// ---------------------------------------------------------------------------

function clipShort(text: string, n: number): string {
  const trimmed = text.trim();
  return trimmed.length > n ? trimmed.slice(0, n) + '…' : trimmed;
}

