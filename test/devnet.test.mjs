import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

test('public devnet backend files are present', async () => {
  const requiredFiles = [
    'backend/cooo-lyquid/Cargo.toml',
    'backend/cooo-lyquid/Cargo.lock',
    'backend/cooo-lyquid/README.md',
    'backend/cooo-lyquid/src/lib.rs',
    'devnet/README.md',
    'devnet/start.sh',
    'devnet/stop.sh',
    'devnet/status.sh',
    'devnet/status.mjs',
    'devnet/provision-env.mjs',
    'devnet/run-quickstart.sh',
    'devnet/run-quickstart.ps1',
  ];
  for (const name of requiredFiles) {
    await readFile(new URL(name, root), 'utf8');
  }
});

test('devnet launcher targets the bundled cooo backend and local state', async () => {
  const start = await readFile(new URL('devnet/start.sh', root), 'utf8');
  const stop = await readFile(new URL('devnet/stop.sh', root), 'utf8');
  const status = await readFile(new URL('devnet/status.mjs', root), 'utf8');
  assert.match(start, /backend\/cooo-lyquid\/Cargo\.toml/);
  assert.match(start, /\.cooo-devnet/);
  assert.match(start, /devnet\.json/);
  assert.match(start, /127\.0\.0\.1:8080/);
  assert.match(stop, /docker compose/);
  assert.match(status, /cooo-local-v0\.3-terms-bound-review/);
  assert.match(status, /ledger\?\.conserved/);
});

test('local devnet state is ignored', async () => {
  const gitignore = await readFile(new URL('.gitignore', root), 'utf8');
  assert.match(gitignore, /^\.cooo-devnet\/$/m);
});
