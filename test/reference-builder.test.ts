import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendReferencesToLastUser,
  buildConcatReferences,
} from '../src/aggregator/reference-builder.js';
import { DEFAULT_MOM_CONFIG } from '../src/types/mom.js';
import type { AdvisorResult } from '../src/types/mom.js';
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

describe('appendReferencesToLastUser — critical invariant', () => {
  it('leaves every non-last message with its original object identity', () => {
    const m0: AnthropicMessage = { role: 'user', content: 'q1' };
    const m1: AnthropicMessage = { role: 'assistant', content: 'a1' };
    const m2: AnthropicMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'q2' }],
    };
    const original = [m0, m1, m2];
    const out = appendReferencesToLastUser(original, 'refs...');
    assert.equal(out.length, 3);
    assert.strictEqual(out[0], m0);
    assert.strictEqual(out[1], m1);
    assert.notStrictEqual(out[2], m2); // last is replaced with modified clone
  });

  it('appends aggregator guidance + Advisor Panel References to the last user text block', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'analyse this' }],
      },
    ];
    const out = appendReferencesToLastUser(messages, 'REF1');
    const last = out[out.length - 1]!;
    const text = (last.content as Array<{ type: string; text: string }>)[0]!.text;
    assert.match(text, /^analyse this\n\n---\n\nYou are the aggregator in a Mixture-of-Models process\./);
    assert.match(text, /Advisor Panel References \(for the aggregator only, not user-visible\):\nREF1/);
  });

  it('appends to the LAST text block when multiple text blocks exist', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'last' },
        ],
      },
    ];
    const out = appendReferencesToLastUser(messages, 'REF');
    const blocks = out[out.length - 1]!.content as Array<{ type: string; text: string }>;
    assert.equal(blocks[0]!.text, 'first');
    assert.match(blocks[1]!.text, /^last\n\n---\n\nYou are the aggregator in a Mixture-of-Models process\./);
    assert.match(blocks[1]!.text, /Advisor Panel References \(for the aggregator only, not user-visible\):\nREF/);
  });

  it('appends a new text block when the last user message has no text (tool_result only)', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }],
      },
    ];
    const out = appendReferencesToLastUser(messages, 'REF');
    const blocks = out[out.length - 1]!.content as Array<{ type: string; text?: string }>;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, 'tool_result');
    assert.equal(blocks[1]!.type, 'text');
    assert.match(blocks[1]!.text ?? '', /You are the aggregator in a Mixture-of-Models process\./);
    assert.match(blocks[1]!.text ?? '', /Advisor Panel References \(for the aggregator only, not user-visible\):\nREF/);
  });

  it('synthesizes a trailing user message when the last message is assistant', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'partial' },
    ];
    const out = appendReferencesToLastUser(messages, 'REF');
    assert.equal(out.length, 3);
    assert.equal(out[2]!.role, 'user');
    const text = (out[2]!.content as Array<{ type: string; text: string }>)[0]!.text;
    // 合成的 user 是**纯** payload,没有 "---" 分隔符前缀
    assert.match(text, /^You are the aggregator in a Mixture-of-Models process\./);
    assert.match(text, /Advisor Panel References \(for the aggregator only, not user-visible\):\nREF/);
    assert.strictEqual(out[0], messages[0]); // prefix identity preserved
    assert.strictEqual(out[1], messages[1]);
  });

  it('does not mutate the input array or the last message in place', () => {
    const m0: AnthropicMessage = { role: 'user', content: 'q1' };
    const m1: AnthropicMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'orig' }],
    };
    const original = [m0, m1];
    appendReferencesToLastUser(original, 'REF');
    const blocks = m1.content as Array<{ type: string; text: string }>;
    assert.equal(blocks[0]!.text, 'orig');
    assert.equal(original.length, 2);
  });
});
