#!/usr/bin/env node
// One-shot pricing sync: pull provider `/v1/models`, translate per-token prices
// into per-1M-tokens ModelPricing entries, merge into data/mom.config.json.
//
// Usage:
//   npm run sync-pricing -- [--currency CNY] [--overwrite] [--dry-run] [--config <path>]
//
// Reads PROVIDER_BASE_URL / PROVIDER_API_KEY / PROVIDER_AUTH_STYLE from process.env
// (invoke with `node --env-file=.env` or via `npm run sync-pricing`).
//
// Behavior:
//   - Default merges only missing pricing_table entries (safe for hand-tuned prices).
//   - `--overwrite` replaces every model listed by the provider.
//   - Models present in mom.config.json but not returned by the provider are left alone
//     (never deleted) and printed as `SKIP unknown-to-provider`.
//   - `cache_write` is estimated as `input * 1.25` (Anthropic convention).
//     Provider `/v1/models` does not expose a cache-write price today.
//   - `--currency` (default `CNY`) is stamped onto every ModelPricing entry; the
//     provider response has no explicit currency, so it must be declared here.
//     paigod (`apiproxy.paigod.work`) returns CNY-denominated per-token prices.
//   - `--dry-run` prints the merged pricing_table without writing.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fetch } from 'undici';

const CACHE_WRITE_MULTIPLIER = 1.25;
const PER_MILLION = 1_000_000;

const { values: args } = parseArgs({
  options: {
    currency: { type: 'string', default: 'CNY' },
    overwrite: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    config: { type: 'string', default: 'data/mom.config.json' },
  },
});

function die(msg, code = 1) {
  console.error(`sync-pricing: ${msg}`);
  process.exit(code);
}

const baseURL = process.env.PROVIDER_BASE_URL;
const apiKey = process.env.PROVIDER_API_KEY;
const authStyle = process.env.PROVIDER_AUTH_STYLE ?? 'bearer';

if (!baseURL) die('PROVIDER_BASE_URL not set — run via `npm run sync-pricing` or `node --env-file=.env scripts/sync-pricing.mjs`');
if (!apiKey) die('PROVIDER_API_KEY not set');
if (!args.currency || !args.currency.trim()) die('--currency must be a non-empty string (e.g. CNY / USD)');

const authHeaders =
  authStyle === 'x-api-key'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${apiKey}` };

const modelsURL = `${baseURL.replace(/\/+$/, '')}/v1/models`;

console.log(`sync-pricing: GET ${modelsURL}`);
const res = await fetch(modelsURL, { headers: authHeaders });
if (!res.ok) {
  die(`provider /v1/models returned HTTP ${res.status}: ${await res.text().catch(() => '<no body>')}`);
}
const { data: models } = await res.json();
if (!Array.isArray(models)) die('provider response missing `data: []`');

const configPath = args.config;
const raw = await readFile(configPath, 'utf8');
const config = JSON.parse(raw);
const existing = config.pricing_table ?? {};

const providerPriced = new Map();
for (const m of models) {
  if (!m || typeof m.id !== 'string' || !m.price) continue;
  const p = m.price;
  if (typeof p.input_price !== 'number' || typeof p.output_price !== 'number') continue;
  providerPriced.set(m.id, {
    currency: args.currency,
    input: round4(p.input_price * PER_MILLION),
    output: round4(p.output_price * PER_MILLION),
    cache_read: typeof p.cached_price === 'number' ? round4(p.cached_price * PER_MILLION) : 0,
    cache_write: round4(p.input_price * PER_MILLION * CACHE_WRITE_MULTIPLIER),
  });
}

let added = 0;
let updated = 0;
let kept = 0;
const merged = { ...existing };
for (const [id, rate] of providerPriced) {
  if (id in existing) {
    if (args.overwrite) {
      merged[id] = rate;
      updated += 1;
      console.log(`UPDATE ${id}  ${fmt(rate)}`);
    } else {
      kept += 1;
    }
  } else {
    merged[id] = rate;
    added += 1;
    console.log(`ADD    ${id}  ${fmt(rate)}`);
  }
}

// Report models the local config already had but the provider doesn't list
for (const id of Object.keys(existing)) {
  if (!providerPriced.has(id)) console.log(`SKIP   ${id}  (unknown to provider — leaving entry intact)`);
}

console.log(
  `sync-pricing: added=${added} updated=${updated} kept-existing=${kept} currency=${args.currency}`,
);

if (args['dry-run']) {
  console.log('--dry-run: not writing config');
  process.exit(0);
}

if (added === 0 && updated === 0) {
  console.log('nothing to write');
  process.exit(0);
}

config.pricing_table = merged;
const tmp = `${configPath}.tmp`;
await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
await rename(tmp, configPath);
console.log(`wrote ${configPath}`);

function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

function fmt(r) {
  return `${r.currency} in=${r.input}/M out=${r.output}/M cache_read=${r.cache_read}/M cache_write≈${r.cache_write}/M`;
}
