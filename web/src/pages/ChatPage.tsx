// Chat — iMessage-style ask/answer surface.
//
// Layout:
//   ┌ RunSelect (top-right) ────────────────────────────────┐
//   │ Composer (presets + textarea + submit, no baseline UI)│
//   │ StatusStrip                                           │
//   │ ┌──────────────── message list ─────────────────────┐ │
//   │ │                                    [ user right ] │ │
//   │ │ [ MoM left ]                                      │ │
//   │ └───────────────────────────────────────────────────┘ │
//   └───────────────────────────────────────────────────────┘
//
// Baseline / Judge / Cost cards live on the Live page; this page keeps only
// the MoM reply plus latency/tokens/cost metadata under the bubble.
// Baseline+judge still run on the backend (baseline_on hard-coded true) so
// switching to the Live page shows the full comparison.

import { useEffect, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { MarkdownBody } from '../components/primitives/MarkdownBody';
import { useI18n } from '../i18n/context';
import { formatCost, formatLatency, formatTokens } from '../i18n/format';
import { color, font, radius, space } from '../theme';
import { useLiveJob } from '../hooks/useLiveRun';
import {
  getPresets, listComparisons,
  type ComparisonListItem, type ComparisonResponse, type PresetEntry,
} from '../lib/api';
import { Composer, RunSelect, StatusStrip } from './live-shared';

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
      title={t.chat.title}
      subtitle={t.chat.subtitle}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <RunSelect
            value={currentGw}
            items={jobs}
            error={jobsError}
            onChange={(gw) => live.select(gw)}
            label={t.chat.historyLabel}
            placeholder={t.chat.historyPlaceholder}
            emptyLabel={t.chat.historyEmpty}
          />
        </div>
        <Composer
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={onSubmit}
          presets={presets}
          presetsError={presetsError}
          onPreset={onPreset}
          busy={busy}
        />
        <StatusStrip live={current} polling={live.polling} transportError={live.transportError} />
        <ConversationView snap={current} />
      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Conversation view — one card containing the user bubble + the MoM bubble
// stacked vertically. iMessage convention: outgoing on the right, incoming
// on the left. Empty state prompts the user to submit.
// ---------------------------------------------------------------------------

function ConversationView({ snap }: { snap: ComparisonResponse | null }) {
  const { t, lang } = useI18n();
  if (!snap) {
    return (
      <Card>
        <div style={{ padding: `${space.lg} 0`, textAlign: 'center', color: color.textMuted, fontSize: font.size.sm }}>
          {t.chat.empty}
        </div>
      </Card>
    );
  }
  const mom = snap.mom;
  const err = snap.mom_error?.message ?? null;
  const pending = !mom && !err;
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <UserBubble text={snap.prompt} />
        {mom && (
          <MomBubble
            text={mom.text}
            latencyMs={mom.latency_ms}
            tokens={mom.usage.output_tokens}
            costUsd={mom.cost_usd ?? 0}
            lang={lang}
          />
        )}
        {err && <ErrorBubble text={err} />}
        {pending && <PendingBubble />}
      </div>
    </Card>
  );
}

function UserBubble({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <BubbleRow align="right" label={t.chat.userLabel}>
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

function MomBubble({
  text, latencyMs, tokens, costUsd, lang,
}: {
  text: string;
  latencyMs: number;
  tokens: number;
  costUsd: number;
  lang: 'zh' | 'en';
}) {
  const { t } = useI18n();
  return (
    <BubbleRow align="left" label={t.chat.momLabel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, alignItems: 'flex-start' }}>
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
          <MarkdownBody text={text} cursor={null} />
        </div>
        <div style={{ display: 'flex', gap: space.md, fontSize: font.size.xs, color: color.textMuted, paddingLeft: space.sm }}>
          <span>⏱ {formatLatency(latencyMs, lang)}</span>
          <span>· {formatTokens(tokens)} {t.live.stats.tokens}</span>
          <span>· {formatCost(costUsd, lang)}</span>
        </div>
      </div>
    </BubbleRow>
  );
}

function ErrorBubble({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <BubbleRow align="left" label={t.chat.momLabel}>
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
    <BubbleRow align="left" label={t.chat.momLabel}>
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

function BubbleRow({
  align, label, children,
}: {
  align: 'left' | 'right';
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        width: '100%',
      }}
    >
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <span
          style={{
            fontSize: font.size.xxs,
            color: color.textMuted,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            paddingInline: space.sm,
          }}
        >
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}
