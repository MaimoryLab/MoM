import { request } from 'undici';
import type { AnthropicMessagesRequest, SSEEvent } from '../types/anthropic.js';
import type { Logger, ProviderConfig } from '../types/mom.js';
import { buildAuthHeaders, buildProviderURL } from './provider-client.js';
import { createSSEParser, formatSSEEvent } from '../gateway/sse.js';

export interface PassthroughStreamOptions {
  onEvent?: (evt: SSEEvent) => void;
  log?: Logger;
}

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

  const writeError = (type: string, message: string): void => {
    if (!isEnded(output)) {
      output.write(
        formatSSEEvent('error', {
          type: 'error',
          error: { type, message },
        }),
      );
      output.end();
    }
  };

  try {
    const res = await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const body = await res.body.text();
      writeError(
        'provider_error',
        `provider ${res.statusCode}: ${body.slice(0, 500)}`,
      );
      return;
    }

    const parser = onEvent ? createSSEParser() : null;

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
    const message = err instanceof Error ? err.message : String(err);
    writeError('gateway_error', message);
  }
}

function isEnded(stream: NodeJS.WritableStream): boolean {
  return (
    (stream as NodeJS.WritableStream & { writableEnded?: boolean }).writableEnded ===
    true
  );
}
