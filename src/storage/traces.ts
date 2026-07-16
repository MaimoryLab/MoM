import type { DatabaseSync } from 'node:sqlite';
import { getDB } from './db.js';
import type { TraceRequest } from '../types/mom.js';

interface TraceRow {
  data: string;
}

function db(): DatabaseSync {
  return getDB();
}

export function saveTraceRequest(trace: TraceRequest): void {
  const stmt = db().prepare(
    `INSERT INTO traces (
      request_id, session_id, gateway_request_id, role, client_model, selected_model,
      provider, started_at, finished_at, duration_ms, status, trigger_reason, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    trace.request_id,
    trace.session_id,
    trace.gateway_request_id,
    trace.role,
    trace.client_model,
    trace.selected_model,
    trace.provider,
    trace.started_at,
    trace.finished_at,
    trace.duration_ms,
    trace.status,
    trace.trigger_reason,
    JSON.stringify(trace),
  );
}

function deserialize(row: TraceRow): TraceRequest {
  return JSON.parse(row.data) as TraceRequest;
}

export function getTraceRequestById(request_id: string): TraceRequest | null {
  const row = db()
    .prepare('SELECT data FROM traces WHERE request_id = ?')
    .get(request_id) as unknown as TraceRow | undefined;
  return row ? deserialize(row) : null;
}

export function getTraceRequestsBySessionId(session_id: string): TraceRequest[] {
  const rows = db()
    .prepare('SELECT data FROM traces WHERE session_id = ? ORDER BY started_at ASC')
    .all(session_id) as unknown as TraceRow[];
  return rows.map(deserialize);
}

export function getRecentTraceRequests(limit: number): TraceRequest[] {
  const rows = db()
    .prepare('SELECT data FROM traces ORDER BY started_at DESC LIMIT ?')
    .all(limit) as unknown as TraceRow[];
  return rows.map(deserialize);
}

export function getTraceRequestsByGatewayRequestId(gatewayRequestId: string): TraceRequest[] {
  const rows = db()
    .prepare(
      'SELECT data FROM traces WHERE gateway_request_id = ? ORDER BY started_at ASC',
    )
    .all(gatewayRequestId) as unknown as TraceRow[];
  return rows.map(deserialize);
}

export function deleteTracesByGatewayRequestId(gatewayRequestId: string): number {
  const info = db()
    .prepare('DELETE FROM traces WHERE gateway_request_id = ?')
    .run(gatewayRequestId);
  return Number(info.changes ?? 0);
}
