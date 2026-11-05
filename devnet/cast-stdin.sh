#!/usr/bin/env bash
# Feed a caller-held local test key to Cast's interactive prompt through a PTY.
# The key is read from stdin and is not placed in the process argument list.
set -euo pipefail

CAST="${COOO_CAST_BIN:-/root/.shakenup/foundry/bin/cast}"
key=""
IFS= read -r key
command_string=""
printf -v command_string '%q ' "$CAST" "$@"
printf '%s\n' "$key" | script --quiet --flush --command "$command_string" /dev/null
