import { loadSettings } from './storage/settings.js';
import type { MoMSettings } from './types/mom.js';

export class ConfigError extends Error {}

export function assertRecursionGuard(settings: MoMSettings): void {
  const aggregator = settings.aggregator.model;
  if (aggregator && settings.advisor.slots.includes(aggregator)) {
    throw new ConfigError(
      `aggregator.model "${aggregator}" also appears in advisor.slots — recursion guard tripped`,
    );
  }
}

export function getConfig(): MoMSettings {
  const settings = loadSettings();
  assertRecursionGuard(settings);
  return settings;
}
