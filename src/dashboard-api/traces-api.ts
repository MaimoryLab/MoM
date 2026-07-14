import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDB } from '../storage/db.js';
import { getTraceRequestById } from '../storage/traces.js';
import type { TraceRequest } from '../types/mom.js';
import type {
  TraceRole,
  TraceStatus,
  TraceSummary,
  TracesListResponse,
  TraceByGatewayResponse,
} from '../types/dashboard-api.js';

const VALID_ROLES: TraceRole[] = ['advisor', 'aggregator', 'passthrough'];
const VALID_STATUSES: TraceStatus[] = ['success', 'error', 'cache_hit'];

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface ListQuery {
  limit?: string;
  offset?: string;
  role?: string;
  status?: string;
  gateway_request_id?: string;
}

function parsePositiveInt(v: string | undefined, fallback: number, max: number): number {
  if (typeof v !== 'string' || v.length === 0) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return NaN;
  return Math.min(n, max);
}

function toSummary(trace: TraceRequest): TraceSummary {
  return {
    request_id: trace.request_id,
    session_id: trace.session_id,
    gateway_request_id: trace.gateway_request_id,
    role: trace.role,
    client_model: trace.client_model,
    selected_model: trace.selected_model,
    provider: trace.provider,
    started_at: trace.started_at,
    finished_at: trace.finished_at,
    duration_ms: trace.duration_ms,
    status: trace.status,
    trigger_reason: trace.trigger_reason,
    cache_hit: trace.cache_hit,
    usage: trace.usage,
    pricing: trace.pricing,
    error: trace.error,
  };
}

interface RowShape {
  data: string;
}

interface CountRow {
  cnt: number;
}

function badRequest(reply: FastifyReply, message: string): void {
  reply.code(400).send({
    type: 'error',
    error: { type: 'invalid_request_error', message },
  });
}

export function registerTracesAPI(app: FastifyInstance): void {
  app.get('/api/traces', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as ListQuery;

    const limit = parsePositiveInt(q.limit, DEFAULT_LIMIT, MAX_LIMIT);
    if (Number.isNaN(limit)) {
      badRequest(reply, 'query "limit" must be a non-negative integer');
      return;
    }
    const offset = parsePositiveInt(q.offset, 0, Number.MAX_SAFE_INTEGER);
    if (Number.isNaN(offset)) {
      badRequest(reply, 'query "offset" must be a non-negative integer');
      return;
    }

    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (typeof q.role === 'string' && q.role.length > 0) {
      if (!VALID_ROLES.includes(q.role as TraceRole)) {
        badRequest(
          reply,
          `query "role" must be one of ${VALID_ROLES.join('|')}`,
        );
        return;
      }
      filters.push('role = ?');
      params.push(q.role);
    }
    if (typeof q.status === 'string' && q.status.length > 0) {
      if (!VALID_STATUSES.includes(q.status as TraceStatus)) {
        badRequest(
          reply,
          `query "status" must be one of ${VALID_STATUSES.join('|')}`,
        );
        return;
      }
      filters.push('status = ?');
      params.push(q.status);
    }
    if (typeof q.gateway_request_id === 'string' && q.gateway_request_id.length > 0) {
      filters.push('gateway_request_id = ?');
      params.push(q.gateway_request_id);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    let items: TraceSummary[];
    let total: number;
    try {
      const countRow = getDB()
        .prepare(`SELECT COUNT(*) as cnt FROM traces ${where}`)
        .get(...params) as unknown as CountRow;
      total = countRow.cnt;

      const rows = getDB()
        .prepare(
          `SELECT data FROM traces ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as unknown as RowShape[];
      items = rows.map((r) => toSummary(JSON.parse(r.data) as TraceRequest));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'traces_list_failed', error: message },
        'traces list failed',
      );
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message },
      });
      return;
    }

    const response: TracesListResponse = { items, total, limit, offset };
    reply.send(response);
  });

  app.get('/api/traces/by-gateway/:gateway_request_id', async (
    req: FastifyRequest<{ Params: { gateway_request_id: string } }>,
    reply: FastifyReply,
  ) => {
    const gatewayRequestId = req.params.gateway_request_id;
    if (typeof gatewayRequestId !== 'string' || gatewayRequestId.length === 0) {
      badRequest(reply, 'path parameter "gateway_request_id" is required');
      return;
    }
    try {
      const rows = getDB()
        .prepare(
          'SELECT data FROM traces WHERE gateway_request_id = ? ORDER BY started_at ASC',
        )
        .all(gatewayRequestId) as unknown as RowShape[];
      const requests = rows.map((r) => JSON.parse(r.data) as TraceRequest);
      const response: TraceByGatewayResponse = {
        gateway_request_id: gatewayRequestId,
        requests,
      };
      reply.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'traces_by_gateway_failed', error: message },
        'traces by gateway failed',
      );
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message },
      });
    }
  });

  app.get('/api/traces/:request_id', async (
    req: FastifyRequest<{ Params: { request_id: string } }>,
    reply: FastifyReply,
  ) => {
    const requestId = req.params.request_id;
    if (typeof requestId !== 'string' || requestId.length === 0) {
      badRequest(reply, 'path parameter "request_id" is required');
      return;
    }
    let trace: TraceRequest | null;
    try {
      trace = getTraceRequestById(requestId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'traces_get_failed', request_id: requestId, error: message },
        'trace fetch failed',
      );
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message },
      });
      return;
    }
    if (!trace) {
      reply.code(404).send({
        type: 'error',
        error: {
          type: 'not_found',
          message: `trace with request_id="${requestId}" not found`,
        },
      });
      return;
    }
    reply.send(trace);
  });
}
