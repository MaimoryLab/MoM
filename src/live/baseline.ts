import type {
  AnthropicMessagesRequest,
  ContentBlock,
} from '../types/anthropic.js';
import type { BaselineResult, ProviderConfig } from '../types/mom.js';
import { passthroughCall, toTraceError } from '../provider/provider-client.js';

function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

const EMPTY_USAGE = { input_tokens: 0, output_tokens: 0 };

/**
 * Fire a single non-streaming baseline call. Never throws — errors are
 * captured on `result.error` so live-runtime can decide the surface.
 */
export async function runBaselineCall(
  original: AnthropicMessagesRequest,
  baselineModel: string,
  provider: ProviderConfig,
): Promise<BaselineResult> {
  const started_at = Date.now();
  const req: AnthropicMessagesRequest = {
    ...original,
    model: baselineModel,
    stream: false,
  };
  try {
    const response = await passthroughCall(req, provider);
    const finished_at = Date.now();
    const text = extractText(response.content);
    return {
      model: baselineModel,
      response,
      text,
      usage: response.usage,
      latency_ms: finished_at - started_at,
      started_at,
      finished_at,
      error: null,
    };
  } catch (err) {
    const finished_at = Date.now();
    return {
      model: baselineModel,
      response: null,
      text: '',
      usage: EMPTY_USAGE,
      latency_ms: finished_at - started_at,
      started_at,
      finished_at,
      error: toTraceError(err, 'baseline_error'),
    };
  }
}
