import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ComparisonBaselineSnapshot,
  ComparisonMomSnapshot,
  ComparisonJudgeSnapshot,
  ComparisonStatus,
  LiveRunEvent,
  LiveRunRequest,
} from '../lib/api';
import { postLiveRun } from '../lib/api';

export interface UseLiveRunState {
  status: ComparisonStatus | 'idle';
  gatewayRequestId: string | null;
  momText: string;
  mom: ComparisonMomSnapshot | null;
  momError: string | null;
  baseline: ComparisonBaselineSnapshot | null;
  baselineError: string | null;
  judge: ComparisonJudgeSnapshot | null;
  judgeError: string | null;
  runError: string | null;
  running: boolean;
}

const INITIAL: UseLiveRunState = {
  status: 'idle',
  gatewayRequestId: null,
  momText: '',
  mom: null,
  momError: null,
  baseline: null,
  baselineError: null,
  judge: null,
  judgeError: null,
  runError: null,
  running: false,
};

export interface UseLiveRunReturn extends UseLiveRunState {
  run: (body: LiveRunRequest) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Drive one /api/live/run turn. State-machine over the 8 SSE event types;
 * incremental mom_delta accumulates onto `momText`; terminal events swap
 * status. Aborting via `cancel()` cancels the fetch and leaves partial state.
 */
export function useLiveRun(): UseLiveRunReturn {
  const [state, setState] = useState<UseLiveRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, running: false, status: 'error' }));
  }, []);

  const run = useCallback(async (body: LiveRunRequest): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL, running: true, status: 'pending' });

    try {
      for await (const evt of postLiveRun(body, controller.signal)) {
        setState((prev) => applyEvent(prev, evt));
      }
      setState((prev) => ({ ...prev, running: false }));
    } catch (err) {
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        // Cancel path — state already tweaked by cancel().
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        running: false,
        status: 'error',
        runError: message,
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { ...state, run, cancel, reset };
}

function applyEvent(
  prev: UseLiveRunState,
  evt: LiveRunEvent,
): UseLiveRunState {
  switch (evt.type) {
    case 'created':
      return { ...prev, gatewayRequestId: evt.gateway_request_id };
    case 'mom_delta':
      return { ...prev, momText: prev.momText + evt.text };
    case 'mom_done':
      return {
        ...prev,
        momText: evt.text_full,
        mom: {
          text: evt.text_full,
          usage: evt.usage,
          cost_usd: evt.cost_usd,
          latency_ms: evt.latency_ms,
        },
        status: prev.status === 'baseline_done' ? 'baseline_done' : 'mom_done',
      };
    case 'mom_error':
      return { ...prev, momError: evt.message };
    case 'baseline_done':
      return {
        ...prev,
        baseline: {
          model: evt.model,
          text: evt.text,
          usage: evt.usage,
          cost_usd: evt.cost_usd,
          latency_ms: evt.latency_ms,
        },
        status: prev.mom ? 'baseline_done' : 'baseline_done',
      };
    case 'baseline_error':
      return { ...prev, baselineError: evt.message };
    case 'judge_done':
      return {
        ...prev,
        judge: {
          model: evt.model,
          scores: evt.scores,
          verdict_summary: evt.verdict_summary,
          fallback: evt.fallback,
        },
        status: 'judge_done',
      };
    case 'judge_error':
      return { ...prev, judgeError: evt.message };
    case 'end':
      return { ...prev, status: evt.status, running: false };
    default:
      return prev;
  }
}
