import type { AuthStyle, ProviderConfig } from '../types/mom.js';

export class ProviderConfigError extends Error {}

const VALID_AUTH_STYLES: ReadonlyArray<AuthStyle> = ['bearer', 'x-api-key'];

function readEnvString(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new ProviderConfigError(
      `missing required environment variable ${name} (set it in .env or the shell)`,
    );
  }
  return raw.trim();
}

function readAuthStyle(name: string): AuthStyle {
  const raw = (process.env[name] ?? 'bearer').trim();
  if (!VALID_AUTH_STYLES.includes(raw as AuthStyle)) {
    throw new ProviderConfigError(
      `${name}="${raw}" is not a valid auth style; expected one of: ${VALID_AUTH_STYLES.join(', ')}`,
    );
  }
  return raw as AuthStyle;
}

export function loadProviderConfig(): ProviderConfig {
  return {
    base_url: readEnvString('PROVIDER_BASE_URL'),
    api_key: readEnvString('PROVIDER_API_KEY'),
    auth_style: readAuthStyle('PROVIDER_AUTH_STYLE'),
  };
}
