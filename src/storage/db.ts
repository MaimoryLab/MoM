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

CREATE TABLE IF NOT EXISTS comparisons (
  gateway_request_id     TEXT PRIMARY KEY,
  session_id             TEXT,
  lang                   TEXT NOT NULL,
  prompt_text            TEXT NOT NULL,
  started_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  status                 TEXT NOT NULL,
  advisors_snapshot_json TEXT,
  aggregator_model       TEXT,
  baseline_model_snapshot TEXT,
  mom_text               TEXT,
  mom_finished_at        INTEGER,
  mom_usage_json         TEXT,
  mom_cost_usd           REAL,
  mom_error_json         TEXT,
  baseline_model         TEXT,
  baseline_text          TEXT,
  baseline_finished_at   INTEGER,
  baseline_usage_json    TEXT,
  baseline_cost_usd      REAL,
  baseline_error_json    TEXT,
  judge_model            TEXT,
  judge_finished_at      INTEGER,
  judge_scores_json      TEXT,
  judge_verdict          TEXT,
  judge_fallback         INTEGER DEFAULT 0,
  judge_ab_mapping_json  TEXT,
  judge_error_json       TEXT
);

CREATE INDEX IF NOT EXISTS idx_comparisons_session_id ON comparisons(session_id, started_at)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comparisons_started_at ON comparisons(started_at DESC);
`;

// Idempotent column-adder — SQLite does not support "ADD COLUMN IF NOT EXISTS",
// so we introspect via PRAGMA table_info before ALTER TABLE.
function ensureColumns(
  instance: DatabaseSync,
  table: string,
  columns: Array<{ name: string; ddl: string }>,
): void {
  const existing = new Set(
    (instance.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
  for (const c of columns) {
    if (!existing.has(c.name)) {
      instance.exec(`ALTER TABLE ${table} ADD COLUMN ${c.name} ${c.ddl}`);
    }
  }
}

let db: DatabaseSync | null = null;

export function initDB(path: string): DatabaseSync {
  const instance = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  instance.exec('PRAGMA journal_mode = WAL');
  instance.exec(SCHEMA);
  // Backfill-safe migrations: existing DBs (created before ISS-035) get the
  // new columns added; fresh DBs get them from SCHEMA above and this is a no-op.
  ensureColumns(instance, 'comparisons', [
    { name: 'advisors_snapshot_json', ddl: 'TEXT' },
    { name: 'aggregator_model', ddl: 'TEXT' },
    { name: 'baseline_model_snapshot', ddl: 'TEXT' },
    { name: 'mom_error_json', ddl: 'TEXT' },
  ]);
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
