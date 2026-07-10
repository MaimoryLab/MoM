export interface SSEParsedLine {
  event?: string;
  data?: string;
}

export function parseSSELine(line: string): SSEParsedLine {
  const trimmed = line.replace(/\r$/, '');
  if (trimmed.startsWith('event:')) {
    return { event: trimmed.slice(6).trim() };
  }
  if (trimmed.startsWith('data:')) {
    return { data: trimmed.slice(5).trim() };
  }
  return {};
}

export function formatSSEEvent(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export interface RawSSEEvent {
  event: string;
  data: string;
}

export interface SSEParser {
  push(chunk: string | Buffer): RawSSEEvent[];
  flush(): RawSSEEvent[];
}

export function createSSEParser(): SSEParser {
  let buffer = '';
  let currentEvent = '';
  let currentData: string[] = [];

  function drainCompletedEvents(): RawSSEEvent[] {
    const events: RawSSEEvent[] = [];
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const line = rawLine.replace(/\r$/, '');
      if (line === '') {
        if (currentEvent !== '' || currentData.length > 0) {
          events.push({
            event: currentEvent || 'message',
            data: currentData.join('\n'),
          });
        }
        currentEvent = '';
        currentData = [];
      } else if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        currentData.push(line.slice(5).replace(/^ /, ''));
      }
      // 其他前缀（id:/retry:/comment）本 MVP 忽略
      idx = buffer.indexOf('\n');
    }
    return events;
  }

  return {
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      return drainCompletedEvents();
    },
    flush() {
      // flush 时若 buffer 里没有终止空行，丢弃残缺帧
      buffer = '';
      currentEvent = '';
      currentData = [];
      return [];
    },
  };
}
