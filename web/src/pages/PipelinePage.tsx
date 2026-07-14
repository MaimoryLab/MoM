import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { Badge } from '../components/primitives/Badge';
import { Button } from '../components/primitives/Button';
import { useI18n } from '../i18n/context';
import { color, font, radius, shadow, space } from '../theme';
import { formatCost, formatLatency } from '../i18n/format';
import { getTracesByGateway, listTraces } from '../lib/api';
import type { TraceRequestFull, TraceSummary } from '../lib/api';
import { compressTimeline, nodeStatusAt, type NodeStatus, TIMELINE_CAP_MS } from '../lib/timing';

interface Props {
  turnFromUrl: string | null;
}

interface ViewNode {
  id: string;
  role: 'user' | 'advisor' | 'assembly' | 'aggregator' | 'final' | 'passthrough';
  startMs: number;
  endMs: number;
  slot?: string;
  model?: string;
  tokens?: number;
  latencyMs?: number;
  costUsd?: number | null;
  cacheHit?: boolean;
  preview?: string;
  raw?: TraceRequestFull;
}

interface TurnData {
  gwId: string;
  nodes: ViewNode[];
  totalMs: number;
  compressedFromMs: number | null;
  aggregator: TraceRequestFull | null;
  passthrough: TraceRequestFull | null;
}

export function PipelinePage({ turnFromUrl }: Props) {
  const { t, lang } = useI18n();
  const [recent, setRecent] = useState<TraceSummary[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [selectedGwId, setSelectedGwId] = useState<string | null>(turnFromUrl);
  const [turn, setTurn] = useState<TurnData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [runId, setRunId] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    setSelectedGwId(turnFromUrl);
  }, [turnFromUrl]);

  useEffect(() => {
    let cancelled = false;
    listTraces({ limit: 20, role: 'aggregator' })
      .then((res) => {
        if (cancelled) return;
        setRecent(res.items);
        if (!selectedGwId && res.items.length > 0) {
          setSelectedGwId(res.items[0].gateway_request_id);
        }
      })
      .catch((err) => {
        if (!cancelled) setRecentError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedGwId) {
      setTurn(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getTracesByGateway(selectedGwId)
      .then((res) => {
        if (cancelled) return;
        setTurn(buildTurnData(selectedGwId, res.requests));
        setRunId((n) => n + 1);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGwId]);

  const totalMs = turn ? turn.totalMs / speed : 0;
  useEffect(() => {
    if (!turn) return;
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
  }, [runId, totalMs, turn]);

  const statusOf = (id: string): NodeStatus => {
    if (!turn) return 'pending';
    const n = turn.nodes.find((x) => x.id === id);
    if (!n) return 'pending';
    return nodeStatusAt(n.startMs / speed, n.endMs / speed, elapsed);
  };

  const advisors = turn?.nodes.filter((n) => n.role === 'advisor') ?? [];
  const aggregatorNode = turn?.nodes.find((n) => n.role === 'aggregator') ?? null;
  const assemblyNode = turn?.nodes.find((n) => n.role === 'assembly') ?? null;
  const userNode = turn?.nodes.find((n) => n.role === 'user') ?? null;
  const finalNode = turn?.nodes.find((n) => n.role === 'final') ?? null;
  const passthroughNode = turn?.nodes.find((n) => n.role === 'passthrough') ?? null;

  return (
    <PageShell
      title={t.pipeline.title}
      subtitle={t.pipeline.subtitle}
      actions={
        <div style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
          <TurnSelect
            value={selectedGwId}
            recent={recent}
            recentError={recentError}
            onChange={setSelectedGwId}
            placeholder={t.pipeline.selectTurnPlaceholder}
            label={t.pipeline.selectTurn}
          />
          <SpeedToggle value={speed} onChange={setSpeed} />
          {turn && (
            <Button variant="primary" onClick={() => setRunId((n) => n + 1)}>
              ▶ {t.pipeline.replay}
            </Button>
          )}
        </div>
      }
    >
      {loading && <Card><span style={{ color: color.textSecondary }}>{t.pipeline.loading}</span></Card>}
      {!loading && !selectedGwId && recent.length === 0 && (
        <EmptyState
          title={t.pipeline.noTurns}
          hint={t.pipeline.emptyHint}
        />
      )}
      {loadError && <Card><span style={{ color: color.negative }}>{t.pipeline.loadError}: {loadError}</span></Card>}
      {turn && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: space.sm }}>
            <div style={{ fontSize: font.size.sm, color: color.textSecondary }}>
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>{turn.gwId.slice(0, 8)}</code> · {(elapsed / 1000).toFixed(2)}s
              {turn.compressedFromMs != null && (
                <span style={{ marginLeft: space.sm, color: color.textMuted, fontSize: font.size.xs }}>
                  · {t.pipeline.compressedNote} {(turn.compressedFromMs / 1000).toFixed(1)}s → {(TIMELINE_CAP_MS / 1000).toFixed(0)}s
                </span>
              )}
            </div>
            <ProgressBar pct={totalMs > 0 ? Math.min(1, elapsed / totalMs) : 0} />
          </div>
          {passthroughNode ? (
            <PassthroughFlow
              node={passthroughNode}
              statusOf={statusOf}
              passthroughLabel={t.pipeline.passthroughNote}
            />
          ) : (
            <FanoutFlow
              userNode={userNode}
              advisors={advisors}
              assemblyNode={assemblyNode}
              aggregatorNode={aggregatorNode}
              finalNode={finalNode}
              statusOf={statusOf}
              onOpenDiff={() => setShowDiff(true)}
            />
          )}
        </Card>
      )}
      {showDiff && turn && aggregatorNode && (
        <DiffModal
          turn={turn}
          aggregatorNode={aggregatorNode}
          onClose={() => setShowDiff(false)}
        />
      )}
    </PageShell>
  );
}

function buildTurnData(gwId: string, traces: TraceRequestFull[]): TurnData {
  const sorted = [...traces].sort((a, b) => a.started_at - b.started_at);
  const advisors = sorted.filter((r) => r.role === 'advisor');
  const aggregator = sorted.find((r) => r.role === 'aggregator') ?? null;
  const passthrough = sorted.find((r) => r.role === 'passthrough') ?? null;

  if (passthrough && !aggregator) {
    const compressed = compressTimeline(
      [{ id: 'passthrough', started_at: passthrough.started_at, finished_at: passthrough.finished_at }],
    );
    const only = compressed.nodes[0];
    return {
      gwId,
      nodes: [{
        id: 'passthrough',
        role: 'passthrough',
        startMs: only.startMs,
        endMs: only.endMs,
        model: passthrough.selected_model,
        tokens: passthrough.usage.output_tokens,
        latencyMs: passthrough.duration_ms,
        costUsd: passthrough.pricing ? costOf(passthrough) : null,
        raw: passthrough,
      }],
      totalMs: compressed.totalMs,
      compressedFromMs: compressed.compressedFromMs,
      aggregator: null,
      passthrough,
    };
  }

  if (!aggregator) {
    return { gwId, nodes: [], totalMs: 0, compressedFromMs: null, aggregator: null, passthrough: null };
  }

  const t0 = Math.min(...sorted.map((r) => r.started_at));
  const userStart = t0 - 200;
  const userEnd = t0;
  const finalStart = aggregator.finished_at + 50;
  const finalEnd = aggregator.finished_at + 250;

  const spans = [
    { id: 'user', started_at: userStart, finished_at: userEnd },
    ...advisors.map((a, i) => ({
      id: `advisor${i}`,
      started_at: a.started_at,
      finished_at: a.finished_at,
    })),
    ...(advisors.length > 0
      ? [{
          id: 'assembly',
          started_at: Math.max(...advisors.map((a) => a.finished_at)),
          finished_at: aggregator.started_at,
        }]
      : []),
    { id: 'aggregator', started_at: aggregator.started_at, finished_at: aggregator.finished_at },
    { id: 'final', started_at: finalStart, finished_at: finalEnd },
  ];
  const compressed = compressTimeline(spans);
  const byId = new Map(compressed.nodes.map((n) => [n.id, n]));

  const nodes: ViewNode[] = [];
  const user = byId.get('user');
  if (user) nodes.push({ id: 'user', role: 'user', startMs: user.startMs, endMs: user.endMs });

  advisors.forEach((a, i) => {
    const n = byId.get(`advisor${i}`);
    if (!n) return;
    nodes.push({
      id: `advisor${i}`,
      role: 'advisor',
      startMs: n.startMs,
      endMs: n.endMs,
      slot: String.fromCharCode(65 + i),
      model: a.selected_model,
      tokens: a.usage.output_tokens,
      latencyMs: a.duration_ms,
      costUsd: a.pricing ? costOf(a) : null,
      cacheHit: a.cache_hit,
      preview: previewOf(a),
      raw: a,
    });
  });
  const assembly = byId.get('assembly');
  if (assembly) {
    nodes.push({ id: 'assembly', role: 'assembly', startMs: assembly.startMs, endMs: assembly.endMs });
  }
  const agg = byId.get('aggregator');
  if (agg) {
    nodes.push({
      id: 'aggregator',
      role: 'aggregator',
      startMs: agg.startMs,
      endMs: agg.endMs,
      model: aggregator.selected_model,
      tokens: aggregator.usage.output_tokens,
      latencyMs: aggregator.duration_ms,
      costUsd: aggregator.pricing ? costOf(aggregator) : null,
      preview: previewOf(aggregator),
      raw: aggregator,
    });
  }
  const finalN = byId.get('final');
  if (finalN) {
    nodes.push({ id: 'final', role: 'final', startMs: finalN.startMs, endMs: finalN.endMs });
  }

  return {
    gwId,
    nodes,
    totalMs: compressed.totalMs,
    compressedFromMs: compressed.compressedFromMs,
    aggregator,
    passthrough: null,
  };
}

function costOf(t: TraceRequestFull): number {
  const p = t.pricing;
  if (!p) return 0;
  const inp = (t.usage.input_tokens / 1_000_000) * p.input_per_million;
  const out = (t.usage.output_tokens / 1_000_000) * p.output_per_million;
  return inp + out;
}

function previewOf(t: TraceRequestFull): string {
  if (t.response_summary?.stop_reason) return `stop_reason=${t.response_summary.stop_reason}`;
  return `${t.usage.output_tokens} tok · ${t.duration_ms}ms`;
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ width: 160, height: 4, background: color.gridLine, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: color.mom, transition: 'width 60ms linear' }} />
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <Card>
      <div style={{ padding: space.xl, textAlign: 'center' }}>
        <div style={{ fontSize: font.size.md, color: color.textPrimary, marginBottom: space.sm }}>{title}</div>
        <div style={{ fontSize: font.size.sm, color: color.textSecondary }}>{hint}</div>
      </div>
    </Card>
  );
}

function TurnSelect({
  value, recent, recentError, onChange, placeholder, label,
}: {
  value: string | null;
  recent: TraceSummary[];
  recentError: string | null;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  if (recentError) {
    return <span style={{ fontSize: font.size.xs, color: color.negative }}>{recentError}</span>;
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
          fontFamily: 'ui-monospace, monospace', cursor: 'pointer', minWidth: 220,
        }}
      >
        <option value="" disabled>{placeholder}</option>
        {recent.map((r) => (
          <option key={r.request_id} value={r.gateway_request_id}>
            {new Date(r.started_at).toLocaleTimeString()} · {r.gateway_request_id.slice(0, 8)} · {r.selected_model}
          </option>
        ))}
      </select>
    </label>
  );
}

function SpeedToggle({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: font.size.sm, color: color.textSecondary }}>
      <span>{t.pipeline.speed}</span>
      <div style={{ display: 'inline-flex', background: color.bgSubtle, borderRadius: 8, padding: 3 }}>
        {[0.5, 1, 2].map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            style={{
              appearance: 'none', border: 'none',
              background: value === s ? color.surface : 'transparent',
              padding: '6px 14px', fontSize: font.size.sm, borderRadius: 6, cursor: 'pointer',
              color: value === s ? color.textPrimary : color.textMuted,
              fontWeight: value === s ? font.weight.medium : font.weight.regular,
              boxShadow: value === s ? shadow.card : 'none',
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
  mom:      { bg: color.momSoft,  border: color.mom,          fg: color.mom },
  neutral:  { bg: color.bgSubtle, border: color.borderStrong, fg: color.textPrimary },
  positive: { bg: '#DFF0E6',      border: color.positive,     fg: color.positive },
};

function StatusPill({ status }: { status: NodeStatus }) {
  const { t } = useI18n();
  if (status === 'pending') return <Badge tone="neutral">{t.pipeline.status.pending}</Badge>;
  if (status === 'running') return <Badge tone="mom">● {t.pipeline.status.running}</Badge>;
  return <Badge tone="positive">✓ {t.pipeline.status.done}</Badge>;
}

function FlowNode({
  status, label, sub, tone, rightSlot,
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
    <div style={{
      background: isPending ? color.surface : c.bg,
      border: `1.5px solid ${isPending ? color.border : c.border}`,
      borderRadius: radius.md,
      padding: `${space.md} ${space.lg}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      opacity: isPending ? 0.4 : 1, transition: 'all 260ms ease', gap: space.md,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: font.size.xs, color: c.fg, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: font.weight.semibold }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: font.size.sm, color: color.textSecondary, lineHeight: 1.5, wordBreak: 'break-word' }}>{sub}</div>}
      </div>
      {rightSlot}
      <StatusPill status={status} />
    </div>
  );
}

function AdvisorCard({ status, node }: { status: NodeStatus; node: ViewNode }) {
  const { t, lang } = useI18n();
  const isPending = status === 'pending';
  const isRunning = status === 'running';
  return (
    <div style={{
      background: isPending ? color.surface : color.bgSubtle,
      border: `1.5px solid ${isPending ? color.border : status === 'done' ? color.positive : color.mom}`,
      borderRadius: radius.md, padding: space.md,
      opacity: isPending ? 0.5 : 1, transition: 'all 260ms ease',
      display: 'flex', flexDirection: 'column', gap: space.sm, minHeight: 160,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm }}>
          <span style={{ fontSize: font.size.xs, color: color.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: font.weight.medium }}>
            Advisor {node.slot}
          </span>
          {node.cacheHit && <Badge tone="info">{t.pipeline.cacheHit}</Badge>}
        </div>
        <StatusPill status={status} />
      </div>
      <code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted, fontSize: font.size.xxs }}>{node.model}</code>
      <div style={{
        fontSize: font.size.sm, color: color.textPrimary, lineHeight: 1.55,
        background: isPending ? 'transparent' : color.surface,
        border: `1px solid ${color.border}`, borderRadius: 6,
        padding: space.sm, minHeight: 80,
      }}>
        {isPending ? <span style={{ color: color.textMuted }}>…</span> : node.preview ?? '—'}
        {isRunning && <span style={{ display: 'inline-block', width: 8, height: 16, background: color.mom, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 1s steps(1) infinite' }} />}
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: font.size.xxs, color: color.textSecondary, fontFamily: 'ui-monospace, monospace' }}>
        <span>⏱ {formatLatency(node.latencyMs ?? 0, lang)}</span>
        <span>· {node.tokens ?? 0}t</span>
        <span>· {formatCost(node.costUsd ?? 0, lang)}</span>
      </div>
    </div>
  );
}

function FlowArrows({ fanOut, fanIn }: { fanOut?: boolean; fanIn?: boolean } = {}) {
  if (fanOut || fanIn) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', height: 32 }}>
        <svg width="600" height="32" viewBox="0 0 600 32" preserveAspectRatio="none" style={{ maxWidth: '100%' }}>
          {fanOut && (
            <>
              <path d="M 300 0 L 100 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
              <path d="M 300 0 L 300 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
              <path d="M 300 0 L 500 32" stroke={color.mom} strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
            </>
          )}
          {fanIn && (
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
    <div style={{ display: 'flex', justifyContent: 'center', height: 20 }}>
      <div style={{ width: 1.5, height: '100%', background: color.mom, opacity: 0.5 }} />
    </div>
  );
}

function FanoutFlow({
  userNode, advisors, assemblyNode, aggregatorNode, finalNode, statusOf, onOpenDiff,
}: {
  userNode: ViewNode | null;
  advisors: ViewNode[];
  assemblyNode: ViewNode | null;
  aggregatorNode: ViewNode | null;
  finalNode: ViewNode | null;
  statusOf: (id: string) => NodeStatus;
  onOpenDiff: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: space.lg, padding: `${space.md} 0` }}>
      {userNode && (
        <FlowNode status={statusOf(userNode.id)} label={t.pipeline.stage.user} tone="mom" />
      )}
      <FlowArrows fanOut />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(advisors.length, 1)}, minmax(0, 1fr))`, gap: space.md }}>
        {advisors.map((a) => (
          <AdvisorCard key={a.id} status={statusOf(a.id)} node={a} />
        ))}
      </div>
      <FlowArrows fanIn />
      {assemblyNode && (
        <FlowNode
          status={statusOf(assemblyNode.id)}
          label={t.pipeline.stage.assembly}
          sub={t.pipeline.stage.assemblyDetail}
          tone="neutral"
          rightSlot={<Button variant="ghost" onClick={onOpenDiff}>{t.pipeline.diffButton} →</Button>}
        />
      )}
      <FlowArrows />
      {aggregatorNode && (
        <FlowNode
          status={statusOf(aggregatorNode.id)}
          label={t.pipeline.stage.aggregator}
          sub={<span><code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted }}>{aggregatorNode.model}</code> · ⏱ {formatLatency(aggregatorNode.latencyMs ?? 0, lang)} · {aggregatorNode.tokens ?? 0}t · {formatCost(aggregatorNode.costUsd ?? 0, lang)}</span>}
          tone="mom"
        />
      )}
      <FlowArrows />
      {finalNode && (
        <FlowNode status={statusOf(finalNode.id)} label={t.pipeline.stage.final} tone="positive" />
      )}
    </div>
  );
}

function PassthroughFlow({
  node, statusOf, passthroughLabel,
}: {
  node: ViewNode;
  statusOf: (id: string) => NodeStatus;
  passthroughLabel: string;
}) {
  const { t, lang } = useI18n();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, padding: `${space.md} 0` }}>
      <div style={{ padding: space.sm, background: color.bgSubtle, borderRadius: radius.sm, fontSize: font.size.xs, color: color.textSecondary }}>
        {passthroughLabel}
      </div>
      <FlowNode
        status={statusOf(node.id)}
        label={t.pipeline.stage.aggregator}
        sub={<span><code style={{ fontFamily: 'ui-monospace, monospace', color: color.textMuted }}>{node.model}</code> · ⏱ {formatLatency(node.latencyMs ?? 0, lang)} · {node.tokens ?? 0}t · {formatCost(node.costUsd ?? 0, lang)}</span>}
        tone="neutral"
      />
    </div>
  );
}

function DiffModal({
  turn, aggregatorNode, onClose,
}: {
  turn: TurnData;
  aggregatorNode: ViewNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const advisorTraces = turn.nodes.filter((n) => n.role === 'advisor');
  const aggregatorRaw = aggregatorNode.raw;
  const beforeText = aggregatorRaw
    ? JSON.stringify({ message_count: aggregatorRaw.request_summary.message_count, max_tokens: aggregatorRaw.request_summary.max_tokens, tool_use_count: aggregatorRaw.request_summary.tool_use_count }, null, 2)
    : '—';
  const afterText = advisorTraces.map((a) => `<ref id="${a.slot}" model="${a.model}">${a.preview ?? ''}</ref>`).join('\n');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(20, 26, 46, 0.32)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40,
    }}>
      <div style={{
        background: color.surface, borderRadius: radius.lg, maxWidth: 1100, width: '100%', maxHeight: '85vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(20, 26, 46, 0.28)',
        display: 'flex', flexDirection: 'column',
      }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: space.lg, borderBottom: `1px solid ${color.border}` }}>
          <div>
            <h3 style={{ margin: 0, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>{t.pipeline.diffTitle}</h3>
            <p style={{ margin: '4px 0 0', fontSize: font.size.sm, color: color.textSecondary }}>{t.pipeline.diffSubtitle}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>× {t.pipeline.close}</Button>
        </header>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: color.border, flex: 1 }}>
          <DiffColumn title={t.pipeline.diffBefore} content={beforeText} tone="neutral" />
          <DiffColumn title={t.pipeline.diffAfter}  content={afterText}  tone="mom" />
        </div>
      </div>
    </div>
  );
}

function DiffColumn({ title, content, tone }: { title: string; content: string; tone: 'neutral' | 'mom' }) {
  const bg = tone === 'mom' ? color.momSoft : color.bgSubtle;
  return (
    <div style={{ background: color.surface, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: `${space.sm} ${space.lg}`, background: bg, fontSize: font.size.xs, color: color.textSecondary, fontWeight: font.weight.medium, letterSpacing: '0.03em' }}>
        {title}
      </div>
      <pre style={{
        margin: 0, padding: space.lg, fontSize: font.size.xs, fontFamily: 'ui-monospace, monospace',
        color: color.textPrimary, lineHeight: 1.55, overflow: 'auto', whiteSpace: 'pre-wrap',
      }}>
        {content}
      </pre>
    </div>
  );
}
