import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { handleMessages } from './messages-handler.js';

const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: { level: 'info' },
    bodyLimit: BODY_LIMIT_BYTES,
    disableRequestLogging: false,
  });

  app.post('/v1/messages', handleMessages);

  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, '../../web/dist');
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

export async function startServer(port: number): Promise<FastifyInstance> {
  const app = createServer();
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
