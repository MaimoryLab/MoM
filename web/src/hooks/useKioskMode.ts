// Kiosk / exhibition auto-play mode.
//
// Cycles Overview → Live(gwId) → Pipeline(gwId) → Overview → next gwId. Live
// page's sub-animation (prompt card in → MoM/Baseline cards in → typewriter →
// judge card in → cost card in → hold) is driven by `liveStep`, so LivePage
// can react to it without owning the timer itself.
//
// Any user pointer/key press cancels kiosk mode — the sign that a human has
// walked up and wants to drive. Hash navigation the user does themselves also
// cancels, but hash changes we initiate (via kioskNavigate) don't; a short
// grace window flags "the next hash change is mine".

import {
  createContext, createElement, useCallback, useContext, useEffect,
  useMemo, useRef, useState, type ReactNode,
} from 'react';
import { listComparisons, listTraces } from '../lib/api';
import { navigateTo } from '../App';

export type KioskPhase = 'overview' | 'live' | 'pipeline';

// Sub-steps inside the Live phase. LivePage renders cards conditionally on
// this so the fade-in choreography stays declarative.
export type KioskLiveStep =
  | 'prompt'        // just the user-prompt card
  | 'answers'       // + MoM/Baseline cards, text typewriter running
  | 'answers-hold'  // typewriter done, hold before judge
  | 'judge'         // + judge radar card
  | 'cost'          // + cost card, hold before pipeline
  | 'done';         // about to switch to pipeline

// Wall-clock timings. Kept in one place so the exhibition operator can tune
// them without hunting through components.
export const KIOSK_TIMING = {
  overviewHoldMs: 5000,
  livePromptMs: 800,
  liveAnswersMaxMs: 30000, // upper bound; usually finishes earlier via onDone
  liveAnswersHoldMs: 2500,
  liveJudgeMs: 2500,
  liveCostMs: 2800,
  pipelinePlayMs: 25000,
} as const;

interface KioskContextValue {
  enabled: boolean;
  phase: KioskPhase;
  liveStep: KioskLiveStep;
  currentGwId: string | null;
  queueLength: number;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  // OutputCard calls this when its typewriter finishes. When BOTH MoM and
  // Baseline have reported done we advance to the next Live sub-step early.
  notifyLiveAnswerDone: () => void;
  // LivePage calls this after a run is deleted so the auto-play queue never
  // lands on a 404'd id. If the deleted id is currently playing, the current
  // phase is restarted against the next queue entry.
  invalidateQueue: (deletedGwId: string) => Promise<void>;
}

const NULL_CTX: KioskContextValue = {
  enabled: false,
  phase: 'overview',
  liveStep: 'prompt',
  currentGwId: null,
  queueLength: 0,
  start: () => {},
  stop: () => {},
  toggle: () => {},
  notifyLiveAnswerDone: () => {},
  invalidateQueue: async () => {},
};

const KioskContext = createContext<KioskContextValue>(NULL_CTX);

// Helper: build the play queue. Prefer runs present in BOTH Live comparison
// history and Pipeline aggregator traces (both pages will have something to
// show); otherwise fall back to Live-only so the exhibition doesn't stall on
// an empty Pipeline page. Kiosk button no longer silently fails when only
// one endpoint has data.
export interface KioskQueueEntry {
  gwId: string;
  hasLive: boolean;
  hasPipeline: boolean;
}

async function fetchQueueDetailed(): Promise<KioskQueueEntry[]> {
  // Prefer runs present on BOTH sides so the loop shows a full Live +
  // Pipeline pair each cycle. If none exist, fall back to whichever singles
  // ARE available — each phase's run* code skips its side if hasLive/
  // hasPipeline is false, so an Overview-only loop is a fallback of last
  // resort (empty queue).
  const [comps, traces] = await Promise.all([
    listComparisons(20).catch(() => ({ items: [] as { gateway_request_id: string }[] })),
    listTraces({ limit: 20, role: 'aggregator' }).catch(() => ({ items: [] as { gateway_request_id: string }[] })),
  ]);
  const liveOrder = comps.items.map((c) => c.gateway_request_id);
  const traceOrder = traces.items.map((t) => t.gateway_request_id);
  const liveSet = new Set(liveOrder);
  const traceSet = new Set(traceOrder);

  const both = liveOrder
    .filter((id) => traceSet.has(id))
    .map((gwId) => ({ gwId, hasLive: true, hasPipeline: true }));

  let entries: KioskQueueEntry[];
  if (both.length > 0) {
    entries = both;
  } else {
    // Fallback: any run from either side, tag with actual availability.
    const seen = new Set<string>();
    entries = [];
    for (const id of liveOrder) {
      if (!seen.has(id)) {
        seen.add(id);
        entries.push({ gwId: id, hasLive: true, hasPipeline: traceSet.has(id) });
      }
    }
    for (const id of traceOrder) {
      if (!seen.has(id)) {
        seen.add(id);
        entries.push({ gwId: id, hasLive: liveSet.has(id), hasPipeline: true });
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log('[kiosk] fetchQueue', {
    live: liveOrder.length, pipeline: traceOrder.length,
    both: both.length, queue: entries.length,
  });
  return entries;
}

export function KioskProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<KioskPhase>('overview');
  const [liveStep, setLiveStep] = useState<KioskLiveStep>('prompt');
  const [currentGwId, setCurrentGwId] = useState<string | null>(null);
  const [queueLength, setQueueLength] = useState(0);

  // Refs so timer callbacks always see fresh values.
  const queueRef = useRef<KioskQueueEntry[]>([]);
  const queueIdxRef = useRef(0);
  const enabledRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  // Tracks the currently-active phase so invalidateQueue can restart it
  // against the new queue after a deletion. Mirrors setPhase() calls.
  const phaseRef = useRef<KioskPhase>('overview');
  // Marks a short window during which the next hashchange is one we caused
  // (via kioskNavigate). Anything else means the user tapped a nav pill.
  const selfNavRef = useRef(false);

  // Answer-typewriter done counter — both MoM and Baseline call
  // notifyLiveAnswerDone when their typewriter finishes; when we've had 2
  // and we're still in the `answers` sub-step, jump forward.
  const answerDoneCountRef = useRef(0);
  const onAnswersCompleteRef = useRef<(() => void) | null>(null);
  const notifyLiveAnswerDone = useCallback(() => {
    answerDoneCountRef.current += 1;
    if (answerDoneCountRef.current >= 2 && onAnswersCompleteRef.current) {
      const cb = onAnswersCompleteRef.current;
      onAnswersCompleteRef.current = null;
      cb();
    }
  }, []);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearTimer();
    enabledRef.current = false;
    setEnabled(false);
  }, []);

  const kioskNavigate = (page: 'overview' | 'live' | 'pipeline', turn?: string | null) => {
    selfNavRef.current = true;
    navigateTo(page, turn ?? null);
    window.setTimeout(() => { selfNavRef.current = false; }, 500);
  };

  // Schedule `fn` after `ms`, unless kiosk got stopped in the meantime.
  const later = (ms: number, fn: () => void, tag?: string) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!enabledRef.current) return;
      if (tag) {
        // eslint-disable-next-line no-console
        console.log('[kiosk]', tag);
      }
      fn();
    }, ms);
  };

  // ---- Phase machine — plain functions, all read via refs ----------------

  const currentEntry = () => {
    const q = queueRef.current;
    if (q.length === 0) return null;
    return q[queueIdxRef.current % q.length];
  };

  const advanceQueue = () => {
    if (queueRef.current.length > 0) {
      queueIdxRef.current = (queueIdxRef.current + 1) % queueRef.current.length;
    }
  };

  const runPipeline = () => {
    const entry = currentEntry();
    if (!entry || !entry.hasPipeline) {
      // Nothing to show on Pipeline for this gwId — skip straight to next.
      advanceQueue();
      later(500, () => runOverview(), 'pipeline-skip→overview');
      return;
    }
    setCurrentGwId(entry.gwId);
    phaseRef.current = 'pipeline';
    setPhase('pipeline');
    kioskNavigate('pipeline', entry.gwId);
    later(KIOSK_TIMING.pipelinePlayMs, () => {
      advanceQueue();
      runOverview();
    }, 'pipeline→overview');
  };

  const runLive = () => {
    const entry = currentEntry();
    if (!entry) {
      // Empty queue — Overview-only loop.
      later(KIOSK_TIMING.overviewHoldMs, () => runOverview(), 'live-empty→overview');
      return;
    }
    if (!entry.hasLive) {
      // Skip Live for this gwId, go straight to Pipeline if it has one.
      runPipeline();
      return;
    }
    setCurrentGwId(entry.gwId);
    phaseRef.current = 'live';
    setPhase('live');
    setLiveStep('prompt');
    kioskNavigate('live');

    const afterAnswers = () => {
      setLiveStep('answers-hold');
      later(KIOSK_TIMING.liveAnswersHoldMs, () => {
        setLiveStep('judge');
        later(KIOSK_TIMING.liveJudgeMs, () => {
          setLiveStep('cost');
          later(KIOSK_TIMING.liveCostMs, () => {
            setLiveStep('done');
            runPipeline();
          }, 'cost→pipeline');
        }, 'judge→cost');
      }, 'answers-hold→judge');
    };

    later(KIOSK_TIMING.livePromptMs, () => {
      // Reset done counter, wire callback, flip to answers. When both
      // typewriters finish, notifyLiveAnswerDone fires afterAnswers early;
      // otherwise the maxMs fallback ticks in.
      answerDoneCountRef.current = 0;
      let fired = false;
      const wrapped = () => {
        if (fired) return;
        fired = true;
        onAnswersCompleteRef.current = null;
        afterAnswers();
      };
      onAnswersCompleteRef.current = wrapped;
      setLiveStep('answers');
      later(KIOSK_TIMING.liveAnswersMaxMs, wrapped, 'answers→hold(maxfallback)');
    }, 'prompt→answers');
  };

  const runOverview = () => {
    phaseRef.current = 'overview';
    setPhase('overview');
    kioskNavigate('overview');
    later(KIOSK_TIMING.overviewHoldMs, () => runLive(), 'overview→live');
  };

  const start = useCallback(async () => {
    if (enabledRef.current) return;
    // Optimistically flip enabled ON so the toggle button shows immediate
    // feedback while we fetch the queue. If fetch fails or returns empty,
    // we still run — just an Overview-only loop.
    enabledRef.current = true;
    setEnabled(true);
    let q: KioskQueueEntry[] = [];
    try { q = await fetchQueueDetailed(); } catch { /* keep q = [] */ }
    if (!enabledRef.current) return; // user hit stop before fetch resolved
    queueRef.current = q;
    queueIdxRef.current = 0;
    setQueueLength(q.length);
    runOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    if (enabledRef.current) stop(); else start();
  }, [start, stop]);

  const invalidateQueue = useCallback(async (deletedGwId: string) => {
    // Cheap path: not running kiosk. Nothing to fix — LivePage's own refetch
    // covers the RunSelect dropdown.
    if (!enabledRef.current) return;

    const idx = queueRef.current.findIndex((e) => e.gwId === deletedGwId);
    if (idx === -1) return;

    const wasCurrent = idx === (queueIdxRef.current % Math.max(1, queueRef.current.length));

    if (wasCurrent) {
      // Deleting the run being shown right now — kill the pending phase
      // timer, refresh queue, and restart the same phase against the new
      // head of the queue.
      clearTimer();
      let q: KioskQueueEntry[] = [];
      try { q = await fetchQueueDetailed(); } catch { /* keep q = [] */ }
      if (!enabledRef.current) return;
      queueRef.current = q;
      queueIdxRef.current = 0;
      setQueueLength(q.length);
      const phase = phaseRef.current;
      if (phase === 'live') runLive();
      else if (phase === 'pipeline') runPipeline();
      else runOverview();
      return;
    }

    // Deleted id is queued somewhere else. Splice it out; if it sat before
    // the current index, decrement so we don't skip the next entry.
    queueRef.current = queueRef.current.filter((e) => e.gwId !== deletedGwId);
    if (idx < queueIdxRef.current) queueIdxRef.current -= 1;
    if (queueRef.current.length === 0) queueIdxRef.current = 0;
    else queueIdxRef.current = queueIdxRef.current % queueRef.current.length;
    setQueueLength(queueRef.current.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Global stop signals -----------------------------------------------

  useEffect(() => {
    if (!enabled) return;

    const onPointer = (e: PointerEvent) => {
      // Clicks on our own toggle button shouldn't count as "user took over".
      const el = e.target as Element | null;
      if (el && el.closest && el.closest('[data-kiosk-control="true"]')) return;
      stop();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.length === 1 || e.key === 'Enter' || e.key === 'Tab') {
        stop();
      }
    };
    const onHash = () => {
      if (selfNavRef.current) return;
      stop();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };

    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, stop]);

  useEffect(() => () => clearTimer(), []);

  const value = useMemo<KioskContextValue>(() => ({
    enabled,
    phase,
    liveStep,
    currentGwId,
    queueLength,
    start,
    stop,
    toggle,
    notifyLiveAnswerDone,
    invalidateQueue,
  }), [enabled, phase, liveStep, currentGwId, queueLength, start, stop, toggle, notifyLiveAnswerDone, invalidateQueue]);

  return createElement(KioskContext.Provider, { value }, children);
}

export function useKiosk(): KioskContextValue {
  return useContext(KioskContext);
}
