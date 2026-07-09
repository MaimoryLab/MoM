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
