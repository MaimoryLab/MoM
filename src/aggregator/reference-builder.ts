import type {
  AnthropicMessage,
  ContentBlock,
  TextBlock,
} from '../types/anthropic.js';
import type {
  AdvisorResult,
  MoMConfig,
  ReferenceInjectionSettings,
  ReferenceInjectionTiming,
} from '../types/mom.js';
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
 * placement stays byte-exact and the caller can log the appended content
 * verbatim via `AggregatorResult.references_appended`.
 */
function composeAggregatorPayload(references: string): string {
  return `${AGGREGATOR_GUIDANCE}\n\n${AGGREGATOR_REFERENCES_HEADER}\n${references}`;
}

function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  return content;
}

/** A "real" user message is role=user carrying no tool_result block (i.e. a
 *  genuine user turn, not a tool-iteration result carrier). */
function isRealUserMessage(message: AnthropicMessage): boolean {
  if (message.role !== 'user') return false;
  for (const b of normalizeContent(message.content)) {
    if (b.type === 'tool_result') return false;
  }
  return true;
}

/** Append `suffix` to a message's last text block (cloning the block), or push
 *  a new text block if none exists. Never mutates the input message. */
function cloneWithAppendedText(
  message: AnthropicMessage,
  suffix: string,
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
    blocks.push({ type: 'text', text: suffix });
  } else {
    const original = blocks[lastTextIdx] as TextBlock;
    blocks[lastTextIdx] = { ...original, text: `${original.text}${suffix}` };
  }
  return { role: message.role, content: blocks };
}

/** Insert the payload at `targetIdx` (append to that message), preserving the
 *  object identity of every other message so prompt-cache prefixes stay stable.
 *  If the target is not a user message, a fresh user message carrying the pure
 *  payload is appended after it instead. */
function injectAtIndex(
  messages: AnthropicMessage[],
  targetIdx: number,
  payload: string,
): AnthropicMessage[] {
  const target = messages[targetIdx]!;
  const next = messages.slice();
  if (target.role === 'user') {
    // "---" separator only when appending into an existing user turn.
    next[targetIdx] = cloneWithAppendedText(target, `\n\n---\n\n${payload}`);
  } else {
    next.splice(targetIdx + 1, 0, {
      role: 'user',
      content: [{ type: 'text', text: payload }],
    });
  }
  return next;
}

/** Index of the last real user message (the genuine query), or -1. */
function lastRealUserIndex(messages: AnthropicMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserMessage(messages[i]!)) return i;
  }
  return -1;
}

export interface ReferenceInjectionInput {
  messages: AnthropicMessage[];
  /** Concatenated advisor references from `buildConcatReferences`. */
  references: string;
  /** Whether this request opens a fresh user turn (vs a tool iteration). */
  isNewUserTurn: boolean;
  settings: ReferenceInjectionSettings;
}

export interface ReferenceInjectionOutput {
  /** Message list to send to the aggregator. Prefix identity preserved. */
  messages: AnthropicMessage[];
  /** True when references were injected on this request. */
  injected: boolean;
  /** Exact payload text injected; '' when `injected` is false. Fed verbatim
   *  into `AggregatorResult.references_appended` for the trace record. */
  payload: string;
}

function shouldInject(
  timing: ReferenceInjectionTiming,
  isNewUserTurn: boolean,
): boolean {
  return timing === 'every_request' || isNewUserTurn;
}

/**
 * Single decision point for reference injection. `timing` gates whether this
 * request gets references at all; `position` picks the placement. Returns the
 * (possibly unchanged) message list plus what was injected, so callers never
 * branch on the policy themselves.
 */
export function applyReferenceInjection(
  input: ReferenceInjectionInput,
): ReferenceInjectionOutput {
  const { messages, references, isNewUserTurn, settings } = input;

  if (messages.length === 0 || !shouldInject(settings.timing, isNewUserTurn)) {
    return { messages, injected: false, payload: '' };
  }

  const payload = composeAggregatorPayload(references);
  const targetIdx =
    settings.position === 'context_tail'
      ? messages.length - 1
      : // user_message_tail: the genuine query; degrade to the last message
        // when there is no real user message (first request is tool_result).
        (() => {
          const idx = lastRealUserIndex(messages);
          return idx === -1 ? messages.length - 1 : idx;
        })();

  return {
    messages: injectAtIndex(messages, targetIdx, payload),
    injected: true,
    payload,
  };
}
