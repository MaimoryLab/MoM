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

export function assertModeRequirements(mom: MoMConfig): void {
  if (mom.mom_mode !== 'always') return;
  if (mom.advisor.slots.length === 0) {
    throw new ConfigError(
      'mom_mode="always" requires advisor.slots to be non-empty — configure at least one advisor slot in data/mom.config.json',
    );
  }
  if (mom.aggregator.model.trim() === '') {
    throw new ConfigError(
      'mom_mode="always" requires aggregator.model to be non-empty — configure it in data/mom.config.json',
    );
  }
}

export function getConfig(momConfigPath: string): RuntimeConfig {
  const provider = loadProviderConfig();
  const mom = loadMoMConfig(momConfigPath);
  assertRecursionGuard(mom);
  assertModeRequirements(mom);
  return { provider, mom };
}
