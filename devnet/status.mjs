import { readFile } from 'node:fs/promises';

const expectedProtocol = 'cooo-local-v0.3-terms-bound-review';
const metadataPath = new URL('../.cooo-devnet/devnet.json', import.meta.url);
let metadata;
try {
  metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
} catch {
  console.error(JSON.stringify({ healthy: false, error: 'devnet metadata is missing; run devnet/start.sh' }));
  process.exit(1);
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

try {
  const [info, state] = await Promise.all([
    readJson(metadata.infoUrl),
    readJson(metadata.stateUrl),
  ]);
  const actualLyquidId = info.lyquid_id ?? info.lyquidId;
  const actualContract = info.backend_contract ?? info.contract;
  const deployment = state.deployment ?? {};
  const result = {
    healthy: actualLyquidId === metadata.lyquidId &&
      actualContract?.toLowerCase() === metadata.contract.toLowerCase() &&
      deployment.lyquidId === metadata.lyquidId &&
      deployment.protocolVersion === expectedProtocol &&
      state.ledger?.conserved === true,
    lyquidId: actualLyquidId,
    contract: actualContract,
    protocol: deployment.protocolVersion,
    ledgerConserved: state.ledger?.conserved === true,
    taskCount: state.tasks?.length ?? 0,
    operationCount: state.operations?.length ?? 0,
    synthetic: state.asset?.synthetic !== false,
    boundary: metadata.boundary,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.healthy || !result.synthetic) process.exit(1);
} catch (error) {
  console.error(JSON.stringify({
    healthy: false,
    lyquidId: metadata.lyquidId,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
