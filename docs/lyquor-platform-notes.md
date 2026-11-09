# Lyquor Platform Notes — behaviors that bite Lyquid client developers

> Field notes from real four-node devnet runs (Lyquor multi v0.8.1, LDK 0.8.x), recorded while
> building and debugging an escrow-style Lyquid end to end. Every item below is backed by an
> archived experiment with verbatim commands and outputs; the receipt/channel quirks are platform
> properties, not contract bugs. Use this page as a troubleshooting index before suspecting your
> own client code — or the Lyquid.

All experiments below ran against a 4-node `multi` devnet stack (`lyquor-node` v0.8.1 ×4,
`lyquor-tools`, `anvil` sequencer, `registry`) with Foundry `cast` as the reference client.
Your versions may differ; re-verify before relying on a quirk in production.

## 1. `eth_estimateGas` reverts empty for Lyquid calls — always

`cast send` (which runs gas estimation first) fails at the estimation step with
`execution reverted, data 0x` for Lyquid contract calls **regardless of whether the call would
succeed** — even a guaranteed-success read like `deal_info` fails estimation. This looks exactly
like a contract revert but is not one.

**Consequence:** never build a client flow that depends on `eth_estimateGas`. Submit via
`eth_sendTransaction` without a gas field (the node auto-gases) or via raw envelopes with your
own gas budget, then confirm through state reads. The SDK's prepare → sign → submit pipeline
follows this rule by construction.

## 2. A receipt's `status: 0x1` means *sequenced*, not *method success*

The platform swallows method-level `Err` returns: a Lyquid method that returns `Err` (for example
an escrow `fund` rejected by an insufficient-balance precheck) still yields a receipt with
`status 0x1` and appears in a block. The sequenced transaction carries no revert data for this
class of failure.

**Consequence:** a transaction hash proves sequencing only. Treat state as the single source of
truth: after every send, read back the authoritative state (`getState` / the domain getter that
the operation affects) and assert the expected transition before proceeding. The SDK guide's
"the hash is a sequencing receipt" rule is this platform behavior, stated from the client side.

## 3. Some platform methods must run via the local-execution channel (`cast call`), or they silently no-op

For methods whose body performs an **inner asynchronous on-chain submission** — the oracle
two-phase epoch methods (`__lyquor_oracle_advance_epoch` / `__lyquor_oracle_finalize_epoch`) are
the measured example — submitting through the sequenced channel (`cast send`) returns
`status 0x1` while the inner submission is **silently dropped**: the destination epoch never
advances, block after block. The same call through the node-local execution channel
(`cast call`) takes effect within seconds.

**Consequence:** if an integration drives platform built-ins (oracle epochs, certification
rounds), use the local-execution channel for them and poll the destination state to confirm the
effect. A `status 0x1` receipt from these methods is not evidence that anything happened.

## 4. Instance-method `println` output is visible via `eth_call` only

`lyquid::println!` lines from **instance** methods are observable when the method runs via
`cast call` (the response or console surface carries them) but are **silent** when the same
method runs via `cast send`. Sequenced execution of instance methods produced no console lines
in the measured runs.

**Consequence:** when you use instance-method console output as an evidence channel (mode lines,
aggregation traces), drive it with `eth_call`. Never promise console evidence from a send path.

## 5. `eth_call` routing returns `FuncNotFound` for **mutating** methods — a channel property

Calling a mutating (state-changing) method through the read channel fails with
`Barrel(FuncNotFound)` even when the method exists and is exported. Reads (view/getter methods)
route normally; unknown methods fail at gas estimation on the send side instead. This was
confirmed as a channel property: the *same* exported method failed via `eth_call` and worked via
`eth_sendTransaction`.

**Consequence:** "FuncNotFound" on `eth_call` does **not** mean the method is missing or
unexported. Route reads to getters and writes through the send path, and treat a FuncNotFound on
a write method's call as expected behavior, not a regression.

## 6. Native instance triggers (`TriggerMode::Once`/`Recurrent`) never fired on the multi devnet

Registered native triggers (arm transactions accepted with `status 0x1`) never fired across
forced blocks, restarts, and a matrix of delays and recurrence periods on the 4-node v0.8.1
stack: zero observed firings in every experiment group. The measured conclusion was "native
triggers are NOT usable on this environment"; the shipped design used a polling keeper loop
instead (off-chain trigger; on-chain guard re-derives everything from consensus state).

**Consequence:** do not build background automation on native triggers without re-testing them
on your exact node version. A polling loop whose submissions are guarded by on-chain checks is
the robust pattern — duplicate or premature submissions are harmlessly rejected by the guard.

## Bonus: environment footguns that produced false test results

- **Git Bash path mangling:** `docker exec`/`docker cp` arguments containing `/tmp/...` are
  rewritten by MSYS and can silently target the wrong path (an `rm -rf` that "succeeds" without
  clearing, a `docker cp` that merges into a stale tree). Prefix docker subprocesses with
  `MSYS_NO_PATHCONV=1` and verify file identity with checksums (md5) after copy — a 0.67 s
  "build passed" that was actually a no-op cache hit on a stale tree was caught this way.
- **`shaker deploy` creates a brand-new instance every time** (new Lyquid id and contract
  address). Re-pinning state after any deploy is part of the workflow; never assume instance
  continuity across deploys.

## Provenance

These notes were produced while building and debugging an escrow Lyquid on a 4-node Lyquor
multi devnet (v0.8.1) during an affiliated university prototype project; verbatim commands,
transcripts, and the control experiments distinguishing platform behavior from contract bugs are
archived in that project's evidence logs. Cross-references (per item): ①② gas/receipt matrix
and channel decision gate; ③ oracle epoch SPIKE record; ④ console-relay limitation measurements;
⑤ same-selector cross-channel routing control; ⑥ trigger experiment matrix (zero-of-N arms,
restart replay, delay/recurrence groups).
