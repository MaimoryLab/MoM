import type { DatabaseSync } from 'node:sqlite';
import { getDB } from './db.js';
import type { Trace } from '../types/mom.js';

interface TraceRow {
  id: string;
  timestamp: number;
  mom_triggered: number;
  trigger_reason: string;
  total_cost_usd: number;
  baseline_cost_usd: number | null;
  total_latency_ms: number;
  data: string;
}

function db(): DatabaseSync {
  return getDB();
}

export function saveTrace(trace: Trace): void {
  const stmt = db().prepare(
    `INSERT INTO traces (id, timestamp, mom_triggered, trigger_reason, total_cost_usd, baseline_cost_usd, total_latency_ms, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    trace.id,
    trace.timestamp,
    trace.mom_triggered ? 1 : 0,
    trace.trigger_reason,
    trace.total_cost_usd,
    trace.baseline_cost_usd,
    trace.total_latency_ms,
    JSON.stringify(trace),
  );
}

function deserializeTraceRow(row: TraceRow): Trace {
  return JSON.parse(row.data) as Trace;
}

export function getTraceById(id: string): Trace | null {
  const row = db().prepare('SELECT * FROM traces WHERE id = ?').get(id) as
    | unknown as TraceRow | undefined;
  return row ? deserializeTraceRow(row) : null;
}

export function getRecentTraces(limit: number): Trace[] {
  const rows = db()
    .prepare('SELECT * FROM traces ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as unknown as TraceRow[];
  return rows.map(deserializeTraceRow);
}
