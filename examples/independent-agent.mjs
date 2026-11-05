import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { CoooSdk, operationMatches } from '../dist/index.js';
import { LocalCastSigner } from '../dist/local-cast-signer.js';
import { buildAgentHeldWorkflow } from './agent-held-workflow.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const role = argument('--role');
const stepLabel = argument('--step');
const planPath = argument('--plan') ?? '.cooo-devnet/independent-plan.json';
const roles = new Set(['operator', 'requester', 'provider', 'reviewer']);
if (!roles.has(role)) {
  throw new Error('Usage: node examples/independent-agent.mjs --role <operator|requester|provider|reviewer> [--plan path]');
}
const plan = JSON.parse(await readFile(path.resolve(process.cwd(), planPath), 'utf8'));
const address = plan.principals?.[role];
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) {
  throw new Error(`Shared plan has no valid ${role} principal`);
}
const privateKey = process.env.COOO_AGENT_PRIVATE_KEY;
if (!privateKey) throw new Error('COOO_AGENT_PRIVATE_KEY is required for this agent process only');

const castOnWindows = process.platform === 'win32';
const castHelper = fileURLToPath(new URL('../devnet/cast-stdin.sh', import.meta.url));
const wslHelper = castHelper.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/');
const castCommand = process.env.COOO_CAST_COMMAND ?? (castOnWindows ? 'wsl.exe' : 'bash');
const commandPrefix = process.env.COOO_CAST_COMMAND
  ? process.env.COOO_CAST_PREFIX?.split(/\s+/).filter(Boolean) ?? []
  : castOnWindows
    ? ['-d', process.env.COOO_WSL_DISTRIBUTION ?? 'SEEDUbuntu', '--', wslHelper]
    : [castHelper];

const signer = new LocalCastSigner({
  expectedAddress: address,
  readPrivateKey: () => privateKey,
  castCommand,
  commandPrefix,
  timeoutMs: Number(process.env.COOO_SIGNER_TIMEOUT_MS ?? 60_000),
});

const sdk = new CoooSdk({
  rpcUrl: plan.rpcUrl,
  infoUrl: plan.infoUrl,
  stateUrl: plan.stateUrl,
  expectedLyquidId: plan.lyquidId,
  expectedContract: plan.contract,
  timeoutMs: 30_000,
});

const workflow = buildAgentHeldWorkflow({
  taskId: plan.taskId,
  operator: plan.principals.operator,
  requester: plan.principals.requester,
  provider: plan.principals.provider,
  reviewer: plan.principals.reviewer,
  evidenceDigest: plan.evidenceDigest,
  termsDigest: plan.termsDigest,
  deploymentTag: plan.deploymentTag,
});

const roleSteps = workflow.filter(step => step.principal === role);
const selectedSteps = stepLabel
  ? roleSteps.filter(step => step.label === stepLabel)
  : roleSteps;
if (stepLabel && selectedSteps.length !== 1) {
  throw new Error(`Step ${stepLabel} is not owned by ${role}`);
}

console.log(JSON.stringify({
  agent: role,
  address,
  taskId: plan.taskId,
  custody: 'caller-held local Cast test key; no platform custody',
  actions: selectedSteps.map(step => step.label),
}, null, 2));

for (const step of selectedSteps) {
  const before = await sdk.getState();
  const prior = (before.operations ?? []).find(operation =>
    operation.caller.toLowerCase() === address.toLowerCase() &&
    operation.operationId === step.operationId);
  if (prior) {
    if (!operationMatches(prior, step.expectedIntent)) {
      throw new Error(`${step.label}: operation ID already has a different intent`);
    }
    console.log(JSON.stringify({ agent: role, step: step.label, state: 'already_confirmed' }));
    continue;
  }

  const transaction = await sdk.prepareTransaction(step.method, address, step.types, step.values);
  const rawTransaction = await signer.signTransaction(transaction);
  const submission = await sdk.submitRawTransaction(rawTransaction, transaction.deployment);
  const confirmation = await sdk.waitForOperation(address, step.operationId, step.expectedIntent);
  if (!confirmation.state.ledger.conserved) {
    throw new Error(`${step.label}: ledger is not conserved`);
  }
  console.log(JSON.stringify({
    agent: role,
    step: step.label,
    submission: submission.status,
    transactionHash: submission.transactionHash,
    confirmedAction: confirmation.operation.action,
    applicationConfirmed: true,
  }));
}

const finalState = await sdk.getState();
const task = finalState.tasks.find(record => record.id === plan.taskId);
if (!finalState.ledger.conserved) {
  throw new Error(`${role} final ledger reconciliation failed`);
}
console.log(JSON.stringify({
  agent: role,
  state: 'agent_complete',
  taskPresent: Boolean(task),
  ledgerConserved: true,
}, null, 2));
