#!/usr/bin/env bash
# ============================================================================
# End-to-end smoke test: drive a REAL local Claude Code session through the MoM
# gateway and assert that mom_mode / fanout_mode / reference_injection actually
# take effect on a live agent loop with tool calls.
#
# This is the one test that exercises the full path the unit/e2e suites cannot:
# a genuine Claude Code agent loop (multi-turn, real tool_use / tool_result)
# hitting the gateway, fanning out to real advisor models, and aggregating.
#
# SAFETY / ISOLATION (so it never disturbs a Claude Code you already run):
#   - Its own gateway PORT (default 3199, override with SMOKE_PORT).
#   - Its own throwaway SQLite DB and config file under a temp dir.
#   - Reuses your .env PROVIDER_* credentials (real provider calls, real tokens).
#   - Sets ANTHROPIC_BASE_URL + a fixed X-Session-ID only for the child
#     `claude` process it spawns — your interactive sessions are untouched.
#
# It does NOT modify data/mom.config.json or mom.db.
#
# Usage:
#   scripts/smoke-claude-code.sh                 # full run (needs provider creds + claude CLI)
#   SMOKE_PORT=3200 scripts/smoke-claude-code.sh # custom port
#   scripts/smoke-claude-code.sh --keep          # keep temp dir + logs for inspection
#   scripts/smoke-claude-code.sh --config user_turn_context_tail
#
# Requires: node >=22.13, the `claude` CLI on PATH, jq, curl, a filled .env.
# ============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
cd "${REPO_ROOT}"

PORT="${SMOKE_PORT:-3199}"
KEEP=0
CONFIG_NAME="user_turn_user_tail"

die() { echo "smoke: $*" >&2; exit 1; }
info() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
pass() { printf '\033[32m  ✔ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m  ✖ %s\033[0m\n' "$*"; SMOKE_FAILED=1; }
SMOKE_FAILED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --config) shift; CONFIG_NAME="${1:-}" ;;
    -h|--help) grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

command -v claude >/dev/null 2>&1 || die "the 'claude' CLI is required on PATH"
command -v jq    >/dev/null 2>&1 || die "jq is required"
command -v curl  >/dev/null 2>&1 || die "curl is required"
[[ -f .env ]] || die "missing .env (provider creds); copy .env.example and fill it"

# Refuse to stomp on a port that is already serving something.
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port ${PORT} is already in use — set SMOKE_PORT=<free port> and retry"
fi

# ---------------------------------------------------------------------------
# Isolated workspace: throwaway DB + config so the real mom.db / config are
# never touched. Cleaned on exit unless --keep.
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mom-smoke.XXXXXX")"
SMOKE_DB="${WORK_DIR}/smoke.db"
SMOKE_CONFIG="${WORK_DIR}/mom.config.json"
GATEWAY_LOG="${WORK_DIR}/gateway.log"
CLAUDE_LOG="${WORK_DIR}/claude.log"
GATEWAY_PID=""

cleanup() {
  [[ -n "${GATEWAY_PID}" ]] && kill "${GATEWAY_PID}" 2>/dev/null || true
  if [[ "${KEEP}" == "1" ]]; then
    info "artifacts kept in ${WORK_DIR}"
  else
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT
trap 'die "failed at line ${LINENO}"' ERR

# ---------------------------------------------------------------------------
# Derive a smoke config from the real data/mom.config.json: keep its advisor
# slots + aggregator + pricing_table, force mom_mode=always, and select the
# fanout_mode / reference_injection combo named by --config.
# ---------------------------------------------------------------------------
info "building isolated config '${CONFIG_NAME}' from data/mom.config.json"
node -e '
const fs = require("fs");
const [src, dst, name] = [process.argv[1], process.argv[2], process.argv[3]];
const base = JSON.parse(fs.readFileSync(src, "utf8"));
const combos = {
  user_turn_user_tail:  { fanout_mode: "user_turn",     timing: "user_turn_only", position: "user_message_tail" },
  user_turn_context_tail:{ fanout_mode: "user_turn",    timing: "user_turn_only", position: "context_tail" },
  per_iter_every_tail:  { fanout_mode: "per_iteration", timing: "every_request",  position: "user_message_tail" },
  off_every_context:    { fanout_mode: "off",           timing: "every_request",  position: "context_tail" },
};
const c = combos[name];
if (!c) { console.error("unknown --config: " + name + "; known: " + Object.keys(combos).join(", ")); process.exit(2); }
base.mom_mode = "always";
base.fanout_mode = c.fanout_mode;
base.reference_injection = { timing: c.timing, position: c.position };
fs.writeFileSync(dst, JSON.stringify(base, null, 2) + "\n");
console.log("  slots: " + base.advisor.slots.join(", "));
console.log("  aggregator: " + base.aggregator.model);
console.log("  fanout_mode=" + c.fanout_mode + "  timing=" + c.timing + "  position=" + c.position);
' data/mom.config.json "${SMOKE_CONFIG}" "${CONFIG_NAME}" \
  || die "config generation failed (unknown --config name?)"

# ---------------------------------------------------------------------------
# Start the gateway on the isolated port / DB / config.
# ---------------------------------------------------------------------------
info "starting gateway on port ${PORT} (isolated db + config)"
# Run the gateway directly with tsx (no `watch` — we don't want file-watching
# to interfere) and load provider creds from .env. Our explicit env vars take
# precedence over .env (Node --env-file never overrides existing process.env),
# so the isolated port / db / config win.
MOM_PORT="${PORT}" MOM_DB_PATH="${SMOKE_DB}" MOM_CONFIG_PATH="${SMOKE_CONFIG}" \
  npx tsx --env-file=.env src/index.ts >"${GATEWAY_LOG}" 2>&1 &
GATEWAY_PID=$!

# Wait for /healthz (max ~20s).
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then break; fi
  if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
    cat "${GATEWAY_LOG}" >&2; die "gateway exited during startup"
  fi
  sleep 0.5
  [[ "${i}" == "40" ]] && { cat "${GATEWAY_LOG}" >&2; die "gateway did not become healthy"; }
done
pass "gateway healthy on ${PORT}"

# ---------------------------------------------------------------------------
# Drive a real Claude Code agent loop through the gateway. A fixed session id
# lets us pull exactly this run's traces afterward. The prompt is written to
# provoke at least one tool call (file read) so we get a genuine multi-round
# agent loop (user turn → tool_use → tool_result → continuation).
# ---------------------------------------------------------------------------
SESSION_ID="$(node -e 'console.log(require("crypto").randomUUID())')"
info "running claude (session ${SESSION_ID}) — real provider calls, consumes tokens"

# Point ONLY this child process at the gateway; inject the session id header.
PROVIDER_KEY="$(node --env-file=.env -e 'process.stdout.write(process.env.PROVIDER_API_KEY ?? "")')"

# Route ONLY this child at the gateway. Note: do NOT set CLAUDE_CODE_USE_GATEWAY
# here — that flag sends Claude Code down a different auth/routing path that
# bypasses ANTHROPIC_BASE_URL, so requests never reach the local gateway. Plain
# ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN is what actually routes here.
# --model must be a name the provider recognises (an advisor/aggregator slot).
AGG_MODEL="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).aggregator.model)' "${SMOKE_CONFIG}")"
set +e
ANTHROPIC_BASE_URL="http://127.0.0.1:${PORT}" \
ANTHROPIC_AUTH_TOKEN="${PROVIDER_KEY}" \
ANTHROPIC_CUSTOM_HEADERS="X-Session-ID: ${SESSION_ID}" \
  claude -p "Read package.json in the current directory and tell me the value of the \"name\" field. Use your file tools." \
    --model "${AGG_MODEL}" \
    --permission-mode acceptEdits \
    --add-dir "${REPO_ROOT}" \
    >"${CLAUDE_LOG}" 2>&1
CLAUDE_EXIT=$?
set -e

if [[ "${CLAUDE_EXIT}" != "0" ]]; then
  cat "${CLAUDE_LOG}" >&2
  die "claude CLI exited ${CLAUDE_EXIT} (see log above)"
fi
pass "claude session completed"

# ---------------------------------------------------------------------------
# Pull this session's traces and assert the three features engaged.
# ---------------------------------------------------------------------------
info "verifying traces for session ${SESSION_ID}"
TRACES="$(curl -fsS "http://127.0.0.1:${PORT}/trace/requests?session_id=${SESSION_ID}")" \
  || die "trace query failed"
echo "${TRACES}" > "${WORK_DIR}/traces.json"

COUNT="$(jq '.requests | length' <<<"${TRACES}")"
[[ "${COUNT}" -gt 0 ]] && pass "captured ${COUNT} trace rows" || fail "no traces captured"

# 1) mom_mode=always → MoM ran: at least one advisor + one aggregator row,
#    and NO passthrough row.
ADV="$(jq '[.requests[] | select(.role=="advisor")] | length' <<<"${TRACES}")"
AGG="$(jq '[.requests[] | select(.role=="aggregator")] | length' <<<"${TRACES}")"
PASS_ROWS="$(jq '[.requests[] | select(.role=="passthrough")] | length' <<<"${TRACES}")"
[[ "${ADV}" -ge 1 ]] && pass "mom_mode=always: ${ADV} advisor rows" || fail "expected advisor rows, got ${ADV}"
[[ "${AGG}" -ge 1 ]] && pass "mom_mode=always: ${AGG} aggregator rows" || fail "expected aggregator rows, got ${AGG}"
# Only meaningful once we actually captured traces — 0 passthrough on 0 rows
# would be a false positive.
if [[ "${COUNT}" -gt 0 && "${PASS_ROWS}" -eq 0 ]]; then
  pass "no passthrough rows (MoM engaged)"
else
  fail "expected 0 passthrough rows on a populated session, got ${PASS_ROWS} (count=${COUNT})"
fi

# 2) fanout_mode → inspect advisor trigger_reason distribution.
info "advisor trigger_reason distribution:"
jq -r '.requests[] | select(.role=="advisor") | "  " + .trigger_reason' <<<"${TRACES}" | sort | uniq -c

# 3) reference_injection → at least the first-turn aggregator carries the
#    guidance/header payload in references_appended.
INJECTED="$(jq '[.requests[] | select(.role=="aggregator" and (.references_appended // "" | test("Advisor Panel References")))] | length' <<<"${TRACES}")"
[[ "${INJECTED}" -ge 1 ]] \
  && pass "reference_injection: ${INJECTED} aggregator call(s) carried references" \
  || fail "no aggregator call carried injected references"

# Show which user turns triggered a fresh fanout vs skipped tool iterations.
info "aggregator trigger_reason distribution:"
jq -r '.requests[] | select(.role=="aggregator") | "  " + .trigger_reason' <<<"${TRACES}" | sort | uniq -c

# ---------------------------------------------------------------------------
info "summary"
if [[ "${SMOKE_FAILED}" == "0" ]]; then
  printf '\033[32mSMOKE PASSED\033[0m (config=%s, session=%s)\n' "${CONFIG_NAME}" "${SESSION_ID}"
else
  printf '\033[31mSMOKE FAILED\033[0m (see checks above; rerun with --keep to inspect %s)\n' "${WORK_DIR}"
  exit 1
fi
