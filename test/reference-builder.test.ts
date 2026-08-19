import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReferenceInjection,
  buildConcatReferences,
} from '../src/aggregator/reference-builder.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';
import type {
  AdvisorResult,
  ReferenceInjectionSettings,
} from '../src/types/mom.js';
import type { AnthropicMessage } from '../src/types/anthropic.js';

const EMPTY_USAGE = { input_tokens: 0, output_tokens: 0 };

function ok(slot: string, reference: string): AdvisorResult {
  return {
    slot,
    success: true,
    reference,
    usage: EMPTY_USAGE,
    latency_ms: 0,
    cache_hit: false,
  };
}

function fail(slot: string, error: string): AdvisorResult {
  return {
    slot,
    success: false,
    reference: '',
    usage: EMPTY_USAGE,
    latency_ms: 0,
    cache_hit: false,
    error,
  };
}

const USER_TAIL: ReferenceInjectionSettings = {
  timing: 'user_turn_only',
  position: 'user_message_tail',
};
const CONTEXT_TAIL: ReferenceInjectionSettings = {
  timing: 'user_turn_only',
  position: 'context_tail',
};
const EVERY_USER_TAIL: ReferenceInjectionSettings = {
  timing: 'every_request',
  position: 'user_message_tail',
};

const GUIDANCE_RE = /You have been provided with a set of responses from various models/;
const HEADER_RE = /Advisor Panel References \(for the aggregator only, not user-visible\):/;

function lastText(msg: AnthropicMessage): string {
  const blocks = msg.content as Array<{ type: string; text?: string }>;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]!.type === 'text') return blocks[i]!.text ?? '';
  }
  return '';
}

describe('buildConcatReferences', () => {
  it('preserves order and labels each reference by slot', () => {
    const out = buildConcatReferences(
      [ok('modelA', 'analysis A'), ok('modelB', 'analysis B')],
      { ...DEFAULT_MOM_CONFIG, reference_max_tokens: 4096 },
    );
    assert.match(out, /\[Reference 1 — modelA\]\nanalysis A/);
    assert.match(out, /\[Reference 2 — modelB\]\nanalysis B/);
  });

  it('renders failed advisor with error message', () => {
    const out = buildConcatReferences(
      [ok('modelA', 'good'), fail('modelB', 'boom')],
      DEFAULT_MOM_CONFIG,
    );
    assert.match(out, /\[Reference 2 — modelB failed: boom\]/);
  });

  it('truncates by reference_max_tokens character budget', () => {
    const long = 'x'.repeat(10_000);
    const out = buildConcatReferences([ok('modelA', long)], {
      ...DEFAULT_MOM_CONFIG,
      reference_max_tokens: 100, // → 400 chars
    });
    assert.match(out, /\[\.\.\.reference truncated\.\.\.\]/);
  });
});

describe('applyReferenceInjection — timing gate', () => {
  const messages: AnthropicMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'q' }] },
  ];

  it('injects on a fresh user turn (user_turn_only)', () => {
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: true,
      settings: USER_TAIL,
    });
    assert.equal(out.injected, true);
    assert.match(out.payload, GUIDANCE_RE);
    assert.notStrictEqual(out.messages, messages);
  });

  it('SKIPS on a tool iteration when timing=user_turn_only', () => {
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: false,
      settings: USER_TAIL,
    });
    assert.equal(out.injected, false);
    assert.equal(out.payload, '');
    // untouched message list passes through by identity
    assert.strictEqual(out.messages, messages);
  });

  it('injects on a tool iteration when timing=every_request', () => {
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: false,
      settings: EVERY_USER_TAIL,
    });
    assert.equal(out.injected, true);
    assert.match(out.payload, GUIDANCE_RE);
  });

  it('injects nothing for an empty message list', () => {
    const out = applyReferenceInjection({
      messages: [],
      references: 'REF',
      isNewUserTurn: true,
      settings: USER_TAIL,
    });
    assert.equal(out.injected, false);
  });
});

describe('applyReferenceInjection — position user_message_tail (A)', () => {
  it('appends to the last real user message, not to trailing tool turns', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'the query' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }] },
    ];
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: true,
      settings: USER_TAIL,
    });
    assert.equal(out.messages.length, 3);
    // reference landed on index 0 (the real user query)
    assert.match(lastText(out.messages[0]!), /^the query\n\n---\n\n/);
    assert.match(lastText(out.messages[0]!), GUIDANCE_RE);
    // trailing tool_result message kept its object identity
    assert.strictEqual(out.messages[2], messages[2]);
  });

  it('preserves object identity of non-target messages', () => {
    const m0: AnthropicMessage = { role: 'user', content: 'q1' };
    const m1: AnthropicMessage = { role: 'assistant', content: 'a1' };
    const m2: AnthropicMessage = { role: 'user', content: [{ type: 'text', text: 'q2' }] };
    const out = applyReferenceInjection({
      messages: [m0, m1, m2],
      references: 'REF',
      isNewUserTurn: true,
      settings: USER_TAIL,
    });
    assert.strictEqual(out.messages[0], m0);
    assert.strictEqual(out.messages[1], m1);
    assert.notStrictEqual(out.messages[2], m2); // target cloned
  });
});

describe('applyReferenceInjection — position context_tail (B)', () => {
  it('appends to the very end and preserves the user+tool prefix identity', () => {
    const m0: AnthropicMessage = { role: 'user', content: [{ type: 'text', text: 'the query' }] };
    const m1: AnthropicMessage = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] };
    const m2: AnthropicMessage = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }] };
    const out = applyReferenceInjection({
      messages: [m0, m1, m2],
      references: 'REF',
      isNewUserTurn: true,
      settings: CONTEXT_TAIL,
    });
    assert.equal(out.messages.length, 3);
    // whole prefix before the tail keeps identity → reusable across next loop
    assert.strictEqual(out.messages[0], m0);
    assert.strictEqual(out.messages[1], m1);
    // last message (tool_result carrier) is the injection target → cloned
    assert.notStrictEqual(out.messages[2], m2);
    assert.match(lastText(out.messages[2]!), GUIDANCE_RE);
    assert.match(lastText(out.messages[2]!), HEADER_RE);
  });

  it('synthesizes a trailing user message when the tail is an assistant turn', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'partial' },
    ];
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: true,
      settings: CONTEXT_TAIL,
    });
    assert.equal(out.messages.length, 3);
    assert.equal(out.messages[2]!.role, 'user');
    // synthesized user carries the pure payload (no "---" separator prefix)
    assert.match(lastText(out.messages[2]!), /^You have been provided with a set of responses/);
  });
});

describe('applyReferenceInjection — non-mutation', () => {
  it('does not mutate the input array or its messages in place', () => {
    const m1: AnthropicMessage = { role: 'user', content: [{ type: 'text', text: 'orig' }] };
    const original = [m1];
    applyReferenceInjection({
      messages: original,
      references: 'REF',
      isNewUserTurn: true,
      settings: USER_TAIL,
    });
    assert.equal(original.length, 1);
    assert.equal((m1.content as Array<{ text: string }>)[0]!.text, 'orig');
  });
});

describe('applyReferenceInjection — user_message_tail degradation (no real user msg)', () => {
  it('falls back to the last message when the first request is a tool_result', () => {
    // A conversation whose only user message carries a tool_result (no genuine
    // query). user_message_tail has no real user target, so it degrades to the
    // last message. Since that message is role=user, the payload appends in place.
    const messages: AnthropicMessage[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }] },
    ];
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: false,
      settings: EVERY_USER_TAIL,
    });
    assert.equal(out.injected, true);
    assert.equal(out.messages.length, 2);
    // degraded target is index 1 (last message, a user tool_result carrier)
    assert.match(lastText(out.messages[1]!), GUIDANCE_RE);
    // index 0 (assistant) keeps identity
    assert.strictEqual(out.messages[0], messages[0]);
  });

  it('synthesizes a trailing user message when the degraded tail is assistant', () => {
    // No real user message AND the last message is an assistant turn → the
    // payload cannot append onto a user message, so a fresh user message is
    // pushed carrying the pure payload.
    const messages: AnthropicMessage[] = [
      { role: 'assistant', content: 'partial thought' },
    ];
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: false,
      settings: EVERY_USER_TAIL,
    });
    assert.equal(out.injected, true);
    assert.equal(out.messages.length, 2);
    assert.equal(out.messages[1]!.role, 'user');
    assert.match(lastText(out.messages[1]!), /^You have been provided with a set of responses/);
  });
});

describe('applyReferenceInjection — empty references still carries scaffolding', () => {
  it('injects guidance + header even when the references string is empty', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
    ];
    const out = applyReferenceInjection({
      messages,
      references: '',
      isNewUserTurn: true,
      settings: USER_TAIL,
    });
    assert.equal(out.injected, true);
    assert.match(out.payload, GUIDANCE_RE);
    assert.match(out.payload, HEADER_RE);
  });
});

describe('applyReferenceInjection — append onto empty-string content', () => {
  it('pushes a fresh text block when the user message content is ""', () => {
    // content === '' normalizes to zero blocks; cloneWithAppendedText then has
    // no text block to append to, so it pushes a new one carrying the payload
    // WITHOUT the leading query text (but with the "---" separator prefix).
    const messages: AnthropicMessage[] = [{ role: 'user', content: '' }];
    const out = applyReferenceInjection({
      messages,
      references: 'REF',
      isNewUserTurn: true,
      settings: USER_TAIL,
    });
    assert.equal(out.injected, true);
    const blocks = out.messages[0]!.content as Array<{ type: string; text?: string }>;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, 'text');
    assert.match(blocks[0]!.text!, /^\n\n---\n\n/);
    assert.match(blocks[0]!.text!, GUIDANCE_RE);
  });
});

describe('buildConcatReferences — token budget boundaries', () => {
  it('reference_max_tokens=0 truncates all body text to the marker', () => {
    const out = buildConcatReferences([ok('modelA', 'some analysis')], {
      ...DEFAULT_MOM_CONFIG,
      reference_max_tokens: 0,
    });
    // label kept, body replaced by just the truncation marker (0-char budget)
    assert.match(out, /\[Reference 1 — modelA\]/);
    assert.match(out, /\[\.\.\.reference truncated\.\.\.\]/);
  });

  it('negative reference_max_tokens clamps to a 0-char budget (no crash)', () => {
    const out = buildConcatReferences([ok('modelA', 'body')], {
      ...DEFAULT_MOM_CONFIG,
      reference_max_tokens: -100,
    });
    assert.match(out, /\[\.\.\.reference truncated\.\.\.\]/);
  });

  it('empty advisor list yields an empty concat string', () => {
    const out = buildConcatReferences([], DEFAULT_MOM_CONFIG);
    assert.equal(out, '');
  });
});
