import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ComparisonResponse,
  LiveRunRequest,
} from '../types/dashboard-api.js';
import type { OrchestratorHolder } from '../orchestrator/orchestrator-holder.js';
import { getComparisonById } from '../live/live-store.js';
import { runLiveTurn } from '../live/live-runtime.js';

const MAX_PROMPT_LENGTH = 32_000;

export interface RegisterLiveAPIOptions {
  holder: OrchestratorHolder;
}

function validateLiveRunBody(raw: unknown): LiveRunRequest {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('body must be a JSON object');
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.prompt !== 'string' || b.prompt.trim().length === 0) {
    throw new ValidationError('field "prompt" must be a non-empty string');
  }
  if (b.prompt.length > MAX_PROMPT_LENGTH) {
    throw new ValidationError(
      `field "prompt" exceeds max length ${MAX_PROMPT_LENGTH}`,
    );
  }
  if (typeof b.baseline_on !== 'boolean') {
    throw new ValidationError('field "baseline_on" must be a boolean');
  }
  if (b.lang !== 'zh' && b.lang !== 'en') {
    throw new ValidationError('field "lang" must be "zh" or "en"');
  }
  return {
    prompt: b.prompt,
    baseline_on: b.baseline_on,
    lang: b.lang,
  };
}

class ValidationError extends Error {}

export function registerLiveAPI(
  app: FastifyInstance,
  options: RegisterLiveAPIOptions,
): void {
  const { holder } = options;

  app.post('/api/live/run', async (req: FastifyRequest, reply: FastifyReply) => {
    let body: LiveRunRequest;
    try {
      body = validateLiveRunBody(req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(400).send({
        type: 'error',
        error: { type: 'invalid_request_error', message },
      });
      return;
    }

    // We rely on OrchestratorHolder's runtime reference for pricing / provider /
    // MoM config; hot reloads pick up on the next Live run.
    const runtime = holder.getRuntime();

    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-cache');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.hijack();

    try {
      await runLiveTurn(body, {
        runtime,
        log: req.log,
        output: reply.raw,
      });
    } catch (err) {
      // runLiveTurn is designed to not throw, but guard anyway.
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'live_run_uncaught', error: message },
        'live run threw despite defensive handling',
      );
      if (!reply.raw.writableEnded) {
        reply.raw.write(
          `event: end\ndata: ${JSON.stringify({ status: 'error' })}\n\n`,
        );
        reply.raw.end();
      }
    }
  });

  app.get('/api/comparison/:gateway_request_id', async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const params = req.params as { gateway_request_id?: string };
    const gwId = params.gateway_request_id;
    if (!gwId) {
      reply.code(400).send({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'gateway_request_id is required',
        },
      });
      return;
    }
    const record = getComparisonById(gwId);
    if (!record) {
      reply.code(404).send({
        type: 'error',
        error: {
          type: 'not_found',
          message: `no comparison record for gateway_request_id=${gwId}`,
        },
      });
      return;
    }
    const response: ComparisonResponse = {
      gateway_request_id: record.gateway_request_id,
      session_id: record.session_id,
      lang: record.lang,
      prompt: record.prompt_text,
      status: record.status,
      started_at: record.started_at,
      updated_at: record.updated_at,
      mom: record.mom
        ? {
            text: record.mom.text,
            usage: record.mom.usage,
            cost_usd: record.mom.cost_usd,
            latency_ms: record.mom.latency_ms,
          }
        : null,
      baseline: record.baseline
        ? {
            model: record.baseline.model,
            text: record.baseline.text,
            usage: record.baseline.usage,
            cost_usd: record.baseline.cost_usd,
            latency_ms: record.baseline.latency_ms,
          }
        : null,
      baseline_error: record.baseline_error
        ? { message: record.baseline_error.message }
        : null,
      judge: record.judge
        ? {
            model: record.judge.model,
            scores: record.judge.scores,
            verdict_summary: record.judge.verdict_summary,
            fallback: record.judge.fallback,
          }
        : null,
      judge_error: record.judge_error
        ? { message: record.judge_error.message }
        : null,
    };
    reply.send(response);
  });
}
