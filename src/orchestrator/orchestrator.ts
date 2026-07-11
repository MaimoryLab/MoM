import { randomUUID } from 'node:crypto';
import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  ContentBlock,
  ContentBlockDeltaEvent,
  SSEEvent,
  Usage,
} from '../types/anthropic.js';
import type {
  AdvisorResult,
  AggregatorResult,
  Logger,
  MoMConfig,
  ProviderConfig,
  RequestSummary,
  ResponseSummary,
  RuntimeConfig,
  TraceError,
  TraceRequest,
  TraceUsage,
  TriggerReason,
} from '../types/mom.js';
import { passthroughCall, toTraceError } from '../provider/provider-client.js';
import { passthroughStream } from '../provider/stream-forward.js';
import { fanoutAdvisorsWithCache } from './fanout.js';
import {
  runAggregatorNonStreaming,
  runAggregatorStreaming,
} from '../aggregator/aggregator-runtime.js';
import { computeFanoutCacheKey } from '../cache/cache-key.js';
import type { FanoutCache } from '../cache/fanout-cache.js';
import { createFanoutCache, parseTTL } from '../cache/fanout-cache.js';
import { computeTriggerReason, isNewUserTurn } from './trigger.js';
import { snapshotPricing, toTraceUsage } from '../cost/pricing.js';
import { saveTraceRequest } from '../storage/traces.js';

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

export interface Orchestrator {
  nonStreaming(
    body: AnthropicMessagesRequest,
    sessionId: string | null,
    log: Logger,
  ): Promise<AnthropicMessagesResponse>;
  streaming(
    body: AnthropicMessagesRequest,
    sessionId: string | null,
    output: NodeJS.WritableStream,
    log: Logger,
  ): Promise<void>;
}

export function createOrchestrator(runtime: RuntimeConfig): Orchestrator {
  const { provider, mom, mom_config_source } = runtime;
  const cache = createFanoutCache({
    max_entries: mom.cache.max_entries,
    ttl_ms: parseTTL(mom.cache.ttl),
  });
  const providerHost = extractHost(provider.base_url);
  return {
    nonStreaming: (body, sessionId, log) =>
      orchestrateNonStreaming(body, sessionId, provider, providerHost, mom, mom_config_source, cache, log),
    streaming: (body, sessionId, output, log) =>
      orchestrateStreaming(
        body,
        sessionId,
        output,
        provider,
        providerHost,
        mom,
        mom_config_source,
        cache,
        log,
      ),
  };
}

function extractHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

async function orchestrateNonStreaming(
  body: AnthropicMessagesRequest,
  sessionId: string | null,
  provider: ProviderConfig,
  providerHost: string,
  mom: MoMConfig,
  pricingSource: string,
  cache: FanoutCache,
  log: Logger,
): Promise<AnthropicMessagesResponse> {
  const gatewayRequestId = randomUUID();
  if (mom.mom_mode !== 'always') {
    return runPassthroughNonStreaming(
      body,
      sessionId,
      gatewayRequestId,
      provider,
      providerHost,
      mom,
      pricingSource,
      log,
    );
  }
  const { advisorResults, triggerReason } = await runFanoutStage(
    body,
    provider,
    mom,
    cache,
    log,
  );
  persistAdvisorTraces(
    advisorResults,
    body,
    sessionId,
    gatewayRequestId,
    providerHost,
    mom,
    pricingSource,
    triggerReason,
    log,
  );
  const aggregatorStartedAt = Date.now();
  let aggregatorResult;
  try {
    aggregatorResult = await runAggregatorNonStreaming(
      body,
      advisorResults,
      mom,
      provider,
    );
  } catch (err) {
    const finishedAt = Date.now();
    const errorAggregator: AggregatorResult = {
      model: mom.aggregator.model,
      response: null,
      usage: EMPTY_USAGE,
      latency_ms: finishedAt - aggregatorStartedAt,
      references_appended: '',
      started_at: aggregatorStartedAt,
      finished_at: finishedAt,
      response_summary: null,
      error: toTraceError(err, 'aggregator_error'),
    };
    persistAggregatorTrace(
      errorAggregator,
      body,
      sessionId,
      gatewayRequestId,
      providerHost,
      mom,
      pricingSource,
      triggerReason,
      log,
    );
    throw err;
  }
  log.info(
    {
      event: 'aggregator_complete',
      model: aggregatorResult.model,
      duration_ms: aggregatorResult.latency_ms,
      trigger_reason: triggerReason,
    },
    'aggregator complete',
  );
  persistAggregatorTrace(
    aggregatorResult,
    body,
    sessionId,
    gatewayRequestId,
    providerHost,
    mom,
    pricingSource,
    triggerReason,
    log,
  );
  return aggregatorResult.response as AnthropicMessagesResponse;
}

async function orchestrateStreaming(
  body: AnthropicMessagesRequest,
  sessionId: string | null,
  output: NodeJS.WritableStream,
  provider: ProviderConfig,
  providerHost: string,
  mom: MoMConfig,
  pricingSource: string,
  cache: FanoutCache,
  log: Logger,
): Promise<void> {
  const gatewayRequestId = randomUUID();
  if (mom.mom_mode !== 'always') {
    await runPassthroughStreaming(
      body,
      sessionId,
      gatewayRequestId,
      output,
      provider,
      providerHost,
      mom,
      pricingSource,
      log,
    );
    return;
  }
  const { advisorResults, triggerReason } = await runFanoutStage(
    body,
    provider,
    mom,
    cache,
    log,
  );
  persistAdvisorTraces(
    advisorResults,
    body,
    sessionId,
    gatewayRequestId,
    providerHost,
    mom,
    pricingSource,
    triggerReason,
    log,
  );
  const collected = createStreamCollector();
  const streamTiming = await runAggregatorStreaming(
    body,
    advisorResults,
    mom,
    provider,
    output,
    { onEvent: collected.onEvent, log },
  );
  const response = collected.build();
  const aggregatorResult: AggregatorResult = {
    model: mom.aggregator.model,
    response,
    usage: response?.usage ?? EMPTY_USAGE,
    latency_ms: streamTiming.finished_at - streamTiming.started_at,
    references_appended: streamTiming.references_appended,
    started_at: streamTiming.started_at,
    finished_at: streamTiming.finished_at,
    response_summary: response
      ? {
          id: response.id,
          stop_reason: response.stop_reason,
          stop_sequence: response.stop_sequence,
        }
      : null,
    error: streamTiming.error,
  };
  log.info(
    {
      event: 'aggregator_stream_complete',
      model: aggregatorResult.model,
      duration_ms: aggregatorResult.latency_ms,
      trigger_reason: triggerReason,
    },
    'aggregator stream complete',
  );
  persistAggregatorTrace(
    aggregatorResult,
    body,
    sessionId,
    gatewayRequestId,
    providerHost,
    mom,
    pricingSource,
    triggerReason,
    log,
  );
}

// ---------------------- passthrough ----------------------

async function runPassthroughNonStreaming(
  body: AnthropicMessagesRequest,
  sessionId: string | null,
  gatewayRequestId: string,
  provider: ProviderConfig,
  providerHost: string,
  mom: MoMConfig,
  pricingSource: string,
  log: Logger,
): Promise<AnthropicMessagesResponse> {
  const startedAt = Date.now();
  try {
    const response = await passthroughCall(body, provider);
    const finishedAt = Date.now();
    persistPassthroughTrace({
      body,
      response,
      sessionId,
      gatewayRequestId,
      providerHost,
      startedAt,
      finishedAt,
      status: 'success',
      error: null,
      mom,
      pricingSource,
      log,
    });
    return response;
  } catch (err) {
    const finishedAt = Date.now();
    persistPassthroughTrace({
      body,
      response: null,
      sessionId,
      gatewayRequestId,
      providerHost,
      startedAt,
      finishedAt,
      status: 'error',
      error: toTraceError(err),
      mom,
      pricingSource,
      log,
    });
    throw err;
  }
}

async function runPassthroughStreaming(
  body: AnthropicMessagesRequest,
  sessionId: string | null,
  gatewayRequestId: string,
  output: NodeJS.WritableStream,
  provider: ProviderConfig,
  providerHost: string,
  mom: MoMConfig,
  pricingSource: string,
  log: Logger,
): Promise<void> {
  const startedAt = Date.now();
  const collected = createStreamCollector();
  let streamError: unknown = null;
  try {
    await passthroughStream(body, output, provider, {
      onEvent: collected.onEvent,
      log,
    });
  } catch (err) {
    streamError = err;
  } finally {
    const finishedAt = Date.now();
    const response = collected.build();
    persistPassthroughTrace({
      body,
      response,
      sessionId,
      gatewayRequestId,
      providerHost,
      startedAt,
      finishedAt,
      status: streamError ? 'error' : 'success',
      error: streamError ? toTraceError(streamError) : null,
      mom,
      pricingSource,
      log,
    });
  }
  if (streamError) throw streamError;
}

// ---------------------- fanout stage ----------------------

interface FanoutStageOutput {
  advisorResults: AdvisorResult[];
  triggerReason: TriggerReason;
  cacheHit: boolean;
}

async function runFanoutStage(
  body: AnthropicMessagesRequest,
  provider: ProviderConfig,
  mom: MoMConfig,
  cache: FanoutCache,
  log: Logger,
): Promise<FanoutStageOutput> {
  const isNewTurn = isNewUserTurn(body.messages);
  const key = computeFanoutCacheKey(body.messages, mom);
  const stageStart = Date.now();
  const { results: advisorResults, cache_hit } = await fanoutAdvisorsWithCache(
    body.messages,
    mom,
    provider,
    cache,
    key,
  );
  const triggerReason = computeTriggerReason(
    mom.fanout_mode,
    isNewTurn,
    cache_hit,
  );
  log.info(
    {
      event: cache_hit ? 'fanout_hit' : 'fanout_miss',
      fanout_mode: mom.fanout_mode,
      is_new_turn: isNewTurn,
      trigger_reason: triggerReason,
      slot_count: advisorResults.length,
      duration_ms: Date.now() - stageStart,
      failures: advisorResults
        .filter((r) => !r.success)
        .map((r) => ({ slot: r.slot, error: r.error })),
    },
    cache_hit ? 'fanout cache hit' : 'fanout complete',
  );
  return { advisorResults, triggerReason, cacheHit: cache_hit };
}

// ---------------------- trace persistence ----------------------

function persistAdvisorTraces(
  results: AdvisorResult[],
  body: AnthropicMessagesRequest,
  sessionId: string | null,
  gatewayRequestId: string,
  providerHost: string,
  mom: MoMConfig,
  pricingSource: string,
  triggerReason: TriggerReason,
  log: Logger,
): void {
  const requestSummary = summarizeRequest(body);
  for (const r of results) {
    const status: TraceRequest['status'] = r.cache_hit
      ? 'cache_hit'
      : r.success
      ? 'success'
      : 'error';
    const pricing = snapshotPricing(r.selected_model, mom.pricing_table, pricingSource);
    if (!pricing && !r.cache_hit) {
      log.warn(
        { event: 'pricing_missing', model: r.selected_model, role: 'advisor' },
        `no pricing entry for model "${r.selected_model}"`,
      );
    }
    const usage = toTraceUsage(r.usage);
    const trace: TraceRequest = {
      request_id: randomUUID(),
      session_id: sessionId,
      gateway_request_id: gatewayRequestId,
      role: 'advisor',
      client_model: body.model,
      selected_model: r.selected_model,
      provider: providerHost,
      started_at: r.started_at,
      finished_at: r.finished_at,
      duration_ms: r.finished_at - r.started_at,
      status,
      usage,
      pricing,
      error: r.error,
      request_summary: requestSummary,
      response_summary: r.response_summary,
      trigger_reason: triggerReason,
      cache_hit: r.cache_hit,
      settings_snapshot: structuredClone(mom),
    };
    writeTrace(trace, log);
  }
}

const AGGREGATOR_EMPTY_RESPONSE_ERROR: TraceError = {
  type: 'aggregator_error',
  message: 'aggregator produced no response',
  http_status: null,
};

function persistAggregatorTrace(
  result: AggregatorResult,
  body: AnthropicMessagesRequest,
  sessionId: string | null,
  gatewayRequestId: string,
  providerHost: string,
  mom: MoMConfig,
  pricingSource: string,
  triggerReason: TriggerReason,
  log: Logger,
): void {
  const traceError: TraceError | null =
    result.error ?? (result.response === null ? AGGREGATOR_EMPTY_RESPONSE_ERROR : null);
  const status: TraceRequest['status'] = traceError ? 'error' : 'success';
  const pricing = snapshotPricing(result.model, mom.pricing_table, pricingSource);
  if (!pricing) {
    log.warn(
      { event: 'pricing_missing', model: result.model, role: 'aggregator' },
      `no pricing entry for model "${result.model}"`,
    );
  }
  const usage = toTraceUsage(result.usage);
  const trace: TraceRequest = {
    request_id: randomUUID(),
    session_id: sessionId,
    gateway_request_id: gatewayRequestId,
    role: 'aggregator',
    client_model: body.model,
    selected_model: result.model,
    provider: providerHost,
    started_at: result.started_at,
    finished_at: result.finished_at,
    duration_ms: result.finished_at - result.started_at,
    status,
    usage,
    pricing,
    error: traceError,
    request_summary: summarizeRequest(body),
    response_summary: result.response_summary,
    trigger_reason: triggerReason,
    cache_hit: false,
    settings_snapshot: structuredClone(mom),
  };
  writeTrace(trace, log);
}

interface PersistPassthroughInput {
  body: AnthropicMessagesRequest;
  response: AnthropicMessagesResponse | null;
  sessionId: string | null;
  gatewayRequestId: string;
  providerHost: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'error';
  error: TraceError | null;
  mom: MoMConfig;
  pricingSource: string;
  log: Logger;
}

function persistPassthroughTrace(input: PersistPassthroughInput): void {
  const {
    body, response, sessionId, gatewayRequestId, providerHost,
    startedAt, finishedAt, status, error, mom, pricingSource, log,
  } = input;
  const pricing = snapshotPricing(body.model, mom.pricing_table, pricingSource);
  const usage = toTraceUsage(response?.usage ?? EMPTY_USAGE);
  const trace: TraceRequest = {
    request_id: randomUUID(),
    session_id: sessionId,
    gateway_request_id: gatewayRequestId,
    role: 'passthrough',
    client_model: body.model,
    selected_model: body.model,
    provider: providerHost,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt - startedAt,
    status,
    usage,
    pricing,
    error,
    request_summary: summarizeRequest(body),
    response_summary: response
      ? { id: response.id, stop_reason: response.stop_reason, stop_sequence: response.stop_sequence }
      : null,
    trigger_reason: 'mom_off',
    cache_hit: false,
    settings_snapshot: structuredClone(mom),
  };
  writeTrace(trace, log);
}

function writeTrace(trace: TraceRequest, log: Logger): void {
  try {
    saveTraceRequest(trace);
  } catch (err) {
    log.error(
      {
        event: 'trace_save_failed',
        request_id: trace.request_id,
        error: err instanceof Error ? err.message : String(err),
      },
      'failed to save trace',
    );
  }
}

function summarizeRequest(body: AnthropicMessagesRequest): RequestSummary {
  return {
    max_tokens: body.max_tokens,
    temperature: body.temperature ?? null,
    stream: body.stream === true,
    message_count: body.messages.length,
    tool_use_count: countToolUseBlocks(body.messages),
  };
}

function countToolUseBlocks(messages: AnthropicMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type === 'tool_use' || b.type === 'tool_result') n++;
    }
  }
  return n;
}

// ---------------------- stream collector ----------------------

interface StreamCollector {
  onEvent: (evt: SSEEvent) => void;
  build: () => AnthropicMessagesResponse | null;
}

function createStreamCollector(): StreamCollector {
  let base: AnthropicMessagesResponse | null = null;
  const contentBuffers: string[] = [];
  const contentBlocks: ContentBlock[] = [];
  let finalUsage: Usage = EMPTY_USAGE;
  let stopReason: AnthropicMessagesResponse['stop_reason'] = null;
  let stopSequence: string | null = null;

  return {
    onEvent(evt) {
      switch (evt.type) {
        case 'message_start':
          base = evt.message;
          finalUsage = evt.message.usage;
          return;
        case 'content_block_start':
          contentBlocks[evt.index] = evt.content_block;
          contentBuffers[evt.index] =
            evt.content_block.type === 'text' ? evt.content_block.text : '';
          return;
        case 'content_block_delta': {
          const delta = (evt as ContentBlockDeltaEvent).delta;
          if (delta.type === 'text_delta') {
            contentBuffers[evt.index] =
              (contentBuffers[evt.index] ?? '') + delta.text;
          }
          return;
        }
        case 'content_block_stop': {
          const block = contentBlocks[evt.index];
          if (block && block.type === 'text') {
            contentBlocks[evt.index] = {
              type: 'text',
              text: contentBuffers[evt.index] ?? '',
            };
          }
          return;
        }
        case 'message_delta':
          if (evt.delta.stop_reason !== undefined) stopReason = evt.delta.stop_reason;
          if (evt.delta.stop_sequence !== undefined) stopSequence = evt.delta.stop_sequence;
          finalUsage = { ...finalUsage, ...evt.usage };
          return;
        default:
          return;
      }
    },
    build() {
      if (!base) return null;
      return {
        ...base,
        content: contentBlocks.filter((b): b is ContentBlock => !!b),
        stop_reason: stopReason ?? base.stop_reason,
        stop_sequence: stopSequence ?? base.stop_sequence,
        usage: finalUsage,
      };
    },
  };
}
