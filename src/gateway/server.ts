import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMessagesHandler } from './messages-handler.js';
import { registerTraceAPI } from './trace-api.js';
import { registerConfigAPI } from '../dashboard-api/config-api.js';
import { registerTracesAPI } from '../dashboard-api/traces-api.js';
import { registerMetricsAPI } from '../dashboard-api/metrics-api.js';
import { registerBenchmarksAPI } from '../dashboard-api/benchmarks-api.js';
import { registerLiveAPI } from './live-api.js';
import { registerPresetsAPI } from './presets-api.js';
import { createOrchestratorHolder } from '../orchestrator/orchestrator-holder.js';
import type { RuntimeConfig } from '../types/mom.js';

const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export interface CreateServerOptions {
  momConfigPath: string;
  benchmarksPath: string;
  presetsPath: string;
}

export function createServer(
  runtime: RuntimeConfig,
  options: CreateServerOptions,
): FastifyInstance {
  const app = Fastify({
    logger: { level: 'info' },
    bodyLimit: BODY_LIMIT_BYTES,
    disableRequestLogging: false,
  });

  const holder = createOrchestratorHolder(runtime);

  app.post('/v1/messages', createMessagesHandler(holder));
  registerTraceAPI(app);
  registerConfigAPI(app, {
    runtime,
    momConfigPath: options.momConfigPath,
    holder,
  });
  registerTracesAPI(app);
  registerMetricsAPI(app);
  registerBenchmarksAPI(app, { benchmarksPath: options.benchmarksPath });
  registerLiveAPI(app, { holder });
  registerPresetsAPI(app, { presetsPath: options.presetsPath });

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
  runtime: RuntimeConfig,
  options: CreateServerOptions,
): Promise<FastifyInstance> {
  const app = createServer(runtime, options);
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
