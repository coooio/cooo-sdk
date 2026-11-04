import test from 'node:test';
import assert from 'node:assert/strict';
import { COOO_PROTOCOL_VERSION, CoooSdk, CoooSdkError } from '../dist/index.js';

const operator = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const provider = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const transactionHash = '0x' + '1f'.padStart(64, '0');

const validState = {
  ledger: {
    totalDeposits: '0',
    balancesTotal: '0',
    reserved: '0',
    earnedClaims: '0',
    completedPayouts: '0',
    completedRefunds: '0',
    platformFees: '0',
    conserved: true,
  },
  tasks: [],
};

function testDeployment(lyquidId = 'Lyquid-test') {
  return { lyquidId, contract: provider, protocolVersion: COOO_PROTOCOL_VERSION };
}

function boundState(lyquidId = 'Lyquid-test') {
  return { ...validState, deployment: testDeployment(lyquidId) };
}

function fakeSdk({ metadata = { lyquid_id: 'Lyquid-test' }, state, pinned = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('/lyquid/info')) {
      return { ok: true, json: async () => ({ backend_contract: provider, ...metadata }) };
    }
    if (String(url).endsWith('/api/state')) {
      return { ok: true, json: async () => authoritativeState };
    }
    if (init?.body) {
      const request = JSON.parse(init.body);
      const result = request.method === 'eth_chainId' ? '0x7a69'
        : request.method === 'eth_getTransactionCount' ? '0x2'
          : request.method === 'eth_gasPrice' ? '0x1'
            : transactionHash;
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: transactionHash }) };
  };
  const defaultDeployment = testDeployment(metadata.lyquid_id ?? metadata.lyquidId);
  const authoritativeState = state ?? { ...validState, deployment: defaultDeployment };
  const sdk = new CoooSdk({
    rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
    infoUrl: 'http://127.0.0.1:8080/lyquid/info',
    stateUrl: 'http://127.0.0.1:8080/api/state',
    expectedLyquidId: pinned ? defaultDeployment.lyquidId : undefined,
    expectedContract: pinned ? provider : undefined,
    fetchImpl,
  });
  return { sdk, calls };
}

test('sdk discovers metadata, validates state, and encodes dynamic arrays canonically', async () => {
  const { sdk, calls } = fakeSdk({ state: boundState() });
  assert.equal((await sdk.getState()).ledger.conserved, true);
  await sdk.grantAuthority(operator, 'test-operation', provider, ['work:data', 'tool:read']);
  const rpc = JSON.parse(calls.at(-1).init.body);
  assert.equal(rpc.params[0].data.slice(0, 10), '0xaed70ccb');
  assert.ok(rpc.params[0].data.includes('0000000000000000000000000000000000000000000000000000000000000040'));
  assert.ok(rpc.params[0].data.includes('0000000000000000000000000000000000000000000000000000000000000080'));
});

test('sdk encodes terms-bound reviewed-task and reviewer operations', async () => {
  const { sdk, calls } = fakeSdk({ state: boundState() });
  const reviewer = '0x976EA74026E726554db657fa54763aBd0C3a0aA9';
  const termsDigest = '0x' + '3b'.repeat(32);
  await sdk.createReviewedTask(
    operator,
    'reviewed-create',
    'reviewed-task',
    provider,
    100n,
    0n,
    transactionHash,
    1n,
    1n,
    termsDigest,
  );
  await sdk.assignVerifier(operator, 'reviewer-assign', 'reviewed-task', provider, reviewer, 10n);
  await sdk.submitVerifierResult(
    reviewer,
    'reviewer-result',
    'reviewed-task',
    provider,
    reviewer,
    1n,
    termsDigest,
    transactionHash,
    true,
  );
  const submissions = calls.filter(call => call.init?.body);
  const create = JSON.parse(submissions[0].init.body);
  const assign = JSON.parse(submissions[1].init.body);
  const result = JSON.parse(submissions[2].init.body);
  assert.equal(create.params[0].data.slice(0, 10), '0x90e99f47');
  assert.equal(assign.params[0].data.slice(0, 10), '0xb37bc2fb');
  assert.equal(result.params[0].data.slice(0, 10), '0xf6b6a778');
});

test('sdk rejects mutations without a complete explicit deployment binding', async () => {
  const metadata = { lyquid_id: 'Lyquid-test', backend_contract: provider };
  const { sdk } = fakeSdk({ metadata, state: boundState(), pinned: false });
  await assert.rejects(
    sdk.deposit(operator, 'unbound-operation', 1n),
    error => error instanceof CoooSdkError &&
      error.code === 'invalid_argument' &&
      /trusted mutations require both/.test(error.message),
  );
});

test('sdk aborts requests through a caller-provided signal', async () => {
  const controller = new AbortController();
  controller.abort();
  const sdk = new CoooSdk({
    rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
    infoUrl: 'http://127.0.0.1:8080/lyquid/info',
    stateUrl: 'http://127.0.0.1:8080/api/state',
    signal: controller.signal,
    fetchImpl: async () => {
      throw new Error('fetch must not run after abort');
    },
  });
  await assert.rejects(
    sdk.getState(),
    error => error instanceof CoooSdkError && error.code === 'aborted' && error.details.endpoint?.endsWith('/api/state') === true,
  );
});

test('sdk confirms exact caller-bound operation intent and rejects changed payloads', async () => {
  const expected = { action: 0, amount: '100' };
  const operation = {
    caller: operator,
    operationId: 'exact-operation',
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
  const matching = fakeSdk({ state: { ...boundState(), operations: [operation] } });
  const confirmation = await matching.sdk.waitForOperation(operator, operation.operationId, expected, 1_000, 1);
  assert.equal(confirmation.operation.operationId, operation.operationId);
  assert.equal(confirmation.state.ledger.conserved, true);

  const conflicting = fakeSdk({ state: { ...boundState(), operations: [{ ...operation, amount: '101' }] } });
  await assert.rejects(
    conflicting.sdk.waitForOperation(operator, operation.operationId, expected, 10, 1),
    error => error instanceof CoooSdkError &&
      error.code === 'state_validation' &&
      error.details.operationId === operation.operationId &&
      (error.details.actualIntent?.amount === '101'),
  );
});

test('sdk optionally binds discovery to an exact Lyquid and contract identity', async () => {
  const metadata = { backend_contract: provider, lyquid_id: 'Lyquid-test' };
  const matching = fakeSdk({ metadata, state: validState });
  matching.sdk.expectedLyquidId = 'Lyquid-test';
  assert.equal((await matching.sdk.discover()).lyquid_id, 'Lyquid-test');
  const mismatched = fakeSdk({ metadata, state: validState });
  mismatched.sdk.expectedLyquidId = 'Lyquor-other';
  await assert.rejects(
    mismatched.sdk.discover(),
    error => error instanceof CoooSdkError && error.code === 'state_validation',
  );
});

test('sdk allows the explicit Docker host gateway for local HTTP backends', () => {
  const sdk = new CoooSdk({
    rpcUrl: 'http://host.docker.internal:8080/lyquid/api',
    infoUrl: 'http://host.docker.internal:8080/lyquid/info',
    stateUrl: 'http://host.docker.internal:8080/api/state',
  });
  assert.equal(typeof sdk.rpcUrl, 'string');
});

test('sdk rejects non-local HTTP endpoints before sending a request', () => {
  assert.throws(
    () => new CoooSdk({
      rpcUrl: 'http://example.test/api',
      infoUrl: 'https://example.test/info',
      stateUrl: 'https://example.test/state',
    }),
    error => error instanceof CoooSdkError && error.code === 'invalid_argument',
  );
});

test('sdk rejects malformed authoritative amounts', async () => {
  const { sdk } = fakeSdk({ state: { ...validState, ledger: { ...validState.ledger, totalDeposits: '0x1' } } });
  await assert.rejects(
    sdk.getState(),
    error => error instanceof CoooSdkError && error.code === 'state_validation',
  );
});

test('sdk validates typed operation arguments and uint256 bounds', async () => {
  const { sdk } = fakeSdk({ state: validState });
  const assertInvalid = promise => assert.rejects(promise, CoooSdkError);
  await assertInvalid(sdk.deposit(operator, 'bad operation', 1n));
  await assertInvalid(sdk.deposit(operator, 'test-operation', 1n << 256n));
  await assertInvalid(sdk.grantAuthority(operator, 'test-operation', provider, ['Invalid Scope']));
});

test('sdk reports request cancellation as a timeout', async () => {
  const sdk = new CoooSdk({
    rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
    infoUrl: 'http://127.0.0.1:8080/lyquid/info',
    stateUrl: 'http://127.0.0.1:8080/api/state',
    timeoutMs: 10,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new DOMException('aborted', 'AbortError');
        reject(error);
      });
    }),
  });
  await assert.rejects(
    sdk.getState(),
    error => error instanceof CoooSdkError && error.code === 'timeout',
  );
});

test('state deployment metadata must match the typed shape', async () => {
  const { sdk } = fakeSdk({ state: { ...validState, deployment: { lyquidId: 42 } } });
  await assert.rejects(sdk.getState(), /deployment identity has an unexpected shape/);
});
test('pinned state rejects a different deployment despite matching discovery metadata', async () => {
  const { sdk } = fakeSdk({ metadata: { lyquid_id: 'Lyquid-a' }, state: boundState('Lyquid-b') });
  sdk.expectedLyquidId = 'Lyquid-a';
  await assert.rejects(sdk.getState(), /state response is not bound/);
});

test('every send rediscovers identity and rejects a changed endpoint before submission', async () => {
  const metadata = { lyquid_id: 'Lyquid-a' };
  const { sdk, calls } = fakeSdk({ metadata, state: boundState('Lyquid-a') });
  sdk.expectedLyquidId = 'Lyquid-a';
  await sdk.deposit(operator, 'first', 1n);
  metadata.lyquid_id = 'Lyquid-b';
  await assert.rejects(sdk.deposit(operator, 'second', 1n), /identity does not match/);
  assert.equal(calls.filter(call => call.init?.body).length, 1);
});

test('external sender receives a bound transaction without unlocked RPC submission', async () => {
  let sent;
  let rpcCalls = 0;
  const deployment = testDeployment('Lyquid-external');
  const sdk = new CoooSdk({
    infoUrl: 'https://node.example/info', stateUrl: 'https://node.example/state', rpcUrl: 'https://node.example/rpc',
    expectedLyquidId: deployment.lyquidId, expectedContract: provider,
    fetchImpl: async url => {
      if (url.endsWith('/rpc')) { rpcCalls++; throw new Error('unlocked RPC must not be used'); }
      return { ok: true, json: async () => url.endsWith('/info') ? { lyquid_id: deployment.lyquidId, backend_contract: provider } : { ...validState, deployment } };
    },
    transactionSender: async transaction => { sent = transaction; return transactionHash; },
  });
  await sdk.deposit(operator, 'external-op', 5n);
  assert.equal(rpcCalls, 0);
  assert.equal(sent.from, operator);
  assert.equal(sent.to, provider);
  assert.deepEqual(sent.deployment, deployment);
  assert.ok(sent.data.startsWith('0x8e27d719'));
});

test('transaction preparation requires a complete deployment pin', async () => {
  const { sdk } = fakeSdk({ metadata: { lyquid_id: 'Lyquid-a', backend_contract: provider }, state: validState, pinned: false });
  sdk.expectedLyquidId = 'Lyquid-a';
  await assert.rejects(
    sdk.prepareTransaction('deposit', operator, ['string', 'uint256'], ['pin-op', 1n]),
    /requires both Lyquid and contract deployment pins/,
  );
});
test('prepareTransaction returns exact caller-bound transaction fields', async () => {
  const deployment = testDeployment('Lyquid-a');
  const { sdk, calls } = fakeSdk({ metadata: { lyquid_id: deployment.lyquidId, backend_contract: provider }, state: { ...validState, deployment } });
  sdk.expectedLyquidId = deployment.lyquidId;
  sdk.expectedContract = provider;
  const transaction = await sdk.prepareTransaction('deposit', operator, ['string', 'uint256'], ['prepared-op', 7n]);
  assert.equal(transaction.from, operator);
  assert.equal(transaction.to, provider);
  assert.equal(transaction.chainId, 31337n);
  assert.equal(transaction.nonce, 2n);
  assert.equal(transaction.gasPrice, 1n);
  assert.deepEqual(transaction.deployment, deployment);
  const requests = calls.map(call => call.init?.body ? JSON.parse(call.init.body) : null).filter(Boolean);
  assert.deepEqual(requests.slice(0, 3).map(request => request.method), ['eth_chainId', 'eth_getTransactionCount', 'eth_gasPrice']);
  assert.deepEqual(requests[1].params, [operator, 'latest']);
});

test('sendRawTransaction submits the exact envelope after rebinding checks', async () => {
  const deployment = testDeployment('Lyquid-a');
  const { sdk, calls } = fakeSdk({ metadata: { lyquid_id: deployment.lyquidId, backend_contract: provider }, state: { ...validState, deployment } });
  sdk.expectedLyquidId = deployment.lyquidId;
  sdk.expectedContract = provider;
  const raw = '0x02' + '44'.repeat(40);
  assert.equal(await sdk.sendRawTransaction(raw, deployment), transactionHash);
  const submission = calls.map(call => call.init?.body ? JSON.parse(call.init.body) : null).filter(Boolean).at(-1);
  assert.equal(submission.method, 'eth_sendRawTransaction');
  assert.deepEqual(submission.params, [raw]);
  await assert.rejects(
    sdk.sendRawTransaction(raw, { ...deployment, lyquidId: 'Lyquid-b' }),
    /raw transaction deployment binding changed/,
  );
});
test('pinned state accepts an authoritative response without duplicating contract identity', async () => {
  const { sdk } = fakeSdk({
    metadata: { lyquid_id: 'Lyquid-a', backend_contract: provider },
    state: { ...validState, deployment: { lyquidId: 'Lyquid-a', protocolVersion: COOO_PROTOCOL_VERSION } },
  });
  sdk.expectedLyquidId = 'Lyquid-a';
  sdk.expectedContract = provider;
  assert.equal((await sdk.getState()).deployment.lyquidId, 'Lyquid-a');
});
