import { request } from 'undici';
import type { AnthropicMessagesRequest, SSEEvent } from '../types/anthropic.js';
import type { Logger, ProviderConfig } from '../types/mom.js';
import {
  buildAuthHeaders,
  buildProviderURL,
  ProviderError,
  toTraceError,
} from './provider-client.js';
import { createSSEParser, formatSSEEvent } from '../gateway/sse.js';

export interface PassthroughStreamOptions {
  onEvent?: (evt: SSEEvent) => void;
  log?: Logger;
}

/**
 * Forwards a streaming request to provider byte-by-byte. Rethrows on failure so
 * upstream callers (orchestrator / aggregator) can persist a status='error'
 * TraceRequest — writing an SSE `error` frame to `output` is a side effect for
 * the *client*, never the signal for observers.
 */
export async function passthroughStream(
  req: AnthropicMessagesRequest,
  output: NodeJS.WritableStream,
  provider: ProviderConfig,
  options: PassthroughStreamOptions = {},
): Promise<void> {
  const url = buildProviderURL(provider.base_url);
  const headers = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...buildAuthHeaders(provider),
  };
  const { onEvent, log } = options;

  const emitErrorFrame = (err: unknown): void => {
    if (isEnded(output)) return;
    const trace = toTraceError(err);
    output.write(
      formatSSEEvent('error', {
        type: 'error',
        error: { type: trace.type, message: trace.message },
      }),
    );
    output.end();
  };

  let res;
  try {
    res = await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
  } catch (err) {
    emitErrorFrame(err);
    throw err;
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const body = await res.body.text();
    const providerErr = new ProviderError(res.statusCode, body, req.model);
    emitErrorFrame(providerErr);
    throw providerErr;
  }

  const parser = onEvent ? createSSEParser() : null;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      const onData = (chunk: Buffer): void => {
        // 主链路：字节级转发到 output
        output.write(chunk);
        // 旁路：observer 增量解析，异常吞掉
        if (parser && onEvent) {
          try {
            const events = parser.push(chunk);
            for (const raw of events) {
              if (raw.data === '') continue;
              try {
                const parsed = JSON.parse(raw.data) as SSEEvent;
                onEvent(parsed);
              } catch (err) {
                log?.warn(
                  {
                    event: 'sse_parse_error',
                    raw_event: raw.event,
                    raw_data_preview: raw.data.slice(0, 200),
                    error: err instanceof Error ? err.message : String(err),
                  },
                  'failed to parse sse data as JSON',
                );
              }
            }
          } catch (err) {
            log?.warn(
              {
                event: 'sse_observer_error',
                error: err instanceof Error ? err.message : String(err),
              },
              'sse observer failed, main forwarding unaffected',
            );
          }
        }
      };

      res.body.on('data', onData);
      res.body.on('error', (err) => {
        if (!isEnded(output)) output.end();
        finish(err);
      });
      output.on('error', (err) => finish(err));
      output.on('close', () => {
        (res.body as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
        finish();
      });
      res.body.on('end', () => {
        if (!isEnded(output)) output.end();
        finish();
      });
    });
  } catch (err) {
    emitErrorFrame(err);
    throw err;
  }
}

function isEnded(stream: NodeJS.WritableStream): boolean {
  return (
    (stream as NodeJS.WritableStream & { writableEnded?: boolean }).writableEnded ===
    true
  );
}
