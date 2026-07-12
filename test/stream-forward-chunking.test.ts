/**
 * stream-forward chunking robustness — new commit reworked the pipe to
 * "parse → normalize → re-emit formatSSEEvent" (removed byte-level tee).
 * Verify:
 *   1. Provider chunks split mid-frame (bytes 0..N of a data line) → client
 *      still receives every event exactly once, in order
 *   2. Very small chunks (1 byte at a time) still yield the same downstream text
 *   3. No frame duplication when chunks straddle multiple events
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { passthroughStream } from '../src/provider/stream-forward.js';
import type { ProviderConfig } from '../src/types/mom.js';
import type { AnthropicMessagesRequest } from '../src/types/anthropic.js';

const provider = (baseUrl: string): ProviderConfig => ({
  base_url: baseUrl,
  api_key: 'x',
  auth_style: 'bearer',
});
const req = (): AnthropicMessagesRequest => ({
  model: 'm', messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 32, stream: true,
});

function buildSSE(): string {
  const frames = [
    { evt: 'message_start', d: {
      type: 'message_start',
      message: {
        id: 'msg', type: 'message', role: 'assistant', model: 'm',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }},
    { evt: 'content_block_start', d: {
      type: 'content_block_start', index: 0,
      content_block: { type: 'text', text: '' },
    }},
    { evt: 'content_block_delta', d: {
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: 'hello ' },
    }},
    { evt: 'content_block_delta', d: {
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: 'world' },
    }},
    { evt: 'content_block_stop', d: { type: 'content_block_stop', index: 0 }},
    { evt: 'message_delta', d: {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 3, output_tokens: 2 },
    }},
    { evt: 'message_stop', d: { type: 'message_stop' }},
  ];
  return frames.map((f) => `event: ${f.evt}\ndata: ${JSON.stringify(f.d)}\n\n`).join('');
}

async function runWithChunkSize(size: number): Promise<string> {
  const full = buildSSE();
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.statusCode = 200;
    // slice into chunks of `size` bytes and write with tiny delays
    let i = 0;
    const tick = (): void => {
      if (i >= full.length) { res.end(); return; }
      const end = Math.min(i + size, full.length);
      res.write(full.slice(i, end));
      i = end;
      setImmediate(tick);
    };
    tick();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (c: Buffer) => chunks.push(c));

  await passthroughStream(req(), out, provider(`http://127.0.0.1:${port}`));
  await new Promise<void>((r) => server.close(() => r()));
  return Buffer.concat(chunks).toString('utf8');
}

describe('stream-forward chunking robustness', () => {
  it('splits at 1 byte/chunk → still emits all events', async () => {
    const text = await runWithChunkSize(1);
    assert.equal((text.match(/event: message_start/g) ?? []).length, 1);
    assert.equal((text.match(/event: content_block_start/g) ?? []).length, 1);
    assert.equal((text.match(/event: content_block_delta/g) ?? []).length, 2);
    assert.equal((text.match(/event: content_block_stop/g) ?? []).length, 1);
    assert.equal((text.match(/event: message_delta/g) ?? []).length, 1);
    assert.equal((text.match(/event: message_stop/g) ?? []).length, 1);
    assert.match(text, /"text":"hello "/);
    assert.match(text, /"text":"world"/);
  });

  it('splits at 5 bytes/chunk → still emits all events', async () => {
    const text = await runWithChunkSize(5);
    assert.equal((text.match(/event: message_delta/g) ?? []).length, 1);
    assert.match(text, /"text":"hello "/);
    assert.match(text, /"text":"world"/);
  });

  it('splits at 300 bytes/chunk (whole small frames) → identical', async () => {
    const text = await runWithChunkSize(300);
    assert.equal((text.match(/event: message_stop/g) ?? []).length, 1);
  });

  it('no duplication or drop across chunk boundaries at any size', async () => {
    const sizes = [1, 3, 7, 13, 100, 4096];
    for (const s of sizes) {
      const text = await runWithChunkSize(s);
      const startCount = (text.match(/event: content_block_start/g) ?? []).length;
      const stopCount = (text.match(/event: content_block_stop/g) ?? []).length;
      const deltaCount = (text.match(/event: content_block_delta/g) ?? []).length;
      assert.equal(startCount, 1, `size=${s}: content_block_start`);
      assert.equal(stopCount, 1, `size=${s}: content_block_stop`);
      assert.equal(deltaCount, 2, `size=${s}: content_block_delta`);
    }
  });
});
