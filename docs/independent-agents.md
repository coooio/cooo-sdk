# Independent agent quickstart

This walkthrough runs the reviewed-task protocol with one separate Node.js process for each authoritative operation. Each process receives only its role principal address and caller-held local test key. It prepares one transaction, signs it with Foundry Cast, submits the raw envelope, and confirms the exact authoritative operation.

Process separation demonstrates the SDK's caller-held authority boundary. It does not prove that four organizations are independently operated, and it is not production key custody.

## Prerequisites

Complete [the local synthetic devnet](../devnet/README.md) and install Foundry Cast as part of Lyquor LDK 0.8.0. Build the SDK once:

```sh
npm ci --ignore-scripts
npm run build
```

The default signer path uses `devnet/cast-stdin.sh` so Cast receives the local test key through an interactive PTY and the key never appears in a process argument. On Windows this helper runs through `SEEDUbuntu` WSL; set `COOO_CAST_COMMAND`, `COOO_CAST_PREFIX`, `COOO_WSL_DISTRIBUTION`, or `COOO_CAST_BIN` for a different local Cast installation.

## Run four process-separated agents

Use four publicly known local Anvil/Hardhat devnet keys that control the first four accounts exposed by your Lyquor node. Never use real keys. In PowerShell:

```powershell
$env:COOO_OPERATOR_PRIVATE_KEY = "<operator-local-test-key>"
$env:COOO_REQUESTER_PRIVATE_KEY = "<requester-local-test-key>"
$env:COOO_PROVIDER_PRIVATE_KEY = "<provider-local-test-key>"
$env:COOO_REVIEWER_PRIVATE_KEY = "<reviewer-local-test-key>"
node devnet/run-independent-agents.mjs --new
```

In a POSIX shell:

```sh
export COOO_OPERATOR_PRIVATE_KEY='<operator-local-test-key>'
export COOO_REQUESTER_PRIVATE_KEY='<requester-local-test-key>'
export COOO_PROVIDER_PRIVATE_KEY='<provider-local-test-key>'
export COOO_REVIEWER_PRIVATE_KEY='<reviewer-local-test-key>'
node devnet/run-independent-agents.mjs --new
```

The coordinator first creates `.cooo-devnet/independent-plan.json` without any private key. It then starts four child processes in role order. Before each child starts, all four role keys are removed from that child's environment and only `COOO_AGENT_PRIVATE_KEY` for the selected role is injected.

Each child uses:

1. `prepareTransaction(...)` for an exact deployment-bound transaction.
2. `LocalCastSigner` to verify key control and sign locally.
3. `submitRawTransaction(...)` for an explicit submitted transport result.
4. `waitForOperation(...)` to confirm the exact caller, operation ID, action, task, amount, digest, and scopes.

No child uses unlocked `eth_sendTransaction`.

## Run agents on separate hosts

Copy the secret-free `independent-plan.json` to each operator. Each `steps` entry in that file gives the required role and step label. On the host responsible for a role, set only that role's key and execute the steps in the order listed in the plan:

```sh
COOO_AGENT_PRIVATE_KEY='<role-local-test-key>' \
node examples/independent-agent.mjs \
  --plan /path/to/independent-plan.json \
  --role <operator|requester|provider|reviewer> \
  --step <step-label-from-plan>
```

Each process can resume safely: it skips an already confirmed operation only when the exact authoritative intent matches and rejects a changed payload under the same caller and operation ID. Do not run a later state-machine step before its authoritative prerequisites are confirmed.

## Security boundary

The public Anvil/Hardhat keys are intentionally public test keys. They must never be used with real assets. The local Cast adapter is for synthetic integration and is not an HSM, browser wallet, cloud KMS, or enterprise custody service.
