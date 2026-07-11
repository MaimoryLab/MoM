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
  "pricing_table": {},
  "cost_tradeoff": {
    "enabled": false
  }
}
```

Effective values for `mom_mode` today: `always` fans out on every user turn (recommended default); `off` passes traffic through unchanged (`auto` is a declared value but currently behaves like `off`). An empty `pricing_table` makes trace `pricing` snapshots `null` — eval-side cost accounting cannot compute, but **the gateway keeps working**. Prefer running the sync step below on first boot. Field-by-field notes live in [`docs/005DEVELOPMENT.md`](docs/005DEVELOPMENT.md).

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

```bash
# Build the dashboard (optional; /dashboard/ shows a placeholder otherwise)
npm run build:web

# Start the gateway (default port 3000)
npm run dev
```

On the Claude Code side:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
claude
```

Open `http://localhost:3000/dashboard/` to see the frontend skeleton.

---

## Docs

- [Phased plan](PLAN.md)
- [Architecture](docs/001ARCHITECTURE.md)
- [Structure](docs/002STRUCTURE.md)
- [Changelog](docs/004CHANGELOG.md)
- [Development notes](docs/005DEVELOPMENT.md)
