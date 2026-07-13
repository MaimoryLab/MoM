import { useEffect, useRef, useState } from 'react';

// Fake-streaming typewriter. Reveals `text` character-by-character on a
// jittery interval so it feels like real SSE. Reset if `text` changes or
// `runId` bumps.

type Options = {
  charsPerTick?: number; // avg chars per tick
  tickMs?: number;       // tick interval
  jitter?: number;       // 0..1, randomises tick + chunk size
  autoStart?: boolean;
  runId?: number;        // bump to restart
  onDone?: () => void;
};

export function useTypewriter(text: string, opts: Options = {}) {
  const {
    charsPerTick = 4,
    tickMs = 28,
    jitter = 0.6,
    autoStart = true,
    runId = 0,
    onDone,
  } = opts;

  const [rendered, setRendered] = useState('');
  const [done, setDone] = useState(false);
  const idxRef = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!autoStart) return;
    idxRef.current = 0;
    setRendered('');
    setDone(false);
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const chunk = Math.max(1, Math.round(charsPerTick * (1 + (Math.random() - 0.5) * jitter)));
      const next = Math.min(text.length, idxRef.current + chunk);
      idxRef.current = next;
      setRendered(text.slice(0, next));
      if (next >= text.length) {
        setDone(true);
        onDoneRef.current?.();
        return;
      }
      const delay = Math.max(4, tickMs * (1 + (Math.random() - 0.5) * jitter));
      setTimeout(tick, delay);
    };

    const initial = Math.max(4, tickMs * (1 + (Math.random() - 0.5) * jitter));
    const id = setTimeout(tick, initial);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [text, autoStart, runId, charsPerTick, tickMs, jitter]);

  return { text: rendered, done };
}
