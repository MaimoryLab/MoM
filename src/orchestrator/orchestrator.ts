import type { FastifyReply, FastifyBaseLogger } from 'fastify';
import type { AnthropicMessagesRequest } from '../types/anthropic.js';
import type { RuntimeConfig } from '../types/mom.js';
import { passthroughCall } from '../provider/provider-client.js';
import { passthroughStream } from '../provider/stream-forward.js';
import { fanoutAdvisors } from './fanout.js';
import {
  runAggregatorNonStreaming,
  runAggregatorStreaming,
} from '../aggregator/aggregator-runtime.js';

export async function orchestrate(
  body: AnthropicMessagesRequest,
  reply: FastifyReply,
  runtime: RuntimeConfig,
  log: FastifyBaseLogger,
): Promise<void> {
  const { provider, mom } = runtime;

  if (mom.mom_mode !== 'always') {
    if (body.stream === true) {
      await passthroughStream(body, reply, provider);
      return;
    }
    const response = await passthroughCall(body, provider);
    reply.send(response);
    return;
  }

  const advisorStart = Date.now();
  const advisorResults = await fanoutAdvisors(body.messages, mom, provider);
  log.info(
    {
      event: 'advisor_fanout_complete',
      slot_count: advisorResults.length,
      duration_ms: Date.now() - advisorStart,
      failures: advisorResults
        .filter((r) => !r.success)
        .map((r) => ({ slot: r.slot, error: r.error })),
    },
    'advisor fanout complete',
  );

  if (body.stream === true) {
    await runAggregatorStreaming(body, advisorResults, mom, provider, reply);
    log.info(
      { event: 'aggregator_stream_complete', model: mom.aggregator.model },
      'aggregator stream complete',
    );
    return;
  }

  const aggregatorResult = await runAggregatorNonStreaming(
    body,
    advisorResults,
    mom,
    provider,
  );
  log.info(
    {
      event: 'aggregator_complete',
      model: aggregatorResult.model,
      duration_ms: aggregatorResult.latency_ms,
      usage: aggregatorResult.usage,
    },
    'aggregator complete',
  );
  reply.send(aggregatorResult.response);
}
