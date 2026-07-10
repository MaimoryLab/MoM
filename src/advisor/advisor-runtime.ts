import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
  ContentBlock,
  Usage,
} from '../types/anthropic.js';
import type { AdvisorResult, MoMConfig, ProviderConfig } from '../types/mom.js';
import { passthroughCall, ProviderError } from '../provider/provider-client.js';
import { convertToAdvisorView } from './view-transformer.js';
import { ADVISOR_SYSTEM_PROMPT } from './prompts.js';

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

function extractText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text') parts.push(b.text);
  }
  return parts.join('\n');
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
    const request: AnthropicMessagesRequest = {
      model: slot,
      messages: advisorMessages,
      system: ADVISOR_SYSTEM_PROMPT,
      max_tokens: momConfig.reference_max_tokens,
      stream: false,
    };
    const response = await passthroughCall(request, provider);
    return {
      slot,
      success: true,
      reference: extractText(response.content),
      usage: response.usage,
      latency_ms: Date.now() - startedAt,
      cache_hit: false,
    };
  } catch (err) {
    const message =
      err instanceof ProviderError
        ? `provider ${err.statusCode}: ${err.providerBody.slice(0, 200)}`
        : err instanceof Error
        ? err.message
        : String(err);
    return {
      slot,
      success: false,
      reference: '',
      usage: EMPTY_USAGE,
      latency_ms: Date.now() - startedAt,
      cache_hit: false,
      error: message,
    };
  }
}
