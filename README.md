# COOO SDK

`@cooo/sdk` is a typed, dependency-free ESM client for cooo workflows on Lyquor. It validates authoritative state, encodes protocol calls, prepares deployment-bound transactions, and reconciles exact operation intent.

Version `0.7.1` targets Node.js 22 or newer and does not support CommonJS.

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

Trusted mutations require both deployment pins. The SDK rediscovers and verifies the deployment before state reads and submissions.

See [docs/compatibility.md](docs/compatibility.md) for protocol, runtime, and deployment-pin policy. The protocol identity is:

```text
cooo-local-v0.3-terms-bound-review
```

## Run a reviewed-task walkthrough

For a reproducible local synthetic Lyquor devnet, see [devnet/README.md](devnet/README.md), then follow [the reviewed-task quickstart](docs/reviewed-task-quickstart.md). It runs the requester, provider, and reviewer workflow with distinct test accounts, confirms each exact operation in authoritative state, and explains how to diagnose uncertain outcomes. The example requires a compatible local Lyquid deployment and does not use real assets.

## Confirm operations

A transaction hash only shows that an envelope was accepted by the endpoint. It is not application success. Confirm the authoritative operation:

```ts
const submission = await sdk.submitRawTransaction(rawTransaction, transaction.deployment);

const confirmation = await sdk.waitForOperation(
  transaction.from,
  operationId,
  expectedIntent,
);

console.log(confirmation.operation);
```

`waitForOperation` matches caller, operation ID, action, task, counterparty, amount, fee, digest, and scopes. If the same caller and operation ID committed a different payload, it returns a changed-intent conflict.

## Use a caller-held signer

Provide a `transactionSender` to keep keys outside the SDK:

```ts
const sdk = new CoooSdk({
  rpcUrl: 'https://example.invalid/lyquid/api',
  infoUrl: 'https://example.invalid/lyquid/info',
  stateUrl: 'https://example.invalid/api/state',
  expectedLyquidId,
  expectedContract,
  transactionSender: async transaction => {
    // Verify consent, chain, recipient, gas, and deployment identity.
    return wallet.submit(transaction);
  },
});
```

The SDK does not provide custody, a production wallet adapter, or a consent system.

For local synthetic integration, `@cooo/sdk/local-cast-signer` wraps a caller-controlled Foundry Cast wallet and passes the key through stdin:

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

`CoooSdkError` exposes:

```ts
error.code;       // invalid_argument, http_error, rpc_error, timeout, state_validation, aborted
error.details;    // immutable endpoint, status, deployment, and intent context
error.retryable;  // conservative transport-retry classification
```

A timeout or unknown response is not proof that an operation failed. Reconcile the exact operation intent before retrying.

## API reference

See [docs/api.md](docs/api.md) for the method overview; generated TypeScript declarations provide the exact signatures.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
```

Tests import generated files from `dist`, so build before running them after source changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for pull-request expectations and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[MIT](LICENSE)
