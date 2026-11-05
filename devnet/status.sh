#!/usr/bin/env bash
# Print concise health and authoritative-state information.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/devnet/status.mjs"
