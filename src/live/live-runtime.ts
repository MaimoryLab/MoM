import { randomUUID } from 'node:crypto';
import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
  ContentBlock,
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
import { DEFAULT_LIVE_MAX_TOKENS, TRACE_TEXT_MAX_BYTES } from '../types/mom.js';
import { createOrchestrator } from '../orchestrator/orchestrator.js';
import {
  calculateCostFromSnapshot,
  snapshotPricing,
  toTraceUsage,
} from '../cost/pricing.js';
import { getTraceRequestsByGatewayRequestId, saveTraceRequest } from '../storage/traces.js';
import { runBaselineCall } from './baseline.js';
import { runJudgeCompare } from '../judge/judge-runtime.js';
import {
  createComparison,
  updateComparisonBaseline,
  updateComparisonBaselineError,
  updateComparisonJudge,
  updateComparisonJudgeError,
  updateComparisonMom,
  updateComparisonMomError,
} from './live-store.js';

export interface LiveRunInput {
  prompt: string;
  baseline_on: boolean;
  lang: 'zh' | 'en';
}

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

function extractHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * Byte-safe truncation identical to orchestrator's — kept local to avoid a
 * cross-module import from a live/ file into orchestrator/.
 */
function truncateForTrace(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  if (text.length === 0) return null;
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  if (bytes.byteLength <= TRACE_TEXT_MAX_BYTES) return text;
  const marker = '\n…[truncated]';
  const markerLen = enc.encode(marker).byteLength;
  const cap = TRACE_TEXT_MAX_BYTES - markerLen;
  const dec = new TextDecoder('utf-8');
  const clipped = dec.decode(bytes.slice(0, cap), { stream: false });
  return clipped + marker;
}

function buildAnthropicRequest(prompt: string, model: string, maxTokens: number): AnthropicMessagesRequest {
  const messages: AnthropicMessage[] = [{ role: 'user', content: prompt }];
  return {
    model,
    messages,
    max_tokens: maxTokens,
    stream: false,
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
  responseText: string | null;
  lastUserText: string | null;
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
    response_text: truncateForTrace(input.responseText),
    references_appended: null,
    last_user_text: truncateForTrace(input.lastUserText),
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
}

/**
 * Kick off a Live comparison job. Runs synchronously enough to insert the
 * `comparisons` row and return the freshly-minted `gateway_request_id`, then
 * spawns background work via `runLiveTurn`. The HTTP handler responds 202 with
 * that id so the front-end can start polling GET /api/comparison/:gwId.
 */
export function submitLiveTurn(
  input: LiveRunInput,
  deps: RunLiveTurnDeps,
): { gateway_request_id: string; session_id: string } {
  const { runtime, log } = deps;
  const { mom } = runtime;
  const gatewayRequestId = randomUUID();
  const sessionId = randomUUID();

  const baselineOn = input.baseline_on && mom.comparison.baseline_model.length > 0;

  createComparison({
    gateway_request_id: gatewayRequestId,
    session_id: sessionId,
    lang: input.lang,
    prompt_text: input.prompt,
    advisors_snapshot: [...mom.advisor.slots],
    aggregator_model: mom.aggregator.model,
    baseline_model_snapshot: baselineOn ? mom.comparison.baseline_model : null,
  });

  // Fire-and-forget; runLiveTurn is designed to never throw. queueMicrotask
  // gets us off the request thread so the 202 flushes immediately.
  queueMicrotask(() => {
    runLiveTurn(input, deps, gatewayRequestId, sessionId).catch((err) => {
      log.error(
        {
          event: 'live_run_uncaught',
          gateway_request_id: gatewayRequestId,
          error: err instanceof Error ? err.message : String(err),
        },
        'live run threw despite defensive handling',
      );
    });
  });

  return { gateway_request_id: gatewayRequestId, session_id: sessionId };
}

/**
 * End-to-end Live turn (background execution): MoM + optional baseline
 * (concurrent) + judge compare (once both are done). Writes everything into
 * the `comparisons` row and a set of `traces` rows (roles: aggregator +
 * baseline + judge). Never rejects — swallows all errors into the store.
 */
export async function runLiveTurn(
  input: LiveRunInput,
  deps: RunLiveTurnDeps,
  gatewayRequestId: string,
  sessionId: string,
): Promise<void> {
  const { runtime, log } = deps;
  const { provider, mom, mom_config_source } = runtime;
  const providerHost = extractHost(provider.base_url);

  const liveMaxTokens = mom.live?.max_tokens ?? DEFAULT_LIVE_MAX_TOKENS;
  const anthropicReq = buildAnthropicRequest(input.prompt, mom.aggregator.model, liveMaxTokens);
  const orchestrator = createOrchestrator(runtime);

  const momStartedAt = Date.now();
  const momPromise = (async () => {
    try {
      const response = await orchestrator.nonStreaming(anthropicReq, sessionId, log, gatewayRequestId);
      const finishedAt = Date.now();
      const fullText = extractResponseText(response.content);
      // MoM cost & tokens must span the *whole* pipeline (advisors +
      // aggregator), not just the aggregator's own call. Traces for both
      // roles are already persisted by orchestrator at this point; read
      // them back and sum. Fixes the "tokens low but cost high" mismatch:
      // previously token display = aggregator.output_tokens while cost
      // display included baseline+judge indirectly via Cost card, which
      // made the two numbers look inconsistent.
      const rolledUp = rollUpMomUsageAndCost(gatewayRequestId, finishedAt - momStartedAt);
      updateComparisonMom(
        gatewayRequestId,
        {
          text: fullText,
          usage: rolledUp.usage,
          cost_usd: rolledUp.cost,
          finished_at: finishedAt,
          latency_ms: finishedAt - momStartedAt,
        },
        'mom_done',
      );
      return { ok: true as const, text: fullText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { event: 'live_mom_failed', gateway_request_id: gatewayRequestId, error: message },
        'live MoM pipeline failed',
      );
      updateComparisonMomError(gatewayRequestId, { message }, 'error');
      return { ok: false as const, text: '' };
    }
  })();

  const baselineModel = mom.comparison.baseline_model;
  const baselineFinalizedPromise: Promise<{ text: string | null }> =
    input.baseline_on && baselineModel
      ? runBaselineCall(anthropicReq, baselineModel, provider).then((result) =>
          finalizeBaseline({
            result,
            mom,
            mom_config_source,
            gatewayRequestId,
            sessionId,
            providerHost,
            anthropicReq,
            log,
          }),
        )
      : Promise.resolve({ text: null });

  const [momOutcome, baselineOutcome] = await Promise.all([
    momPromise,
    baselineFinalizedPromise,
  ]);

  const canJudge =
    momOutcome.ok &&
    momOutcome.text.length > 0 &&
    input.baseline_on &&
    baselineOutcome.text !== null &&
    baselineOutcome.text.length > 0 &&
    mom.judge.model.length > 0;

  if (canJudge) {
    const judgeResult = await runJudgeCompare({
      lang: input.lang,
      prompt: input.prompt,
      momText: momOutcome.text,
      baselineText: baselineOutcome.text as string,
      judge: mom.judge,
      provider,
    });
    finalizeJudge({
      judgeResult,
      mom,
      mom_config_source,
      gatewayRequestId,
      sessionId,
      providerHost,
      anthropicReq,
      log,
    });
  }
}

function extractResponseText(content: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'text') parts.push(b.text);
  }
  return parts.join('');
}

// Sum usage + cost across every advisor + aggregator trace for this
// gatewayRequestId. Each trace already stores its own PricingSnapshot, so
// cost is per-row and only requires summing. baseline / judge traces are
// deliberately excluded — they are shown as their own line items on the
// Live page, not folded into "MoM".
function rollUpMomUsageAndCost(
  gatewayRequestId: string,
  _latencyMs: number,
): { usage: TraceUsage; cost: number | null } {
  const traces = getTraceRequestsByGatewayRequestId(gatewayRequestId);
  const usage: TraceUsage = {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
  };
  let cost = 0;
  let anyPricing = false;
  for (const tr of traces) {
    if (tr.role !== 'advisor' && tr.role !== 'aggregator') continue;
    usage.input_tokens += tr.usage.input_tokens;
    usage.cache_read_tokens += tr.usage.cache_read_tokens;
    usage.cache_creation_tokens += tr.usage.cache_creation_tokens;
    usage.output_tokens += tr.usage.output_tokens;
    usage.reasoning_tokens += tr.usage.reasoning_tokens;
    if (tr.pricing) {
      anyPricing = true;
      cost += calculateCostFromSnapshot(tr.usage, tr.pricing);
    }
  }
  return { usage, cost: anyPricing ? cost : null };
}

function finalizeBaseline(args: {
  result: BaselineResult;
  mom: RuntimeConfig['mom'];
  mom_config_source: string;
  gatewayRequestId: string;
  sessionId: string;
  providerHost: string;
  anthropicReq: AnthropicMessagesRequest;
  log: Logger;
}): { text: string | null } {
  const { result, mom, mom_config_source, gatewayRequestId, sessionId, providerHost, anthropicReq, log } = args;
  const traceUsage = toTraceUsage(result.usage);
  const pricing = snapshotPricing(result.model, mom.pricing_table, mom_config_source);
  const cost = pricing ? calculateCostFromSnapshot(traceUsage, pricing) : null;

  if (result.error) {
    updateComparisonBaselineError(
      gatewayRequestId,
      { message: result.error.message },
      'pending',
    );
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
    responseText: result.error ? null : result.text,
    lastUserText: typeof anthropicReq.messages[0]?.content === 'string'
      ? (anthropicReq.messages[0].content as string)
      : null,
    log,
  });

  return { text: result.error ? null : result.text };
}

function finalizeJudge(args: {
  judgeResult: JudgeCompareResult;
  mom: RuntimeConfig['mom'];
  mom_config_source: string;
  gatewayRequestId: string;
  sessionId: string;
  providerHost: string;
  anthropicReq: AnthropicMessagesRequest;
  log: Logger;
}): void {
  const { judgeResult, mom, mom_config_source, gatewayRequestId, sessionId, providerHost, anthropicReq, log } = args;
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
    responseText: judgeResult.raw ? String(judgeResult.raw).slice(0, 2000) : null,
    lastUserText: null,
    log,
  });
}
