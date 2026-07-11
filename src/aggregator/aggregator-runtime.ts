import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  SSEEvent,
} from '../types/anthropic.js';
import type {
  AdvisorResult,
  AggregatorResult,
  Logger,
  MoMConfig,
  ProviderConfig,
  ResponseSummary,
} from '../types/mom.js';
import { passthroughCall, ProviderError } from '../provider/provider-client.js';
import { passthroughStream } from '../provider/stream-forward.js';
import {
  appendReferencesToLastUser,
  buildConcatReferences,
} from './reference-builder.js';

function summarize(response: AnthropicMessagesResponse): ResponseSummary {
  return {
    id: response.id,
    stop_reason: response.stop_reason,
    stop_sequence: response.stop_sequence,
  };
}

function providerErrorMessage(err: unknown): string {
  if (err instanceof ProviderError) {
    return `provider ${err.statusCode}: ${err.providerBody.slice(0, 200)}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

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
  const finishedAt = Date.now();
  return {
    model: momConfig.aggregator.model,
    response,
    usage: response.usage,
    latency_ms: finishedAt - startedAt,
    references_appended: references,
    started_at: startedAt,
    finished_at: finishedAt,
    response_summary: summarize(response),
  };
}

export interface RunAggregatorStreamingOptions {
  onEvent?: (evt: SSEEvent) => void;
  log?: Logger;
}

export interface StreamingTimingResult {
  references_appended: string;
  started_at: number;
  finished_at: number;
  error?: string;
}

export async function runAggregatorStreaming(
  original: AnthropicMessagesRequest,
  results: AdvisorResult[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
  output: NodeJS.WritableStream,
  options: RunAggregatorStreamingOptions = {},
): Promise<StreamingTimingResult> {
  const startedAt = Date.now();
  const { request, references } = buildAggregatorRequest(original, results, momConfig);
  try {
    await passthroughStream(
      { ...request, stream: true },
      output,
      provider,
      options,
    );
    return {
      references_appended: references,
      started_at: startedAt,
      finished_at: Date.now(),
    };
  } catch (err) {
    return {
      references_appended: references,
      started_at: startedAt,
      finished_at: Date.now(),
      error: providerErrorMessage(err),
    };
  }
}
