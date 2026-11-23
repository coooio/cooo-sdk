#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$(mktemp -d)"
tarball=""
cleanup() {
  rm -rf "$workspace" "$tarball"
}
trap cleanup EXIT

cd "$root"
version="$(node --input-type=module -e "import { readFile } from 'node:fs/promises'; console.log(JSON.parse(await readFile('package.json', 'utf8')).version)")"
tarball="$root/cooo-sdk-$version.tgz"
npm pack "$root"

mkdir -p "$workspace"
cd "$workspace"
npm init --yes
npm install "$tarball" typescript@5.7.2

cat >index.mts <<'EOF'
import { CoooSdk } from '@cooo/sdk';
import { LocalCastSigner } from '@cooo/sdk/local-cast-signer';

const sdk = new CoooSdk({
  rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
  infoUrl: 'http://127.0.0.1:8080/lyquid/info',
  stateUrl: 'http://127.0.0.1:8080/api/state',
  expectedLyquidId: 'Lyquid-consumer',
  expectedContract: '0x0000000000000000000000000000000000000000',
});

const signer = new LocalCastSigner({
  expectedAddress: '0x0000000000000000000000000000000000000000',
  readPrivateKey: () => '0x' + '00'.repeat(32),
});

if (typeof sdk.waitForOperation !== 'function' || !(signer instanceof LocalCastSigner)) {
  throw new Error('packed cooo SDK exports are unavailable');
}
EOF

cat >tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist"
  },
  "include": ["index.mts"]
}
EOF

./node_modules/.bin/tsc --project tsconfig.json
node dist/index.mjs
printf 'Verified @cooo/sdk %s in a clean consumer.\n' "$version"
