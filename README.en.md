# MoM (Mixture of Models)

<div align="center">

[中文版](README.md) · [English](README.en.md)

</div>

MoM is a standalone HTTP gateway that sits between Claude Code and a provider. It fans a single Claude Code request out to several cheap advisor models, feeds their references into one aggregator model, and lets the combination approach the capability of a flagship. Both the inbound and outbound protocols are the Anthropic Messages API, so Claude Code needs no changes — just point `ANTHROPIC_BASE_URL` at MoM.

The project is currently in Phase 1 (skeleton + passthrough). The gateway forwards traffic unchanged; the MoM logic itself lands in the following phases. See [`PLAN.md`](PLAN.md) for the staged plan.

---

## Requirements

| Dependency | Version |
|------------|---------|
| Node.js | >= 22.13.0 |
| npm | ships with Node 22 (used for workspaces) |

SQLite is provided by the built-in `node:sqlite` module — no separate install, no native build step.

---

## Install

```bash
git clone https://github.com/MaimoryLab/MoM.git
cd MoM
npm install
```

---

## Configure

Configuration lives in two clearly-separated places:

- **`.env`** (deployment / secrets): provider credentials, listening port, data file paths
- **`data/mom.config.json`** (business config): MoM trigger mode, advisor slots, aggregator model, pricing table, etc. Never holds secrets.

### 1. `.env` (provider secrets)

```bash
cp .env.example .env
# Edit .env — at minimum set PROVIDER_BASE_URL and PROVIDER_API_KEY.
# PROVIDER_AUTH_STYLE defaults to "bearer"; use "x-api-key" for the official Anthropic API.
```

### 2. `data/mom.config.json` (business config)

On first startup MoM writes `DEFAULT_MOM_CONFIG` — a safe empty shell (`mom_mode=off`, `advisor.slots=[]`, `aggregator.model=""`). You must fill in model names before MoM actually fans out. Edit it directly with `vi` afterwards, or through the Dashboard form once Phase 5 ships. The Dashboard never edits secrets — secrets live in `.env` only.

Model names go in two places:

- `advisor.slots`: array of advisor model names — one entry = one concurrent advisor call (3 slots → fan out 3 times).
- `aggregator.model`: a single aggregator model name that folds the advisor references into the final response.

Every model name must be a real model id served by the provider you pointed `PROVIDER_BASE_URL` at. Slots may repeat or overlap with the aggregator.

A ready-to-run fan-out example (replace `<...>` with real model names from your provider):

```json
{
  "mom_mode": "always",
  "fanout_mode": "user_turn",
  "aggregation_mode": "concat",
  "reference_max_tokens": 4096,
  "advisor": {
    "slots": ["<advisor-model-1>", "<advisor-model-2>", "<advisor-model-3>"],
    "tools_enabled": false
  },
  "aggregator": {
    "model": "<aggregator-model>"
  },
  "judge": {
    "model": ""
  },
  "cache": {
    "ttl": "5m",
    "max_entries": 1000
  },
  "comparison": {
    "enabled": false,
    "baseline_model": ""
  },
  "reference_injection": {
    "timing": "user_turn_only",
    "position": "user_message_tail"
  },
  "pricing_table": {},
  "cost_tradeoff": {
    "enabled": false
  }
}
```

Effective values for `mom_mode` today: `always` fans out on every user turn (recommended default); `off` passes traffic through unchanged (`auto` is a declared value but currently behaves like `off`). An empty `pricing_table` makes trace `pricing` snapshots `null` — eval-side cost accounting cannot compute, but **the gateway keeps working**. Prefer running the sync step below on first boot. Field-by-field notes live in [`docs/005DEVELOPMENT.md`](docs/005DEVELOPMENT.md).

`fanout_mode` controls the local advisor-result cache: `user_turn` reuses results within the same real user turn, `per_iteration` caches by the full message sequence, and `off` bypasses all cache reads and writes so every iteration calls the advisors. Restart the gateway after changing it.

`reference_injection` controls how advisor references are injected into the aggregator request, along two orthogonal axes. `timing` decides *when* to inject: `user_turn_only` (default) injects only on a fresh user turn and skips tool iterations (the model has already internalised the references, so re-injecting is redundant), while `every_request` injects on every request. `position` decides *where* to place them: `user_message_tail` (default) appends to the last real user message's tail (optimises prompt-cache hits within a single agent loop), while `context_tail` appends to the very end of the message sequence (optimises prefix reuse across agent loops). The default pair is `user_turn_only + user_message_tail`.

### 3. Sync pricing on first boot (recommended)

`data/mom.config.json.pricing_table` starts empty. Before the first real run, invoke the sync script — it fetches the provider's `/v1/models`, converts per-token prices to per-1M-tokens, and writes them into `pricing_table`. From then on trace `pricing.currency` / `input_per_million` / ... are populated and eval-side cost math works:

```bash
# Default currency=CNY (the current paigod data source is in CNY);
# only fills missing entries — never overwrites hand-tuned prices.
npm run sync-pricing

# For a different provider or currency:
npm run sync-pricing -- --currency USD

# Preview what would be written without touching disk:
npm run sync-pricing -- --dry-run
```

The script never deletes local `pricing_table` entries the provider no longer lists — it only prints `SKIP unknown-to-provider`. Pass `--overwrite` to replace existing entries. Re-run whenever you add an advisor slot or swap the aggregator model.

---

## Run

Two ways to run the Dashboard — pick one. For day-to-day frontend work, use vite dev (hot reload + proxy). For deployment or a quick look at the current UI, use the built-artifact mode (static assets served by the gateway).

### Option A: one-shot start of gateway + web (recommended for dev)

```bash
# Runs the gateway (3000) and the vite dev server (5173) in parallel;
# logs are prefixed so you can tell them apart.
npm run dev:all
```

After launch:

- The gateway prints both entry points (`http://localhost:3000/dashboard/` for built artifacts, `http://localhost:5173/dashboard/` for vite dev).
- The vite dev port is authoritative in its own output — vite falls back to 5174 / 5175 / ... if 5173 is already taken.
- In vite dev mode the proxy is preconfigured: `/api` and `/v1` are forwarded to 3000, no extra setup needed.

To run just one side: `npm run dev` (gateway only) or `npm run dev:web` (vite dev only).

### Option B: build first, then let the gateway serve the artifacts

```bash
# Build the dashboard (output goes to web/dist; /dashboard/ shows a placeholder otherwise).
npm run build:web

# Start the gateway (default port 3000).
npm run dev
```

Open `http://localhost:3000/dashboard/`.

### On the Claude Code side

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
claude
```

`ANTHROPIC_BASE_URL` always points at the gateway port (3000) regardless of the vite dev port — vite dev only exists to hot-reload the Dashboard UI.

### Enabling MoM vs Baseline comparison in the Dashboard

`data/mom.config.json` ships with `comparison` disabled by default:

```json
"comparison": {
  "enabled": false,
  "baseline_model": ""
}
```

To turn on the Dashboard's Live Compare panel (`/api/live/run` runs MoM + baseline + judge scoring in a single request), flip it to:

```json
"comparison": {
  "enabled": true,
  "baseline_model": "<a real baseline model id from your provider>"
}
```

Notes:

- `baseline_model` must be a model id that actually exists on the provider pointed to by `PROVIDER_BASE_URL` in `.env`.
- Sync that baseline model into `pricing_table` too (just re-run `npm run sync-pricing`), otherwise baseline-side cost shows up as null.
- The toggle only affects the Dashboard's Live Compare entry point — the `/v1/messages` path that Claude Code uses is unaffected and will not be slowed down by baseline + judge.
- Editing via the Dashboard form or the file directly are equivalent; `POST /api/config` hot-rebuilds the orchestrator, no gateway restart needed.

---

## Docs

- [Phased plan](PLAN.md)
- [Architecture](docs/001ARCHITECTURE.md)
- [Structure](docs/002STRUCTURE.md)
- [Changelog](docs/004CHANGELOG.md)
- [Development notes](docs/005DEVELOPMENT.md)
