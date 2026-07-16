#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/run-latest.sh [options] [-- <npm run dev:all args>]

Update the current git branch and install dependencies, then start the MoM
gateway and the Vite development server together with `npm run dev:all`.

Options:
  --dry-run          Print the steps without executing them.
  --skip-pull        Skip `git pull --ff-only`.
  --skip-install     Skip `npm install`.
  --skip-web-build   Deprecated; Vite dev mode does not build web artifacts.
  -h, --help         Show this help.

Environment:
  MOM_PORT=3010      Override the gateway port used by `npm run dev:all`.
  Vite uses port 5173 by default and automatically selects the next free port.
EOF
}

die() {
  echo "run-latest: $*" >&2
  exit 1
}

warn() {
  echo "run-latest: warning: $*" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

port_owner() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | tail -n +2 || true
}

check_port_available() {
  local port="$1"
  local owner
  owner="$(port_owner "${port}")"
  if [[ -n "${owner}" ]]; then
    echo "run-latest: port ${port} is already in use:" >&2
    echo "${owner}" >&2
    die "stop the existing process or run with MOM_PORT=<free-port> ${BASH_SOURCE[0]}"
  fi
}

run_command() {
  printf "\n==> %s\n" "$*"
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  "$@"
}

check_node_version() {
  local found
  found="$(node -v)"
  node -e '
const [major, minor, patch] = process.versions.node.split(".").map(Number);
process.exit(major > 22 || (major === 22 && (minor > 13 || (minor === 13 && patch >= 0))) ? 0 : 1);
' || die "Node.js >= 22.13.0 is required; found ${found}"
}

resolve_gateway_port() {
  if [[ -n "${MOM_PORT:-}" ]]; then
    printf '%s\n' "${MOM_PORT}"
    return
  fi

  if [[ -f .env ]]; then
    node --env-file=.env -e 'process.stdout.write(process.env.MOM_PORT ?? "3000")'
    return
  fi

  printf '3000\n'
}

DRY_RUN=0
SKIP_PULL="${SKIP_GIT_PULL:-0}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
DEV_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-pull)
      SKIP_PULL=1
      ;;
    --skip-install)
      SKIP_INSTALL=1
      ;;
    --skip-web-build)
      warn "--skip-web-build is no longer needed when using npm run dev:all"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      DEV_ARGS=("$@")
      break
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

trap 'die "failed at line ${LINENO}"' ERR

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
cd "${REPO_ROOT}"

require_command git
require_command node
require_command npm
check_node_version

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git repository: ${REPO_ROOT}"

if [[ "$SKIP_PULL" != "1" ]]; then
  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    die "current branch has no upstream; set an upstream or rerun with --skip-pull"
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "tracked local changes exist; pull may fail if remote changes overlap"
  fi

  if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    warn "untracked files exist; pull may fail if remote adds the same paths"
  fi

  run_command git pull --ff-only
else
  warn "skipping git pull"
fi

if [[ ! -f .env ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "missing .env; real runs need .env copied from .env.example with provider settings filled"
  else
    die "missing .env; copy .env.example to .env and fill provider settings before running"
  fi
fi

if [[ "$SKIP_INSTALL" != "1" ]]; then
  run_command npm install
else
  warn "skipping npm install"
fi

START_PORT="$(resolve_gateway_port)"
if [[ "$DRY_RUN" != "1" ]]; then
  check_port_available "${START_PORT}"
fi

echo
echo "==> Starting MoM gateway and Vite dev server (gateway port ${START_PORT}). Press Ctrl+C to stop."
if [[ ${#DEV_ARGS[@]} -gt 0 ]]; then
  run_command npm run dev:all -- "${DEV_ARGS[@]}"
else
  run_command npm run dev:all
fi
