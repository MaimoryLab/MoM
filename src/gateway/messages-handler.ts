import type { FastifyReply, FastifyRequest } from 'fastify';
import { validateMessagesRequest, ValidationError } from './validator.js';
import { ProviderError } from '../provider/provider-client.js';
import type { RuntimeConfig } from '../types/mom.js';
import { orchestrate } from '../orchestrator/orchestrator.js';

export function createMessagesHandler(runtime: RuntimeConfig) {
  return async function handleMessages(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    let body;
    try {
      body = validateMessagesRequest(req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(400).send({
        type: 'error',
        error: { type: 'invalid_request_error', message },
      });
      return;
    }

    try {
      await orchestrate(body, reply, runtime, req.log);
    } catch (err) {
      if (err instanceof ProviderError) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(err.providerBody);
        } catch {
          parsed = {
            type: 'error',
            error: { type: 'provider_error', message: err.providerBody.slice(0, 500) },
          };
        }
        reply.code(err.statusCode).send(parsed);
        return;
      }
      if (err instanceof ValidationError) {
        reply.code(400).send({
          type: 'error',
          error: { type: 'invalid_request_error', message: err.message },
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      reply.code(502).send({
        type: 'error',
        error: { type: 'gateway_error', message },
      });
    }
  };
}
