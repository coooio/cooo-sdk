# Operation recovery guide

A timeout, dropped response, process exit, or transport failure after submission is an **unknown outcome**. The transaction might or might not be committed. Do not infer success from a transaction hash and do not immediately submit a new operation ID.

Recovery uses four stable values:

1. The authoritative caller address.
2. The original operation ID.
3. The exact expected operation intent.
4. The pinned Lyquid and contract identity.

If all four match authoritative state, the operation is already confirmed. If the same caller and operation ID committed another payload, the retry is a changed-intent conflict. If no matching operation exists, only then consider submitting again.

## Recovery matrix

| Outcome | Meaning | Safe action |
| --- | --- | --- |
| `timeout`, network reset, process exit after submit | Unknown outcome | Read authoritative state and reconcile the exact intent. |
| Exact operation found | The operation is committed | Continue to the next business step. |
| Same caller and operation ID with another payload | Changed-intent conflict | Stop; inspect the original intent and do not overwrite the ID. |
| signer failed before submission | No authoritative submission | Rebuild the transaction from the same intent and retry. |
| HTTP 408, 425, 429, 500, 502, 503, or 504 | Potentially retryable transport failure | Reconcile first; only then retry the transport if no operation exists. |
| Other HTTP or protocol rejection | Request was rejected | Fix the caller, payload, permissions, or terms before trying again. |
| Deployment identity changed | Cross-deployment replay risk | Stop and bind explicitly to the intended deployment. |
| Ledger not conserved | Authoritative invariant failure | Stop and investigate; do not continue settlement. |

A transaction hash is only a sequencing receipt. Application success is the matching authoritative operation and the expected state transition.

## Two-process local example

[`examples/operation-recovery.mjs`](../examples/operation-recovery.mjs) separates submission from confirmation. It uses a synthetic local unlocked account and the same `deposit` intent on both runs.

Build the SDK, start [the local devnet](../devnet/README.md), and export its endpoint and identity variables. Then submit once and exit before confirmation:

```sh
COOO_CALLER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
COOO_OPERATION_ID=recovery-demo-1 \
COOO_AMOUNT=1 \
node examples/operation-recovery.mjs --submit-only
```

Run the same command without `--submit-only`. The process reads authoritative state first, finds the exact operation, and reports `already-confirmed`; it does not submit a second deposit.

If the first process loses the response after the node accepts the transaction, it exits with an unknown-outcome error. Re-running the same command still reconciles the committed operation. Use a new operation ID only after authoritative state confirms that the original intent was not committed.

## In an agent process

Use the same sequence with caller-held signing:

1. Load the caller, operation ID, and expected intent from a durable plan.
2. Prepare a deployment-bound transaction.
3. Sign and submit with the caller's external signer.
4. Confirm with `waitForOperation(caller, operationId, expectedIntent)`.
5. Persist only authoritative confirmation, not the transaction hash as business success.

On restart, perform the state lookup before building or submitting another envelope. The existing independent-agent example follows this ordering.

## Production boundary

The local recovery example intentionally uses an unlocked synthetic account on loopback. Production agents must provide `transactionSender`, keep keys outside the SDK, pin the deployment identity, and treat every missing response as unknown until authoritative state resolves it.