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
  overviewHoldMs: 12000,
  livePromptMs: 800,
  liveAnswersMs: 6500,     // typewriter budget for MoM/Baseline
  liveAnswersHoldMs: 2500,
  liveJudgeMs: 2500,
  liveCostMs: 2800,
  pipelinePlayMs: 14000,   // pipeline's own animation is ~10s; give a buffer
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
};

const KioskContext = createContext<KioskContextValue>(NULL_CTX);

// Helper: fetch the intersection of gwIds that appear in both Live comparison
// history AND Pipeline aggregator history — those are the runs where both
// pages have something to show.
async function fetchQueue(): Promise<string[]> {
  const [comps, traces] = await Promise.all([
    listComparisons(20).catch(() => ({ items: [] as { gateway_request_id: string }[] })),
    listTraces({ limit: 20, role: 'aggregator' }).catch(() => ({ items: [] as { gateway_request_id: string }[] })),
  ]);
  const traceSet = new Set(traces.items.map((t) => t.gateway_request_id));
  return comps.items
    .map((c) => c.gateway_request_id)
    .filter((id) => traceSet.has(id));
}

export function KioskProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<KioskPhase>('overview');
  const [liveStep, setLiveStep] = useState<KioskLiveStep>('prompt');
  const [currentGwId, setCurrentGwId] = useState<string | null>(null);
  const [queueLength, setQueueLength] = useState(0);

  // Refs so timer callbacks always see fresh values.
  const queueRef = useRef<string[]>([]);
  const queueIdxRef = useRef(0);
  const enabledRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  // Marks a short window during which the next hashchange is one we caused
  // (via kioskNavigate). Anything else means the user tapped a nav pill.
  const selfNavRef = useRef(false);

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
  const later = (ms: number, fn: () => void) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!enabledRef.current) return;
      fn();
    }, ms);
  };

  // ---- Phase machine — plain functions, all read via refs ----------------

  const runPipeline = () => {
    const gw = queueRef.current[queueIdxRef.current % Math.max(1, queueRef.current.length)] ?? null;
    setCurrentGwId(gw);
    setPhase('pipeline');
    kioskNavigate('pipeline', gw);
    later(KIOSK_TIMING.pipelinePlayMs, () => {
      if (queueRef.current.length > 0) {
        queueIdxRef.current = (queueIdxRef.current + 1) % queueRef.current.length;
      }
      runOverview();
    });
  };

  const runLive = () => {
    const gw = queueRef.current[queueIdxRef.current % Math.max(1, queueRef.current.length)] ?? null;
    setCurrentGwId(gw);
    setPhase('live');
    setLiveStep('prompt');
    kioskNavigate('live');
    later(KIOSK_TIMING.livePromptMs, () => {
      setLiveStep('answers');
      later(KIOSK_TIMING.liveAnswersMs, () => {
        setLiveStep('answers-hold');
        later(KIOSK_TIMING.liveAnswersHoldMs, () => {
          setLiveStep('judge');
          later(KIOSK_TIMING.liveJudgeMs, () => {
            setLiveStep('cost');
            later(KIOSK_TIMING.liveCostMs, () => {
              setLiveStep('done');
              runPipeline();
            });
          });
        });
      });
    });
  };

  const runOverview = () => {
    setPhase('overview');
    kioskNavigate('overview');
    later(KIOSK_TIMING.overviewHoldMs, () => runLive());
  };

  const start = useCallback(async () => {
    if (enabledRef.current) return;
    const q = await fetchQueue();
    if (q.length === 0) return;
    queueRef.current = q;
    queueIdxRef.current = 0;
    setQueueLength(q.length);
    enabledRef.current = true;
    setEnabled(true);
    // start next tick so React commits enabled=true before phase timers fire
    window.setTimeout(() => {
      if (!enabledRef.current) return;
      runOverview();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    if (enabledRef.current) stop(); else start();
  }, [start, stop]);

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
  }), [enabled, phase, liveStep, currentGwId, queueLength, start, stop, toggle]);

  return createElement(KioskContext.Provider, { value }, children);
}

export function useKiosk(): KioskContextValue {
  return useContext(KioskContext);
}
