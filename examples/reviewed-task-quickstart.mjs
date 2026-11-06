import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CoooSdk, operationMatches } from '../dist/index.js';
import {
  agentHeldTerms,
  agentHeldTermsDigest,
  buildAgentHeldWorkflow,
} from './agent-held-workflow.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see examples/reviewed-task.env.example`);
  return value;
}

const rpcUrl = required('COOO_RPC_URL');
const infoUrl = required('COOO_INFO_URL');
const stateUrl = required('COOO_STATE_URL');
const lyquidId = required('COOO_LYQUID_ID');
const contract = required('COOO_CONTRACT');
const taskId = required('COOO_TASK_ID');
const accounts = {
  operator: required('COOO_OPERATOR'),
  requester: required('COOO_REQUESTER'),
  provider: required('COOO_PROVIDER'),
  reviewer: required('COOO_REVIEWER'),
};
const deadlineInput = required('COOO_DEADLINE');
const deadline = new Date(deadlineInput);
if (Number.isNaN(deadline.valueOf()) || deadline.valueOf() <= Date.now()) {
  throw new Error('COOO_DEADLINE must be a future ISO-8601 timestamp');
}

const evidencePath = process.env.COOO_EVIDENCE_FILE ??
  new URL('./reviewed-task-evidence.txt', import.meta.url);
const evidence = await readFile(evidencePath);
const evidenceDigest = `0x${createHash('sha256').update(evidence).digest('hex')}`;
const terms = {
  ...agentHeldTerms({
    requester: accounts.requester,
    provider: accounts.provider,
    reviewer: accounts.reviewer,
    evidenceDigest,
  }),
  deadline: deadline.toISOString(),
};
const termsDigest = agentHeldTermsDigest(terms);
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

// This example uses unlocked accounts only on a loopback devnet.
const sdk = new CoooSdk({
  rpcUrl,
  infoUrl,
  stateUrl,
  expectedLyquidId: lyquidId,
  expectedContract: contract,
});

const initialState = await sdk.getState();
if (!initialState.ledger.conserved || initialState.asset?.synthetic === false) {
  throw new Error('This walkthrough requires a conserved, synthetic local deployment');
}
console.log(JSON.stringify({ taskId, evidenceDigest, termsDigest, deploymentTag }, null, 2));

for (const step of workflow) {
  const caller = accounts[step.principal];
  const before = await sdk.getState();
  const prior = (before.operations ?? []).find(operation =>
    operation.caller.toLowerCase() === caller.toLowerCase() &&
    operation.operationId === step.operationId);
  if (prior) {
    if (!operationMatches(prior, step.expectedIntent)) {
      throw new Error(`${step.label}: operation ID already has a different intent`);
    }
    console.log(`${step.label}: already confirmed; skipping submission`);
    continue;
  }

  const method = sdk[step.method];
  if (typeof method !== 'function') throw new Error(`Unknown SDK method: ${step.method}`);
  let transactionHash;
  try {
    transactionHash = await method.call(sdk, caller, ...step.values);
  } catch (error) {
    console.error(`${step.label}: submission outcome is unknown; inspect authoritative state before retrying`);
    throw error;
  }

  // Confirm the exact authoritative intent after transport acceptance.
  const { operation, state } = await sdk.waitForOperation(
    caller,
    step.operationId,
    step.expectedIntent,
  );
  if (!state.ledger.conserved) throw new Error(`${step.label}: ledger is not conserved`);
  console.log(JSON.stringify({
    step: step.label,
    transactionHash,
    confirmedAction: operation.action,
    task: state.tasks.find(task => task.id === taskId) ?? null,
  }));
}

const finalState = await sdk.getState();
if (!finalState.ledger.conserved || !finalState.tasks.some(task => task.id === taskId)) {
  throw new Error('Final task state or ledger invariant is missing');
}
console.log(`Confirmed ${workflow.length} exact operations for ${taskId}`);
