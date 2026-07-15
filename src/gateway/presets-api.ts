import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PresetEntry, PresetsResponse } from '../types/dashboard-api.js';

const MAX_PRESETS = 32;
const MAX_TEXT_LEN = 8_000;

export interface RegisterPresetsAPIOptions {
  presetsPath: string;
}

/**
 * GET /api/presets — surface the Live prompt shelf entries from
 * `data/presets.json`. File-missing / invalid JSON / bad shape all resolve to
 * `{presets: []}` (the frontend hides the shelf when empty), so the API never
 * fails the page load. Read on every request — presets are small and this
 * lets ops swap the file without a restart.
 */
export function registerPresetsAPI(
  app: FastifyInstance,
  options: RegisterPresetsAPIOptions,
): void {
  app.get('/api/presets', async (_req: FastifyRequest, reply: FastifyReply) => {
    const presets = await loadPresets(options.presetsPath);
    const body: PresetsResponse = { presets };
    reply.send(body);
  });
}

async function loadPresets(path: string): Promise<PresetEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || parsed === null) return [];
  const maybe = (parsed as { presets?: unknown }).presets;
  if (!Array.isArray(maybe)) return [];
  const out: PresetEntry[] = [];
  for (const item of maybe) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      typeof r.zh !== 'string' ||
      typeof r.en !== 'string' ||
      typeof r.title_zh !== 'string' ||
      typeof r.title_en !== 'string'
    ) continue;
    if (r.id.length === 0 || r.id.length > 64) continue;
    if (r.zh.length === 0 || r.zh.length > MAX_TEXT_LEN) continue;
    if (r.en.length === 0 || r.en.length > MAX_TEXT_LEN) continue;
    if (r.title_zh.length === 0 || r.title_zh.length > 128) continue;
    if (r.title_en.length === 0 || r.title_en.length > 128) continue;
    out.push({
      id: r.id,
      title_zh: r.title_zh,
      title_en: r.title_en,
      zh: r.zh,
      en: r.en,
    });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}
