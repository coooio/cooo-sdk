#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
devnet_pid=''
metadata="$work/devnet/devnet.json"

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

read_metadata() {
  node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const field of process.argv.slice(2)) {
      if (typeof value[field] !== "string" || value[field] === "") {
        throw new Error(`deployment metadata field ${field} is missing`);
      }
      console.log(value[field]);
    }
  ' "$metadata" "$@"
}

probe() {
  local url="$1" output="$2"
  curl --noproxy '*' --silent --show-error --fail --max-time 15 \
    --output "$output" "$url"
}

diagnose_proxy() {
  local endpoint url status body

  echo 'Devnet proxy did not become ready.' >&2
  if [[ -s "$metadata" ]]; then
    echo '--- metadata ---' >&2
    cat "$metadata" >&2
  else
    echo "Deployment metadata is missing at $metadata." >&2
  fi
  if kill -0 "$devnet_pid" >/dev/null 2>&1; then
    echo "Devnet process $devnet_pid is still running." >&2
  else
    echo "Devnet process $devnet_pid has exited." >&2
  fi

  for endpoint in info state; do
    if [[ "$endpoint" == info ]]; then
      url="${info_url:-http://127.0.0.1:8080/lyquor/info}"
    else
      url="${state_url:-http://127.0.0.1:8080/api/state}"
    fi
    status="$(
      curl --noproxy '*' --silent --show-error --max-time 15 \
        --dump-header "$work/${endpoint}.headers" --output "$work/${endpoint}.json" \
        --write-out '%{http_code}' "$url" 2>"$work/${endpoint}.curl.log"
    )" || status="curl exit $?"
    echo "--- $endpoint HTTP $status ---" >&2
    cat "$work/${endpoint}.curl.log" >&2 2>/dev/null || true
    cat "$work/${endpoint}.headers" >&2 2>/dev/null || true
    if [[ -s "$work/${endpoint}.json" ]]; then
      body="$(head -c 512 "$work/${endpoint}.json")"
      printf '%s\n' "$body" >&2
    fi
  done

  echo '--- devnet log ---' >&2
  cat "$work/devnet.log" >&2
}

bash "$root/devnet/start.sh" >"$work/devnet.log" 2>&1 &
devnet_pid=$!

rpc_url=''
info_url=''
state_url=''
for _ in $(seq 1 24); do
  if ! kill -0 "$devnet_pid" >/dev/null 2>&1; then
    devnet_status=0
    wait "$devnet_pid" || devnet_status=$?
    echo "Devnet process exited with status $devnet_status." >&2
    cat "$work/devnet.log" >&2
    exit 1
  fi
  if [[ -s "$metadata" ]]; then
    readarray -t endpoints < <(read_metadata rpcUrl infoUrl stateUrl)
    rpc_url="${endpoints[0]}"
    info_url="${endpoints[1]}"
    state_url="${endpoints[2]}"
    if probe "$info_url" "$work/info.json" && probe "$state_url" "$work/state.json"; then
      break
    fi
  fi
  sleep 2
done

if [[ -z "$rpc_url" ]] || [[ -z "$info_url" ]] || [[ -z "$state_url" ]] ||
  ! probe "$info_url" "$work/info.json" ||
  ! probe "$state_url" "$work/state.json"; then
  diagnose_proxy
  exit 1
fi

readarray -t deployment < <(read_metadata lyquidId contract)
lyquid_id="${deployment[0]}"
contract="${deployment[1]}"

readarray -t protocol_accounts < <(curl --noproxy '*' --silent --show-error --fail \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_accounts","params":[]}' \
  "$rpc_url" |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const accounts = JSON.parse(input).result;
      if (!Array.isArray(accounts) || accounts.length < 4) throw new Error("four unlocked accounts are required");
      for (const account of accounts.slice(0, 4)) console.log(account);
    });
  ')

export COOO_RPC_URL="$rpc_url"
export COOO_INFO_URL="$info_url"
export COOO_STATE_URL="$state_url"
export COOO_LYQUID_ID="$lyquid_id"
export COOO_CONTRACT="$contract"
export COOO_OPERATOR="${protocol_accounts[0]}"
export COOO_REQUESTER="${protocol_accounts[1]}"
export COOO_PROVIDER="${protocol_accounts[2]}"
export COOO_REVIEWER="${protocol_accounts[3]}"

node "$root/devnet/provider-digest-e2e.mjs"
