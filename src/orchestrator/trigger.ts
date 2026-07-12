import type { AnthropicMessage, ContentBlock } from '../types/anthropic.js';
import type { FanoutMode, TriggerReason } from '../types/mom.js';

function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  return content;
}

export function isNewUserTurn(messages: AnthropicMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return false;
  const blocks = normalizeContent(last.content);
  for (const b of blocks) {
    if (b.type === 'tool_result') return false;
  }
  return true;
}

export function computeTriggerReason(
  fanoutMode: FanoutMode,
  isNewTurn: boolean,
  cacheHit: boolean,
): TriggerReason {
  if (fanoutMode === 'off') return 'fanout_cache_off';
  if (fanoutMode === 'per_iteration') {
    return cacheHit ? 'fanout_cache_hit' : 'per_iteration';
  }
  if (cacheHit) return 'skipped_tool_iteration';
  return isNewTurn ? 'user_turn' : 'tool_iteration_cache_miss';
}
