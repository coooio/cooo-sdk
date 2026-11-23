import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverDeposit } from '../examples/operation-recovery.mjs';

const caller = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const zeroAddress = '0x' + '0'.repeat(40);
const zeroDigest = '0x' + '0'.repeat(64);
const operation = {
  caller,
  operationId: 'recover-demo',
  action: 0,
  taskId: '',
  parentId: '',
  provider: zeroAddress,
  counterparty: zeroAddress,
  amount: '1',
  cancellationFee: '0',
  digest: zeroDigest,
  scopes: [],
};
const conservedState = () => ({
  ledger: { conserved: true },
  operations: [],
});

test('recovery skips submission after exact authoritative confirmation', async () => {
  let submissions = 0;
  const result = await recoverDeposit({
    sdk: {
      getState: async () => ({ ...conservedState(), operations: [operation] }),
      deposit: async () => { submissions++; throw new Error('must not submit'); },
    },
    caller,
    operationId: operation.operationId,
    amount: 1n,
  });
  assert.equal(result.status, 'already-confirmed');
  assert.equal(result.ledgerConserved, true);
  assert.equal(submissions, 0);
});

test('submit-only returns the transport receipt without claiming confirmation', async () => {
  let confirmations = 0;
  const result = await recoverDeposit({
    sdk: {
      getState: conservedState,
      deposit: async () => '0x' + '1f'.repeat(32),
      waitForOperation: async () => { confirmations++; throw new Error('must not wait'); },
    },
    caller,
    operationId: operation.operationId,
    amount: 1n,
    submitOnly: true,
  });
  assert.equal(result.status, 'submitted');
  assert.equal(result.transactionHash, '0x' + '1f'.repeat(32));
  assert.equal(confirmations, 0);
});

test('recovery confirms the exact intent after submission', async () => {
  const result = await recoverDeposit({
    sdk: {
      getState: conservedState,
      deposit: async () => '0x' + '1f'.repeat(32),
      waitForOperation: async () => ({ operation, state: conservedState() }),
    },
    caller,
    operationId: operation.operationId,
    amount: 1n,
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.operation, operation);
  assert.equal(result.ledgerConserved, true);
});

test('recovery rejects a reused operation ID with changed intent', async () => {
  await assert.rejects(
    recoverDeposit({
      sdk: {
        getState: async () => ({ ...conservedState(), operations: [{ ...operation, amount: '2' }] }),
        deposit: async () => '0x' + '1f'.repeat(32),
      },
      caller,
      operationId: operation.operationId,
      amount: 1n,
    }),
    /different authoritative intent/,
  );
});
