# Multi-node oracle certification runbook (observed on v0.8.1)

An operational, step-by-step runbook for validating oracle-based committee
certification on a multi-node Lyquor devnet: acquiring committee identities,
configuring and activating a two-phase oracle, executing a certification round,
capturing console evidence, and grading signer participation. It is the
template we used to answer the release-gate question "does threshold consensus
actually aggregate across real nodes?" with on-chain evidence.

## Scope

- **Observed on:** a 4-node Lyquor `multi` devnet (node image v0.8.1; host ports
  10087 / 11087 / 12087 / 13087 map to node1–node4), Foundry `cast` as the client,
  a tools container on the same Docker network for container-internal hostnames.
- **This repository currently ships a v0.8.0 single-node devnet.** Adapt host
  names/ports accordingly and re-verify each step on that stack; the sequence and
  the failure playbook below are the transferable parts.
- Evidence framing: commands are given in the form we executed them; grading
  criteria reference the exact console lines we graded against. Underlying
  transcripts live outside this repository.

## 0. Topology and identity probe

```sh
for p in 10087 11087 12087 13087; do
  curl -s --data '{}' -H 'content-type: application/json' \
    "http://127.0.0.1:$p/lyquor.node.v1.NodeService/GetNodeInfo"; echo
done
```

Expect one JSON response per node with a `nodeId` (`Node-…` form) and a version
string. Two facts worth recording at this point:

- **Node identity stability:** node ids were identical across container restarts
  in our runs, so the committee set can be cached per deployment — but re-read
  and diff them every run anyway (cheap, and catches a rebuilt cluster).
- **Host reachability of all four API ports** (this surprised us positively):
  direct `eth_call` from the host against every node's mapped port worked, so
  orchestration scripts do not need to route through the Docker network.

## 1. Committee acquisition (NodeID → bytes32)

Oracle configuration takes committee members as `bytes32`. The display-form
`Node-…` id decodes deterministically:

```python
import base64
def node_id_to_bytes32(nid: str) -> str:
    b = nid.split("Node-")[1].upper()
    b += "=" * ((8 - len(b) % 8) % 8)        # pad to base32 block
    raw = base64.b32decode(b)
    assert len(raw) == 35, len(raw)          # 32 id bytes + 3 checksum bytes
    return "0x" + raw[:32].hex()
```

Run this for all four ids and keep the ordered array — order is part of the
signer-index mapping you will rely on when grading (`signers RAW = [0, 2]` means
array positions 0 and 2).

## 2. Configure the committee and activate the epoch

Configuration only *stages* the committee; activation is a two-phase epoch
transition. In our measured runs the epoch methods had to run on the
**node-local execution channel** (`cast call`) — the sequenced channel silently
dropped their inner submissions (see `docs/lyquor-platform-notes.md`, item 3).

```sh
CTR=<contract>; PK=<deployer-key>; RPC=http://node1:10087/api

# stage: members + threshold (start with 2 to prove multi-signer aggregation
# before raising the bar to 4)
cast send $CTR "probe_configure(bytes32[],uint16)" "[<b32_1>,<b32_2>,<b32_3>,<b32_4>]" 2 \
  --private-key $PK --rpc-url $RPC

# derive the oracle TARGET (must be nonzero and DIFFERENT from the contract
# address; it addresses the LVM domain)
TARGET=$(docker exec multi-tools shaker to-hex <instance-name>)
echo "$TARGET"   # assert: non-zero, != $CTR

# activate phase 1 -> poll -> finalize  (ALL via cast call)
cast call $CTR "__lyquor_oracle_advance_epoch(string,address,bool) returns (bool)" \
  "cert_probe" $TARGET false --rpc-url $RPC          # expect: true
cast call $CTR "__lyquor_oracle_dest_epoch_info(string,bool) returns (uint64,bytes32,uint32,bytes)" \
  "cert_probe" true --rpc-url $RPC                    # epoch must advance
cast call $CTR "__lyquor_oracle_finalize_epoch(string,address,bool) returns (bool)" \
  "cert_probe" $TARGET false --rpc-url $RPC          # expect: true
```

Grading the activation: the destination epoch increments, the change count grows
by `members + 1` (four `AddNode` + one `SetThreshold`), and the config blob ends
with the threshold byte you set.

## 3. Execute a certification round and capture console evidence

Start the console capture **before** triggering the round, and trigger exactly
once from exactly one node:

```sh
# evidence channel: streaming console replay (rc=124 from timeout is the NORMAL
# way this command ends — it replays history and keeps streaming)
timeout 40 docker exec multi-tools shaker console <instance-name> \
  --endpoint ws://node1:10087/ws > round-console.log 2>&1 &

cast call $CTR "probe_run_round() returns (bool)" --rpc-url $RPC   # expect: true
```

**Single-shot discipline:** never re-trigger a round for the same target. Each
trigger starts an independent round; if the first round already moved the target
state (e.g. a dispute to a terminal verdict), later certified calls fail the
state guard by design. Idempotency rules do not protect you here — trigger
arithmetic is part of the protocol, not a retry policy.

## 4. Participation grading

Grade from the captured console lines (exact shapes we graded against):

| Check | Console line | Threshold-2 result | Threshold-4 result |
|---|---|---|---|
| Round submitted | `…certified call submitted to the sequencing backend` | ✓ | ✓ |
| Aggregation | `…aggregated round=N node=<id> from M input(s)` | M = 1 | M = 4 |
| **Signer set** | `cert.signers RAW = [i, j, …] (… len=K)` | `[0, 2]`, K=2 | `[0, 1, 2, 3]`, K=4 |
| Signer mapping | one `signer <i> -> Node-…` line per signer | 2 distinct nodes | 4 distinct nodes |

Grading ladder we used:

- **L2 (target form):** 4 proposals (`from 4 input(s)`) **and** 4 signers — a
  single trigger fans out via the protocol's broadcast, every committee node
  proposes and signs.
- **L1 (acceptable multi-node form):** 1 proposal + 4 signers — the signature
  set still spans all committee nodes.
- **L0 (platform limitation):** threshold > 1 never aggregates (signers stuck at
  1) — record honestly and fall back to single-signer delivery; do not present a
  single signature as committee-wide.

On the measured stack, threshold-2 aggregated two distinct node signatures and
threshold-4 aggregated all four — L2 was reached with one trigger.

## 5. Failure playbook

| Symptom | First checks |
|---|---|
| Epoch never advances after `cast send` of advance/finalize | You used the sequenced channel — rerun via `cast call` (local execution), then poll `dest_epoch_info` |
| Round returns `true` but console shows nothing | Console was started after the trigger (history replays on connect — re-capture, re-trigger on a **fresh** target), or wrong instance name in `shaker console` |
| `signers` stuck at 1 with threshold > 1 | Verify the staged members match the *current* node ids (rebuilt cluster changes them); re-check the config blob tail byte equals your threshold |
| Certified call lands but state guard rejects | First round already moved the target to a terminal state — by design; use a fresh target instead of re-triggering |
| `shaker to-hex` returns the contract address | It should not — TARGET addresses the LVM domain and differs from the contract address; re-derive before any epoch call |

## 6. Discipline list (the short version)

1. Epoch methods and round triggers: **`cast call` channel only**; receipts from
   the sequenced channel prove nothing here.
2. **One trigger per target.** Retries create new rounds, not idempotent replays.
3. Start console capture **before** triggering; `timeout` rc=124 is success.
4. Re-derive and assert `TARGET` (nonzero, ≠ contract) after every deploy —
   `shaker deploy` mints a fresh instance each time.
5. On Git Bash, prefix every `docker exec` / `docker cp` with
   `MSYS_NO_PATHCONV=1` and checksum-verify anything you copy into a container.
