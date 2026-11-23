#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
devnet_pid=''

cleanup() {
  if [[ -n "$devnet_pid" ]]; then
    kill "$devnet_pid" >/dev/null 2>&1 || true
    wait "$devnet_pid" >/dev/null 2>&1 || true
  fi
  bash "$root/devnet/stop.sh" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

export COOO_DEVNET_DATA_DIR="$work/devnet"
export COOO_CARGO_TARGET_DIR="$work/cargo-target"
mkdir -p "$COOO_DEVNET_DATA_DIR"

bash "$root/devnet/start.sh" >"$work/devnet.log" 2>&1 &
devnet_pid=$!

for _ in $(seq 1 180); do
  if ! kill -0 "$devnet_pid" >/dev/null 2>&1; then
    wait "$devnet_pid" || true
    cat "$work/devnet.log" >&2
    exit 1
  fi
  if curl --max-time 2 -sf http://127.0.0.1:8080/lyquor/info >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --max-time 2 -sf http://127.0.0.1:8080/lyquor/info >/dev/null; then
  cat "$work/devnet.log" >&2
  exit 1
fi

readarray -t deployment < <(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!value.lyquidId || !value.contract) throw new Error("deployment metadata is incomplete");
  console.log(value.lyquidId);
  console.log(value.contract);
' "$COOO_DEVNET_DATA_DIR/devnet.json")
lyquid_id="${deployment[0]}"
contract="${deployment[1]}"

readarray -t protocol_accounts < <(curl -fsS \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_accounts","params":[]}' \
  http://127.0.0.1:8080/lyquid/api |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const accounts = JSON.parse(input).result;
      if (!Array.isArray(accounts) || accounts.length < 4) throw new Error("four unlocked accounts are required");
      for (const account of accounts.slice(0, 4)) console.log(account);
    });
  ')

export COOO_RPC_URL=http://127.0.0.1:8080/lyquid/api
export COOO_INFO_URL=http://127.0.0.1:8080/lyquor/info
export COOO_STATE_URL=http://127.0.0.1:8080/api/state
export COOO_LYQUID_ID="$lyquid_id"
export COOO_CONTRACT="$contract"
export COOO_OPERATOR="${protocol_accounts[0]}"
export COOO_REQUESTER="${protocol_accounts[1]}"
export COOO_PROVIDER="${protocol_accounts[2]}"
export COOO_REVIEWER="${protocol_accounts[3]}"

node "$root/devnet/provider-digest-e2e.mjs"
