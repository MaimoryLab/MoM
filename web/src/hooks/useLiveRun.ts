import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  getComparison,
  isTerminalStatus,
  submitLiveRun,
  type ComparisonResponse,
  type LiveRunRequest,
} from '../lib/api';

const POLL_INTERVAL_MS = 3000;

export interface LiveJobState {
  /** Currently-selected comparison; null before first submit or when user picks nothing from history. */
  current: ComparisonResponse | null;
  /** True while we're actively polling `current`. */
  polling: boolean;
  /** Fetch/API error from the last submit / poll cycle, distinct from `current.mom_error` etc. */
  transportError: string | null;
}

export interface LiveJobActions {
  /** Fire a new /api/live/run job, start polling. Existing job (if any) is replaced. */
  submit: (body: LiveRunRequest) => Promise<void>;
  /** Load an existing gateway_request_id (from the job list) and start polling it if not terminal. */
  select: (gwId: string) => Promise<void>;
  /** Stop polling and clear state. Does NOT abort the server-side job. */
  reset: () => void;
}

export interface LiveJobContextValue extends LiveJobState, LiveJobActions {}

const NULL_CTX: LiveJobContextValue = {
  current: null,
  polling: false,
  transportError: null,
  submit: async () => {},
  select: async () => {},
  reset: () => {},
};

const LiveJobContext = createContext<LiveJobContextValue>(NULL_CTX);

/**
 * Lift Live-run state to the App tree so it survives page navigation — the
 * old useLiveRun hook lived inside LivePage and lost its SSE stream when
 * the component unmounted mid-run. Now we submit a job, poll every 3s, and
 * anything on LivePage is just a view over the same store.
 */
export function LiveJobProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveJobState>({
    current: null,
    polling: false,
    transportError: null,
  });
  const timerRef = useRef<number | null>(null);
  const activeGwRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(async (gwId: string) => {
    // Ignore stale ticks after user swapped to a different gwId.
    if (activeGwRef.current !== gwId) return;
    try {
      const snap = await getComparison(gwId);
      if (activeGwRef.current !== gwId) return;
      setState((s) => ({ ...s, current: snap, transportError: null }));
      if (isTerminalStatus(snap.status)) {
        setState((s) => ({ ...s, polling: false }));
        return;
      }
    } catch (err) {
      if (activeGwRef.current !== gwId) return;
      setState((s) => ({
        ...s,
        transportError: err instanceof Error ? err.message : String(err),
      }));
    }
    if (activeGwRef.current === gwId) {
      timerRef.current = window.setTimeout(() => tick(gwId), POLL_INTERVAL_MS);
    }
  }, []);

  const submit = useCallback(async (body: LiveRunRequest) => {
    stopPolling();
    setState({ current: null, polling: true, transportError: null });
    try {
      const { gateway_request_id } = await submitLiveRun(body);
      activeGwRef.current = gateway_request_id;
      // First fetch happens immediately so the UI stops showing "empty".
      tick(gateway_request_id);
    } catch (err) {
      setState({
        current: null,
        polling: false,
        transportError: err instanceof Error ? err.message : String(err),
      });
    }
  }, [stopPolling, tick]);

  const select = useCallback(async (gwId: string) => {
    stopPolling();
    activeGwRef.current = gwId;
    setState({ current: null, polling: true, transportError: null });
    tick(gwId);
  }, [stopPolling, tick]);

  const reset = useCallback(() => {
    stopPolling();
    activeGwRef.current = null;
    setState({ current: null, polling: false, transportError: null });
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const value: LiveJobContextValue = {
    ...state,
    submit,
    select,
    reset,
  };
  return createElement(LiveJobContext.Provider, { value }, children);
}

export function useLiveJob(): LiveJobContextValue {
  return useContext(LiveJobContext);
}
