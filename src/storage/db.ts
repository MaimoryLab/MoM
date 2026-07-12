import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS traces (
  request_id TEXT PRIMARY KEY,
  session_id TEXT,
  gateway_request_id TEXT NOT NULL,
  role TEXT NOT NULL,
  client_model TEXT NOT NULL,
  selected_model TEXT NOT NULL,
  provider TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traces_session_id ON traces (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traces_started_at ON traces (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_gateway_request_id ON traces (gateway_request_id);

CREATE TABLE IF NOT EXISTS metrics_cache (
  window TEXT PRIMARY KEY,
  computed_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

let db: DatabaseSync | null = null;

export function initDB(path: string): DatabaseSync {
  const instance = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  instance.exec('PRAGMA journal_mode = WAL');
  instance.exec(SCHEMA);
  db = instance;
  return instance;
}

export function getDB(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized — call initDB() first');
  }
  return db;
}

export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}
