import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getTraceRequestsBySessionId } from '../storage/traces.js';

// Accept any hex 8-4-4-4-12 UUID (RFC 4122 v1-v8, NIL, max), not just v1-v5.
// Eval / dashboard side may issue UUIDv7 (timestamp-ordered), we take whatever they pick.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TraceQuery {
  session_id?: unknown;
}

export function registerTraceAPI(app: FastifyInstance): void {
  app.get('/trace/requests', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as TraceQuery;
    const sessionId = query.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      reply.code(400).send({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'query parameter "session_id" is required',
        },
      });
      return;
    }
    if (!UUID_PATTERN.test(sessionId)) {
      reply.code(400).send({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `query parameter "session_id" must be a valid UUID; got "${sessionId}"`,
        },
      });
      return;
    }
    try {
      const requests = getTraceRequestsBySessionId(sessionId);
      reply.send({ session_id: sessionId, requests });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(
        { event: 'trace_query_failed', session_id: sessionId, error: message },
        'trace query failed',
      );
      reply.code(500).send({
        type: 'error',
        error: { type: 'internal_error', message },
      });
    }
  });
}
