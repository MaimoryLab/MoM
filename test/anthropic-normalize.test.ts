import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnthropicSSENormalizer,
  normalizeAnthropicResponse,
} from '../src/provider/anthropic-normalize.js';
import type { AnthropicMessagesResponse } from '../src/types/anthropic.js';

describe('Anthropic response normalization', () => {
  it('drops thinking blocks without a replayable signature', () => {
    const response = {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      model: 'model',
      content: [
        { type: 'thinking', thinking: 'internal', signature: null },
        { type: 'text', text: 'answer' },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as AnthropicMessagesResponse;

    assert.deepEqual(normalizeAnthropicResponse(response).content, [
      { type: 'text', text: 'answer' },
    ]);
  });

  it('preserves signed thinking blocks', () => {
    const response = {
      content: [{ type: 'thinking', thinking: 'internal', signature: 'signed' }],
    } as unknown as AnthropicMessagesResponse;
    assert.equal(normalizeAnthropicResponse(response).content.length, 1);
  });

  it('drops unsigned thinking SSE and remaps later content indices', () => {
    const normalizer = createAnthropicSSENormalizer();
    assert.equal(
      normalizer.normalize({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: null },
      }),
      null,
    );
    assert.equal(
      normalizer.normalize({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'secret' },
      }),
      null,
    );
    assert.deepEqual(
      normalizer.normalize({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 't1', name: 'search', input: {} },
      }),
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't1', name: 'search', input: {} },
      },
    );
    assert.deepEqual(
      normalizer.normalize({ type: 'content_block_stop', index: 1 }),
      { type: 'content_block_stop', index: 0 },
    );
  });
});
