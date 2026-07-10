import type {
  AnthropicMessage,
  ContentBlock,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '../types/anthropic.js';
import { ADVISORY_INSTRUCTION } from './prompts.js';

const TOOL_RESULT_HEAD_TAIL_BUDGET = 2000;

export function truncateToolResult(text: string, headTailBudget = TOOL_RESULT_HEAD_TAIL_BUDGET): string {
  const doubleBudget = headTailBudget * 2;
  if (text.length <= doubleBudget) return text;
  const head = text.slice(0, headTailBudget);
  const tail = text.slice(text.length - headTailBudget);
  const omitted = text.length - doubleBudget;
  return `${head}\n[... ${omitted} chars omitted ...]\n${tail}`;
}

function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  return content;
}

function renderToolUse(block: ToolUseBlock): string {
  const inputJson = (() => {
    try {
      return JSON.stringify(block.input);
    } catch {
      return '<unserializable>';
    }
  })();
  return `[called tool: ${block.name}(${inputJson})]`;
}

function renderToolResultContent(content: ToolResultBlock['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : '[image omitted]'))
    .join('\n');
}

function renderToolResult(block: ToolResultBlock): string {
  const raw = renderToolResultContent(block.content);
  const truncated = truncateToolResult(raw);
  return block.is_error === true
    ? `[tool result (error): ${truncated}]`
    : `[tool result: ${truncated}]`;
}

function flattenMessage(message: AnthropicMessage): AnthropicMessage | null {
  const blocks = normalizeContent(message.content);
  const pieces: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text !== '') pieces.push(block.text);
    } else if (block.type === 'tool_use') {
      pieces.push(renderToolUse(block));
    } else if (block.type === 'tool_result') {
      pieces.push(renderToolResult(block));
    }
    // image blocks: dropped (advisor MVP does not accept images)
  }
  if (pieces.length === 0) return null;
  const merged: TextBlock = { type: 'text', text: pieces.join('\n') };
  return { role: message.role, content: [merged] };
}

export function convertToAdvisorView(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    const flat = flattenMessage(m);
    if (flat) out.push(flat);
  }
  const last = out[out.length - 1];
  if (!last || last.role === 'assistant') {
    out.push({
      role: 'user',
      content: [{ type: 'text', text: ADVISORY_INSTRUCTION }],
    });
  }
  return out;
}
