import { pathToFileURL } from 'node:url';
import { CoooSdk, findExactOperation } from '../dist/index.js';

const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const ZERO_DIGEST = '0x' + '0'.repeat(64);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function recoverDeposit({ sdk, caller, operationId, amount, submitOnly = false }) {
  const expectedIntent = Object.freeze({
    action: 0,
    taskId: '',
    parentId: '',
    provider: ZERO_ADDRESS,
    counterparty: ZERO_ADDRESS,
    amount: String(amount),
    cancellationFee: '0',
    digest: ZERO_DIGEST,
    scopes: [],
  });

  const state = await sdk.getState();
  if (!state.ledger.conserved) throw new Error('authoritative ledger is not conserved');
  const confirmed = findExactOperation(state, caller, operationId, expectedIntent);
  if (confirmed) {
    return Object.freeze({
      status: 'already-confirmed',
      operation: confirmed,
      ledgerConserved: state.ledger.conserved,
    });
  }

  const conflicting = (state.operations ?? []).find(operation =>
    operation.caller.toLowerCase() === caller.toLowerCase() &&
    operation.operationId === operationId);
  if (conflicting) {
    throw new Error('operation ID already has a different authoritative intent');
  }

  const transactionHash = await sdk.deposit(caller, operationId, BigInt(amount));
  if (submitOnly) {
    return Object.freeze({ status: 'submitted', transactionHash });
  }

  const confirmation = await sdk.waitForOperation(caller, operationId, expectedIntent);
  if (!confirmation.state.ledger.conserved) throw new Error('authoritative ledger is not conserved');
  return Object.freeze({
    status: 'confirmed',
    transactionHash,
    operation: confirmation.operation,
    ledgerConserved: confirmation.state.ledger.conserved,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const submitOnly = process.argv.includes('--submit-only');
  const sdk = new CoooSdk({
    rpcUrl: required('COOO_RPC_URL'),
    infoUrl: required('COOO_INFO_URL'),
    stateUrl: required('COOO_STATE_URL'),
    expectedLyquidId: required('COOO_LYQUID_ID'),
    expectedContract: required('COOO_CONTRACT'),
  });
  const result = await recoverDeposit({
    sdk,
    caller: required('COOO_CALLER'),
    operationId: required('COOO_OPERATION_ID'),
    amount: required('COOO_AMOUNT'),
    submitOnly,
  });
  console.log(JSON.stringify(result, null, 2));
}
