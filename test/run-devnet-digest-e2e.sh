#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="$(date +%s)$$${RANDOM}${RANDOM}"
network="cooo-sdk-e2e-${suffix}"
node_container="cooo-sdk-e2e-node-${suffix}"
proxy_container="cooo-sdk-e2e-proxy-${suffix}"
volume="cooo-sdk-e2e-data-${suffix}"
work="$(mktemp -d)"
node_image='ghcr.io/lyquor-labs/lyquor-node:v0.8.0'
tools_image='ghcr.io/lyquor-labs/lyquor-tools:v0.8.0'
node_host_port=10088
proxy_host_port=18080

cleanup() {
  docker rm -f "$node_container" "$proxy_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker run --pull always -d --name "$node_container" \
  --network "$network" --network-alias node \
  -p "127.0.0.1:${node_host_port}:10087" \
  -v "$volume:/opt" \
  "$node_image" >/dev/null

for _ in $(seq 1 90); do
  if curl --max-time 2 --data '{}' --header 'content-type: application/json' \
    -sf "http://127.0.0.1:${node_host_port}/lyquor.node.v1.NodeService/GetNodeInfo" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --max-time 2 --data '{}' --header 'content-type: application/json' \
  -sf "http://127.0.0.1:${node_host_port}/lyquor.node.v1.NodeService/GetNodeInfo" >/dev/null; then
  echo 'Timed out waiting for the Lyquor node.' >&2
  exit 1
fi

docker run --pull always --rm \
  --network "$network" \
  --env CARGO_TARGET_DIR=/work/target \
  -v "$root:/source:ro" \
  -v "$work:/work" \
  "$tools_image" /bin/bash -lc '
    set -euo pipefail
    until curl --data "{}" --header "content-type: application/json" \
      -sf http://node:10087/lyquor.node.v1.NodeService/GetNodeInfo >/dev/null; do sleep 1; done
    if ! curl --data "{}" --header "content-type: application/json" \
      -sf http://node:10087/lyquor.lyquid.v1.LyquidService/GetLyquidInfo | grep contract >/dev/null; then
      /usr/local/bin/shaker deploy \
        --is-bartender \
        --reference ghcr.io/lyquor-labs/lyquids:bartender-v0.8.0 \
        --endpoint ws://node:10087/ws >/dev/null
    fi
    /usr/local/bin/shaker deploy --output json \
      --endpoint ws://node:10087/ws /source/backend/cooo-lyquid/Cargo.toml > /work/deploy.json
  '

readarray -t deployment < <(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!value.lyquid_id || !value.contract) throw new Error("deployment metadata is incomplete");
  console.log(value.lyquid_id);
  console.log(value.contract);
' "$work/deploy.json")
lyquid_id="${deployment[0]}"
contract="${deployment[1]}"

docker run --pull always -d --name "$proxy_container" \
  --network "$network" \
  -p "127.0.0.1:${proxy_host_port}:8080" \
  "$tools_image" \
  /usr/local/bin/shaker serve "$lyquid_id" \
    --endpoint ws://node:10087/ws --listen 0.0.0.0:8080 >/dev/null

for _ in $(seq 1 90); do
  if curl --max-time 2 -sf "http://127.0.0.1:${proxy_host_port}/lyquor/info" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --max-time 2 -sf "http://127.0.0.1:${proxy_host_port}/lyquor/info" >/dev/null; then
  echo 'Timed out waiting for the cooo proxy.' >&2
  exit 1
fi

readarray -t protocol_accounts < <(curl -fsS \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_accounts","params":[]}' \
  "http://127.0.0.1:${proxy_host_port}/lyquid/api" |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const accounts = JSON.parse(input).result;
      if (!Array.isArray(accounts) || accounts.length < 4) throw new Error("four unlocked accounts are required");
      for (const account of accounts.slice(0, 4)) console.log(account);
    });
  ')

export COOO_RPC_URL="http://127.0.0.1:${proxy_host_port}/lyquid/api"
export COOO_INFO_URL="http://127.0.0.1:${proxy_host_port}/lyquor/info"
export COOO_STATE_URL="http://127.0.0.1:${proxy_host_port}/api/state"
export COOO_LYQUID_ID="$lyquid_id"
export COOO_CONTRACT="$contract"
export COOO_OPERATOR="${protocol_accounts[0]}"
export COOO_REQUESTER="${protocol_accounts[1]}"
export COOO_PROVIDER="${protocol_accounts[2]}"
export COOO_REVIEWER="${protocol_accounts[3]}"

node "$root/devnet/provider-digest-e2e.mjs"
