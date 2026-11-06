# Reviewed-task quickstart

This walkthrough runs a 13-operation requester, provider, and reviewer workflow against the bundled local Lyquor devnet. It uses four distinct unlocked test accounts and confirms every operation in authoritative state.

Start the devnet as described in [devnet/README.md](../devnet/README.md), then run:

```sh
npm ci --ignore-scripts
npm run build
node --env-file=.env examples/reviewed-task-quickstart.mjs
```

The devnet runner can generate `.env` automatically. To configure a deployment manually, copy `examples/reviewed-task.env.example` and set the three endpoints, both deployment pins, four principal addresses, a unique task ID, and a future deadline.

## Workflow

| Step | Caller | SDK method |
| --- | --- | --- |
| 1 | Requester | `deposit` |
| 2 | Operator | `grantAuthority` |
| 3 | Operator | `grantAuthority` |
| 4 | Requester | `createReviewedTask` |
| 5 | Requester | `assignProvider` |
| 6 | Requester | `assignVerifier` |
| 7 | Provider | `dispatchProvider` |
| 8 | Provider | `deliverProvider` |
| 9 | Reviewer | `submitVerifierResult` |
| 10 | Requester | `acceptProvider` |
| 11 | Provider | `withdrawProvider` |
| 12 | Reviewer | `withdrawVerifierReward` |
| 13 | Requester | `cancel` |

The example hashes the exact evidence bytes and canonical task terms before the first transaction. Each submission is followed by `waitForOperation(...)`, which checks caller, operation ID, action, task, counterparty, amount, digest, and scopes.

The final line is:

```text
Confirmed 13 exact operations for <task ID>
```

The final state must contain the task and report `ledger.conserved === true`.

## Recovery

If a response is lost or the process stops, inspect authoritative state for the same caller and operation ID before retrying. The example skips an operation only when its authoritative intent matches exactly and rejects a changed payload.

For signatures and error codes, see [api.md](api.md). For protocol requirements, see [compatibility.md](compatibility.md).
