import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ComparisonListItem,
  ComparisonListResponse,
  ComparisonResponse,
  LiveRunRequest,
  LiveRunSubmitResponse,
} from '../types/dashboard-api.js';
import type { OrchestratorHolder } from '../orchestrator/orchestrator-holder.js';
import { getComparisonById, listRecentComparisons } from '../live/live-store.js';
import { submitLiveTurn } from '../live/live-runtime.js';

const MAX_PROMPT_LENGTH = 32_000;
const COMPARISONS_DEFAULT_LIMIT = 20;
const COMPARISONS_MAX_LIMIT = 100;

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

  // POST /api/live/run — fires the job, returns 202 with gateway_request_id.
  // Actual work continues in the background; poll GET /api/comparison/:gwId.
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

    const runtime = holder.getRuntime();
    const { gateway_request_id } = submitLiveTurn(body, {
      runtime,
      log: req.log,
    });

    const response: LiveRunSubmitResponse = { gateway_request_id };
    reply.code(202).send(response);
  });

  // GET /api/comparisons?limit=20 — recent comparison jobs, newest first.
  app.get('/api/comparisons', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    const parsed = query.limit ? Number.parseInt(query.limit, 10) : COMPARISONS_DEFAULT_LIMIT;
    const limit = Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, COMPARISONS_MAX_LIMIT)
      : COMPARISONS_DEFAULT_LIMIT;

    const { items, total } = listRecentComparisons({ limit });
    const payload: ComparisonListResponse = {
      items: items.map((r): ComparisonListItem => ({
        gateway_request_id: r.gateway_request_id,
        lang: r.lang,
        prompt: r.prompt_text,
        status: r.status,
        started_at: r.started_at,
        updated_at: r.updated_at,
        aggregator_model: r.aggregator_model,
        baseline_model_snapshot: r.baseline_model_snapshot,
      })),
      total,
      limit,
    };
    reply.send(payload);
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
      advisors_snapshot: record.advisors_snapshot,
      aggregator_model: record.aggregator_model,
      baseline_model_snapshot: record.baseline_model_snapshot,
      mom: record.mom
        ? {
            text: record.mom.text,
            usage: record.mom.usage,
            cost_usd: record.mom.cost_usd,
            latency_ms: record.mom.latency_ms,
          }
        : null,
      mom_error: record.mom_error ? { message: record.mom_error.message } : null,
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
