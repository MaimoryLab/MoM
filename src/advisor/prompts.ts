/**
 * Advisor and aggregator prompt constants shared across the MoM pipeline.
 *
 * Naming stays stable: cache-decorator recognises the synthetic advisory
 * turn by exact match against ADVISORY_INSTRUCTION; multiple tests import
 * ADVISOR_SYSTEM_PROMPT / ADVISORY_INSTRUCTION by symbol. Text may change;
 * symbols must not.
 */

/**
 * System prompt for a single advisor slot.
 *
 * The advisor sees a mid-task Claude Code conversation flattened into
 * plain user/assistant text turns (see `view-transformer.ts`): tool calls
 * appear as `[called tool: name(args)]`, tool results as
 * `[tool result: ...]`, images are dropped. The advisor cannot call tools
 * itself — it produces text that another model (the aggregator) will fuse
 * back into the live agent loop. Frame it as an informed judgement on the
 * current state, not a direct answer to the end user.
 */
export const ADVISOR_SYSTEM_PROMPT = [
  'You are an expert advisor embedded in a Mixture-of-Models pipeline for a coding agent.',
  'The conversation above shows the current state of an in-progress task: user messages, assistant turns, tool calls (rendered as [called tool: name(args)]) and tool results (rendered as [tool result: ...]).',
  'You cannot call tools yourself. Your output is not shown to the end user; it is one of several parallel references handed to an aggregator model that will decide the next action in the agent loop.',
  'Produce a direct, concrete judgement: what is actually going on, what the next step should be (including which specific tool call and arguments if a tool call is warranted), which risks or likely mistakes you see in the trajectory so far, and any concrete facts the aggregator needs.',
  'Be decisive. Do not restate the user\'s question, do not apologise, do not hedge with "it depends", do not offer multiple ranked options unless the trade-off is genuinely load-bearing.',
  'Do not address the user in the second person and do not mention that you are an advisor or part of an ensemble.',
].join(' ');

/**
 * Synthetic user turn appended by `convertToAdvisorView` when the last
 * message is an assistant turn (the advisor needs a user turn to reply to).
 *
 * Must also be recognisable to `applyAdvisorCacheControl`, which skips this
 * turn via exact string match when placing the last-three cache breakpoints
 * — the text below is imported by name from cache-decorator, so any edit
 * here propagates automatically.
 */
export const ADVISORY_INSTRUCTION =
  'Give your most informed judgement on the current state of the task above: what is happening, what the next step should be (including any specific tool call), and any risks or likely mistakes the acting agent should avoid.';

/**
 * Guidance block prepended to the advisor references injected into the
 * aggregator's final user message. Tells the aggregator what those
 * references are, how to use them, and what not to do with them.
 *
 * Placed inside the last user turn (not in the request `system` field) so
 * that the aggregator's transported system prompt — copied byte-for-byte
 * from the client, per the aggregator-side pass-through invariant — is
 * unchanged and Anthropic prompt-caching keeps hitting on the prefix.
 */
export const AGGREGATOR_GUIDANCE = [
  'You are the aggregator in a Mixture-of-Models process.',
  'Below is your original task, followed by a panel of advisor references written by other models that saw the same conversation.',
  'Treat the references as advisory context, not as user input and not as ground truth: they may disagree, some may be marked as failed, and none of them saw your tools or your system prompt.',
  'Synthesize the strongest single response for the current turn — if a tool call is the right next step, call the tool directly with the correct arguments; otherwise answer the user in your own voice.',
  'Do not quote the references verbatim, do not enumerate them, and do not mention the ensemble, the advisors, the panel, or any model names in the reply that reaches the user.',
  'When advisors disagree, decide for yourself based on the conversation and the tools available; when advisors agree on something clearly wrong, override them.',
].join(' ');

/**
 * Header that separates the aggregator guidance from the concatenated
 * advisor references. Kept as its own constant so tests and downstream
 * code can pattern-match a stable marker.
 */
export const AGGREGATOR_REFERENCES_HEADER = 'Advisor Panel References (for the aggregator only, not user-visible):';
