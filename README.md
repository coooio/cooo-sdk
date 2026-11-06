# COOO SDK

`@cooo/sdk` is a typed, dependency-free ESM client for cooo workflows on Lyquor. It validates authoritative state, encodes protocol calls, prepares deployment-bound transactions, and reconciles exact operation intent.

Version `0.7.3` targets Node.js 22 or newer and does not support CommonJS.

## Install

```sh
npm install @cooo/sdk
```

## Connect to a deployment

```ts
import { CoooSdk } from '@cooo/sdk';

const sdk = new CoooSdk({
  rpcUrl: 'http://127.0.0.1:8080/lyquid/api',
  infoUrl: 'http://127.0.0.1:8080/lyquid/info',
  stateUrl: 'http://127.0.0.1:8080/api/state',
  expectedLyquidId: 'Lyquid-example',
  expectedContract: '0x0000000000000000000000000000000000000000',
});

const state = await sdk.getState();
if (!state.ledger.conserved) {
  throw new Error('Authoritative ledger is not conserved');
}
```

Mutations require both deployment pins. The SDK rediscovers and verifies the deployment before state reads and submissions.

Protocol identity:

```text
cooo-local-v0.3-terms-bound-review
```

See [docs/compatibility.md](docs/compatibility.md) for protocol, runtime, and deployment-pin policy.

## Run a reviewed-task workflow

Start the bundled local Lyquor devnet with [devnet/README.md](devnet/README.md), then run either:

- [Reviewed-task quickstart](docs/reviewed-task-quickstart.md) — one script controls four local test principals.
- [Independent agent walkthrough](docs/independent-agents.md) — every authoritative operation runs in a role-isolated process with a caller-held test key.

Both workflows confirm the exact caller, operation ID, action, amount, digest, and scopes in authoritative state.

## Confirm operations

A transaction hash only says that an endpoint accepted an envelope. Confirm the operation itself:

```ts
const submission = await sdk.submitRawTransaction(rawTransaction, transaction.deployment);

const confirmation = await sdk.waitForOperation(
  transaction.from,
  operationId,
  expectedIntent,
);

console.log(confirmation.operation);
```

If the same caller and operation ID committed a different payload, `waitForOperation` returns a changed-intent conflict.

## Use a caller-held signer

Provide a `transactionSender` to keep keys outside the SDK:

```ts
const sdk = new CoooSdk({
  rpcUrl: 'https://example.invalid/lyquid/api',
  infoUrl: 'https://example.invalid/lyquid/info',
  stateUrl: 'https://example.invalid/api/state',
  expectedLyquidId,
  expectedContract,
  transactionSender: async transaction => wallet.submit(transaction),
});
```

For local integration, `@cooo/sdk/local-cast-signer` wraps a caller-controlled Foundry Cast wallet and passes the key through stdin:

```ts
import { LocalCastSigner } from '@cooo/sdk/local-cast-signer';

const signer = new LocalCastSigner({
  expectedAddress,
  readPrivateKey: () => process.env.COOO_TEST_PRIVATE_KEY!,
  castCommand: 'cast',
});
```

## Cancellation and errors

Pass an `AbortSignal` to the constructor to cancel all requests. `waitForState` and `waitForOperation` also accept a per-call signal.

```ts
error.code;       // invalid_argument, http_error, rpc_error, timeout, state_validation, aborted
error.details;    // endpoint, status, deployment, and intent context
error.retryable;  // conservative transport-retry classification
```

A timeout or missing response is an unknown outcome. Reconcile authoritative state before retrying.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
```

Tests import generated files from `dist`, so build before running them after source changes. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
