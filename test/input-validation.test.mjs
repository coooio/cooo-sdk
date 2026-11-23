import test from 'node:test';
import assert from 'node:assert/strict';
import { COOO_PROTOCOL_VERSION, CoooSdk, CoooSdkError } from '../dist/index.js';

const operator = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const provider = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const reviewer = '0x976EA74026E726554db657fa54763aBd0C3a0aA9';
const digest = '0x' + '2a'.repeat(32);

function invalidArgumentSdk() {
  const calls = [];
  const sdk = new CoooSdk({
    rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
    infoUrl: 'http://127.0.0.1:8080/lyquid/info',
    stateUrl: 'http://127.0.0.1:8080/api/state',
    expectedLyquidId: 'Lyquid-test',
    expectedContract: provider,
    fetchImpl: async (...args) => {
      calls.push(args);
      throw new Error('transport must not be reached');
    },
  });
  return { sdk, calls };
}

function options(overrides = {}) {
  return {
    rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
    infoUrl: 'http://127.0.0.1:8080/lyquid/info',
    stateUrl: 'http://127.0.0.1:8080/api/state',
    expectedLyquidId: 'Lyquid-test',
    expectedContract: provider,
    ...overrides,
  };
}

async function assertInvalidTransport(promise, calls, pattern) {
  await assert.rejects(
    promise,
    error => error instanceof CoooSdkError &&
      error.code === 'invalid_argument' &&
      pattern.test(error.message),
  );
  assert.deepEqual(calls, []);
}

test('typed operations validate external arguments before transport', async () => {
  const { sdk, calls } = invalidArgumentSdk();
  const invalidCalls = [
    () => sdk.deposit(operator, 'deposit', 1),
    () => sdk.grantAuthority(operator, 'grant', provider, 'work'),
    () => sdk.createTask(operator, 'create', 'task', provider, 1n, 0n, '0x2a'),
    () => sdk.allocateChild(operator, 'delegate', 'parent', 'child', 'provider', 1n, 0n, digest),
    () => sdk.dispatchTask('caller', 'dispatch', 'task'),
    () => sdk.deliverTask(operator, 'deliver', 'task', '0x2a'),
    () => sdk.acceptTask('caller', 'accept', 'task'),
    () => sdk.withdrawTask(operator, 'withdraw', null),
    () => sdk.assignProvider(operator, 'assign', 'task', provider, 1n, '0x2a'),
    () => sdk.dispatchProvider(operator, 'dispatch-provider', 'task', 'provider'),
    () => sdk.deliverProvider(operator, 'deliver-provider', 'task', provider, '0x2a'),
    () => sdk.acceptProvider(operator, 'accept-provider', 'task', 'provider'),
    () => sdk.withdrawProvider(operator, 'withdraw-provider', 'task', 'provider'),
    () => sdk.cancel('caller', 'cancel', 'task'),
    () => sdk.createReviewedTask(
      operator, 'reviewed-create', 'task', provider, 1n, 0n, digest, 1n, 1n, '0x2a',
    ),
    () => sdk.assignVerifier(operator, 'assign-verifier', 'task', provider, 'reviewer', 1n),
    () => sdk.submitVerifierResult(
      operator, 'verifier-result', 'task', provider, reviewer, 1n, digest, digest, 1,
    ),
    () => sdk.revokeReviewer(operator, 'revoke-reviewer', 'task', 'producer', reviewer),
    () => sdk.withdrawVerifierReward(operator, 'withdraw-reviewer-reward', 'task', provider, 'reviewer'),
  ];

  for (const run of invalidCalls) {
    await assertInvalidTransport(run(), calls, /must/);
  }
});

test('low-level operations validate arguments before discovery', async () => {
  const { sdk, calls } = invalidArgumentSdk();
  await assertInvalidTransport(
    sdk.prepareTransaction('unsupported', operator, [], []),
    calls,
    /method must be a supported cooo operation/,
  );
  await assertInvalidTransport(
    sdk.send('unsupported', operator, [], []),
    calls,
    /method must be a supported cooo operation/,
  );
  await assertInvalidTransport(
    sdk.send('deposit', operator, ['string'], []),
    calls,
    /ABI type and value counts differ/,
  );
  await assertInvalidTransport(
    sdk.sendRawTransaction('0x' + '44'.repeat(16), {
      lyquidId: 'Lyquid-test',
      contract: 'contract',
      protocolVersion: COOO_PROTOCOL_VERSION,
    }),
    calls,
    /expectedDeployment\.contract must be a 20-byte address/,
  );
});

test('reconciliation and constructor boundaries reject invalid runtime input', async () => {
  const { sdk, calls } = invalidArgumentSdk();
  await assertInvalidTransport(
    sdk.waitForState(null),
    calls,
    /predicate must be a function/,
  );
  await assertInvalidTransport(
    sdk.waitForOperation('caller', 'operation', {}),
    calls,
    /caller must be a 20-byte address/,
  );
  await assertInvalidTransport(
    sdk.waitForOperation(operator, '', {}),
    calls,
    /operationId must match/,
  );

  assert.throws(
    () => new CoooSdk(options({ fetchImpl: {} })),
    error => error instanceof CoooSdkError && /fetchImpl must be a function/.test(error.message),
  );
  assert.throws(
    () => new CoooSdk(options({ transactionSender: null })),
    error => error instanceof CoooSdkError && /transactionSender must be a function/.test(error.message),
  );
  assert.throws(
    () => new CoooSdk(options({ signal: null })),
    error => error instanceof CoooSdkError && /signal must be an AbortSignal/.test(error.message),
  );
  assert.throws(
    () => new CoooSdk(options({ expectedContract: 'contract' })),
    error => error instanceof CoooSdkError && /expectedContract must be a 20-byte address/.test(error.message),
  );
  assert.throws(
    () => new CoooSdk(options({ timeoutMs: 0 })),
    error => error instanceof CoooSdkError && /timeoutMs must be a positive integer/.test(error.message),
  );
});
