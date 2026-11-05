import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const roles = Object.freeze(['operator', 'requester', 'provider', 'reviewer']);
const newPlan = process.argv.includes('--new');
const planPath = path.join(root, '.cooo-devnet', 'independent-plan.json');

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

if (!existsSync(planPath) || newPlan) {
  await run(process.execPath, ['devnet/plan-independent-agents.mjs', '--new']);
}

const suppliedKeys = Object.fromEntries(roles.map(role => {
  const key = process.env[`COOO_${role.toUpperCase()}_PRIVATE_KEY`];
  if (!key) throw new Error(`Set COOO_${role.toUpperCase()}_PRIVATE_KEY in the operator shell; it is passed only to that agent child process`);
  return [role, key];
}));

const sanitizedEnv = { ...process.env };
for (const role of roles) delete sanitizedEnv[`COOO_${role.toUpperCase()}_PRIVATE_KEY`];
delete sanitizedEnv.COOO_AGENT_PRIVATE_KEY;

const plan = JSON.parse(await readFile(planPath, 'utf8'));
console.log(JSON.stringify({
  boundary: 'one separate Node process per authoritative step on one local test host',
  planPath,
  taskId: plan.taskId,
  stepCount: plan.steps.length,
}, null, 2));

for (const step of plan.steps) {
  const childEnv = {
    ...sanitizedEnv,
    COOO_AGENT_PRIVATE_KEY: suppliedKeys[step.role],
  };
  console.log(`Starting independent ${step.role} process for ${step.label}...`);
  await run(process.execPath, [
    'examples/independent-agent.mjs',
    '--plan', planPath,
    '--role', step.role,
    '--step', step.label,
  ], childEnv);
}

const finalState = await fetch(plan.stateUrl, { signal: AbortSignal.timeout(3000) }).then(async response => {
  if (!response.ok) throw new Error(`Final state read returned HTTP ${response.status}`);
  return response.json();
});
if (!finalState.tasks?.some(task => task.id === plan.taskId) || finalState.ledger?.conserved !== true) {
  throw new Error('Final independent-agent task or ledger reconciliation failed');
}
console.log(JSON.stringify({
  taskId: plan.taskId,
  taskPresent: true,
  ledgerConserved: true,
  operationCount: finalState.operations?.length ?? 0,
}, null, 2));

await run(process.execPath, ['devnet/status.mjs']);
