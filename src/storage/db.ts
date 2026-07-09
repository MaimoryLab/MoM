import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  mom_triggered INTEGER NOT NULL,
  trigger_reason TEXT NOT NULL,
  total_cost_usd REAL NOT NULL,
  baseline_cost_usd REAL,
  total_latency_ms INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON traces (timestamp DESC);

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
