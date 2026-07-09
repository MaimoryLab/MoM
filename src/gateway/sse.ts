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
