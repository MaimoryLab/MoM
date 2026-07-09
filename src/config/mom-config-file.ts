import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_MOM_CONFIG, type MoMConfig } from '../types/mom.js';

export class MoMConfigFileError extends Error {}

function isNodeErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}

export function loadMoMConfig(path: string): MoMConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      const defaults = structuredClone(DEFAULT_MOM_CONFIG);
      saveMoMConfig(path, defaults);
      return defaults;
    }
    throw new MoMConfigFileError(
      `failed to read MoM config file at ${path}: ${(err as Error).message}`,
    );
  }
  try {
    return JSON.parse(raw) as MoMConfig;
  } catch (err) {
    throw new MoMConfigFileError(
      `MoM config file at ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }
}

export function saveMoMConfig(path: string, config: MoMConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}
