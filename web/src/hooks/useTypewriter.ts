import { useEffect, useRef, useState } from 'react';

interface Options {
  active: boolean;
  msPerChar?: number;
  onDone?: () => void;
}

// Advance a substring of `full` one char at a time. When active flips off,
// jump to the end immediately. When `full` changes we reset to 0.
export function useTypewriter(full: string, opts: Options): string {
  const { active, msPerChar = 18, onDone } = opts;
  const [visible, setVisible] = useState(active ? '' : full);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    if (!active) {
      setVisible(full);
      return;
    }
    if (!full) {
      setVisible('');
      return;
    }
    setVisible('');
    let i = 0;
    let cancelled = false;
    let timer: number | null = null;
    const step = () => {
      if (cancelled) return;
      i += 1;
      setVisible(full.slice(0, i));
      if (i >= full.length) {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone?.();
        }
        return;
      }
      timer = window.setTimeout(step, msPerChar);
    };
    timer = window.setTimeout(step, msPerChar);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [full, active, msPerChar, onDone]);

  return visible;
}
