import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Phase 6 placeholder — returns 501 so the frontend knows the route exists but
// the data pipeline (judge / baseline / comparison) is not yet wired.
export function registerComparisonAPI(app: FastifyInstance): void {
  app.get('/api/comparison/:trace_id', async (
    _req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    reply.code(501).send({
      type: 'error',
      error: {
        type: 'not_implemented',
        message: 'comparison endpoint arrives in Phase 6',
      },
    });
  });
}
