#!/usr/bin/env bash
# Run the reviewed-task quickstart against the active local devnet.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${COOO_DEVNET_DATA_DIR:-$ROOT/.cooo-devnet}"
ENV_FILE="$STATE_DIR/reviewed-task.env"

cd "$ROOT"
if ! node devnet/status.mjs; then
  echo "The cooo devnet is not healthy." >&2
  echo "Keep devnet/start.sh running in another foreground shell." >&2
  exit 1
fi

new_run=false
if [[ "${1:-}" == "--new" ]]; then
  new_run=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: devnet/run-quickstart.sh [--new]" >&2
  exit 2
fi

if [[ "$new_run" == true || ! -f "$ENV_FILE" ]]; then
  FORCE_NEW="$new_run" node devnet/provision-env.mjs
fi

if [[ ! -d node_modules ]]; then
  npm ci --ignore-scripts
fi
npm run build
node --env-file="$ENV_FILE" examples/reviewed-task-quickstart.mjs
node devnet/status.mjs
