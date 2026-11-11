# Lyquor platform observations (v0.8.1 multi-node)

Operational notes for client developers integrating with a Lyquor Lyquid, collected
while building and debugging an escrow-style contract against a live devnet. Each
entry states the observed behavior, the environment it was observed on, and the
client-side consequence we adopted.

## Scope

- **Observed on:** a 4-node Lyquor `multi` devnet stack, node image v0.8.1
  (`lyquor-node` ×4, `lyquor-tools`, `anvil` sequencer, `registry`), using Foundry
  `cast` as the reference client.
- **This repository currently ships and tests a v0.8.0 single-node devnet.** The
  behaviors below have *not* been re-verified against that stack; until they are,
  treat them as reported field notes from a closely related environment, not as
  version-independent platform guarantees.
- The underlying transcripts and control experiments are not part of this
  repository. Minimal reproduction commands for any entry are a welcome
  contribution.

## 1. `eth_estimateGas` reverted empty on every measured Lyquid call

Across every Lyquid call we measured — including calls that provably succeed when
submitted — gas estimation failed with `execution reverted` and empty data. This
resembles a contract revert but was not one.

**Consequence:** do not build client flows that depend on `eth_estimateGas`. Submit
via `eth_sendTransaction` without a gas field (the node auto-gases) or via raw
envelopes with an explicit budget, then confirm the effect through state reads. The
SDK's prepare → sign → submit pipeline follows this rule by construction.

## 2. A receipt's `status: 0x1` meant *sequenced*, not *method success*

The platform swallowed method-level `Err` returns: a Lyquid method returning `Err`
(for example an escrow `fund` rejected by an insufficient-balance precheck) still
produced a receipt with `status 0x1` and a block placement, with no revert data.

**Consequence:** a transaction hash proves sequencing only. After every send, read
back the authoritative state and assert the expected transition before proceeding.
The SDK guide's "the hash is a sequencing receipt" rule reflects this behavior.

## 3. Inner-async platform methods took effect only via the local-execution channel

For methods whose body performs an inner asynchronous on-chain submission — the
oracle two-phase epoch methods (`__lyquor_oracle_advance_epoch` /
`__lyquor_oracle_finalize_epoch`) are the measured example — submitting through the
sequenced channel returned `status 0x1` while the inner submission was silently
dropped: the destination epoch never advanced across many blocks. The same call
through the node-local execution channel (`cast call`) took effect within seconds.

**Consequence:** when driving platform built-ins (oracle epochs, certification
rounds), use the local-execution channel and poll the destination state to confirm
the effect. A `status 0x1` receipt from these methods is not evidence that anything
happened.

## 4. Instance-method `println` output was observable via `eth_call` only

Console lines emitted by **instance** methods appeared when the method ran via
`cast call`, and did not appear when the same method ran via `cast send` in our
measurements.

**Consequence:** when using instance-method console output as an evidence channel,
drive it with `eth_call`; do not promise console evidence from a send path.

## 5. `eth_call` routing returned `FuncNotFound` for **mutating** methods

Calling a state-changing method through the read channel failed with
`Barrel(FuncNotFound)` even though the method existed and was exported; the same
method submitted through the send path executed normally. Reads (getters) routed
normally.

**Consequence:** `FuncNotFound` on `eth_call` does not indicate a missing or
unexported method. Route reads to getters and writes through the send path, and
treat this response on a write method as expected rather than as a regression.

## 6. Native instance triggers never fired on the measured stack

Registered native triggers (`TriggerMode::Once` / `Recurrent`; arm transactions
accepted with `status 0x1`) produced zero firings across forced blocks, node
restarts, and a matrix of delays and recurrence periods. We stopped relying on them
and shipped a polling keeper loop instead (off-chain trigger; the on-chain guard
re-derives everything from consensus state, so duplicate or premature submissions
are harmlessly rejected).

**Consequence:** re-test native triggers on your exact node version before building
background automation on them; a polling loop behind on-chain guards is the robust
pattern.

## Environment notes

Two environment issues produced misleading results during the same work and are
worth guarding against in any Docker-based workflow:

- **Git Bash path mangling:** `docker exec` / `docker cp` arguments containing
  `/tmp/...` were rewritten by MSYS, silently targeting the wrong path (an `rm -rf`
  that "succeeded" without clearing; a `docker cp` that merged into a stale tree).
  Prefix docker subprocesses with `MSYS_NO_PATHCONV=1` and verify copied file
  identity with checksums — this pattern caught a 0.67 s "build passed" that was
  actually a no-op cache hit on a stale tree.
- **`shaker deploy` creates a new instance on every invocation** (new Lyquid id and
  contract address). Re-pin state after every deploy; never assume instance
  continuity.

## Provenance

Recorded while building and debugging an escrow-style Lyquid on a 4-node Lyquor
multi devnet (v0.8.1). The verbatim commands, transcripts, and control experiments
separating platform behavior from contract bugs are archived outside this
repository; minimal reproduction scripts for any entry are welcome as follow-up
contributions.
