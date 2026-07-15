// Timing helpers for PipelinePage — compress a real trace timeline into
// something demo-friendly while keeping the *relative* nodes intact.

export interface RawSpan {
  id: string;
  started_at: number;
  finished_at: number;
}

export interface TimedNode {
  id: string;
  startMs: number;
  endMs: number;
}

export interface CompressedTimeline {
  nodes: TimedNode[];
  totalMs: number;
  compressedFromMs: number | null;
}

export const TIMELINE_CAP_MS = 5000;

/**
 * Rebase all spans against the earliest `started_at` and compress the total
 * span to `capMs` when the raw duration exceeds it. Preserves relative
 * spacing — good for the animation feel, avoids 30 s waits on real traces.
 */
export function compressTimeline(
  spans: RawSpan[],
  capMs: number = TIMELINE_CAP_MS,
): CompressedTimeline {
  if (spans.length === 0) {
    return { nodes: [], totalMs: 0, compressedFromMs: null };
  }
  const t0 = Math.min(...spans.map((s) => s.started_at));
  const t1 = Math.max(...spans.map((s) => s.finished_at));
  const rawTotal = Math.max(1, t1 - t0);
  const scale = rawTotal > capMs ? capMs / rawTotal : 1;
  const nodes: TimedNode[] = spans.map((s) => ({
    id: s.id,
    startMs: Math.max(0, (s.started_at - t0) * scale),
    endMs: Math.max(1, (s.finished_at - t0) * scale),
  }));
  return {
    nodes,
    totalMs: rawTotal * scale,
    compressedFromMs: scale < 1 ? rawTotal : null,
  };
}

export type NodeStatus = 'pending' | 'running' | 'done';

/**
 * Given an elapsed wall-clock ms (already scaled by user's speed toggle),
 * return the animation status for a node.
 */
export function nodeStatusAt(startMs: number, endMs: number, elapsed: number): NodeStatus {
  if (elapsed < startMs) return 'pending';
  if (elapsed < endMs) return 'running';
  return 'done';
}
