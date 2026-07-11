import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AnthropicMessage } from '../src/types/anthropic.js';
import { computeTriggerReason, isNewUserTurn } from '../src/orchestrator/trigger.js';

describe('isNewUserTurn', () => {
  it('returns true for a plain user text message at the tail', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'hi' },
    ];
    assert.equal(isNewUserTurn(messages), true);
  });

  it('returns true for a user message with only text blocks', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'analyse' }],
      },
    ];
    assert.equal(isNewUserTurn(messages), true);
  });

  it('returns false when last user message contains any tool_result block', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'here is context' },
          { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
        ],
      },
    ];
    assert.equal(isNewUserTurn(messages), false);
  });

  it('returns false when last message is assistant', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ];
    assert.equal(isNewUserTurn(messages), false);
  });

  it('returns false for empty messages', () => {
    assert.equal(isNewUserTurn([]), false);
  });
});

describe('computeTriggerReason', () => {
  it('off: always reports cache disabled regardless of turn or cache state', () => {
    assert.equal(computeTriggerReason('off', true, false), 'fanout_cache_off');
    assert.equal(computeTriggerReason('off', false, false), 'fanout_cache_off');
    assert.equal(computeTriggerReason('off', true, true), 'fanout_cache_off');
  });
  it('user_turn: new turn + cache miss', () => {
    assert.equal(computeTriggerReason('user_turn', true, false), 'user_turn');
  });
  it('user_turn: tool iteration + cache hit → skipped_tool_iteration', () => {
    assert.equal(computeTriggerReason('user_turn', false, true), 'skipped_tool_iteration');
  });
  it('user_turn: tool iteration + cache miss → tool_iteration_cache_miss', () => {
    assert.equal(
      computeTriggerReason('user_turn', false, false),
      'tool_iteration_cache_miss',
    );
  });
  it('user_turn: new turn + cache hit (rare, still labels skipped_tool_iteration)', () => {
    // 语义：user_turn 模式下 cache hit 一律走 skipped_tool_iteration 分支
    assert.equal(computeTriggerReason('user_turn', true, true), 'skipped_tool_iteration');
  });
  it('per_iteration: cache miss → per_iteration', () => {
    assert.equal(computeTriggerReason('per_iteration', true, false), 'per_iteration');
    assert.equal(computeTriggerReason('per_iteration', false, false), 'per_iteration');
  });
  it('per_iteration: cache hit → fanout_cache_hit', () => {
    assert.equal(computeTriggerReason('per_iteration', true, true), 'fanout_cache_hit');
    assert.equal(computeTriggerReason('per_iteration', false, true), 'fanout_cache_hit');
  });
});
