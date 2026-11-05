import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '..');

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath, entry.name));
}

test('package metadata describes a public scoped package', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@cooo/sdk');
  assert.equal(manifest.version, '0.7.2');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.sideEffects, false);
  assert.equal(manifest.engines.node, '>=22.0.0');
  assert.deepEqual(manifest.publishConfig, { access: 'public' });
  assert.deepEqual(manifest.exports['.'], {
    types: './dist/index.d.ts',
    import: './dist/index.js',
  });
  assert.deepEqual(manifest.exports['./package.json'], './package.json');
});

test('repository contains the required public release files', async () => {
  const requiredFiles = [
    '.editorconfig',
    '.gitattributes',
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'docs/api.md',
    'docs/compatibility.md',
    'LICENSE',
    'README.md',
    'SECURITY.md',
  ];
  for (const name of requiredFiles) {
    await readFile(path.join(packageRoot, name), 'utf8');
  }
});

test('public source and declarations contain no former brand identifier', async () => {
  const files = [
    ...(await filesUnder(path.join(packageRoot, 'src'))),
    ...(await filesUnder(path.join(packageRoot, 'dist'))),
    ...(await filesUnder(path.join(packageRoot, 'docs'))),
    path.join(packageRoot, 'package.json'),
    path.join(packageRoot, 'README.md'),
    path.join(packageRoot, 'CHANGELOG.md'),
  ];
  assert.ok(files.length > 10);
  const formerBrand = ['int', 'ervow'].join('');
  const pattern = new RegExp(formerBrand, 'i');
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, pattern, `${path.relative(packageRoot, file)} contains a former brand identifier`);
  }
});

test('generated declarations expose the stable protocol name', async () => {
  const declarations = (await filesUnder(path.join(packageRoot, 'dist')))
    .filter(file => file.endsWith('.d.ts'))
    .map(file => readFile(file, 'utf8'));
  const content = (await Promise.all(declarations)).join('\n');
  assert.match(content, /COOO_PROTOCOL_VERSION/);
  assert.doesNotMatch(content, /SDK_PROTOCOL_VERSION/);
});



