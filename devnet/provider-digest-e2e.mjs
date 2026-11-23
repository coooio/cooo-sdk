import { createHash, randomBytes } from 'node:crypto';
import { CoooSdk } from '../dist/index.js';
import {
  agentHeldTerms,
  agentHeldTermsDigest,
  buildAgentHeldWorkflow,
} from '../examples/agent-held-workflow.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const rpcUrl = required('COOO_RPC_URL');
const infoUrl = required('COOO_INFO_URL');
const stateUrl = required('COOO_STATE_URL');
const lyquidId = required('COOO_LYQUID_ID');
const contract = required('COOO_CONTRACT');
const accounts = {
  operator: required('COOO_OPERATOR'),
  requester: required('COOO_REQUESTER'),
  provider: required('COOO_PROVIDER'),
  reviewer: required('COOO_REVIEWER'),
};

const evidence = Buffer.from('cooo devnet provider-digest E2E evidence', 'utf8');
const evidenceDigest = `0x${createHash('sha256').update(evidence).digest('hex')}`;
const wrongDigest = `0x${createHash('sha256').update(Buffer.from('wrong evidence', 'utf8')).digest('hex')}`;
const terms = agentHeldTerms({
  requester: accounts.requester,
  provider: accounts.provider,
  reviewer: accounts.reviewer,
  evidenceDigest,
});
const termsDigest = agentHeldTermsDigest(terms);
const taskId = `digest-e2e-${randomBytes(6).toString('hex')}`;
const deploymentTag = createHash('sha256')
  .update(`${lyquidId}:${contract.toLowerCase()}`)
  .digest('hex')
  .slice(0, 12);
const workflow = buildAgentHeldWorkflow({
  taskId,
  ...accounts,
  evidenceDigest,
  termsDigest,
  deploymentTag,
});

const sdk = new CoooSdk({
  rpcUrl,
  infoUrl,
  stateUrl,
  expectedLyquidId: lyquidId,
  expectedContract: contract,
});

function providerState(state) {
  const task = state.tasks.find(item => item.id === taskId);
  const provider = task?.providers?.find(item =>
    item.provider.toLowerCase() === accounts.provider.toLowerCase());
  if (!provider) throw new Error(`provider state missing for ${taskId}`);
  return provider;
}

const initialState = await sdk.getState();
if (!initialState.ledger.conserved || initialState.asset?.synthetic === false) {
  throw new Error('E2E requires a conserved synthetic deployment');
}

for (const step of workflow.slice(0, 7)) {
  const method = sdk[step.method];
  if (typeof method !== 'function') throw new Error(`unknown SDK method: ${step.method}`);
  await method.call(sdk, accounts[step.principal], ...step.values);
  const confirmation = await sdk.waitForOperation(
    accounts[step.principal],
    step.operationId,
    step.expectedIntent,
  );
  if (!confirmation.state.ledger.conserved) {
    throw new Error(`${step.label}: ledger is not conserved`);
  }
  console.log(`${step.label}: confirmed`);
}

const beforeRejectedDelivery = await sdk.getState();
const beforeOperationCount = beforeRejectedDelivery.operations?.length ?? 0;
if (providerState(beforeRejectedDelivery).executionState !== 1) {
  throw new Error('provider must be dispatched before the wrong-digest attempt');
}

let wrongDigestRejected = false;
try {
  await sdk.deliverProvider(
    accounts.provider,
    `${taskId}:wrong-digest:d${deploymentTag}`,
    taskId,
    accounts.provider,
    wrongDigest,
  );
} catch (error) {
  if (!/provider evidence does not match terms/.test(String(error?.message))) throw error;
  wrongDigestRejected = true;
}
if (!wrongDigestRejected) throw new Error('wrong provider digest was accepted');

const afterRejectedDelivery = await sdk.getState();
if ((afterRejectedDelivery.operations?.length ?? 0) !== beforeOperationCount) {
  throw new Error('rejected wrong-digest delivery changed the authoritative operation set');
}
if (providerState(afterRejectedDelivery).executionState !== 1) {
  throw new Error('rejected wrong-digest delivery changed provider execution state');
}
if (!afterRejectedDelivery.ledger.conserved) throw new Error('ledger conservation failed after rejection');
console.log('wrong digest: rejected without authoritative state change');

const delivery = workflow[7];
await sdk.deliverProvider(
  accounts.provider,
  delivery.operationId,
  taskId,
  accounts.provider,
  evidenceDigest,
);
const delivered = await sdk.waitForOperation(
  accounts.provider,
  delivery.operationId,
  delivery.expectedIntent,
);
if (providerState(delivered.state).executionState !== 2) {
  throw new Error('correct provider digest did not enter Delivered state');
}
if (!delivered.state.ledger.conserved) throw new Error('ledger conservation failed after delivery');

console.log(JSON.stringify({
  taskId,
  evidenceDigest,
  wrongDigest,
  providerExecutionState: providerState(delivered.state).executionState,
  operationCount: delivered.state.operations?.length ?? 0,
  ledgerConserved: delivered.state.ledger.conserved,
}, null, 2));
