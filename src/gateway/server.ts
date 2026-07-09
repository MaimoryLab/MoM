import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMessagesHandler } from './messages-handler.js';
import type { ProviderConfig } from '../types/mom.js';

const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export function createServer(provider: ProviderConfig): FastifyInstance {
  const app = Fastify({
    logger: { level: 'info' },
    bodyLimit: BODY_LIMIT_BYTES,
    disableRequestLogging: false,
  });

  app.post('/v1/messages', createMessagesHandler(provider));

  const webDist = resolve(process.cwd(), 'web/dist');
  if (existsSync(webDist)) {
    app.register(fastifyStatic, {
      root: webDist,
      prefix: '/dashboard/',
      decorateReply: false,
    });
  } else {
    app.get('/dashboard/*', async (_req, reply) => {
      reply
        .type('text/html')
        .send(
          '<!doctype html><meta charset="utf-8"><title>MoM</title>' +
            '<h1>MoM dashboard not built yet</h1>' +
            '<p>Run <code>npm run build --workspace=web</code> first.</p>',
        );
    });
  }

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}

export async function startServer(
  port: number,
  provider: ProviderConfig,
): Promise<FastifyInstance> {
  const app = createServer(provider);
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
