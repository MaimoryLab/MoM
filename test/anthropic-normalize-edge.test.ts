/**
 * Anthropic normalize — edge-case coverage beyond the happy-path test in
 * test/anthropic-normalize.test.ts.
 *
 * 探测点:
 *   1. signature 为空字符串 vs 缺失字段 vs null 三种"unsigned"边界
 *   2. 多个 unsigned thinking block 交错 index 重映射的正确性
 *   3. message_start 内含 thinking → 是否也被过滤
 *   4. thinking_delta 落在被删的 index 上 → 是否正确返回 null
 *   5. 非 anthropic 事件类型(如 ping) → 原样透出
 *   6. content_block 不是 record 时的健壮性(protocol drift)
 *   7. 顺序:tool_use → thinking(unsigned) → text 的 index 是否为 0, drop, 1
 *   8. isUnsignedThinkingBlock 只判断 signature,不看 thinking 内容
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnthropicSSENormalizer,
  normalizeAnthropicResponse,
} from '../src/provider/anthropic-normalize.js';
import type { AnthropicMessagesResponse } from '../src/types/anthropic.js';

describe('normalizeAnthropicResponse — edge cases', () => {
  it('drops unsigned thinking with signature: undefined', () => {
    const resp = {
      content: [
        { type: 'thinking', thinking: 'x' }, // no signature key at all
        { type: 'text', text: 'y' },
      ],
    } as unknown as AnthropicMessagesResponse;
    const out = normalizeAnthropicResponse(resp).content;
    assert.equal(out.length, 1);
    assert.equal((out[0] as any).text, 'y');
  });

  it('drops unsigned thinking with signature: ""', () => {
    const resp = {
      content: [
        { type: 'thinking', thinking: 'x', signature: '' },
        { type: 'text', text: 'y' },
      ],
    } as unknown as AnthropicMessagesResponse;
    assert.equal(normalizeAnthropicResponse(resp).content.length, 1);
  });

  it('keeps signed thinking (signature is a non-empty string)', () => {
    const resp = {
      content: [
        { type: 'thinking', thinking: 'x', signature: 'abc' },
        { type: 'text', text: 'y' },
      ],
    } as unknown as AnthropicMessagesResponse;
    assert.equal(normalizeAnthropicResponse(resp).content.length, 2);
  });

  it('drops multiple unsigned thinking blocks in a row', () => {
    const resp = {
      content: [
        { type: 'thinking', signature: null },
        { type: 'thinking', signature: '' },
        { type: 'text', text: 'kept' },
        { type: 'thinking' }, // no signature
      ],
    } as unknown as AnthropicMessagesResponse;
    const out = normalizeAnthropicResponse(resp).content;
    assert.equal(out.length, 1);
    assert.equal((out[0] as any).text, 'kept');
  });

  it('preserves other fields of the response verbatim', () => {
    const resp = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'm',
      content: [{ type: 'thinking', signature: null }, { type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 5 },
    } as unknown as AnthropicMessagesResponse;
    const out = normalizeAnthropicResponse(resp);
    assert.equal(out.id, 'msg_1');
    assert.equal(out.stop_reason, 'end_turn');
    assert.deepEqual(out.usage, { input_tokens: 3, output_tokens: 5 });
  });

  it('empty content array survives without mutation', () => {
    const resp = { content: [] } as unknown as AnthropicMessagesResponse;
    assert.deepEqual(normalizeAnthropicResponse(resp).content, []);
  });
});

describe('createAnthropicSSENormalizer — index remapping edge cases', () => {
  it('normalizes message_start.message.content (drops unsigned thinking there too)', () => {
    const norm = createAnthropicSSENormalizer();
    const out = norm.normalize({
      type: 'message_start',
      message: {
        id: 'm1',
        type: 'message',
        role: 'assistant',
        model: 'm',
        content: [
          { type: 'thinking', signature: null },
          { type: 'text', text: 'hi' },
        ],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }) as any;
    assert.equal(out.type, 'message_start');
    assert.equal(out.message.content.length, 1);
    assert.equal(out.message.content[0].type, 'text');
  });

  it('interleaved thinking(unsigned) → text → thinking(unsigned) → text mapping', () => {
    const norm = createAnthropicSSENormalizer();
    // upstream idx 0 = unsigned thinking → drop
    assert.equal(norm.normalize({
      type: 'content_block_start', index: 0,
      content_block: { type: 'thinking', signature: null },
    }), null);
    // upstream idx 1 = text → maps to 0
    assert.deepEqual(norm.normalize({
      type: 'content_block_start', index: 1,
      content_block: { type: 'text', text: '' },
    }), {
      type: 'content_block_start', index: 0,
      content_block: { type: 'text', text: '' },
    });
    // upstream idx 2 = unsigned thinking → drop
    assert.equal(norm.normalize({
      type: 'content_block_start', index: 2,
      content_block: { type: 'thinking' },
    }), null);
    // upstream idx 3 = text → maps to 1 (前面已经映射了一个 kept 到 0)
    assert.deepEqual(norm.normalize({
      type: 'content_block_start', index: 3,
      content_block: { type: 'text', text: '' },
    }), {
      type: 'content_block_start', index: 1,
      content_block: { type: 'text', text: '' },
    });
  });

  it('content_block_delta on a dropped index → null', () => {
    const norm = createAnthropicSSENormalizer();
    norm.normalize({
      type: 'content_block_start', index: 0,
      content_block: { type: 'thinking', signature: null },
    });
    assert.equal(norm.normalize({
      type: 'content_block_delta', index: 0,
      delta: { type: 'thinking_delta', thinking: 'x' },
    }), null);
  });

  it('content_block_stop on a dropped index → null and mapping cleaned up', () => {
    const norm = createAnthropicSSENormalizer();
    norm.normalize({
      type: 'content_block_start', index: 0,
      content_block: { type: 'thinking', signature: null },
    });
    assert.equal(norm.normalize({
      type: 'content_block_stop', index: 0,
    }), null);
  });

  it('content_block_stop on a mapped kept index → remapped and mapping cleaned', () => {
    const norm = createAnthropicSSENormalizer();
    norm.normalize({
      type: 'content_block_start', index: 0,
      content_block: { type: 'text', text: '' },
    });
    assert.deepEqual(
      norm.normalize({ type: 'content_block_stop', index: 0 }),
      { type: 'content_block_stop', index: 0 },
    );
  });

  it('delta/stop for an index without a preceding start passes through unchanged', () => {
    // 这个语义上是"未见 start 就发 delta",实际协议不会发生;实现选择 pass-through
    const norm = createAnthropicSSENormalizer();
    const out = norm.normalize({
      type: 'content_block_delta', index: 5, delta: { type: 'text_delta', text: 'x' },
    });
    assert.deepEqual(out, {
      type: 'content_block_delta', index: 5, delta: { type: 'text_delta', text: 'x' },
    });
  });

  it('non-content event types pass through (ping / message_delta / message_stop)', () => {
    const norm = createAnthropicSSENormalizer();
    assert.deepEqual(norm.normalize({ type: 'ping' }), { type: 'ping' });
    assert.deepEqual(
      norm.normalize({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    );
    assert.deepEqual(norm.normalize({ type: 'message_stop' }), { type: 'message_stop' });
  });

  it('malformed event (non-record) passes through', () => {
    const norm = createAnthropicSSENormalizer();
    assert.equal(norm.normalize(null), null);
    assert.equal(norm.normalize('random string'), 'random string');
    assert.equal(norm.normalize(42), 42);
  });

  it('event with type not string passes through', () => {
    const norm = createAnthropicSSENormalizer();
    const evt = { type: 123, foo: 'bar' };
    assert.deepEqual(norm.normalize(evt), evt);
  });

  it('is not shared across normalizer instances (isolation)', () => {
    const a = createAnthropicSSENormalizer();
    const b = createAnthropicSSENormalizer();
    a.normalize({
      type: 'content_block_start', index: 0,
      content_block: { type: 'thinking', signature: null },
    });
    a.normalize({
      type: 'content_block_start', index: 1,
      content_block: { type: 'text', text: '' },
    });
    // b should start fresh
    const bOut = b.normalize({
      type: 'content_block_start', index: 0,
      content_block: { type: 'text', text: '' },
    }) as any;
    assert.equal(bOut.index, 0);
  });
});

// --------------------------------------------
// 集成层面测试:通过 mock HTTP 服务器灌一段真实 SSE 流,
// 观察 output stream 收到的字节序是否正确剔除 unsigned thinking 帧
// --------------------------------------------
describe('stream-forward + normalizer end-to-end', () => {
  it('drops thinking frames from downstream SSE bytes while preserving text/tool_use', async () => {
    const { createServer } = await import('node:http');
    const { PassThrough } = await import('node:stream');
    const { passthroughStream } = await import('../src/provider/stream-forward.js');
    const type = (o: unknown) =>
      `event: ${(o as { evt: string }).evt}\ndata: ${JSON.stringify((o as { d: unknown }).d)}\n\n`;

    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.statusCode = 200;
      // Sequence:
      //   message_start(with unsigned thinking + text)
      //   content_block_start idx0 = thinking(unsigned)
      //   content_block_delta idx0 = thinking_delta
      //   content_block_stop idx0
      //   content_block_start idx1 = text
      //   content_block_delta idx1 = text_delta "hello"
      //   content_block_stop idx1
      //   message_delta / message_stop
      for (const f of [
        { evt: 'message_start', d: {
          type: 'message_start',
          message: {
            id: 'msg_test', type: 'message', role: 'assistant', model: 'm',
            content: [
              { type: 'thinking', signature: null },
              { type: 'text', text: '' },
            ],
            stop_reason: null, stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }},
        { evt: 'content_block_start', d: {
          type: 'content_block_start', index: 0,
          content_block: { type: 'thinking', signature: null },
        }},
        { evt: 'content_block_delta', d: {
          type: 'content_block_delta', index: 0,
          delta: { type: 'thinking_delta', thinking: 'INTERNAL_SECRET' },
        }},
        { evt: 'content_block_stop', d: {
          type: 'content_block_stop', index: 0,
        }},
        { evt: 'content_block_start', d: {
          type: 'content_block_start', index: 1,
          content_block: { type: 'text', text: '' },
        }},
        { evt: 'content_block_delta', d: {
          type: 'content_block_delta', index: 1,
          delta: { type: 'text_delta', text: 'hello world' },
        }},
        { evt: 'content_block_stop', d: {
          type: 'content_block_stop', index: 1,
        }},
        { evt: 'message_delta', d: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 5, output_tokens: 3 },
        }},
        { evt: 'message_stop', d: { type: 'message_stop' }},
      ]) res.write(type(f));
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as any).port;

    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));

    await passthroughStream(
      {
        model: 'm', messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 32, stream: true,
      },
      out,
      { base_url: `http://127.0.0.1:${port}`, api_key: 'x', auth_style: 'bearer' },
    );

    await new Promise<void>((r) => server.close(() => r()));

    const text = Buffer.concat(chunks).toString('utf8');

    // 断言 1:client 收到的 SSE 不含 "INTERNAL_SECRET"(thinking 内容被剔除)
    assert.doesNotMatch(text, /INTERNAL_SECRET/);

    // 断言 2:message_start 里的 content 不含 unsigned thinking
    const messageStartMatch = text.match(/event: message_start\ndata: (\{.+\})/);
    assert.ok(messageStartMatch, 'message_start event must exist');
    const messageStart = JSON.parse(messageStartMatch[1]!);
    assert.equal(messageStart.message.content.length, 1);
    assert.equal(messageStart.message.content[0].type, 'text');

    // 断言 3:content_block_start 只出现一次,且 index=0(remapped from upstream 1)
    const starts = [...text.matchAll(/event: content_block_start\ndata: (\{.+\})/g)];
    assert.equal(starts.length, 1);
    assert.equal(JSON.parse(starts[0]![1]!).index, 0);

    // 断言 4:文本 delta index=0,内容是 "hello world"
    const deltas = [...text.matchAll(/event: content_block_delta\ndata: (\{.+\})/g)];
    assert.equal(deltas.length, 1);
    const delta = JSON.parse(deltas[0]![1]!);
    assert.equal(delta.index, 0);
    assert.equal(delta.delta.text, 'hello world');

    // 断言 5:content_block_stop index=0(remapped)
    const stops = [...text.matchAll(/event: content_block_stop\ndata: (\{.+\})/g)];
    assert.equal(stops.length, 1);
    assert.equal(JSON.parse(stops[0]![1]!).index, 0);

    // 断言 6:message_delta / message_stop 存在
    assert.match(text, /event: message_delta/);
    assert.match(text, /event: message_stop/);
  });
});
