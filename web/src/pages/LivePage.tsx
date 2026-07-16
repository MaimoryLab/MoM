// Live Compare — single-page workflow.
//
// Two rendering modes driven by whether there's a run to show:
//   - Empty state (no current run, not polling): center the composer + preset
//     picker in the main content area, no comparison cards at all.
//   - With a run: show the status strip, MoM / Baseline / Judge / Cost cards
//     and the pipeline jump; hide the composer entirely.
// The top-right RunSelect (history + "+ New run") is always visible so the
// user can escape either state at any time. "+ New run" calls live.reset()
// and drops back to the empty state.

import { useEffect, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Button } from '../components/primitives/Button';
import { useI18n } from '../i18n/context';
import { color, font, space } from '../theme';
import { useLiveJob } from '../hooks/useLiveRun';
import { useKiosk } from '../hooks/useKioskMode';
import { navigateTo } from '../App';
import {
  deleteComparison, getPresets, listComparisons,
  type ComparisonListItem, type PresetEntry,
} from '../lib/api';
import {
  BaselineColumn, Composer, CostCard, JudgeCard, MomColumn,
  PresetsList, RunSelect, StatusStrip,
} from './live-shared';

export function LivePage() {
  const { t, lang } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ComparisonListItem[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsBumpKey, setJobsBumpKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const live = useLiveJob();
  const kiosk = useKiosk();

  // Kiosk mode drives which run is displayed — swap the visible snapshot to
  // match kiosk.currentGwId whenever it changes while auto-playing.
  useEffect(() => {
    if (!kiosk.enabled) return;
    if (!kiosk.currentGwId) return;
    if (live.current?.gateway_request_id === kiosk.currentGwId) return;
    live.select(kiosk.currentGwId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kiosk.enabled, kiosk.currentGwId]);

  useEffect(() => {
    let cancelled = false;
    getPresets()
      .then((res) => { if (!cancelled) setPresets(res.presets); })
      .catch((err) => { if (!cancelled) setPresetsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  // Only refetch history when a run *finishes* or the user selects a different
  // gateway_request_id — intermediate polling ticks don't change list contents
  // and would just cause the dropdown to redraw every 3 s.
  const historyKey = live.current
    ? `${live.current.gateway_request_id}:${live.current.status === 'judge_done' || live.current.status === 'error' ? live.current.status : 'active'}`
    : null;
  useEffect(() => {
    let cancelled = false;
    listComparisons(20)
      .then((res) => { if (!cancelled) setJobs(res.items); })
      .catch((err) => { if (!cancelled) setJobsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [historyKey, jobsBumpKey]);

  const current = live.current;
  const currentGw = current?.gateway_request_id ?? null;
  const busy = live.polling;

  const handleDelete = async () => {
    if (!currentGw || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteComparison(currentGw);
      live.reset();
      setJobsBumpKey((k) => k + 1);
      if (kiosk.enabled) await kiosk.invalidateQueue(currentGw);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const submit = (text: string) => {
    const p = text.trim();
    if (!p || busy) return;
    live.submit({ prompt: p, baseline_on: true, lang });
    setPrompt('');
  };
  const onPreset = (preset: PresetEntry) => {
    submit(lang === 'zh' ? preset.zh : preset.en);
  };

  // Empty state = no run displayed and none in flight.
  const isEmpty = current == null && !busy;

  return (
    <PageShell
      title={t.nav.live}
      subtitle={lang === 'zh'
        ? 'MoM 输出 vs Baseline 输出'
        : 'MoM output vs Baseline output'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, minHeight: 640 }}>
        {!kiosk.enabled && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
              <RunSelect
                value={currentGw}
                items={jobs}
                error={jobsError}
                onChange={(gw) => live.select(gw)}
                label={t.live.recentRunsLabel}
                placeholder={t.live.recentRunsPlaceholder}
                emptyLabel={t.live.recentRunsEmpty}
                onNew={{ label: t.live.newRun, onClick: () => live.reset(), variant: 'primary' }}
              />
            </div>
            <hr style={{ border: 0, borderTop: `1px solid ${color.border}`, margin: 0 }} />
          </>
        )}
        {kiosk.enabled ? (
          <KioskResultView snap={current} />
        ) : isEmpty ? (
          <EmptyState
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={() => submit(prompt)}
            busy={busy}
            presets={presets}
            presetsError={presetsError}
            onPreset={onPreset}
          />
        ) : (
          <ResultView
            snap={current}
            polling={live.polling}
            transportError={live.transportError}
            onDelete={handleDelete}
            deleting={deleting}
            deleteError={deleteError}
          />
        )}
      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({
  prompt, onPromptChange, onSubmit, busy, presets, presetsError, onPreset,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  presets: PresetEntry[];
  presetsError: string | null;
  onPreset: (p: PresetEntry) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.lg,
      padding: `${space.xl} 0`,
      minHeight: 560,
    }}>
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: space.lg }}>
        <div style={{ textAlign: 'center', color: color.textSecondary, fontSize: font.size.md, letterSpacing: '-0.005em' }}>
          {t.live.emptyResult}
        </div>
        <Composer
          prompt={prompt}
          onPromptChange={onPromptChange}
          onSubmit={onSubmit}
          busy={busy}
        />
        <PresetsList
          presets={presets}
          presetsError={presetsError}
          onPreset={onPreset}
          busy={busy}
        />
      </div>
    </div>
  );
}

function ResultView({
  snap, polling, transportError, onDelete, deleting, deleteError,
}: {
  snap: ReturnType<typeof useLiveJob>['current'];
  polling: boolean;
  transportError: string | null;
  onDelete?: () => void | Promise<void>;
  deleting?: boolean;
  deleteError?: string | null;
}) {
  const { t } = useI18n();
  return (
    <>
      <StatusStrip
        live={snap}
        polling={polling}
        transportError={transportError}
        onDelete={onDelete}
        deleting={deleting}
        deleteError={deleteError}
      />
      <hr style={{ border: 0, borderTop: `1px solid ${color.border}`, margin: 0 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space.md }}>
        <MomColumn snap={snap} />
        <BaselineColumn snap={snap} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.md }}>
        <JudgeCard snap={snap} />
        <CostCard snap={snap} />
      </div>
      {snap && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space.sm }}>
          <KioskStartButton />
          <Button variant="secondary" onClick={() => navigateTo('pipeline', snap.gateway_request_id)}>
            {t.live.viewPipeline} →
          </Button>
        </div>
      )}
    </>
  );
}

function KioskStartButton() {
  const { t } = useI18n();
  const kiosk = useKiosk();
  if (kiosk.enabled) return null;
  return (
    <Button
      variant="ghost"
      data-kiosk-control="true"
      onClick={() => kiosk.start()}
    >
      ▶ {t.kiosk.liveStartLabel}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// KioskResultView — the auto-play version of ResultView. Cards fade in one
// after another driven by kiosk.liveStep; MoM/Baseline text runs a typewriter
// during the `answers` step and freezes after.
// ---------------------------------------------------------------------------

function KioskEnter({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  return (
    <div style={{ animation: `kioskEnterUp 500ms ease-out ${delay}ms both` }}>
      {children}
    </div>
  );
}

function KioskResultView({ snap }: { snap: ReturnType<typeof useLiveJob>['current'] }) {
  const kiosk = useKiosk();
  const { t } = useI18n();
  const step = kiosk.liveStep;
  const showAnswers = step === 'answers' || step === 'answers-hold' || step === 'judge' || step === 'cost' || step === 'done';
  const typing = step === 'answers';
  const showJudge = step === 'judge' || step === 'cost' || step === 'done';
  const showCost = step === 'cost' || step === 'done';

  // Snap not yet fetched for the current gwId — the live.select() call is
  // still in flight. Show a plain "loading" strip instead of falling through
  // to the compose/preset empty state (which reads as a "new chat" screen
  // and confuses booth visitors).
  if (!snap) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 400, color: color.textMuted, fontSize: font.size.sm,
      }}>
        {t.pipeline.loading}
      </div>
    );
  }

  return (
    <>
      <KioskEnter>
        <StatusStrip live={snap} polling={false} transportError={null} />
      </KioskEnter>
      <hr style={{ border: 0, borderTop: `1px solid ${color.border}`, margin: 0 }} />
      {showAnswers && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space.md }}>
          <KioskEnter>
            <MomColumn snap={snap} typewriter={typing} cursorOn={typing} />
          </KioskEnter>
          <KioskEnter>
            <BaselineColumn snap={snap} typewriter={typing} cursorOn={typing} />
          </KioskEnter>
        </div>
      )}
      {(showJudge || showCost) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.md }}>
          {showJudge && (
            <KioskEnter>
              <JudgeCard snap={snap} />
            </KioskEnter>
          )}
          {showCost && (
            <KioskEnter>
              <CostCard snap={snap} />
            </KioskEnter>
          )}
        </div>
      )}
    </>
  );
}
