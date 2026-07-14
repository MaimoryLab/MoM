/**
 * Advisor and aggregator prompt constants shared across the MoM pipeline.
 *
 * Naming stays stable: cache-decorator recognises the synthetic advisory
 * turn by exact match against ADVISORY_INSTRUCTION; multiple tests import
 * ADVISOR_SYSTEM_PROMPT / ADVISORY_INSTRUCTION by symbol. Text may change;
 * symbols must not.
 */

/**
 * Prompt text shared by advisor system prompt and synthetic advisor
 * instruction. Kept single-source so both stay byte-identical and any
 * future edit propagates automatically.
 */
const ADVISOR_JUDGEMENT_PROMPT =
  'The conversation above is the current state of the task. Give your ' +
  'most intelligent judgement: what is going on, what should happen next, ' +
  'what risks or mistakes you see, and how the acting agent should proceed.';

/**
 * System prompt for a single advisor slot.
 *
 * The advisor sees a mid-task Claude Code conversation flattened into
 * plain user/assistant text turns (see `view-transformer.ts`): tool calls
 * appear as `[called tool: name(args)]`, tool results as
 * `[tool result: ...]`, images are dropped. The advisor cannot call tools
 * itself — it produces text that another model (the aggregator) will fuse
 * back into the live agent loop.
 */
export const ADVISOR_SYSTEM_PROMPT = ADVISOR_JUDGEMENT_PROMPT;

/**
 * Synthetic user turn appended by `convertToAdvisorView` when the last
 * message is an assistant turn (the advisor needs a user turn to reply to).
 *
 * Must also be recognisable to `applyAdvisorCacheControl`, which skips this
 * turn via exact string match when placing the last-three cache breakpoints
 * — the text below is imported by name from cache-decorator, so any edit
 * here propagates automatically.
 */
export const ADVISORY_INSTRUCTION = ADVISOR_JUDGEMENT_PROMPT;

/**
 * Guidance block prepended to the advisor references injected into the
 * aggregator's final user message. Tells the aggregator what those
 * references are and how to use them.
 *
 * Placed inside the last user turn (not in the request `system` field) so
 * that the aggregator's transported system prompt — copied byte-for-byte
 * from the client, per the aggregator-side pass-through invariant — is
 * unchanged and Anthropic prompt-caching keeps hitting on the prefix.
 */
export const AGGREGATOR_GUIDANCE = [
  'You have been provided with a set of responses from various models',
  'to the latest user query. Your task is to synthesize these responses into a',
  'single, high-quality response. It is crucial to critically evaluate the',
  'information provided in these responses, recognizing that some of it may be',
  'biased or incorrect. Your response should not simply replicate the given answers',
  'but should offer a refined, accurate, and comprehensive reply to the instruction.',
  'Ensure your response is well-structured, coherent, and adheres to the highest',
  'standards of accuracy and reliability.',
].join(' ');

/**
 * Header that separates the aggregator guidance from the concatenated
 * advisor references. Kept as its own constant so tests and downstream
 * code can pattern-match a stable marker.
 */
export const AGGREGATOR_REFERENCES_HEADER = 'Advisor Panel References (for the aggregator only, not user-visible):';
