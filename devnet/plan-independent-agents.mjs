import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile as readFileFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentHeldTerms, agentHeldTermsDigest, buildAgentHeldWorkflow } from '../examples/agent-held-workflow.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const metadataPath = path.join(root, '.cooo-devnet', 'devnet.json');
const metadata = JSON.parse(await readFileFile(metadataPath, 'utf8'));
const roles = Object.freeze(['operator', 'requester', 'provider', 'reviewer']);


async function rpc(method, params) {
  const response = await fetch(metadata.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? 'JSON-RPC error');
  return payload.result;
}

const info = await fetch(metadata.infoUrl, { signal: AbortSignal.timeout(3000) }).then(async response => {
  if (!response.ok) throw new Error(`Lyquid info returned HTTP ${response.status}`);
  return response.json();
});
const state = await fetch(metadata.stateUrl, { signal: AbortSignal.timeout(3000) }).then(async response => {
  if (!response.ok) throw new Error(`Lyquid state returned HTTP ${response.status}`);
  return response.json();
});
const lyquidId = info.lyquid_id ?? info.lyquidId;
const contract = info.backend_contract ?? info.contract;
if (lyquidId !== metadata.lyquidId || contract.toLowerCase() !== metadata.contract.toLowerCase()) {
  throw new Error('Active deployment does not match the generated devnet metadata');
}
if (state.deployment?.protocolVersion !== 'cooo-local-v0.3-terms-bound-review' || state.ledger?.conserved !== true) {
  throw new Error('Active deployment is not a conserved cooo synthetic deployment');
}

const accounts = await rpc('eth_accounts', []);
if (!Array.isArray(accounts) || accounts.length < roles.length) {
  throw new Error('The local devnet must expose at least four funded test accounts');
}
const principals = Object.fromEntries(roles.map((role, index) => [role, accounts[index]]));
if (new Set(Object.values(principals).map(address => address.toLowerCase())).size !== roles.length) {
  throw new Error('Agent principals must be distinct');
}

const taskId = `independent-${randomBytes(6).toString('hex')}`;
const evidence = `${taskId}:caller-held independent-agent evidence`;
const evidenceDigest = `0x${createHash('sha256').update(evidence).digest('hex')}`;
const terms = agentHeldTerms({
  requester: principals.requester,
  provider: principals.provider,
  reviewer: principals.reviewer,
  evidenceDigest,
});
const termsDigest = agentHeldTermsDigest(terms);
const deploymentTag = createHash('sha256')
  .update(`${lyquidId}:${contract.toLowerCase()}:cooo-local-v0.3-terms-bound-review`)
  .digest('hex')
  .slice(0, 12);
const workflow = buildAgentHeldWorkflow({
  taskId,
  operator: principals.operator,
  requester: principals.requester,
  provider: principals.provider,
  reviewer: principals.reviewer,
  evidenceDigest,
  termsDigest,
  deploymentTag,
});

const plan = {
  boundary: 'synthetic local single-node devnet; caller-held test keys; process-separated agents',
  taskId,
  rpcUrl: metadata.rpcUrl,
  infoUrl: metadata.infoUrl,
  stateUrl: metadata.stateUrl,
  lyquidId,
  contract,
  protocol: 'cooo-local-v0.3-terms-bound-review',
  deploymentTag,
  principals,
  evidence,
  evidenceDigest,
  terms,
  termsDigest,
  steps: workflow.map(step => ({ role: step.principal, label: step.label })),
};

const planPath = path.join(root, '.cooo-devnet', 'independent-plan.json');
await mkdir(path.dirname(planPath), { recursive: true });
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ planPath, taskId, principals, evidenceDigest, termsDigest }, null, 2));
