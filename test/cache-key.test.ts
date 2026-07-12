import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AnthropicMessage } from '../src/types/anthropic.js';
import { computeFanoutCacheKey, selectSignatureMessages } from '../src/cache/cache-key.js';
import { DEFAULT_MOM_CONFIG, type MoMConfig } from '../src/types/mom.js';

function cfg(overrides: Partial<MoMConfig> = {}): MoMConfig {
  return {
    ...DEFAULT_MOM_CONFIG,
    fanout_mode: 'user_turn',
    reference_max_tokens: 4096,
    advisor: { slots: ['a', 'b', 'c'], tools_enabled: false },
    ...overrides,
  };
}

describe('selectSignatureMessages — user_turn mode', () => {
  it('trims to the last real user message (inclusive)', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2 real' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    ];
    const sig = selectSignatureMessages(messages, 'user_turn');
    assert.equal(sig.length, 3);
    assert.equal(sig[sig.length - 1]!.content, 'q2 real');
  });

  it('falls back to full messages when no real user message exists', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }],
      },
    ];
    const sig = selectSignatureMessages(messages, 'user_turn');
    assert.equal(sig.length, 1);
  });
});

describe('selectSignatureMessages — per_iteration mode', () => {
  it('returns full messages unchanged', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'r' }] },
    ];
    const sig = selectSignatureMessages(messages, 'per_iteration');
    assert.equal(sig.length, 3);
  });
});

describe('selectSignatureMessages — off mode', () => {
  it('returns full messages unchanged', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'r' }] },
    ];
    const sig = selectSignatureMessages(messages, 'off');
    assert.equal(sig.length, 3);
  });
});

describe('computeFanoutCacheKey', () => {
  it('produces the same key across tool iterations of the same real user turn', () => {
    const base: AnthropicMessage[] = [{ role: 'user', content: 'analyse repo' }];
    const withToolCall: AnthropicMessage[] = [
      ...base,
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: { cmd: 'ls' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file1\nfile2' }] },
    ];
    const k1 = computeFanoutCacheKey(base, cfg());
    const k2 = computeFanoutCacheKey(withToolCall, cfg());
    assert.equal(k1, k2);
  });

  it('changes when slot ORDER changes (order preserved, not sorted)', () => {
    const msgs: AnthropicMessage[] = [{ role: 'user', content: 'q' }];
    const k1 = computeFanoutCacheKey(msgs, cfg({ advisor: { slots: ['a', 'b', 'c'], tools_enabled: false } }));
    const k2 = computeFanoutCacheKey(msgs, cfg({ advisor: { slots: ['c', 'b', 'a'], tools_enabled: false } }));
    assert.notEqual(k1, k2);
  });

  it('changes when reference_max_tokens changes (settingsHash)', () => {
    const msgs: AnthropicMessage[] = [{ role: 'user', content: 'q' }];
    const k1 = computeFanoutCacheKey(msgs, cfg({ reference_max_tokens: 4096 }));
    const k2 = computeFanoutCacheKey(msgs, cfg({ reference_max_tokens: 2048 }));
    assert.notEqual(k1, k2);
  });

  it('per_iteration mode differs from user_turn mode on tool iteration', () => {
    const withTool: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }] },
    ];
    const kUser = computeFanoutCacheKey(withTool, cfg({ fanout_mode: 'user_turn' }));
    const kIter = computeFanoutCacheKey(withTool, cfg({ fanout_mode: 'per_iteration' }));
    assert.notEqual(kUser, kIter);
  });

  it('produces the 3-segment "settingsHash|slotsHash|sig" format', () => {
    const msgs: AnthropicMessage[] = [{ role: 'user', content: 'q' }];
    const k = computeFanoutCacheKey(msgs, cfg());
    const parts = k.split('|');
    assert.equal(parts.length, 3);
    for (const p of parts) assert.match(p, /^[a-f0-9]{64}$/);
  });
});
