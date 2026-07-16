import type {
  AnthropicMessagesRequest,
  ContentBlock,
} from '../types/anthropic.js';
import type {
  JudgeCompareResult,
  JudgeScores,
  JudgeSettings,
  Logger,
  ProviderConfig,
} from '../types/mom.js';
import { passthroughCall, toTraceError } from '../provider/provider-client.js';
import {
  JUDGE_COMPARE_PROMPT_EN,
  JUDGE_COMPARE_PROMPT_ZH,
  buildJudgeCompareUserMessage,
} from './judge-prompt.js';
import { parseJudgeCompare } from './judge-parse.js';

const JUDGE_MAX_TOKENS = 1024;

// Bounded retry when the judge model outputs unparseable JSON or the request
// itself fails. Upper cap of 5 attempts to avoid unbounded token spend on a
// consistently broken model; each retry bumps temperature slightly so the
// model produces a different sample rather than repeating the same malformed
// output. Transport 4xx (auth / bad request) are treated as permanent and
// don't consume retry budget.
const JUDGE_MAX_ATTEMPTS = 5;
const JUDGE_RETRY_TEMPERATURES = [0, 0.1, 0.2, 0.3, 0.4];

const EMPTY_USAGE = { input_tokens: 0, output_tokens: 0 };

const EMPTY_SCORES: JudgeScores = {
  correctness: 0,
  completeness: 0,
  depth: 0,
  clarity: 0,
  usefulness: 0,
};

function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export interface RunJudgeCompareInput {
  lang: 'zh' | 'en';
  prompt: string;
  momText: string;
  baselineText: string;
  judge: JudgeSettings;
  provider: ProviderConfig;
  /** Injectable for tests; defaults to `Math.random`. */
  rand?: () => number;
  /** Optional logger — retries emit `judge_retry` events for debuggability. */
  log?: Logger;
}

/**
 * Run judge with bounded retries. A single attempt can fail two ways: transport
 * error (network / 5xx / provider hiccup) or parse error (model returned JSON
 * with the wrong shape or non-JSON). Both are re-tried up to JUDGE_MAX_ATTEMPTS
 * total; 4xx errors are treated as permanent (bad request / auth failure —
 * retrying won't help). Usage and latency accumulate across all attempts so
 * cost accounting stays accurate. Never throws.
 */
export async function runJudgeCompare(
  input: RunJudgeCompareInput,
): Promise<JudgeCompareResult> {
  const rand = input.rand ?? Math.random;
  // A/B mapping is decided once and reused across retries so the returned
  // scores line up with a single mapping — otherwise a retry could flip the
  // mapping and re-scramble the semantics for the caller.
  const aIsMom = rand() < 0.5;
  const ab_mapping: JudgeCompareResult['ab_mapping'] = aIsMom
    ? { A: 'mom', B: 'baseline' }
    : { A: 'baseline', B: 'mom' };

  const start = Date.now();
  let cumUsageInput = 0;
  let cumUsageOutput = 0;
  let lastAttempt: JudgeCompareResult | null = null;

  for (let attempt = 0; attempt < JUDGE_MAX_ATTEMPTS; attempt++) {
    const temperature = JUDGE_RETRY_TEMPERATURES[attempt] ?? 0.4;
    const result = await runJudgeCompareOnce(input, aIsMom, ab_mapping, temperature);
    cumUsageInput += result.usage.input_tokens ?? 0;
    cumUsageOutput += result.usage.output_tokens ?? 0;
    lastAttempt = result;

    const transportOk = result.error === null;
    const parseOk = !result.parse_error;
    if (transportOk && parseOk) {
      // Overwrite the per-attempt usage/latency with cumulative values so
      // the caller's cost accounting reflects every retry that ran.
      return {
        ...result,
        usage: { input_tokens: cumUsageInput, output_tokens: cumUsageOutput },
        latency_ms: Date.now() - start,
      };
    }

    // Permanent failures: 4xx auth / bad request. Retrying wouldn't help.
    const status = result.error?.http_status ?? null;
    if (status !== null && status >= 400 && status < 500) {
      input.log?.warn(
        { event: 'judge_permanent_failure', http_status: status, message: result.error?.message },
        'judge failed with permanent 4xx, not retrying',
      );
      break;
    }

    input.log?.info(
      {
        event: 'judge_retry',
        attempt: attempt + 1,
        total: JUDGE_MAX_ATTEMPTS,
        reason: parseOk ? 'transport_error' : 'parse_error',
        next_temperature: JUDGE_RETRY_TEMPERATURES[attempt + 1] ?? 0.4,
      },
      'judge attempt failed, retrying',
    );
  }

  // Exhausted all attempts — return the last failure with cumulative usage.
  const finalResult = lastAttempt!;
  return {
    ...finalResult,
    usage: { input_tokens: cumUsageInput, output_tokens: cumUsageOutput },
    latency_ms: Date.now() - start,
  };
}

async function runJudgeCompareOnce(
  input: RunJudgeCompareInput,
  aIsMom: boolean,
  ab_mapping: JudgeCompareResult['ab_mapping'],
  temperature: number,
): Promise<JudgeCompareResult> {
  const responseA = aIsMom ? input.momText : input.baselineText;
  const responseB = aIsMom ? input.baselineText : input.momText;

  const systemPrompt =
    input.judge.system_prompt?.trim() ||
    (input.lang === 'zh' ? JUDGE_COMPARE_PROMPT_ZH : JUDGE_COMPARE_PROMPT_EN);

  const req: AnthropicMessagesRequest = {
    model: input.judge.model,
    max_tokens: JUDGE_MAX_TOKENS,
    temperature,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: buildJudgeCompareUserMessage({
          lang: input.lang,
          prompt: input.prompt,
          responseA,
          responseB,
        }),
      },
    ],
  };

  const started_at = Date.now();
  let response;
  try {
    response = await passthroughCall(req, input.provider);
  } catch (err) {
    const finished_at = Date.now();
    return {
      model: input.judge.model,
      raw: '',
      scores: null,
      verdict_summary: null,
      fallback: false,
      parse_error: false,
      ab_mapping,
      usage: EMPTY_USAGE,
      latency_ms: finished_at - started_at,
      started_at,
      finished_at,
      error: toTraceError(err, 'judge_error'),
    };
  }
  const finished_at = Date.now();

  const raw = extractText(response.content);
  const parsed = parseJudgeCompare(raw);

  if (!parsed) {
    return {
      model: input.judge.model,
      raw,
      scores: { mom: EMPTY_SCORES, baseline: EMPTY_SCORES },
      verdict_summary: null,
      fallback: false,
      parse_error: true,
      ab_mapping,
      usage: response.usage,
      latency_ms: finished_at - started_at,
      started_at,
      finished_at,
      error: {
        type: 'judge_error',
        message: 'judge output could not be parsed as JSON with required shape',
        http_status: null,
      },
    };
  }

  // Demap A/B → mom/baseline.
  const momScores = aIsMom ? parsed.a : parsed.b;
  const baselineScores = aIsMom ? parsed.b : parsed.a;

  return {
    model: input.judge.model,
    raw,
    scores: { mom: momScores, baseline: baselineScores },
    verdict_summary: parsed.verdict_summary,
    fallback: parsed.fallback,
    parse_error: false,
    ab_mapping,
    usage: response.usage,
    latency_ms: finished_at - started_at,
    started_at,
    finished_at,
    error: null,
  };
}
