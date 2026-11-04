import test from 'node:test';
import assert from 'node:assert/strict';
import { CoooSdk } from '../dist/index.js';
import {
  agentHeldTerms,
  agentHeldTermsDigest,
  buildAgentHeldWorkflow,
  findExactOperation,
  operationMatches,
} from '../examples/agent-held-workflow.mjs';

const contract = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const operator = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const requester = '0x3C44CdDdB6a900fa2b585dd29eEB14C7aD1B0E7F';
const provider = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const reviewer = '0x976EA74026E726554db657fa54763aBd0C3a0aA9';
const evidenceDigest = '0x' + '3b'.repeat(32);
const termsDigest = '0x' + '7f'.repeat(32);
const workflow = buildAgentHeldWorkflow({
  taskId: 'agent-held-test',
  operator,
  requester,
  provider,
  reviewer,
  evidenceDigest,
  termsDigest,
  deploymentTag: 'abcdef123456',
});

function fakeSdk() {
  const deployment = { lyquidId: 'Lyquid-agent-held', contract, protocolVersion: 'cooo-local-v0.3-terms-bound-review' };
  const state = {
    ledger: {
      totalDeposits: '0', balancesTotal: '0', reserved: '0', earnedClaims: '0',
      completedPayouts: '0', completedRefunds: '0', platformFees: '0', conserved: true,
    },
    deployment,
    tasks: [],
  };
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/lyquid/info')) {
      return { ok: true, json: async () => ({ lyquid_id: deployment.lyquidId, backend_contract: contract }) };
    }
    if (String(url).endsWith('/api/state')) return { ok: true, json: async () => state };
    const request = JSON.parse(init.body);
    const result = request.method === 'eth_chainId' ? '0x7a69'
      : request.method === 'eth_getTransactionCount' ? '0x0'
        : request.method === 'eth_gasPrice' ? '0x1'
          : '0x' + '2f'.padStart(64, '0');
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
  };
  const sdk = new CoooSdk({
    rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
    infoUrl: 'http://127.0.0.1:8080/lyquid/info',
    stateUrl: 'http://127.0.0.1:8080/api/state',
    expectedLyquidId: deployment.lyquidId,
    expectedContract: contract,
    fetchImpl,
  });
  return { sdk, deployment, state };
}

test('agent-held workflow separates admission operator from ordinary requester and builds valid ABI arguments', async () => {
  assert.equal(workflow.length, 13);
  assert.equal(workflow.at(-1).expectedIntent.amount, '100', 'cancel records the original root amount');
  assert.ok(workflow.filter(step => step.method === 'grantAuthority').every(step => step.principal === 'operator'));
  assert.ok(workflow.filter(step => step.method !== 'grantAuthority').every(step => step.principal !== 'operator'));
  const ids = workflow.map(step => step.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const step of workflow) {
    assert.equal(step.types.length, step.values.length, `${step.label} must not add a redundant signer ABI value`);
    assert.equal(step.values[0], step.operationId, `${step.label} must encode its logical operation ID`);
    assert.ok(step.operationId.length <= 128);
    assert.equal(step.expectedIntent.action, {
      'requester-deposit': 0,
      'operator-admit-provider': 8,
      'operator-admit-reviewer': 8,
      'requester-reviewed-terms': 27,
      'requester-provider-assignment': 9,
      'requester-reviewer-assignment': 15,
      'provider-dispatch': 10,
      'provider-delivery': 11,
      'reviewer-decision': 16,
      'requester-acceptance': 12,
      'provider-payout': 13,
      'reviewer-payout': 17,
      'requester-close-remainder': 6,
    }[step.label]);
  }
  assert.notEqual(operator.toLowerCase(), requester.toLowerCase());
  const { sdk } = fakeSdk();
  for (const step of workflow) {
    const transaction = await sdk.prepareTransaction(
      step.method,
      { operator, requester, provider, reviewer }[step.principal],
      step.types,
      step.values,
    );
    assert.equal(transaction.from.toLowerCase(), { operator, requester, provider, reviewer }[step.principal].toLowerCase());
    assert.ok(transaction.data.startsWith('0x'));
  }
});

test('agent-held operation reconciliation matches the exact authoritative intent', () => {
  const deposit = workflow[0];
  const actual = {
    caller: requester,
    operationId: deposit.operationId,
    action: 0,
    taskId: '',
    parentId: '',
    provider: '0x' + '0'.repeat(40),
    counterparty: '0x' + '0'.repeat(40),
    amount: '100',
    cancellationFee: '0',
    digest: '0x' + '0'.repeat(64),
    scopes: [],
  };
  assert.ok(operationMatches(actual, deposit.expectedIntent));
  assert.ok(findExactOperation({ operations: [actual] }, requester, deposit.operationId, deposit.expectedIntent));
  for (const changed of [
    { ...actual, amount: '101' },
    { ...actual, action: 1 },
    { ...actual, caller: provider },
    { ...actual, operationId: `${deposit.operationId}-other` },
  ]) {
    assert.equal(findExactOperation({ operations: [changed] }, requester, deposit.operationId, deposit.expectedIntent), undefined);
  }
});

test('terms digest is canonical and operation state validation rejects malformed history', async () => {
  const terms = agentHeldTerms({ requester, provider, reviewer, evidenceDigest });
  const digest = agentHeldTermsDigest(terms);
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  const { sdk, state } = fakeSdk();
  state.operations = [{ caller: requester }];
  await assert.rejects(
    sdk.getState(),
    /operations\[0\] has an unexpected shape/,
    'SDK state validation should reject malformed authoritative operation history',
  );
});


