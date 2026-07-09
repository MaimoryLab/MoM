import type { AnthropicMessagesRequest } from '../types/anthropic.js';

export class ValidationError extends Error {}

export function validateMessagesRequest(body: unknown): AnthropicMessagesRequest {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.model !== 'string' || b.model.length === 0) {
    throw new ValidationError('`model` is required and must be a non-empty string');
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new ValidationError('`messages` is required and must be a non-empty array');
  }
  if (typeof b.max_tokens !== 'number' || !Number.isFinite(b.max_tokens) || b.max_tokens <= 0) {
    throw new ValidationError('`max_tokens` is required and must be a positive number');
  }
  return b as unknown as AnthropicMessagesRequest;
}
