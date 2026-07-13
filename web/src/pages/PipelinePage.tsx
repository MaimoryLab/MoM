import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { Badge } from '../components/primitives/Badge';
import { Button } from '../components/primitives/Button';
import { pipelineTimeline, getPipelineCopy, type PipelineNode } from '../mock/pipeline-trace';
import { useI18n } from '../i18n/context';
import { color, radius, space } from '../theme';
import { formatCost, formatLatency } from '../i18n/format';

type NodeStatus = 'pending' | 'running' | 'done';

function computeStatus(node: PipelineNode, elapsed: number, speed: number): NodeStatus {
  const start = node.startMs / speed;
  const end   = node.endMs   / speed;
  if (elapsed < start) return 'pending';
  if (elapsed < end)   return 'running';
  return 'done';
}

export function PipelinePage() {
  const { t, lang } = useI18n();
  const copy = useMemo(() => getPipelineCopy(lang), [lang]);
  const [runId, setRunId] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [showDiff, setShowDiff] = useState(false);
  const totalMs = pipelineTimeline[pipelineTimeline.length - 1].endMs / speed;

  useEffect(() => {
    setElapsed(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const dt = now - t0;
      setElapsed(dt);
      if (dt < totalMs + 200) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runId, totalMs]);

  const statusOf = (id: PipelineNode['id']): NodeStatus => {
    const n = pipelineTimeline.find((x) => x.id === id);
    return n ? computeStatus(n, elapsed, speed) : 'pending';
  };

  return (
    <PageShell
      title={t.pipeline.title}
      subtitle={t.pipeline.subtitle}
      actions={
        <div style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
          <SpeedToggle value={speed} onChange={setSpeed} />
          <Button variant="primary" onClick={() => setRunId((n) => n + 1)}>▶ {t.pipeline.replay}</Button>
        </div>
      }
    >
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: space.sm }}>
          <div style={{ fontSize: 13, color: color.textSecondary }}>
            {t.pipeline.turnLabel} #{runId} · {(elapsed / 1000).toFixed(2)}s
          </div>
          <ProgressBar pct={Math.min(1, elapsed / totalMs)} />
        </div>
        <FlowDiagram copy={copy} statusOf={statusOf} onOpenDiff={() => setShowDiff(true)} />
      </Card>
      {showDiff && <DiffModal copy={copy} onClose={() => setShowDiff(false)} />}
    </PageShell>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ width: 160, height: 4, background: color.gridLine, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: color.mom, transition: 'width 60ms linear' }} />
    </div>
  );
}

function FlowDiagram({
  copy,
  statusOf,
  onOpenDiff,
}: {
  copy: ReturnType<typeof getPipelineCopy>;
  statusOf: (id: PipelineNode['id']) => NodeStatus;
  onOpenDiff: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: space.lg, padding: `${space.md} 0` }}>
      <FlowNode status={statusOf('user')} label={t.pipeline.stage.user} sub={copy.userPrompt} tone="mom" />
      <FlowArrows fanOut />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space.md }}>
        {copy.advisor.map((a, i) => (
          <AdvisorCard
            key={a.slot}
            status={statusOf((['advisorA', 'advisorB', 'advisorC'] as const)[i])}
            slot={a.slot} model={a.model} preview={a.text}
            tokens={a.tokens} latencyMs={a.latencyMs} costUsd={a.costUsd}
            cacheHit={pipelineTimeline.find((n) => n.id === (['advisorA', 'advisorB', 'advisorC'] as const)[i])?.cacheHit}
          />
        ))}
      </div>
      <FlowArrows fanIn />
      <FlowNode
        status={statusOf('assembly')}
        label={t.pipeline.stage.assembly}
        sub={t.pipeline.stage.assemblyDetail}
        tone="neutral"
        rightSlot={<Button variant="ghost" onClick={onOpenDiff}>{t.pipeline.diffButton} →</Button>}
      />
      <FlowArrows />
      <FlowNode
        status={statusOf('aggregator')}
        label={t.pipeline.stage.aggregator}
        sub={<span><code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted }}>{copy.aggregatorModel}</code> · {copy.aggregatorPreview}</span>}
        tone="mom"
      />
      <FlowArrows />
      <FlowNode
        status={statusOf('final')}
        label={t.pipeline.stage.final}
        sub={<code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted, fontSize: 12 }}>{copy.finalPreview}</code>}
        tone="positive"
      />
    </div>
  );
}

function SpeedToggle({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: color.textSecondary }}>
      <span>{t.pipeline.speed}</span>
      <div style={{ display: 'inline-flex', background: color.bgSubtle, borderRadius: 8, padding: 2 }}>
        {[1, 2, 4].map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            style={{
              appearance: 'none', border: 'none',
              background: value === s ? color.surface : 'transparent',
              padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
              color: value === s ? color.textPrimary : color.textMuted,
              fontWeight: value === s ? 500 : 400,
              boxShadow: value === s ? '0 1px 2px rgba(31,27,22,0.06)' : 'none',
            }}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

const TONE: Record<'mom' | 'neutral' | 'positive', { bg: string; border: string; fg: string }> = {
  mom:      { bg: color.momSoft, border: color.mom,        fg: color.mom },
  neutral:  { bg: color.bgSubtle, border: color.borderStrong, fg: color.textPrimary },
  positive: { bg: '#E4EFE0', border: color.positive,      fg: color.positive },
};

function FlowNode({
  status,
  label,
  sub,
  tone,
  rightSlot,
}: {
  status: NodeStatus;
  label: React.ReactNode;
  sub?: React.ReactNode;
  tone: 'mom' | 'neutral' | 'positive';
  rightSlot?: React.ReactNode;
}) {
  const c = TONE[tone];
  const isPending = status === 'pending';
  return (
    <div
      style={{
        background: isPending ? color.surface : c.bg,
        border: `1.5px solid ${isPending ? color.border : c.border}`,
        borderRadius: radius.md,
        padding: `${space.md} ${space.lg}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity: isPending ? 0.4 : 1,
        transition: 'all 260ms ease',
        gap: space.md,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: c.fg, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: 13, color: color.textSecondary, lineHeight: 1.5, wordBreak: 'break-word' }}>{sub}</div>}
      </div>
      {rightSlot}
      <StatusPill status={status} />
    </div>
  );
}

function StatusPill({ status }: { status: NodeStatus }) {
  const { t } = useI18n();
  if (status === 'pending')
    return <Badge tone="neutral">{t.pipeline.status.pending}</Badge>;
  if (status === 'running')
    return <Badge tone="mom">● {t.pipeline.status.running}</Badge>;
  return <Badge tone="positive">✓ {t.pipeline.status.done}</Badge>;
}

function AdvisorCard({
  status, slot, model, preview, tokens, latencyMs, costUsd, cacheHit,
}: {
  status: NodeStatus;
  slot: string; model: string; preview: string;
  tokens: number; latencyMs: number; costUsd: number;
  cacheHit?: boolean;
}) {
  const { t, lang } = useI18n();
  const isPending = status === 'pending';
  const isRunning = status === 'running';
  return (
    <div
      style={{
        background: isPending ? color.surface : color.bgSubtle,
        border: `1.5px solid ${isPending ? color.border : status === 'done' ? color.positive : color.mom}`,
        borderRadius: radius.md,
        padding: space.md,
        opacity: isPending ? 0.5 : 1,
        transition: 'all 260ms ease',
        display: 'flex', flexDirection: 'column', gap: space.sm,
        minHeight: 160,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
          <span style={{ fontSize: 12, color: color.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Advisor {slot}
          </span>
          {cacheHit && <Badge tone="info">{t.pipeline.cacheHit}</Badge>}
        </div>
        <StatusPill status={status} />
      </div>
      <code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted, fontSize: 11 }}>{model}</code>
      <div style={{
        fontSize: 12, color: color.textPrimary, lineHeight: 1.55,
        background: isPending ? 'transparent' : color.surface,
        border: `1px solid ${color.border}`, borderRadius: 6,
        padding: space.sm, minHeight: 60,
      }}>
        {isPending ? <span style={{ color: color.textMuted }}>…</span> : preview}
        {isRunning && <span style={{ display: 'inline-block', width: 6, height: 12, background: color.mom, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 1s steps(1) infinite' }} />}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: color.textSecondary, fontFamily: 'ui-monospace, monospace' }}>
        <span>⏱ {formatLatency(latencyMs, lang)}</span>
        <span>· {tokens}t</span>
        <span>· {formatCost(costUsd, lang)}</span>
      </div>
    </div>
  );
}

function FlowArrows({ fanOut, fanIn }: { fanOut?: boolean; fanIn?: boolean } = {}) {
  // A single visual affordance: dashed vertical connector, with fan hint via a wider SVG when needed.
  if (fanOut || fanIn) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', height: 32 }}>
        <svg width="600" height="32" viewBox="0 0 600 32" preserveAspectRatio="none" style={{ maxWidth: '100%' }}>
          {fanOut ? (
            <>
              <path d="M 300 0 L 100 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
              <path d="M 300 0 L 300 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
              <path d="M 300 0 L 500 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
            </>
          ) : (
            <>
              <path d="M 100 0 L 300 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
              <path d="M 300 0 L 300 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
              <path d="M 500 0 L 300 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
            </>
          )}
        </svg>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'center', height: 24 }}>
      <div style={{ width: 2, height: '100%', background: `repeating-linear-gradient(to bottom, ${color.mom} 0 4px, transparent 4px 8px)` }} />
    </div>
  );
}

function DiffModal({ copy, onClose }: { copy: ReturnType<typeof getPipelineCopy>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(31, 27, 22, 0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        padding: space.lg,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: color.surface, borderRadius: radius.lg,
          maxWidth: 1100, width: '100%', maxHeight: '85vh', overflow: 'auto',
          boxShadow: '0 20px 60px rgba(31, 27, 22, 0.24)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: space.lg, borderBottom: `1px solid ${color.border}` }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.pipeline.diffTitle}</h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: color.textSecondary }}>{t.pipeline.diffSubtitle}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>× {t.pipeline.close}</Button>
        </header>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: color.border, flex: 1 }}>
          <DiffColumn title={t.pipeline.diffBefore} content={copy.contextBefore} tone="neutral" />
          <DiffColumn title={t.pipeline.diffAfter}  content={copy.contextAfter}  tone="mom" />
        </div>
      </div>
    </div>
  );
}

function DiffColumn({ title, content, tone }: { title: string; content: string; tone: 'neutral' | 'mom' }) {
  const bg = tone === 'mom' ? color.momSoft : color.bgSubtle;
  return (
    <div style={{ background: color.surface, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: `${space.sm} ${space.lg}`, background: bg, fontSize: 12, color: color.textSecondary, fontWeight: 500, letterSpacing: '0.03em' }}>
        {title}
      </div>
      <pre style={{
        margin: 0, padding: space.lg, fontSize: 12, fontFamily: 'ui-monospace, monospace',
        color: color.textPrimary, lineHeight: 1.55, overflow: 'auto', whiteSpace: 'pre-wrap',
      }}>
        {content}
      </pre>
    </div>
  );
}
