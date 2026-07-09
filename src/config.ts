import { loadProviderConfig } from './config/provider-env.js';
import { loadMoMConfig } from './config/mom-config-file.js';
import type { MoMConfig, RuntimeConfig } from './types/mom.js';

export class ConfigError extends Error {}

export function assertRecursionGuard(mom: MoMConfig): void {
  const aggregator = mom.aggregator.model;
  if (aggregator && mom.advisor.slots.includes(aggregator)) {
    throw new ConfigError(
      `aggregator.model "${aggregator}" also appears in advisor.slots — recursion guard tripped`,
    );
  }
}

export function getConfig(momConfigPath: string): RuntimeConfig {
  const provider = loadProviderConfig();
  const mom = loadMoMConfig(momConfigPath);
  assertRecursionGuard(mom);
  return { provider, mom };
}
