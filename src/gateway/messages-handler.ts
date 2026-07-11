import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AnthropicMessagesRequest } from '../types/anthropic.js';
import { validateMessagesRequest, ValidationError } from './validator.js';
import { ProviderError } from '../provider/provider-client.js';
import type { RuntimeConfig } from '../types/mom.js';
import { createOrchestrator, type Orchestrator } from '../orchestrator/orchestrator.js';
import { formatSSEEvent } from './sse.js';

export function createMessagesHandler(runtime: RuntimeConfig) {
  const orchestrator = createOrchestrator(runtime);
  return async function handleMessages(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    let body: AnthropicMessagesRequest;
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

    if (body.stream === true) {
      await handleStreaming(body, reply, orchestrator, req);
      return;
    }
    await handleNonStreaming(body, reply, orchestrator, req);
  };
}

async function handleNonStreaming(
  body: AnthropicMessagesRequest,
  reply: FastifyReply,
  orchestrator: Orchestrator,
  req: FastifyRequest,
): Promise<void> {
  try {
    const response = await orchestrator.nonStreaming(body, req.log);
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

async function handleStreaming(
  body: AnthropicMessagesRequest,
  reply: FastifyReply,
  orchestrator: Orchestrator,
  req: FastifyRequest,
): Promise<void> {
  reply.raw.setHeader('content-type', 'text/event-stream');
  reply.raw.setHeader('cache-control', 'no-cache');
  reply.raw.setHeader('connection', 'keep-alive');
  reply.hijack();
  try {
    await orchestrator.streaming(body, reply.raw, req.log);
  } catch (err) {
    if (!reply.raw.writableEnded) {
      const message = err instanceof Error ? err.message : String(err);
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
