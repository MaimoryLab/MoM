import { createOrchestrator, type Orchestrator } from './orchestrator.js';
import type { RuntimeConfig } from '../types/mom.js';

export interface OrchestratorHolder {
  get(): Orchestrator;
  rebuild(): void;
}

// Mutable holder — Dashboard's POST /api/config edits `runtime.mom` in place
// then calls rebuild() so the next /v1/messages call picks up the new
// orchestrator (with a fresh fanout cache).
export function createOrchestratorHolder(
  runtime: RuntimeConfig,
): OrchestratorHolder {
  let current = createOrchestrator(runtime);
  return {
    get() {
      return current;
    },
    rebuild() {
      current = createOrchestrator(runtime);
    },
  };
}
