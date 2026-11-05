# Reviewed-task quickstart (local synthetic devnet)

This walkthrough runs the existing 13-operation agent-held example against a **compatible local Lyquor devnet**. It uses four distinct, unlocked test accounts to show who authorizes work, requests it, delivers it, and reviews it. The script confirms each operation in authoritative cooo state; a transaction hash alone is never treated as success.

The SDK repository supplies the client, this example, and the `cooo` Lyquid source in `backend/cooo-lyquid`. It does not vendor the Lyquor runtime or operating-system dependencies. Install Lyquor LDK and start the bundled deployment with [devnet/README.md](../devnet/README.md) before running the example. Keep this walkthrough on synthetic assets and loopback endpoints. Browser wallets, production signing, real funds, and multi-node validation are outside this walkthrough.

## 1. Prepare the SDK and accounts

Use Node.js 22 or newer. From the SDK repository root:

```sh
npm ci --ignore-scripts
npm run check
npm run build
```

Provision four **different** unlocked local accounts: `operator`, `requester`, `provider`, and `reviewer`. The requester must be able to fund the synthetic task; each account must be able to submit its own local transaction. Do not put real private keys in `.env`, issues, logs, or this repository. The `operator` only grants provider and reviewer authority; it is not the requester or a matchmaking service.

Copy `examples/reviewed-task.env.example` to `.env` in the repository root and replace the placeholders with values from **your local deployment**. In particular:

| Setting | Meaning |
| --- | --- |
| `COOO_RPC_URL`, `COOO_INFO_URL`, `COOO_STATE_URL` | The three compatible local endpoints. The template uses the paths shown in the main README. |
| `COOO_LYQUID_ID`, `COOO_CONTRACT` | Expected deployment identity and contract address. Mutations require both pins; do not guess them. |
| `COOO_OPERATOR`, `COOO_REQUESTER`, `COOO_PROVIDER`, `COOO_REVIEWER` | Four distinct unlocked test-account addresses. |
| `COOO_TASK_ID` | A new task ID for a first run. Keep it unchanged if resuming the same run. |
| `COOO_DEADLINE` | A future ISO-8601 timestamp. Keep it unchanged when resuming because it is included in the terms digest. |
| `COOO_EVIDENCE_FILE` | Optional path to the delivered file. By default the script hashes `examples/reviewed-task-evidence.txt`. Keep the bytes unchanged when resuming. |

The fixture represents only synthetic evidence. The example's terms use 100 integer protocol units: 90 for the provider and 10 for the reviewer. These numbers are **not** a claim of 100 dollars or any other real asset.

Before submitting anything, the script calls `getState()` and checks the ledger conservation flag and, when present, the synthetic-asset flag. The SDK also checks the expected Lyquid ID, contract, and protocol identity. If these checks fail, correct the deployment or configuration rather than bypassing them.

## 2. Run the workflow

Node.js 22 supports `--env-file`. From the SDK repository root:

```sh
node --env-file=.env examples/reviewed-task-quickstart.mjs
```

The script hashes the **exact evidence file bytes** with SHA-256. It also hashes one fixed set of task terms, including the deadline, using `agentHeldTermsDigest()` from `examples/agent-held-workflow.mjs`. It prints both digests before the first transaction. Retain the file and term values so another participant can recompute them.

The script invokes the SDK's typed methods in this order. After each submission, `waitForOperation()` checks the exact caller, operation ID, action, task, counterparty, amount, fee, digest, and scopes recorded by authoritative state. The `confirmedAction` values below come from the existing agent-held workflow example.

| Step | Caller | SDK method | Confirmed result |
| --- | --- | --- | --- |
| 1. Fund | Requester | `deposit` | Action `0`; amount `100` |
| 2. Admit provider | Operator | `grantAuthority` | Action `8`; provider has `work:data` scope |
| 3. Admit reviewer | Operator | `grantAuthority` | Action `8`; reviewer has `verify:work:data` scope |
| 4. Bind reviewed terms | Requester | `createReviewedTask` | Action `27`; task ID, evidence digest, terms version `1`, and terms digest match |
| 5. Assign provider | Requester | `assignProvider` | Action `9`; provider amount `90` and evidence digest match |
| 6. Assign reviewer | Requester | `assignVerifier` | Action `15`; reviewer reward `10` |
| 7. Dispatch work | Provider | `dispatchProvider` | Action `10`; correct task and provider |
| 8. Deliver evidence | Provider | `deliverProvider` | Action `11`; delivered digest equals the agreed evidence digest |
| 9. Record review | Reviewer | `submitVerifierResult` | Action `16`; terms and evidence digests match; synthetic example submits `approved=true` |
| 10. Accept work | Requester | `acceptProvider` | Action `12`; correct task and provider |
| 11. Pay provider | Provider | `withdrawProvider` | Action `13`; provider claim amount `90` |
| 12. Pay reviewer | Reviewer | `withdrawVerifierReward` | Action `17`; reviewer claim amount `10` |
| 13. Close remainder | Requester | `cancel` | Action `6`; root task operation is recorded |

Each successful line prints the step name, returned transaction hash, confirmed action, and current task object. The final line should read `Confirmed 13 exact operations for <task ID>`, and the final authoritative state must still contain the task with `ledger.conserved === true`. Inspect `tasks`, `verifications`, balances, and payment state in the printed state if you need to make a stronger claim about approval or settlement. The operation record does not itself contain the reviewer's `approved` boolean.

This is a **single-node synthetic protocol walkthrough**. The script controls all four unlocked test roles to exercise the state machine. It does not establish that an independent reviewer judged the work quality, that the evidence remains available elsewhere, or that a distributed deployment reached consensus.

## 3. Diagnose a failed or uncertain step

| Symptom | Check |
| --- | --- |
| `trusted mutations require both ... deployment pins` or deployment mismatch | Set the exact local Lyquid ID and contract from the running deployment. The SDK deliberately rejects a different identity. |
| `unlocked submission is restricted to loopback` | This script only supports unlocked accounts on a loopback devnet. A remote endpoint needs a caller-held `transactionSender`; see the main README. |
| HTTP/RPC timeout, missing hash, or interrupted process | Treat the outcome as unknown. Inspect authoritative state for the **same caller and operation ID** before retrying. The script checks existing operations on resume, but do not rerun while the prior transaction may still be pending. |
| `operation ID already has a different intent` | The task ID was reused with different terms, evidence bytes, role addresses, or deployment identity. Do not overwrite it. Start a genuinely new task ID, or restore the original inputs. |
| `authoritative operation intent does not match` | Inspect the actual and expected intent; a hash match alone cannot repair a wrong amount, role, or scope. |
| Review or settlement does not complete | Inspect the current task and verification state. Confirm role authority, evidence digest, terms digest, and the exact preceding operation. Do not infer business success from a transaction hash. |

For exact method signatures and error codes, see [`docs/api.md`](api.md). For the full protocol and runtime boundary, see [`docs/compatibility.md`](compatibility.md). The example plan and its focused tests are in [`examples/agent-held-workflow.mjs`](../examples/agent-held-workflow.mjs) and [`test/agent-held-workflow.test.mjs`](../test/agent-held-workflow.test.mjs).
