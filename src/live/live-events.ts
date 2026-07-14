import { formatSSEEvent } from '../gateway/sse.js';
import type { LiveRunEvent } from '../types/dashboard-api.js';

export type LiveEvent = LiveRunEvent;

/**
 * Serialize a LiveRunEvent as an SSE frame. `type` becomes the SSE `event:`
 * name; the whole event (including `type`) is the JSON `data:` payload so
 * clients can dispatch on either channel.
 */
export function encodeLiveEvent(evt: LiveEvent): string {
  return formatSSEEvent(evt.type, evt);
}

export function writeLiveEvent(
  output: NodeJS.WritableStream,
  evt: LiveEvent,
): void {
  const w = output as NodeJS.WritableStream & { writableEnded?: boolean };
  if (w.writableEnded) return;
  output.write(encodeLiveEvent(evt));
}
