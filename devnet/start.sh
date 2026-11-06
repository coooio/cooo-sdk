#!/usr/bin/env bash
# Start the local synthetic cooo devnet in the foreground.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LDK_HOME="${COOO_LDK_HOME:-$HOME/.shakenup}"
SHAKER="${COOO_SHAKER:-$LDK_HOME/bin/shaker}"
COMPOSE_FILE="${COOO_COMPOSE_FILE:-$LDK_HOME/ldk/docker/single/docker-compose.yaml}"
NODE_ENDPOINT="${COOO_NODE_ENDPOINT:-ws://127.0.0.1:10087/ws}"
NODE_HEALTH_URL="${COOO_NODE_HEALTH_URL:-http://127.0.0.1:10087/lyquor.node.v1.NodeService/GetNodeInfo}"
PROXY_LISTEN="${COOO_PROXY_LISTEN:-127.0.0.1:8080}"
STATE_DIR="${COOO_DEVNET_DATA_DIR:-$ROOT/.cooo-devnet}"
METADATA="$STATE_DIR/devnet.json"
export CARGO_TARGET_DIR="${COOO_CARGO_TARGET_DIR:-$HOME/.cache/cooo-sdk-target}"

if [[ ! -x "$SHAKER" ]]; then
  echo "Lyquor shaker was not found at $SHAKER." >&2
  echo "Install Lyquor LDK 0.8.0 as described in devnet/README.md, or set COOO_SHAKER." >&2
  exit 1
fi
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Lyquor Compose file was not found at $COMPOSE_FILE." >&2
  echo "Install Lyquor LDK 0.8.0, or set COOO_COMPOSE_FILE." >&2
  exit 1
fi
for command_name in docker curl sed grep head; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required." >&2
    exit 1
  fi
done

mkdir -p "$STATE_DIR"
docker compose -f "$COMPOSE_FILE" up -d

ready=false
for _ in $(seq 1 60); do
  if curl --max-time 2 --data '{}' --header 'content-type: application/json' \
    -sf "$NODE_HEALTH_URL" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Timed out waiting for the Lyquor node at $NODE_HEALTH_URL." >&2
  exit 1
fi

# Wait for the one-shot Compose bootstrap to finish registering Lyquids.
for _ in $(seq 1 60); do
  if ! docker compose -f "$COMPOSE_FILE" ps | grep -q setup-devnet; then
    break
  fi
  sleep 1
done
if docker compose -f "$COMPOSE_FILE" ps | grep -q setup-devnet; then
  echo "Timed out waiting for the Lyquor setup service." >&2
  exit 1
fi

lyquid_id=''
contract=''
if [[ -s "$METADATA" ]]; then
  cached_id="$(sed -n 's/.*"lyquidId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$METADATA" | head -1)"
  if [[ -n "$cached_id" ]]; then
    for _ in $(seq 1 60); do
      if "$SHAKER" list --endpoint "$NODE_ENDPOINT" | grep -F "$cached_id" >/dev/null; then
        lyquid_id="$cached_id"
        contract="$(sed -n 's/.*"contract"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$METADATA" | head -1)"
        echo "Reusing cooo Lyquid $lyquid_id at $contract."
        break
      fi
      sleep 1
    done
  fi
fi

if [[ -z "$lyquid_id" ]]; then
  echo "Building and deploying the synthetic cooo Lyquid..."
  deploy_json="$("$SHAKER" deploy \
    --endpoint "$NODE_ENDPOINT" \
    --output json \
    "$ROOT/backend/cooo-lyquid/Cargo.toml")"
  lyquid_id="$(printf '%s' "$deploy_json" | sed -n 's/.*"lyquid_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  contract="$(printf '%s' "$deploy_json" | sed -n 's/.*"contract"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [[ ! "$lyquid_id" =~ ^Lyquid- ]] || [[ ! "$contract" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "Failed to parse the shaker deployment result." >&2
    exit 1
  fi
fi

proxy_host="${PROXY_LISTEN%:*}"
proxy_port="${PROXY_LISTEN##*:}"
if [[ "$proxy_host" == "$PROXY_LISTEN" ]]; then
  proxy_host='127.0.0.1'
  proxy_port="$PROXY_LISTEN"
fi
if [[ "$proxy_host" == '['* ]]; then
  proxy_host="${proxy_host#\[}"
  proxy_host="${proxy_host%\]}"
  rpc_url="http://[${proxy_host}]:${proxy_port}/lyquid/api"
  info_url="http://[${proxy_host}]:${proxy_port}/lyquid/info"
  state_url="http://[${proxy_host}]:${proxy_port}/api/state"
else
  rpc_url="http://${proxy_host}:${proxy_port}/lyquid/api"
  info_url="http://${proxy_host}:${proxy_port}/lyquid/info"
  state_url="http://${proxy_host}:${proxy_port}/api/state"
fi

cat > "$METADATA" <<JSON
{
  "lyquidId": "$lyquid_id",
  "contract": "$contract",
  "protocol": "cooo-local-v0.3-terms-bound-review",
  "nodeEndpoint": "$NODE_ENDPOINT",
  "proxyListen": "$PROXY_LISTEN",
  "rpcUrl": "$rpc_url",
  "infoUrl": "$info_url",
  "stateUrl": "$state_url",
  "boundary": "local synthetic single-node devnet"
}
JSON

echo
echo "cooo synthetic devnet:"
echo "  Lyquid: $lyquid_id"
echo "  Contract: $contract"
echo "  Proxy: http://$PROXY_LISTEN"
echo "  Metadata: $METADATA"
echo "  Boundary: synthetic single-node devnet; no real assets."
echo "  Keep this foreground process running; use the quickstart runner in another shell."
echo
exec "$SHAKER" serve "$lyquid_id" --endpoint "$NODE_ENDPOINT" --listen "$PROXY_LISTEN"
