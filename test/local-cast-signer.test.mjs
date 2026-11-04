import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { LocalCastSigner } from '../dist/local-cast-signer.js';

const expectedAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const privateKey = '0x' + '11'.repeat(32);
const transaction = {
  from: expectedAddress,
  to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  data: '0x8e27d7190000000000000000000000000000000000000000000000000000000000000020',
  gas: '0x249f00',
  chainId: 31337n,
  nonce: 2n,
  gasPrice: 1n,
  deployment: { lyquidId: 'Lyquid-a', protocolVersion: 'test' },
};

test('local Cast signer proves key control and signs exact fields without shell arguments', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cooo-cast-'));
  const helper = path.join(directory, 'fake-cast.mjs');
  const calls = path.join(directory, 'calls.jsonl');
  await writeFile(helper, `import { appendFileSync } from 'node:fs';
import process from 'node:process';
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, input }) + '\\n');
  if (args[0] === 'wallet' && args[1] === 'address') process.stdout.write(${JSON.stringify(expectedAddress)});
  else if (args[0] === 'wallet' && args[1] === 'sign') process.stdout.write('0x' + '22'.repeat(65));
  else if (args[0] === 'mktx') process.stdout.write('0x02abcdef');
  else process.exit(12);
});\n`);
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  let keyReads = 0;
  const signer = new LocalCastSigner({
    expectedAddress,
    readPrivateKey: () => {
      keyReads += 1;
      return privateKey;
    },
    castCommand: process.execPath,
    commandPrefix: [helper],
  });
  const raw = await signer.signTransaction(transaction);
  assert.equal(raw, '0x02abcdef');
  assert.equal(keyReads, 1, 'address proof and signing must use the same resolved key');
  const entries = (await import('node:fs/promises')).readFile;
  const observed = String(await entries(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(observed.length, 2);
  assert.equal(observed[0].args.at(-1), '--interactive');
  assert.equal(observed[1].args[0], 'mktx');
  assert.ok(observed[1].args.includes('--chain'));
  assert.ok(observed[1].args.includes('31337'));
  assert.ok(observed[1].args.includes('2'));
  assert.ok(observed[1].args.includes('2400000'));
  assert.ok(observed[1].args.includes(transaction.to));
  assert.ok(observed[1].args.includes(transaction.data));
  assert.ok(observed.every(call => !JSON.stringify(call.args).includes(privateKey)));
  assert.ok(observed.every(call => call.input.trim() === privateKey));
});

test('local Cast signer signs a bounded challenge message without exposing the key in arguments', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cooo-cast-message-'));
  const helper = path.join(directory, 'fake-cast.mjs');
  const calls = path.join(directory, 'calls.jsonl');
  await writeFile(helper, `import { appendFileSync } from 'node:fs';
import process from 'node:process';
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, input }) + '\\n');
  if (args[0] === 'wallet' && args[1] === 'address') process.stdout.write(${JSON.stringify(expectedAddress)});
  else if (args[0] === 'wallet' && args[1] === 'sign') process.stdout.write('0x' + '22'.repeat(65));
  else process.exit(12);
});\n`);
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  let keyReads = 0;
  const signer = new LocalCastSigner({
    expectedAddress,
    readPrivateKey: () => { keyReads += 1; return privateKey; },
    castCommand: process.execPath,
    commandPrefix: [helper],
  });
  const signature = await signer.signMessage('cooo account binding v1\nchallenge: test');
  assert.equal(signature, '0x' + '22'.repeat(65));
  assert.equal(keyReads, 1);
  const observed = String(await (await import('node:fs/promises')).readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(observed.length, 2);
  assert.ok(observed[1].args.includes('sign'));
  assert.ok(observed.every(call => !JSON.stringify(call.args).includes(privateKey)));
});
test('local Cast signer rejects a mismatched provisioned account and malformed key', async () => {
  const signer = new LocalCastSigner({ expectedAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', readPrivateKey: () => privateKey });
  await assert.rejects(signer.signTransaction({ ...transaction, from: expectedAddress }), /does not match the provisioned account/);
  const malformed = new LocalCastSigner({ expectedAddress, readPrivateKey: () => '0x12' });
  await assert.rejects(malformed.signTransaction(transaction), /private key is malformed/);
});

