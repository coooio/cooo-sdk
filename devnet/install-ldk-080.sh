#!/usr/bin/env bash
set -euo pipefail

destination="${1:-${COOO_LDK_HOME:-$HOME/.shakenup}}"
archive_name='lyquor-2026-10-13-9946920-linux-amd64.tar.gz'
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

if [[ -x "$destination/bin/shaker" ]]; then
  echo "Lyquor LDK already exists at $destination." >&2
  exit 0
fi

curl --fail --location --retry 3 \
  -o "$temporary/tools.tar.gz" \
  "https://github.com/lyquor-labs/ldk/releases/download/v0.8.0/$archive_name"
curl --fail --location --retry 3 \
  -o "$temporary/ldk.tar.gz" \
  https://github.com/lyquor-labs/ldk/releases/download/v0.8.0/ldk.tar.gz

echo 'a82a6994cc125134d85f6abfdc7f563ff5d6c322ef7b6a95c9656b09bc6be399  '"$temporary"'/tools.tar.gz' | sha256sum -c -
echo 'b33cc20905fb35ee07d96e959495906a9b5a161a1c681b028415d9733033e21b  '"$temporary"'/ldk.tar.gz' | sha256sum -c -

mkdir -p "$temporary/extracted/ldk" "$destination/bin" "$destination/ldk"
tar -xzf "$temporary/tools.tar.gz" -C "$temporary/extracted"
tar -xzf "$temporary/ldk.tar.gz" -C "$temporary/extracted/ldk"
for binary in lyquor ladle shaker lyquid-test-runner barstrainer; do
  install -m 755 "$temporary/extracted/${archive_name%.tar.gz}/$binary" "$destination/bin/$binary"
done
cp -a "$temporary/extracted/ldk/." "$destination/ldk/"
printf '%s\n' "$archive_name" > "$destination/.lyquor_version"
cat > "$destination/ldk-env" <<'EOF'
LYQUOR_NODE_IMAGE=ghcr.io/lyquor-labs/lyquor-node:v0.8.0
LYQUOR_TOOLS_IMAGE=ghcr.io/lyquor-labs/lyquor-tools:v0.8.0
EOF

"$destination/bin/shaker" --version
