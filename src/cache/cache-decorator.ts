import type {
  AnthropicMessage,
  ContentBlock,
  SystemBlock,
} from '../types/anthropic.js';
import { ADVISORY_INSTRUCTION } from '../advisor/prompts.js';

const CACHE_BREAKPOINTS = 3;

function isSyntheticAdvisoryMarker(msg: AnthropicMessage): boolean {
  if (msg.role !== 'user') return false;
  if (typeof msg.content === 'string') return msg.content === ADVISORY_INSTRUCTION;
  if (msg.content.length !== 1) return false;
  const only = msg.content[0]!;
  return only.type === 'text' && only.text === ADVISORY_INSTRUCTION;
}

function withCacheControl<T extends ContentBlock>(block: T): T {
  return { ...block, cache_control: { type: 'ephemeral' } };
}

function normalizeBlocks(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  return [...content];
}

function markLastBlockWithCacheControl(msg: AnthropicMessage): AnthropicMessage {
  const blocks = normalizeBlocks(msg.content);
  if (blocks.length === 0) {
    return {
      role: msg.role,
      content: [{ type: 'text', text: '', cache_control: { type: 'ephemeral' } }],
    };
  }
  const lastIdx = blocks.length - 1;
  const last = blocks[lastIdx]!;
  blocks[lastIdx] = withCacheControl(last);
  return { role: msg.role, content: blocks };
}

export function applyAdvisorCacheControl(
  system: string,
  messages: AnthropicMessage[],
): { system: SystemBlock[]; messages: AnthropicMessage[] } {
  const systemBlocks: SystemBlock[] = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];

  // 选出最后 3 条非合成 marker 的 message 的下标
  const targets: number[] = [];
  for (let i = messages.length - 1; i >= 0 && targets.length < CACHE_BREAKPOINTS; i--) {
    if (!isSyntheticAdvisoryMarker(messages[i]!)) {
      targets.push(i);
    }
  }
  const targetSet = new Set(targets);
  const nextMessages = messages.map((m, i) =>
    targetSet.has(i) ? markLastBlockWithCacheControl(m) : m,
  );

  return { system: systemBlocks, messages: nextMessages };
}
