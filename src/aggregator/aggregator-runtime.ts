import type { FastifyReply } from 'fastify';
import type { AnthropicMessagesRequest } from '../types/anthropic.js';
import type {
  AdvisorResult,
  AggregatorResult,
  MoMConfig,
  ProviderConfig,
} from '../types/mom.js';
import { passthroughCall } from '../provider/provider-client.js';
import { passthroughStream } from '../provider/stream-forward.js';
import {
  appendReferencesToLastUser,
  buildConcatReferences,
} from './reference-builder.js';

function buildAggregatorRequest(
  original: AnthropicMessagesRequest,
  results: AdvisorResult[],
  momConfig: MoMConfig,
): { request: AnthropicMessagesRequest; references: string } {
  const references = buildConcatReferences(results, momConfig);
  const messages = appendReferencesToLastUser(original.messages, references);
  const request: AnthropicMessagesRequest = {
    ...original,
    model: momConfig.aggregator.model,
    messages,
  };
  return { request, references };
}

export async function runAggregatorNonStreaming(
  original: AnthropicMessagesRequest,
  results: AdvisorResult[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
): Promise<AggregatorResult> {
  const startedAt = Date.now();
  const { request, references } = buildAggregatorRequest(original, results, momConfig);
  const response = await passthroughCall({ ...request, stream: false }, provider);
  return {
    model: momConfig.aggregator.model,
    response,
    usage: response.usage,
    latency_ms: Date.now() - startedAt,
    references_appended: references,
  };
}

export async function runAggregatorStreaming(
  original: AnthropicMessagesRequest,
  results: AdvisorResult[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
  reply: FastifyReply,
): Promise<void> {
  const { request } = buildAggregatorRequest(original, results, momConfig);
  await passthroughStream({ ...request, stream: true }, reply, provider);
}
