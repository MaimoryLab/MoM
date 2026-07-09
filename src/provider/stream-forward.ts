import { request } from 'undici';
import type { FastifyReply } from 'fastify';
import type { AnthropicMessagesRequest } from '../types/anthropic.js';
import type { MoMSettings } from '../types/mom.js';
import { buildAuthHeaders, buildProviderURL } from './provider-client.js';
import { formatSSEEvent } from '../gateway/sse.js';

export async function passthroughStream(
  req: AnthropicMessagesRequest,
  reply: FastifyReply,
  settings: MoMSettings,
): Promise<void> {
  const url = buildProviderURL(settings.provider.base_url);
  const headers = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...buildAuthHeaders(settings),
  };

  reply.raw.setHeader('content-type', 'text/event-stream');
  reply.raw.setHeader('cache-control', 'no-cache');
  reply.raw.setHeader('connection', 'keep-alive');
  reply.hijack();

  try {
    const res = await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const body = await res.body.text();
      reply.raw.write(
        formatSSEEvent('error', {
          type: 'error',
          error: {
            type: 'provider_error',
            message: `provider ${res.statusCode}: ${body.slice(0, 500)}`,
          },
        }),
      );
      reply.raw.end();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      res.body.on('error', (err) => finish(err));
      reply.raw.on('error', (err) => finish(err));
      reply.raw.on('close', () => {
        res.body.destroy();
        finish();
      });
      res.body.pipe(reply.raw);
      res.body.on('end', () => finish());
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!reply.raw.writableEnded) {
      reply.raw.write(
        formatSSEEvent('error', {
          type: 'error',
          error: { type: 'gateway_error', message },
        }),
      );
      reply.raw.end();
    }
  }
}
