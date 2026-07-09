import { initDB } from './storage/db.js';
import { getConfig, ConfigError } from './config.js';
import { startServer } from './gateway/server.js';

const DB_PATH = process.env.MOM_DB_PATH ?? 'mom.db';
const PORT = Number(process.env.MOM_PORT ?? 3000);

async function main(): Promise<void> {
  initDB(DB_PATH);
  try {
    getConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[MoM] config error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const app = await startServer(PORT);
  app.log.info(`MoM gateway listening on ${PORT}`);
}

main().catch((err) => {
  console.error('[MoM] fatal:', err);
  process.exit(1);
});
