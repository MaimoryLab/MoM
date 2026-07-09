import type { FastifyReply, FastifyRequest } from 'fastify';
import { validateMessagesRequest, ValidationError } from './validator.js';
import { passthroughCall, ProviderError } from '../provider/provider-client.js';
import { passthroughStream } from '../provider/stream-forward.js';
import { loadSettings } from '../storage/settings.js';

export async function handleMessages(
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

  const settings = loadSettings();

  try {
    if (body.stream === true) {
      await passthroughStream(body, reply, settings);
      return;
    }
    const response = await passthroughCall(body, settings);
    reply.send(response);
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
}
