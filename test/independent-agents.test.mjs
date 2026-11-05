import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

test('independent agent example files are present', async () => {
  for (const name of [
    'devnet/plan-independent-agents.mjs',
    'devnet/run-independent-agents.mjs',
    'devnet/cast-stdin.sh',
    'examples/independent-agent.mjs',
    'docs/independent-agents.md',
  ]) {
    await readFile(new URL(name, root), 'utf8');
  }
});

test('agent process uses caller-held signing and exact reconciliation', async () => {
  const source = await readFile(new URL('examples/independent-agent.mjs', root), 'utf8');
  assert.match(source, /new LocalCastSigner/);
  assert.match(source, /prepareTransaction\(/);
  assert.match(source, /submitRawTransaction\(/);
  assert.match(source, /--step/);
  assert.match(source, /waitForOperation\(/);
  assert.doesNotMatch(source, /eth_sendTransaction/);
  assert.doesNotMatch(source, /COOO_(OPERATOR|REQUESTER|PROVIDER|REVIEWER)_PRIVATE_KEY/);
});

test('coordinator isolates role keys before spawning an agent', async () => {
  const source = await readFile(new URL('devnet/run-independent-agents.mjs', root), 'utf8');
  assert.match(source, /for \(const role of roles\) delete sanitizedEnv\[`COOO_\$\{role\.toUpperCase\(\)\}_PRIVATE_KEY`\]/);
  assert.match(source, /delete sanitizedEnv\.COOO_AGENT_PRIVATE_KEY/);
  assert.match(source, /COOO_AGENT_PRIVATE_KEY: suppliedKeys\[step.role\]/);
  assert.match(source, /for \(const step of plan.steps\)/);
});

test('shared agent plan contains no private-key field', async () => {
  const source = await readFile(new URL('devnet/plan-independent-agents.mjs', root), 'utf8');
  assert.match(source, /evidenceDigest/);
  assert.match(source, /termsDigest/);
  assert.doesNotMatch(source, /PRIVATE_KEY/i);
});
