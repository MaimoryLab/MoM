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
git clone <this-repo>
cd MoM
npm install
```

---

## Configure

Configuration lives in two clearly-separated places:

- **`.env`** (deployment / secrets): provider credentials, listening port, data file paths
- **`data/mom.config.json`** (business config): MoM trigger mode, advisor slots, aggregator model, pricing table, etc. Never holds secrets.

Set up `.env` first:

```bash
cp .env.example .env
# Edit .env — at minimum set PROVIDER_BASE_URL and PROVIDER_API_KEY.
# PROVIDER_AUTH_STYLE defaults to "bearer"; use "x-api-key" for the official Anthropic API.
```

`data/mom.config.json` is generated on first startup with `DEFAULT_MOM_CONFIG`. Edit it directly with `vi`, or through the Dashboard form once Phase 5 ships. The Dashboard never edits secrets — secrets live in `.env` only.

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
