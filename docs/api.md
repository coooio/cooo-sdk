# API overview

All SDK operations are asynchronous. Generated TypeScript declarations provide the exact parameter signatures. Monetary values are decimal strings in authoritative state and `bigint` in SDK arguments; digests are 32-byte hexadecimal strings; addresses are 20-byte hexadecimal strings.

## Client

```ts
import { CoooSdk } from '@cooo/sdk';

const sdk = new CoooSdk({
  rpcUrl,
  infoUrl,
  stateUrl,
  expectedLyquidId,
  expectedContract,
  timeoutMs: 30_000,
  signal: controller.signal,
  transactionSender: async transaction => wallet.submit(transaction),
});
```

`expectedLyquidId` and `expectedContract` are required for mutation-capable clients and caller-held signing. `fetchImpl` remains available for controlled integration testing.

## Reads and reconciliation

| Method | Purpose |
| --- | --- |
| `discover()` | Read Lyquid metadata and bind the contract address. |
| `getState()` | Read and validate authoritative state. |
| `waitForState(predicate, timeoutMs?, intervalMs?, signal?)` | Poll validated authoritative state. |
| `waitForOperation(caller, operationId, expectedIntent, ...)` | Confirm an exact caller and payload intent. |
| `operationMatches(actual, expected)` | Compare an authoritative operation with a partial expected intent. |
| `findExactOperation(state, caller, operationId, expectedIntent)` | Find an exact operation in a state object. |

## Transactions

| Method | Purpose |
| --- | --- |
| `prepareTransaction(method, from, types, values)` | Build a deployment-bound legacy transaction. |
| `sendRawTransaction(rawTransaction, expectedDeployment?)` | Submit a signed envelope and return its transaction hash. |
| `submitRawTransaction(rawTransaction, expectedDeployment?)` | Return an explicit `{ status: "submitted", transactionHash }` result. |

A returned hash is not application success. Confirm authoritative state or the exact operation before treating work as complete.

## Protocol operations

| Method | Caller |
| --- | --- |
| `deposit(from, operationId, amount)` | Payer |
| `grantAuthority(from, operationId, provider, scopes)` | Operator |
| `createTask(...)` | Payer |
| `createReviewedTask(...)` | Requester |
| `allocateChild(...)` | Provider |
| `assignProvider(...)` | Requester |
| `dispatchProvider(...)` | Provider |
| `deliverProvider(...)` | Provider |
| `acceptProvider(...)` | Requester |
| `withdrawProvider(...)` | Provider |
| `assignVerifier(...)` | Requester |
| `submitVerifierResult(...)` | Reviewer |
| `revokeReviewer(...)` | Requester |
| `withdrawVerifierReward(...)` | Reviewer |
| `dispatchTask(...)` / `deliverTask(...)` / `acceptTask(...)` / `withdrawTask(...)` | Root task participants |
| `cancel(from, operationId, taskId)` | Payer |
| `send(method, from, types, values)` | Local development escape hatch |

Typed wrappers perform argument validation and ABI encoding. Avoid the low-level `send` escape hatch when a typed method exists.

## Errors

`CoooSdkError` has:

- `code`: `invalid_argument`, `http_error`, `rpc_error`, `timeout`, `state_validation`, or `aborted`.
- `details`: immutable endpoint, status, deployment, and operation context where available.
- `retryable`: conservative transport-only retry classification.

Unknown outcomes require reconciliation with the original operation ID. Do not blindly resubmit.

