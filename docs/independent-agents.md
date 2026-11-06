# Independent agent quickstart

This walkthrough assigns every authoritative operation to a separate Node.js process. Each process receives one role address and one caller-held local test key, prepares a deployment-bound transaction, signs it with Foundry Cast, submits the raw envelope, and confirms the exact authoritative operation.

## Prerequisites

Start [the local devnet](../devnet/README.md), then build the SDK:

```sh
npm ci --ignore-scripts
npm run build
```

The default signer path uses `devnet/cast-stdin.sh`, which passes the key to Cast through an interactive PTY and never places it in a process argument. On Windows, the helper runs through `SEEDUbuntu` WSL. Set `COOO_CAST_COMMAND`, `COOO_CAST_PREFIX`, `COOO_WSL_DISTRIBUTION`, or `COOO_CAST_BIN` to use another local Cast installation.

## Run the workflow

Use four publicly known local Anvil/Hardhat test keys that control the first four accounts exposed by the node.

```sh
export COOO_OPERATOR_PRIVATE_KEY='<operator-test-key>'
export COOO_REQUESTER_PRIVATE_KEY='<requester-test-key>'
export COOO_PROVIDER_PRIVATE_KEY='<provider-test-key>'
export COOO_REVIEWER_PRIVATE_KEY='<reviewer-test-key>'
node devnet/run-independent-agents.mjs --new
```

PowerShell users can assign the same four environment variables before running the command.

The coordinator writes a secret-free `.cooo-devnet/independent-plan.json`, then launches one child process for each of the 13 plan steps in protocol order. Every child receives only `COOO_AGENT_PRIVATE_KEY` for its role.

Each child uses:

1. `prepareTransaction(...)`.
2. `LocalCastSigner`.
3. `submitRawTransaction(...)`.
4. `waitForOperation(...)`.

No child uses unlocked `eth_sendTransaction`.

## Separate hosts

Copy `independent-plan.json` to each operator. Each `steps` entry identifies the role and step label:

```sh
COOO_AGENT_PRIVATE_KEY='<role-test-key>' \
node examples/independent-agent.mjs \
  --plan /path/to/independent-plan.json \
  --role <operator|requester|provider|reviewer> \
  --step <step-label>
```

Run the steps in the order listed in the plan. A process skips an operation only after exact authoritative intent matching; the same caller and operation ID with a different payload is rejected.

Use only public local test keys. Keys remain with the agent operator and are never sent to the SDK.
