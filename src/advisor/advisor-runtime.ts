import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  ContentBlock,
  Usage,
} from '../types/anthropic.js';
import type {
  AdvisorResult,
  MoMConfig,
  ProviderConfig,
  ResponseSummary,
} from '../types/mom.js';
import { passthroughCall, toTraceError } from '../provider/provider-client.js';
import { convertToAdvisorView } from './view-transformer.js';
import { ADVISOR_SYSTEM_PROMPT } from './prompts.js';
import { applyAdvisorCacheControl } from '../cache/cache-decorator.js';

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

function extractText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text') parts.push(b.text);
  }
  return parts.join('\n');
}

function summarize(response: AnthropicMessagesResponse): ResponseSummary {
  return {
    id: response.id,
    stop_reason: response.stop_reason,
    stop_sequence: response.stop_sequence,
  };
}

export async function runAdvisor(
  slot: string,
  messages: AnthropicMessage[],
  momConfig: MoMConfig,
  provider: ProviderConfig,
): Promise<AdvisorResult> {
  const startedAt = Date.now();
  try {
    const advisorMessages = convertToAdvisorView(messages);
    const systemPrompt = momConfig.advisor.system_prompt ?? ADVISOR_SYSTEM_PROMPT;
    const decorated = applyAdvisorCacheControl(systemPrompt, advisorMessages);
    const request: AnthropicMessagesRequest = {
      model: slot,
      messages: decorated.messages,
      system: decorated.system,
      max_tokens: momConfig.reference_max_tokens,
      stream: false,
    };
    const response = await passthroughCall(request, provider);
    const finishedAt = Date.now();
    return {
      slot,
      success: true,
      reference: extractText(response.content),
      usage: response.usage,
      latency_ms: finishedAt - startedAt,
      cache_hit: false,
      error: null,
      started_at: startedAt,
      finished_at: finishedAt,
      selected_model: slot,
      response_summary: summarize(response),
    };
  } catch (err) {
    const finishedAt = Date.now();
    return {
      slot,
      success: false,
      reference: '',
      usage: EMPTY_USAGE,
      latency_ms: finishedAt - startedAt,
      cache_hit: false,
      error: toTraceError(err, 'advisor_error'),
      started_at: startedAt,
      finished_at: finishedAt,
      selected_model: slot,
      response_summary: null,
    };
  }
}
