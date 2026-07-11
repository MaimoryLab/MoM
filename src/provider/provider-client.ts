import { request } from 'undici';
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
} from '../types/anthropic.js';
import type { ProviderConfig, TraceError, TraceErrorType } from '../types/mom.js';
import { normalizeAnthropicResponse } from './anthropic-normalize.js';

export class ProviderError extends Error {
  statusCode: number;
  providerBody: string;
  model: string;

  constructor(statusCode: number, providerBody: string, model: string) {
    super(`provider returned ${statusCode} for model ${model}`);
    this.statusCode = statusCode;
    this.providerBody = providerBody;
    this.model = model;
  }
}

const PROVIDER_BODY_PREVIEW_LIMIT = 500;

export function toTraceError(err: unknown, fallbackType: TraceErrorType = 'gateway_error'): TraceError {
  if (err instanceof ProviderError) {
    return {
      type: 'provider_error',
      message: err.providerBody.slice(0, PROVIDER_BODY_PREVIEW_LIMIT),
      http_status: err.statusCode,
    };
  }
  if (err instanceof Error) {
    return { type: fallbackType, message: err.message, http_status: null };
  }
  return { type: fallbackType, message: String(err), http_status: null };
}

export function buildAuthHeaders(provider: ProviderConfig): Record<string, string> {
  const key = provider.api_key;
  if (provider.auth_style === 'x-api-key') {
    return {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    Authorization: `Bearer ${key}`,
  };
}

export function buildProviderURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  return `${trimmed}/v1/messages`;
}

export async function passthroughCall(
  req: AnthropicMessagesRequest,
  provider: ProviderConfig,
): Promise<AnthropicMessagesResponse> {
  const url = buildProviderURL(provider.base_url);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...buildAuthHeaders(provider),
  };
  const res = await request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new ProviderError(res.statusCode, text, req.model);
  }
  return normalizeAnthropicResponse(JSON.parse(text) as AnthropicMessagesResponse);
}
