import { initDB } from './storage/db.js';
import { getConfig, ConfigError } from './config.js';
import { ProviderConfigError } from './config/provider-env.js';
import { MoMConfigFileError } from './config/mom-config-file.js';
import { startServer } from './gateway/server.js';

const DB_PATH = process.env.MOM_DB_PATH ?? 'mom.db';
const MOM_CONFIG_PATH = process.env.MOM_CONFIG_PATH ?? 'data/mom.config.json';
const BENCHMARKS_PATH =
  process.env.MOM_BENCHMARKS_PATH ?? 'data/benchmarks.json';
const PRESETS_PATH = process.env.MOM_PRESETS_PATH ?? 'data/presets.json';
const PORT = Number(process.env.MOM_PORT ?? 3000);

async function main(): Promise<void> {
  initDB(DB_PATH);
  let runtime;
  try {
    runtime = getConfig(MOM_CONFIG_PATH);
  } catch (err) {
    if (
      err instanceof ConfigError ||
      err instanceof ProviderConfigError ||
      err instanceof MoMConfigFileError
    ) {
      console.error(`[MoM] config error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const app = await startServer(PORT, runtime, {
    momConfigPath: MOM_CONFIG_PATH,
    benchmarksPath: BENCHMARKS_PATH,
    presetsPath: PRESETS_PATH,
  });
  app.log.info(`MoM gateway listening on ${PORT}`);
}

main().catch((err) => {
  console.error('[MoM] fatal:', err);
  process.exit(1);
});
