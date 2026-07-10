import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AnthropicMessage } from '../src/types/anthropic.js';
import { applyAdvisorCacheControl } from '../src/cache/cache-decorator.js';
import { ADVISORY_INSTRUCTION } from '../src/advisor/prompts.js';

function hasCacheControl(block: unknown): boolean {
  return typeof block === 'object' && block !== null && 'cache_control' in block;
}

describe('applyAdvisorCacheControl — system_and_3 layout', () => {
  it('wraps system into a SystemBlock[] with one ephemeral marker', () => {
    const { system } = applyAdvisorCacheControl('sys prompt', []);
    assert.equal(system.length, 1);
    assert.equal(system[0]!.text, 'sys prompt');
    assert.deepEqual(system[0]!.cache_control, { type: 'ephemeral' });
  });

  it('marks the LAST content block of the last 3 non-synthetic messages', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'q0' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'q1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
      { role: 'user', content: [{ type: 'text', text: 'q2' }] },
    ];
    const { messages: decorated } = applyAdvisorCacheControl('sys', messages);
    // 前两条不动
    const untouched = decorated.slice(0, 2);
    for (const m of untouched) {
      const b = (m.content as Array<{ cache_control?: unknown }>)[0]!;
      assert.equal(hasCacheControl(b), false);
    }
    // 后三条最后 block 应带 cache_control
    for (let i = 2; i < 5; i++) {
      const b = (decorated[i]!.content as Array<{ cache_control?: unknown }>)[0]!;
      assert.ok(hasCacheControl(b), `message ${i} should carry cache_control`);
    }
  });

  it('skips the synthetic ADVISORY_INSTRUCTION marker when picking the last 3', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'q1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'q2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
      { role: 'user', content: [{ type: 'text', text: ADVISORY_INSTRUCTION }] }, // 合成 marker，应跳过
    ];
    const { messages: decorated } = applyAdvisorCacheControl('sys', messages);
    // 应标记 index 1、2、3（跳过 index 4 的合成 marker，回退到 index 1）
    const shouldMark = [1, 2, 3];
    for (const idx of shouldMark) {
      const b = (decorated[idx]!.content as Array<{ cache_control?: unknown }>)[0]!;
      assert.ok(hasCacheControl(b), `expected cache_control on index ${idx}`);
    }
    const syntheticBlock = (decorated[4]!.content as Array<{ cache_control?: unknown }>)[0]!;
    assert.equal(hasCacheControl(syntheticBlock), false);
    const firstBlock = (decorated[0]!.content as Array<{ cache_control?: unknown }>)[0]!;
    assert.equal(hasCacheControl(firstBlock), false);
  });

  it('does not go out of bounds when fewer than 3 non-synthetic messages exist', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'q1' }] },
      { role: 'user', content: [{ type: 'text', text: ADVISORY_INSTRUCTION }] },
    ];
    const { messages: decorated } = applyAdvisorCacheControl('sys', messages);
    assert.equal(decorated.length, 2);
    const firstBlock = (decorated[0]!.content as Array<{ cache_control?: unknown }>)[0]!;
    assert.ok(hasCacheControl(firstBlock));
    const synthetic = (decorated[1]!.content as Array<{ cache_control?: unknown }>)[0]!;
    assert.equal(hasCacheControl(synthetic), false);
  });

  it('marks the LAST content block when a message has multiple blocks', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ];
    const { messages: decorated } = applyAdvisorCacheControl('sys', messages);
    const blocks = decorated[0]!.content as Array<{ cache_control?: unknown }>;
    assert.equal(hasCacheControl(blocks[0]), false);
    assert.ok(hasCacheControl(blocks[1]));
  });
});
