import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertToAdvisorView,
  truncateToolResult,
} from '../src/advisor/view-transformer.js';
import { ADVISORY_INSTRUCTION } from '../src/advisor/prompts.js';
import type { AnthropicMessage } from '../src/types/anthropic.js';

describe('truncateToolResult', () => {
  it('returns text unchanged when under budget', () => {
    const text = 'x'.repeat(4000);
    assert.equal(truncateToolResult(text), text);
  });

  it('truncates with head+tail markers when over budget', () => {
    const text = 'A'.repeat(1000) + 'B'.repeat(3000) + 'C'.repeat(1000);
    const out = truncateToolResult(text, 500);
    assert.match(out, /^A{500}\n\[\.\.\. 4000 chars omitted \.\.\.\]\nC{500}$/);
  });
});

describe('convertToAdvisorView', () => {
  it('normalizes string content into a text block', () => {
    const messages: AnthropicMessage[] = [{ role: 'user', content: 'hello' }];
    const out = convertToAdvisorView(messages);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('merges assistant text and tool_use into a single text block', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'read the file' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 't1', name: 'bash', input: { cmd: 'ls' } },
        ],
      },
    ];
    const out = convertToAdvisorView(messages);
    // The trailing assistant triggers the ADVISORY_INSTRUCTION marker
    assert.equal(out.length, 3);
    const assistant = out[1]!;
    assert.equal(assistant.role, 'assistant');
    const assistantText = (assistant.content as Array<{ type: string; text: string }>)[0]!.text;
    assert.match(assistantText, /Let me check\./);
    assert.match(assistantText, /\[called tool: bash\(\{"cmd":"ls"\}\)\]/);
  });

  it('merges user text and tool_result with truncation', () => {
    const big = 'Q'.repeat(5000);
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'read the file' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 't1', name: 'bash', input: { cmd: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: big },
          { type: 'text', text: 'analyse it' },
        ],
      },
    ];
    const out = convertToAdvisorView(messages);
    // Last message ends with user; no synthetic marker appended
    assert.equal(out[out.length - 1]!.role, 'user');
    const lastText = (out[out.length - 1]!.content as Array<{ type: string; text: string }>)[0]!
      .text;
    assert.match(lastText, /\[tool result:.*chars omitted.*\]/s);
    assert.match(lastText, /analyse it/);
  });

  it('drops image blocks and preserves text-only content', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'x' },
          },
        ],
      },
    ];
    const out = convertToAdvisorView(messages);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]!.content, [{ type: 'text', text: 'describe' }]);
  });

  it('appends synthetic ADVISORY_INSTRUCTION user when last message is assistant', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'partial answer' },
    ];
    const out = convertToAdvisorView(messages);
    assert.equal(out.length, 3);
    const last = out[out.length - 1]!;
    assert.equal(last.role, 'user');
    assert.deepEqual(last.content, [{ type: 'text', text: ADVISORY_INSTRUCTION }]);
  });

  it('drops empty messages (image-only user, empty string)', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: '' },
    ];
    const out = convertToAdvisorView(messages);
    // Empty assistant is dropped; last is user so no synthetic marker
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, 'user');
  });
});
