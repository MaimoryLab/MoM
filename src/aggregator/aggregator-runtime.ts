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
  TraceError,
} from '../types/mom.js';
import { passthroughCall, toTraceError } from '../provider/provider-client.js';
import { passthroughStream } from '../provider/stream-forward.js';
import {
  applyReferenceInjection,
  buildConcatReferences,
} from './reference-builder.js';

function summarize(response: AnthropicMessagesResponse): ResponseSummary {
  return {
    id: response.id,
    stop_reason: response.stop_reason,
    stop_sequence: response.stop_sequence,
  };
}

function buildAggregatorRequest(
  original: AnthropicMessagesRequest,
  results: AdvisorResult[],
  momConfig: MoMConfig,
  isNewUserTurn: boolean,
): { request: AnthropicMessagesRequest; references: string } {
  const references = buildConcatReferences(results, momConfig);
  const injection = applyReferenceInjection({
    messages: original.messages,
    references,
    isNewUserTurn,
    settings: momConfig.reference_injection,
  });
  const request: AnthropicMessagesRequest = {
    ...original,
    model: momConfig.aggregator.model,
    messages: injection.messages,
  };
  // `references_appended` on the trace must reflect what was actually injected
  // (empty when policy skipped this request), not the raw concat.
  return { request, references: injection.payload };
}

export async function runAggregatorNonStreaming(
  original: AnthropicMessagesRequest,
  results: AdvisorResult[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
  isNewUserTurn: boolean,
): Promise<AggregatorResult> {
  const startedAt = Date.now();
  const { request, references } = buildAggregatorRequest(
    original,
    results,
    momConfig,
    isNewUserTurn,
  );
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
    error: null,
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
  error: TraceError | null;
}

export async function runAggregatorStreaming(
  original: AnthropicMessagesRequest,
  results: AdvisorResult[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
  output: NodeJS.WritableStream,
  isNewUserTurn: boolean,
  options: RunAggregatorStreamingOptions = {},
): Promise<StreamingTimingResult> {
  const startedAt = Date.now();
  const { request, references } = buildAggregatorRequest(
    original,
    results,
    momConfig,
    isNewUserTurn,
  );
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
      error: null,
    };
  } catch (err) {
    return {
      references_appended: references,
      started_at: startedAt,
      finished_at: Date.now(),
      error: toTraceError(err, 'aggregator_error'),
    };
  }
}
