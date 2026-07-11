import { randomUUID } from 'node:crypto';
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  ContentBlock,
  SSEEvent,
  Usage,
} from '../types/anthropic.js';
import type {
  AdvisorResult,
  AggregatorResult,
  Logger,
  MoMConfig,
  ProviderConfig,
  RuntimeConfig,
  Trace,
  TriggerReason,
} from '../types/mom.js';
import { passthroughCall } from '../provider/provider-client.js';
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
import { calculateCost } from '../cost/pricing.js';
import { saveTrace } from '../storage/traces.js';

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

export interface Orchestrator {
  nonStreaming(
    body: AnthropicMessagesRequest,
    log: Logger,
  ): Promise<AnthropicMessagesResponse>;
  streaming(
    body: AnthropicMessagesRequest,
    output: NodeJS.WritableStream,
    log: Logger,
  ): Promise<void>;
}

export function createOrchestrator(runtime: RuntimeConfig): Orchestrator {
  const { provider, mom } = runtime;
  const cache = createFanoutCache({
    max_entries: mom.cache.max_entries,
    ttl_ms: parseTTL(mom.cache.ttl),
  });
  return {
    nonStreaming: (body, log) =>
      orchestrateNonStreaming(body, provider, mom, cache, log),
    streaming: (body, output, log) =>
      orchestrateStreaming(body, output, provider, mom, cache, log),
  };
}
async function orchestrateNonStreaming(
  body: AnthropicMessagesRequest,
  provider: ProviderConfig,
  mom: MoMConfig,
  cache: FanoutCache,
  log: Logger,
): Promise<AnthropicMessagesResponse> {
  const startedAt = Date.now();
  if (mom.mom_mode !== 'always') {
    const response = await passthroughCall(body, provider);
    persistPassthroughTrace(body, response, startedAt, mom, log);
    return response;
  }
  const { advisorResults, triggerReason, cacheHit } = await runFanoutStage(
    body,
    provider,
    mom,
    cache,
    log,
  );
  const aggregatorResult = await runAggregatorNonStreaming(
    body,
    advisorResults,
    mom,
    provider,
  );
  log.info(
    {
      event: 'aggregator_complete',
      model: aggregatorResult.model,
      duration_ms: aggregatorResult.latency_ms,
      trigger_reason: triggerReason,
      cache_hit: cacheHit,
    },
    'aggregator complete',
  );
  persistMoMTrace({
    body,
    response: aggregatorResult.response,
    advisorResults,
    aggregatorResult,
    triggerReason,
    startedAt,
    mom,
    log,
  });
  return aggregatorResult.response as AnthropicMessagesResponse;
}
async function orchestrateStreaming(
  body: AnthropicMessagesRequest,
  output: NodeJS.WritableStream,
  provider: ProviderConfig,
  mom: MoMConfig,
  cache: FanoutCache,
  log: Logger,
): Promise<void> {
  const startedAt = Date.now();
  if (mom.mom_mode !== 'always') {
    const collected = createStreamCollector();
    await passthroughStream(body, output, provider, {
      onEvent: collected.onEvent,
      log,
    });
    persistPassthroughTrace(body, collected.build(), startedAt, mom, log);
    return;
  }
  const { advisorResults, triggerReason, cacheHit } = await runFanoutStage(
    body,
    provider,
    mom,
    cache,
    log,
  );
  const collected = createStreamCollector();
  const aggregatorStartedAt = Date.now();
  const { references_appended } = await runAggregatorStreaming(
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
    latency_ms: Date.now() - aggregatorStartedAt,
    references_appended,
  };
  log.info(
    {
      event: 'aggregator_stream_complete',
      model: aggregatorResult.model,
      duration_ms: aggregatorResult.latency_ms,
      trigger_reason: triggerReason,
      cache_hit: cacheHit,
    },
    'aggregator stream complete',
  );
  persistMoMTrace({
    body,
    response,
    advisorResults,
    aggregatorResult,
    triggerReason,
    startedAt,
    mom,
    log,
  });
}
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
        case 'content_block_delta':
          if (evt.delta.type === 'text_delta') {
            contentBuffers[evt.index] =
              (contentBuffers[evt.index] ?? '') + evt.delta.text;
          }
          return;
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
interface PersistMoMTraceInput {
  body: AnthropicMessagesRequest;
  response: AnthropicMessagesResponse | null;
  advisorResults: AdvisorResult[];
  aggregatorResult: AggregatorResult;
  triggerReason: TriggerReason;
  startedAt: number;
  mom: MoMConfig;
  log: Logger;
}

function persistMoMTrace(input: PersistMoMTraceInput): void {
  const {
    body, response, advisorResults, aggregatorResult, triggerReason, startedAt, mom, log,
  } = input;
  const advisorCost = advisorResults.reduce(
    (acc, r) => acc + calculateCost(r.slot, r.usage, mom.pricing_table, log),
    0,
  );
  const aggregatorCost = calculateCost(
    aggregatorResult.model,
    aggregatorResult.usage,
    mom.pricing_table,
    log,
  );
  const trace: Trace = {
    id: randomUUID(),
    timestamp: startedAt,
    request: body,
    response,
    mom_triggered: true,
    trigger_reason: triggerReason,
    advisor_results: advisorResults,
    aggregator_result: aggregatorResult,
    judge_result: null,
    baseline_result: null,
    total_cost_usd: advisorCost + aggregatorCost,
    baseline_cost_usd: null,
    total_latency_ms: Date.now() - startedAt,
    settings_snapshot: structuredClone(mom),
  };
  writeTrace(trace, log);
}

function persistPassthroughTrace(
  body: AnthropicMessagesRequest,
  response: AnthropicMessagesResponse | null,
  startedAt: number,
  mom: MoMConfig,
  log: Logger,
): void {
  const trace: Trace = {
    id: randomUUID(),
    timestamp: startedAt,
    request: body,
    response,
    mom_triggered: false,
    trigger_reason: 'mom_off',
    advisor_results: [],
    aggregator_result: null,
    judge_result: null,
    baseline_result: null,
    total_cost_usd: 0,
    baseline_cost_usd: null,
    total_latency_ms: Date.now() - startedAt,
    settings_snapshot: structuredClone(mom),
  };
  writeTrace(trace, log);
}

function writeTrace(trace: Trace, log: Logger): void {
  try {
    saveTrace(trace);
  } catch (err) {
    log.error(
      {
        event: 'trace_save_failed',
        trace_id: trace.id,
        error: err instanceof Error ? err.message : String(err),
      },
      'failed to save trace',
    );
  }
}

