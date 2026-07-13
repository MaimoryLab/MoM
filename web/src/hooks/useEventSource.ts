import { useEffect, useState } from 'react';

// Placeholder SSE hook — reserved for Phase 4 backend integration.
// Not used by the preview build; kept so downstream pages have a stable API.

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage?: { input: number; output: number } };

export function useEventSource(url: string | null) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    setConnected(true);
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as StreamEvent;
        setEvents((prev) => [...prev, parsed]);
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
    };
    return () => {
      es.close();
      setConnected(false);
    };
  }, [url]);

  return { events, connected };
}
