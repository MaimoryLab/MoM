import type { AnthropicMessagesResponse } from '../types/anthropic.js';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isUnsignedThinkingBlock(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'thinking' &&
    (typeof value.signature !== 'string' || value.signature.length === 0)
  );
}

/** Drop non-Anthropic reasoning blocks that cannot be replayed safely. */
export function normalizeAnthropicResponse(
  response: AnthropicMessagesResponse,
): AnthropicMessagesResponse {
  return {
    ...response,
    content: response.content.filter((block) => !isUnsignedThinkingBlock(block)),
  };
}

export interface AnthropicSSENormalizer {
  normalize(event: unknown): unknown | null;
}

/**
 * Normalize streamed content blocks and keep downstream indices contiguous
 * when an invalid thinking block is removed.
 */
export function createAnthropicSSENormalizer(): AnthropicSSENormalizer {
  const indexMap = new Map<number, number | null>();
  let nextIndex = 0;

  return {
    normalize(event) {
      if (!isRecord(event) || typeof event.type !== 'string') return event;

      if (event.type === 'message_start' && isRecord(event.message)) {
        return {
          ...event,
          message: normalizeAnthropicResponse(
            event.message as unknown as AnthropicMessagesResponse,
          ),
        };
      }

      if (event.type === 'content_block_start' && typeof event.index === 'number') {
        if (isUnsignedThinkingBlock(event.content_block)) {
          indexMap.set(event.index, null);
          return null;
        }
        const mappedIndex = nextIndex++;
        indexMap.set(event.index, mappedIndex);
        return { ...event, index: mappedIndex };
      }

      if (
        (event.type === 'content_block_delta' || event.type === 'content_block_stop') &&
        typeof event.index === 'number'
      ) {
        const mappedIndex = indexMap.get(event.index);
        if (mappedIndex === null) return null;
        if (mappedIndex === undefined) return event;
        if (event.type === 'content_block_stop') indexMap.delete(event.index);
        return { ...event, index: mappedIndex };
      }

      return event;
    },
  };
}
