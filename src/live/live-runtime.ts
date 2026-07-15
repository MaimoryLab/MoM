import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
  ContentBlockDeltaEvent,
  SSEEvent,
  Usage,
} from '../types/anthropic.js';
import type {
  BaselineResult,
  JudgeCompareResult,
  Logger,
  RuntimeConfig,
  TraceError,
  TraceRequest,
  TraceUsage,
} from '../types/mom.js';
import type {
  ComparisonUsage,
  ComparisonStatus,
} from '../types/dashboard-api.js';
import { createOrchestrator } from '../orchestrator/orchestrator.js';
import {
  calculateCostFromSnapshot,
  snapshotPricing,
  toTraceUsage,
} from '../cost/pricing.js';
import { saveTraceRequest } from '../storage/traces.js';
import { runBaselineCall } from './baseline.js';
import { runJudgeCompare } from '../judge/judge-runtime.js';
import {
  createComparison,
  updateComparisonBaseline,
  updateComparisonBaselineError,
  updateComparisonJudge,
  updateComparisonJudgeError,
  updateComparisonMom,
} from './live-store.js';
import { writeLiveEvent, type LiveEvent } from './live-events.js';

export interface LiveRunInput {
  prompt: string;
  baseline_on: boolean;
  lang: 'zh' | 'en';
}

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };
const LIVE_MAX_TOKENS = 2048;

function extractHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function toComparisonUsage(usage: TraceUsage): ComparisonUsage {
  return {
    input_tokens: usage.input_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
    output_tokens: usage.output_tokens,
  };
}

/**
 * A drop-in `NodeJS.WritableStream` that never writes bytes anywhere — the
 * orchestrator's internal streaming path builds and writes Anthropic SSE
 * frames toward `output`, but for Live runs we want to filter through the
 * event observer only and emit our own `mom_delta` frames on the outer SSE.
 */
class DevNullWritable extends Writable {
  override _write(
    _chunk: unknown,
    _enc: BufferEncoding,
    cb: (error?: Error | null) => void,
  ): void {
    cb();
  }
}

interface MomStreamCollector {
  onEvent: (evt: SSEEvent) => void;
  getFullText: () => string;
  getFinalUsage: () => Usage;
}

/**
 * Turn orchestrator SSE events into `mom_delta` LiveEvents and accumulate the
 * final text + usage for the `mom_done` frame.
 */
function createMomStreamCollector(
  output: NodeJS.WritableStream,
): MomStreamCollector {
  const buffers: string[] = [];
  let finalUsage: Usage = EMPTY_USAGE;
  return {
    onEvent(evt) {
      switch (evt.type) {
        case 'message_start':
          finalUsage = evt.message.usage;
          return;
        case 'content_block_start':
          buffers[evt.index] =
            evt.content_block.type === 'text' ? evt.content_block.text : '';
          return;
        case 'content_block_delta': {
          const delta = (evt as ContentBlockDeltaEvent).delta;
          if (delta.type === 'text_delta') {
            buffers[evt.index] = (buffers[evt.index] ?? '') + delta.text;
            writeLiveEvent(output, { type: 'mom_delta', text: delta.text });
          }
          return;
        }
        case 'message_delta':
          finalUsage = { ...finalUsage, ...evt.usage };
          return;
        default:
          return;
      }
    },
    getFullText() {
      return buffers.join('');
    },
    getFinalUsage() {
      return finalUsage;
    },
  };
}

function buildAnthropicRequest(prompt: string, model: string): AnthropicMessagesRequest {
  const messages: AnthropicMessage[] = [{ role: 'user', content: prompt }];
  return {
    model,
    messages,
    max_tokens: LIVE_MAX_TOKENS,
    stream: true,
  };
}

interface WriteTraceInput {
  role: TraceRequest['role'];
  sessionId: string;
  gatewayRequestId: string;
  providerHost: string;
  clientModel: string;
  selectedModel: string;
  startedAt: number;
  finishedAt: number;
  status: TraceRequest['status'];
  usage: TraceUsage;
  pricing: TraceRequest['pricing'];
  error: TraceError | null;
  requestSummary: TraceRequest['request_summary'];
  responseSummary: TraceRequest['response_summary'];
  settingsSnapshot: TraceRequest['settings_snapshot'];
  log: Logger;
}

function writeTrace(input: WriteTraceInput): void {
  const trace: TraceRequest = {
    request_id: randomUUID(),
    session_id: input.sessionId,
    gateway_request_id: input.gatewayRequestId,
    role: input.role,
    client_model: input.clientModel,
    selected_model: input.selectedModel,
    provider: input.providerHost,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    duration_ms: input.finishedAt - input.startedAt,
    status: input.status,
    usage: input.usage,
    pricing: input.pricing,
    error: input.error,
    request_summary: input.requestSummary,
    response_summary: input.responseSummary,
    trigger_reason: 'user_turn',
    cache_hit: false,
    settings_snapshot: input.settingsSnapshot,
  };
  try {
    saveTraceRequest(trace);
  } catch (err) {
    input.log.error(
      {
        event: 'live_trace_save_failed',
        request_id: trace.request_id,
        role: trace.role,
        error: err instanceof Error ? err.message : String(err),
      },
      'failed to save live-run trace',
    );
  }
}

export interface RunLiveTurnDeps {
  runtime: RuntimeConfig;
  log: Logger;
  output: NodeJS.WritableStream;
}

/**
 * End-to-end Live turn: MoM streaming + baseline (optional, concurrent) +
 * judge compare (once both are done). Emits SSE events on `output` and
 * updates the `comparisons` row + writes baseline/judge TraceRequests along
 * the way. Never rejects — surfaces failures as SSE `*_error` events.
 */
export async function runLiveTurn(
  input: LiveRunInput,
  deps: RunLiveTurnDeps,
): Promise<void> {
  const { runtime, log, output } = deps;
  const { provider, mom, mom_config_source } = runtime;
  const providerHost = extractHost(provider.base_url);
  const gatewayRequestId = randomUUID();
  const sessionId = randomUUID();

  createComparison({
    gateway_request_id: gatewayRequestId,
    session_id: sessionId,
    lang: input.lang,
    prompt_text: input.prompt,
  });

  writeLiveEvent(output, {
    type: 'created',
    gateway_request_id: gatewayRequestId,
    session_id: sessionId,
  });

  // Build the outbound Anthropic request. `client_model` is the aggregator
  // model — Live has no upstream client so we use it as a stable label.
  const anthropicReq = buildAnthropicRequest(input.prompt, mom.aggregator.model);

  const orchestrator = createOrchestrator(runtime);
  const collector = createMomStreamCollector(output);

  // Sink writable that swallows the orchestrator's SSE frames; the collector's
  // onEvent hook is the real observer.
  const sink = new DevNullWritable();

  const momStartedAt = Date.now();
  const momPromise = (async () => {
    try {
      await runStreamingWithObserver(
        orchestrator,
        anthropicReq,
        sessionId,
        sink,
        log,
        collector.onEvent,
      );
      const finishedAt = Date.now();
      const rawUsage = collector.getFinalUsage();
      const traceUsage = toTraceUsage(rawUsage);
      const pricing = snapshotPricing(
        mom.aggregator.model,
        mom.pricing_table,
        mom_config_source,
      );
      const cost = pricing ? calculateCostFromSnapshot(traceUsage, pricing) : null;
      const fullText = collector.getFullText();

      updateComparisonMom(
        gatewayRequestId,
        {
          text: fullText,
          usage: traceUsage,
          cost_usd: cost,
          finished_at: finishedAt,
          latency_ms: finishedAt - momStartedAt,
        },
        'mom_done',
      );

      writeLiveEvent(output, {
        type: 'mom_done',
        text_full: fullText,
        usage: toComparisonUsage(traceUsage),
        cost_usd: cost,
        latency_ms: finishedAt - momStartedAt,
      });
      return { ok: true as const, text: fullText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { event: 'live_mom_failed', gateway_request_id: gatewayRequestId, error: message },
        'live MoM streaming failed',
      );
      writeLiveEvent(output, { type: 'mom_error', message });
      return { ok: false as const, text: '' };
    }
  })();

  // Baseline branch. When disabled we resolve with a sentinel skipped flag.
  const baselineModel = mom.comparison.baseline_model;
  const baselinePromise: Promise<
    | { skipped: true }
    | { skipped: false; result: BaselineResult }
  > = input.baseline_on && baselineModel
    ? runBaselineCall(anthropicReq, baselineModel, provider).then((result) => ({
        skipped: false,
        result,
      }))
    : Promise.resolve({ skipped: true });

  // Kick off baseline in parallel; its finalization runs independently.
  const baselineFinalizedPromise = baselinePromise.then((outcome) => {
    if (outcome.skipped) return { text: null as string | null };
    const { result } = outcome;
    const traceUsage = toTraceUsage(result.usage);
    const pricing = snapshotPricing(result.model, mom.pricing_table, mom_config_source);
    const cost = pricing ? calculateCostFromSnapshot(traceUsage, pricing) : null;

    if (result.error) {
      updateComparisonBaselineError(
        gatewayRequestId,
        { message: result.error.message },
        'pending',
      );
      writeLiveEvent(output, {
        type: 'baseline_error',
        message: result.error.message,
      });
    } else {
      updateComparisonBaseline(
        gatewayRequestId,
        {
          model: result.model,
          text: result.text,
          usage: traceUsage,
          cost_usd: cost,
          finished_at: result.finished_at,
          latency_ms: result.latency_ms,
        },
        'baseline_done',
      );
      writeLiveEvent(output, {
        type: 'baseline_done',
        model: result.model,
        text: result.text,
        usage: toComparisonUsage(traceUsage),
        cost_usd: cost,
        latency_ms: result.latency_ms,
      });
    }

    writeTrace({
      role: 'baseline',
      sessionId,
      gatewayRequestId,
      providerHost,
      clientModel: anthropicReq.model,
      selectedModel: result.model,
      startedAt: result.started_at,
      finishedAt: result.finished_at,
      status: result.error ? 'error' : 'success',
      usage: traceUsage,
      pricing,
      error: result.error,
      requestSummary: {
        max_tokens: anthropicReq.max_tokens,
        temperature: anthropicReq.temperature ?? null,
        stream: false,
        message_count: anthropicReq.messages.length,
        tool_use_count: 0,
      },
      responseSummary: result.response
        ? {
            id: result.response.id,
            stop_reason: result.response.stop_reason,
            stop_sequence: result.response.stop_sequence,
          }
        : null,
      settingsSnapshot: structuredClone(mom),
      log,
    });

    return { text: result.error ? null : result.text };
  });

  const [momOutcome, baselineOutcome] = await Promise.all([
    momPromise,
    baselineFinalizedPromise,
  ]);

  // Judge — only if both sides produced usable text.
  let terminalStatus: ComparisonStatus = 'baseline_done';
  const canJudge =
    momOutcome.ok &&
    momOutcome.text.length > 0 &&
    input.baseline_on &&
    baselineOutcome.text !== null &&
    baselineOutcome.text.length > 0 &&
    mom.judge.model.length > 0;

  if (canJudge) {
    const judgeResult: JudgeCompareResult = await runJudgeCompare({
      lang: input.lang,
      prompt: input.prompt,
      momText: momOutcome.text,
      baselineText: baselineOutcome.text as string,
      judge: mom.judge,
      provider,
    });
    const judgeUsage = toTraceUsage(judgeResult.usage);
    const pricing = snapshotPricing(
      judgeResult.model,
      mom.pricing_table,
      mom_config_source,
    );

    if (judgeResult.error) {
      updateComparisonJudgeError(
        gatewayRequestId,
        { message: judgeResult.error.message },
        'judge_done',
      );
      writeLiveEvent(output, {
        type: 'judge_error',
        message: judgeResult.error.message,
      });
      terminalStatus = 'judge_done';
    } else if (judgeResult.scores) {
      updateComparisonJudge(
        gatewayRequestId,
        {
          model: judgeResult.model,
          scores: judgeResult.scores,
          verdict_summary: judgeResult.verdict_summary,
          fallback: judgeResult.fallback,
          ab_mapping: judgeResult.ab_mapping,
          finished_at: judgeResult.finished_at,
        },
        'judge_done',
      );
      writeLiveEvent(output, {
        type: 'judge_done',
        model: judgeResult.model,
        scores: judgeResult.scores,
        verdict_summary: judgeResult.verdict_summary,
        fallback: judgeResult.fallback,
      });
      terminalStatus = 'judge_done';
    }

    writeTrace({
      role: 'judge',
      sessionId,
      gatewayRequestId,
      providerHost,
      clientModel: anthropicReq.model,
      selectedModel: judgeResult.model,
      startedAt: judgeResult.started_at,
      finishedAt: judgeResult.finished_at,
      status: judgeResult.error ? 'error' : 'success',
      usage: judgeUsage,
      pricing,
      error: judgeResult.error,
      requestSummary: {
        max_tokens: 1024,
        temperature: 0,
        stream: false,
        message_count: 1,
        tool_use_count: 0,
      },
      responseSummary: null,
      settingsSnapshot: structuredClone(mom),
      log,
    });
  } else if (momOutcome.ok) {
    terminalStatus = input.baseline_on ? 'baseline_done' : 'mom_done';
  } else {
    terminalStatus = 'error';
  }

  writeLiveEvent(output, { type: 'end', status: terminalStatus });
  const w = output as NodeJS.WritableStream & { writableEnded?: boolean };
  if (!w.writableEnded) output.end();
}

/**
 * Thin adapter that mirrors `orchestrator.streaming` but plumbs an extra
 * observer through. Achieved by monkey-patching the writable's `write` — the
 * orchestrator already fans SSE events into the writable, so we accept those
 * bytes and re-parse; but we already receive normalized SSEEvent instances
 * through the passthrough stream layer's `onEvent` hook. The orchestrator API
 * doesn't take that hook, so we replicate its streaming code path here.
 *
 * Implementation note: since createOrchestrator exposes only `streaming(body,
 * sid, output, log)`, and its internal code already fans an observer for its
 * own aggregator collector, we hijack by giving it the sink writable and rely
 * on the Anthropic SSE frames the orchestrator writes to that sink to
 * reconstruct events via the shared SSE parser.
 */
async function runStreamingWithObserver(
  orchestrator: ReturnType<typeof createOrchestrator>,
  body: AnthropicMessagesRequest,
  sessionId: string,
  sink: NodeJS.WritableStream,
  log: Logger,
  onEvent: (evt: SSEEvent) => void,
): Promise<void> {
  // Wrap sink so every SSE frame written by the orchestrator is also parsed
  // into a normalized event and forwarded to `onEvent`.
  const { createSSEParser } = await import('../gateway/sse.js');
  const parser = createSSEParser();
  const observed = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      try {
        const events = parser.push(chunk);
        for (const raw of events) {
          if (raw.data === '') continue;
          try {
            const parsed = JSON.parse(raw.data) as SSEEvent;
            onEvent(parsed);
          } catch {
            /* non-JSON frame: ignore (error frames go through raw path) */
          }
        }
      } catch {
        /* ignore parse issues in observer */
      }
      // Also forward to the true sink (dev null) so backpressure semantics stay sane.
      sink.write(chunk, () => cb());
    },
    final(cb) {
      sink.end();
      cb();
    },
  });
  await orchestrator.streaming(body, sessionId, observed, log);
}
