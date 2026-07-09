import { request } from 'undici';
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
} from '../types/anthropic.js';
import type { MoMSettings } from '../types/mom.js';

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

export function buildAuthHeaders(settings: MoMSettings): Record<string, string> {
  const key = settings.provider.api_key;
  if (settings.provider.auth_style === 'x-api-key') {
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
  settings: MoMSettings,
): Promise<AnthropicMessagesResponse> {
  const url = buildProviderURL(settings.provider.base_url);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...buildAuthHeaders(settings),
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
  return JSON.parse(text) as AnthropicMessagesResponse;
}
