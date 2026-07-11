import { createHash } from 'node:crypto';
import type { AnthropicMessage, ContentBlock } from '../types/anthropic.js';
import type { MoMConfig } from '../types/mom.js';

function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  return content;
}

function hasToolResultBlock(msg: AnthropicMessage): boolean {
  for (const b of normalizeContent(msg.content)) {
    if (b.type === 'tool_result') return true;
  }
  return false;
}

function isRealUserMessage(msg: AnthropicMessage): boolean {
  return msg.role === 'user' && !hasToolResultBlock(msg);
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k]),
  );
  return '{' + parts.join(',') + '}';
}

export function selectSignatureMessages(
  messages: AnthropicMessage[],
  fanoutMode: MoMConfig['fanout_mode'],
): AnthropicMessage[] {
  if (fanoutMode === 'per_iteration') return messages;
  // user_turn: 截到最后一条真实 user message（含）为止
  let lastRealIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserMessage(messages[i]!)) {
      lastRealIdx = i;
      break;
    }
  }
  // 若不存在真实 user message，退化为全 messages（首请求即 tool_result 时）
  if (lastRealIdx === -1) return messages;
  return messages.slice(0, lastRealIdx + 1);
}

export function computeFanoutCacheKey(
  messages: AnthropicMessage[],
  momConfig: MoMConfig,
): string {
  const sigMessages = selectSignatureMessages(messages, momConfig.fanout_mode);
  const sig = sha256Hex(canonicalStringify(sigMessages));
  const settingsHash = sha256Hex(
    canonicalStringify({
      system_prompt: momConfig.advisor.system_prompt ?? '',
      tools_enabled: momConfig.advisor.tools_enabled,
      reference_max_tokens: momConfig.reference_max_tokens,
    }),
  );
  const slotsHash = sha256Hex(momConfig.advisor.slots.join('\x00'));
  return `${settingsHash}|${slotsHash}|${sig}`;
}
