import type {
  AnthropicMessage,
  ContentBlock,
  TextBlock,
} from '../types/anthropic.js';
import type { AdvisorResult, MoMConfig } from '../types/mom.js';
import {
  AGGREGATOR_GUIDANCE,
  AGGREGATOR_REFERENCES_HEADER,
} from '../advisor/prompts.js';

const CHARS_PER_TOKEN_ESTIMATE = 4;

function truncateByCharBudget(text: string, tokenBudget: number): string {
  const charBudget = Math.max(0, tokenBudget * CHARS_PER_TOKEN_ESTIMATE);
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget) + '\n[...reference truncated...]';
}

export function buildConcatReferences(
  results: AdvisorResult[],
  momConfig: MoMConfig,
): string {
  const pieces = results.map((r, idx) => {
    const label = `[Reference ${idx + 1} — ${r.slot}`;
    if (!r.success) {
      return `${label} failed: ${r.error ?? 'unknown error'}]`;
    }
    const body = truncateByCharBudget(r.reference, momConfig.reference_max_tokens);
    return `${label}]\n${body}`;
  });
  return pieces.join('\n\n');
}

/**
 * Compose the aggregator injection payload: guidance block + references
 * header + concatenated advisor references. Kept as a single string so
 * `appendReferencesToLastUser` stays byte-exact and the caller can log the
 * appended content verbatim via `AggregatorResult.references_appended`.
 */
function composeAggregatorPayload(references: string): string {
  return `${AGGREGATOR_GUIDANCE}\n\n${AGGREGATOR_REFERENCES_HEADER}\n${references}`;
}

function cloneWithAppendedText(
  message: AnthropicMessage,
  guidance: string,
): AnthropicMessage {
  const blocks: ContentBlock[] =
    typeof message.content === 'string'
      ? message.content === ''
        ? []
        : [{ type: 'text', text: message.content }]
      : [...message.content];

  let lastTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]!.type === 'text') {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx === -1) {
    blocks.push({ type: 'text', text: guidance });
  } else {
    const original = blocks[lastTextIdx] as TextBlock;
    blocks[lastTextIdx] = {
      ...original,
      text: `${original.text}${guidance}`,
    };
  }
  return { role: message.role, content: blocks };
}

export function appendReferencesToLastUser(
  messages: AnthropicMessage[],
  references: string,
): AnthropicMessage[] {
  if (messages.length === 0) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx]!;
  const payload = composeAggregatorPayload(references);
  const appended = `\n\n---\n\n${payload}`;

  const next = messages.slice(0, lastIdx);
  if (last.role === 'user') {
    next.push(cloneWithAppendedText(last, appended));
  } else {
    next.push(last);
    next.push({
      role: 'user',
      content: [{ type: 'text', text: payload }],
    });
  }
  return next;
}
