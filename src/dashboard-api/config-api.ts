import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  MoMConfig,
  ProviderConfig,
  RuntimeConfig,
} from '../types/mom.js';
import type {
  ConfigResponse,
  SaveConfigRequest,
  SaveConfigResponse,
} from '../types/dashboard-api.js';
import { saveMoMConfig } from '../config/mom-config-file.js';
import {
  assertModeRequirements,
  stampMoMConfigSource,
  ConfigError,
} from '../config.js';
import type { OrchestratorHolder } from '../orchestrator/orchestrator-holder.js';

const MASK_MIDDLE = '****';

// Fixed-shape mask: <first 3><****><last 2>. Never leaks the key length.
export function maskApiKey(key: string): string {
  const s = key ?? '';
  if (s.length === 0) return '';
  if (s.length < 5) {
    return `${s[0] ?? ''}${MASK_MIDDLE}`;
  }
  return `${s.slice(0, 3)}${MASK_MIDDLE}${s.slice(-2)}`;
}

function toProviderPublic(p: ProviderConfig) {
  return {
    base_url: p.base_url,
    auth_style: p.auth_style,
    api_key_masked: maskApiKey(p.api_key),
  };
}

function buildConfigResponse(runtime: RuntimeConfig): ConfigResponse {
  return {
    mom: runtime.mom,
    provider: toProviderPublic(runtime.provider),
    mom_config_source: runtime.mom_config_source,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

const MOM_MODES = new Set(['off', 'always', 'auto']);
const FANOUT_MODES = new Set(['off', 'user_turn', 'per_iteration']);
const AGG_MODES = new Set(['concat', 'judge']);
const TTL_PRESETS = new Set(['5m', '1h']);

export class ValidationError extends Error {}

// Hand-written shape guard — no zod. Rejects with ValidationError on the first
// failure so the client sees a specific diagnostic instead of a generic 400.
export function assertMoMConfigShape(v: unknown): asserts v is MoMConfig {
  if (!isObject(v)) throw new ValidationError('body.mom must be an object');
  if (!isString(v.mom_mode) || !MOM_MODES.has(v.mom_mode))
    throw new ValidationError('mom.mom_mode must be one of "off"|"always"|"auto"');
  if (!isString(v.fanout_mode) || !FANOUT_MODES.has(v.fanout_mode))
    throw new ValidationError('mom.fanout_mode must be one of "off"|"user_turn"|"per_iteration"');
  if (!isString(v.aggregation_mode) || !AGG_MODES.has(v.aggregation_mode))
    throw new ValidationError('mom.aggregation_mode must be one of "concat"|"judge"');
  if (!isNumber(v.reference_max_tokens) || v.reference_max_tokens <= 0)
    throw new ValidationError('mom.reference_max_tokens must be a positive number');

  if (!isObject(v.advisor))
    throw new ValidationError('mom.advisor must be an object');
  if (!isStringArray(v.advisor.slots))
    throw new ValidationError('mom.advisor.slots must be an array of strings');
  if (!isBoolean(v.advisor.tools_enabled))
    throw new ValidationError('mom.advisor.tools_enabled must be boolean');

  if (!isObject(v.aggregator) || !isString(v.aggregator.model))
    throw new ValidationError('mom.aggregator.model must be string');

  if (!isObject(v.judge) || !isString(v.judge.model))
    throw new ValidationError('mom.judge.model must be string');

  if (!isObject(v.cache))
    throw new ValidationError('mom.cache must be an object');
  if (!isString(v.cache.ttl) || !TTL_PRESETS.has(v.cache.ttl))
    throw new ValidationError('mom.cache.ttl must be "5m" or "1h"');
  if (!isNumber(v.cache.max_entries) || v.cache.max_entries <= 0)
    throw new ValidationError('mom.cache.max_entries must be a positive number');

  if (!isObject(v.comparison))
    throw new ValidationError('mom.comparison must be an object');
  if (!isBoolean(v.comparison.enabled))
    throw new ValidationError('mom.comparison.enabled must be boolean');
  if (!isString(v.comparison.baseline_model))
    throw new ValidationError('mom.comparison.baseline_model must be string');

  if (!isObject(v.pricing_table))
    throw new ValidationError('mom.pricing_table must be an object');
  for (const [model, entry] of Object.entries(v.pricing_table)) {
    if (!isObject(entry))
      throw new ValidationError(`mom.pricing_table["${model}"] must be an object`);
    if (!isString(entry.currency))
      throw new ValidationError(`mom.pricing_table["${model}"].currency must be string`);
    for (const field of ['input', 'output', 'cache_write', 'cache_read'] as const) {
      if (!isNumber(entry[field]))
        throw new ValidationError(
          `mom.pricing_table["${model}"].${field} must be a number`,
        );
    }
  }

  if (!isObject(v.cost_tradeoff))
    throw new ValidationError('mom.cost_tradeoff must be an object');
  if (!isBoolean(v.cost_tradeoff.enabled))
    throw new ValidationError('mom.cost_tradeoff.enabled must be boolean');
}

export interface ConfigAPIContext {
  runtime: RuntimeConfig;
  momConfigPath: string;
  holder: OrchestratorHolder;
}

export function registerConfigAPI(
  app: FastifyInstance,
  ctx: ConfigAPIContext,
): void {
  app.get('/api/config', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(buildConfigResponse(ctx.runtime));
  });

  app.post('/api/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Partial<SaveConfigRequest> | undefined;
    if (!body || typeof body !== 'object') {
      reply.code(400).send({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'request body must be a JSON object',
        },
      });
      return;
    }
    let mom: MoMConfig;
    try {
      assertMoMConfigShape(body.mom);
      mom = body.mom;
      assertModeRequirements(mom);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errType =
        err instanceof ConfigError ? 'config_error' : 'invalid_request_error';
      reply.code(400).send({
        type: 'error',
        error: { type: errType, message },
      });
      return;
    }
    try {
      saveMoMConfig(ctx.momConfigPath, mom);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'save_mom_config_failed', error: message },
        'failed to persist MoM config',
      );
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message },
      });
      return;
    }
    ctx.runtime.mom = mom;
    ctx.runtime.mom_config_source = stampMoMConfigSource(ctx.momConfigPath);
    ctx.holder.rebuild();
    const response: SaveConfigResponse = {
      mom,
      mom_config_source: ctx.runtime.mom_config_source,
    };
    reply.send(response);
  });
}
