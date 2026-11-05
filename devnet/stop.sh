#!/usr/bin/env bash
# Stop the local synthetic cooo devnet.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LDK_HOME="${COOO_LDK_HOME:-$HOME/.shakenup}"
COMPOSE_FILE="${COOO_COMPOSE_FILE:-$LDK_HOME/ldk/docker/single/docker-compose.yaml}"
STATE_DIR="${COOO_DEVNET_DATA_DIR:-$ROOT/.cooo-devnet}"
METADATA="$STATE_DIR/devnet.json"

if [[ -f "$METADATA" ]]; then
  lyquid_id="$(sed -n 's/.*"lyquidId":"\([^"]*\)".*/\1/p' "$METADATA" | head -1)"
  if [[ "$lyquid_id" =~ ^Lyquid-[a-z0-9]+$ ]]; then
    pattern="shaker serve ${lyquid_id}( |$)"
    pkill -f "$pattern" 2>/dev/null || true
  fi
fi

if [[ -f "$COMPOSE_FILE" ]]; then
  docker compose -f "$COMPOSE_FILE" down
else
  echo "No Lyquor Compose installation found at $COMPOSE_FILE." >&2
  exit 1
fi

echo "The local metadata remains at $METADATA."
echo "Run devnet/start.sh again to restart the same synthetic deployment."
