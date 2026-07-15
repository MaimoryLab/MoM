import type {
  AnthropicMessagesRequest,
  ContentBlock,
} from '../types/anthropic.js';
import type {
  JudgeCompareResult,
  JudgeScores,
  JudgeSettings,
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
}

/**
 * Run a single judge-compare call. Never throws — a request failure is
 * returned as `{ error }` with null scores; a JSON parse failure is returned
 * as `{ parse_error: true }` with null scores. Caller (live-runtime) decides
 * how to surface the failure to the client.
 */
export async function runJudgeCompare(
  input: RunJudgeCompareInput,
): Promise<JudgeCompareResult> {
  const rand = input.rand ?? Math.random;
  // A/B mapping: randomly assign which real answer becomes Response A.
  const aIsMom = rand() < 0.5;
  const ab_mapping: JudgeCompareResult['ab_mapping'] = aIsMom
    ? { A: 'mom', B: 'baseline' }
    : { A: 'baseline', B: 'mom' };
  const responseA = aIsMom ? input.momText : input.baselineText;
  const responseB = aIsMom ? input.baselineText : input.momText;

  const systemPrompt =
    input.judge.system_prompt?.trim() ||
    (input.lang === 'zh' ? JUDGE_COMPARE_PROMPT_ZH : JUDGE_COMPARE_PROMPT_EN);

  const req: AnthropicMessagesRequest = {
    model: input.judge.model,
    max_tokens: JUDGE_MAX_TOKENS,
    temperature: 0,
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
