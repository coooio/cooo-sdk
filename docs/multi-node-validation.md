# Four-node oracle certification field notes (Lyquor v0.8.1)

This page records a collaborator-operated validation of oracle-based committee
certification on an external four-node Lyquor devnet. It explains how node
identities were acquired, how the committee and epoch were configured, how a
certification round was triggered, and how signer participation was graded. It
is engineering evidence from a controlled prototype, not an automated test in
this repository.

The observation is valuable because cooo's independent acceptance model needs
authority and verdict aggregation to extend beyond one operator or one node. It
does not by itself establish a production multi-node deployment, a public SDK
runtime guarantee, or a release gate.

## Scope and evidence status

- **Observed environment:** a four-node Lyquor `multi` devnet with node image
  `v0.8.1`; host ports `10087`, `11087`, `12087`, and `13087` mapped to node1
  through node4. Foundry `cast` was the client and a tools container on the same
  Docker network supplied container-internal hostnames.
- **Provenance:** the procedure and results were supplied by a trusted project
  collaborator. The underlying transcripts and control experiments remain
  outside this repository.
- **Supported repository runtime:** this repository ships and tests a Lyquor
  `0.8.0` single-node devnet. The four-node procedure has not been turned into a
  fixture, script, or CI job here.
- **Evidence classification:** reported field notes. Console replay and direct
  state inspection were used during the observed session. Console text is an
  observation channel, not authoritative evidence by itself; a future release
  gate must assert the relevant state directly and reproduce the result from a
  clean deployment.
- **Security note:** one archival command below reflects the observed use of
  `cast --private-key`. Do not copy that pattern into reusable automation. Keep
  keys caller-held, avoid process arguments and shell history, and use a
  secret-backed signer flow.

These limitations do not invalidate the observation; they define what may be
claimed from it.

## Engineering significance

The measured threshold behavior showed that certification was not confined to a
single signer. At threshold two, two distinct node signatures aggregated. At
threshold four, all four node signatures aggregated. For cooo, that is an
important early signal that Lyquor's oracle committee model can represent
independent acceptance authority across multiple nodes.

The next engineering step is to turn this procedure into a reproducible
multi-node fixture with authoritative-state assertions, safer signing, stable
node identity checks, and CI integration. Until that exists, this document
supports roadmap and due-diligence discussion rather than a supported runtime
claim.

## 0. Topology and identity probe

```sh
for p in 10087 11087 12087 13087; do
  curl -s --data '{}' -H 'content-type: application/json' \
    "http://127.0.0.1:$p/lyquor.node.v1.NodeService/GetNodeInfo"; echo
done
```

Each node returned a JSON object with a `nodeId` in the `Node-…` form and a
version string. Two properties were checked before treating the topology as
stable:

- **Node identity stability:** node ids were identical across container
  restarts in the observed runs, so a committee set can be cached for a
  deployment. Re-read and compare the ids on every run anyway; a rebuilt cluster
  must invalidate the cached committee.
- **Host reachability:** direct `eth_call` from the host reached every mapped
  node port. Orchestration therefore did not need to route every client command
  through the Docker network.

## 1. Committee acquisition (NodeID to bytes32)

Oracle configuration represents committee members as `bytes32`. The display-form
`Node-…` identifier was decoded deterministically:

```python
import base64

def node_id_to_bytes32(nid: str) -> str:
    b = nid.split("Node-")[1].upper()
    b += "=" * ((8 - len(b) % 8) % 8)
    raw = base64.b32decode(b)
    assert len(raw) == 35, len(raw)
    return "0x" + raw[:32].hex()
```

The result contains 32 identifier bytes plus 3 checksum bytes; only the first 32
bytes are used. The four decoded values were kept as an ordered array because
that order determines signer indices. For example, `signers RAW = [0, 2]` refers
to array positions zero and two.

## 2. Configure the committee and activate the epoch

Configuration stages the committee. Activation is a two-phase epoch transition.
In the observed runs, epoch methods took effect only through the node-local
execution channel (`cast call`); submissions through the sequenced channel
returned successful-looking receipts while the inner state transition was
dropped. See item 3 in [Lyquor platform observations](lyquor-platform-notes.md).

The following archival command reflects the observed session:

```sh
CTR=<contract>
PK=<redacted-deployer-key>
RPC=http://node1:10087/api

cast send $CTR "probe_configure(bytes32[],uint16)" \
  "[<b32_1>,<b32_2>,<b32_3>,<b32_4>]" 2 \
  --private-key $PK --rpc-url $RPC
```

The threshold was first set to two to prove multi-signer aggregation before
raising it to four.

The oracle target was then derived:

```sh
TARGET=$(docker exec multi-tools shaker to-hex <instance-name>)
echo "$TARGET"
```

The observed checks required the target to be nonzero and different from the
contract address because it addresses the LVM domain rather than the contract
itself.

Epoch activation used the node-local channel:

```sh
cast call $CTR "__lyquor_oracle_advance_epoch(string,address,bool) returns (bool)" \
  "cert_probe" $TARGET false --rpc-url $RPC

cast call $CTR "__lyquor_oracle_dest_epoch_info(string,bool) returns (uint64,bytes32,uint32,bytes)" \
  "cert_probe" true --rpc-url $RPC

cast call $CTR "__lyquor_oracle_finalize_epoch(string,address,bool) returns (bool)" \
  "cert_probe" $TARGET false --rpc-url $RPC
```

The session graded activation by state changes, not by receipt status alone: the
destination epoch advanced, the change count increased by five events (four
`AddNode` changes plus one `SetThreshold`), and the configuration blob ended with
the selected threshold byte.

## 3. Execute one certification round

Console capture began before the round was triggered, and the trigger was issued
exactly once from exactly one node:

```sh
timeout 40 docker exec multi-tools shaker console <instance-name> \
  --endpoint ws://node1:10087/ws > round-console.log 2>&1 &

cast call $CTR "probe_run_round() returns (bool)" --rpc-url $RPC
```

The `timeout` exit code 124 was expected: the console command replayed history
and continued streaming until terminated.

A round trigger is not an idempotent retry. Each trigger starts an independent
round, so re-triggering a target whose first round already moved its state can
fail a later state guard by design. Use a fresh target for a fresh measurement.

## 4. Participation grading

The operator graded the following console observations:

| Check | Console observation | Threshold-2 result | Threshold-4 result |
| --- | --- | --- | --- |
| Round submitted | `…certified call submitted to the sequencing backend` | yes | yes |
| Aggregation | `…aggregated round=N node=<id> from M input(s)` | `M = 1` | `M = 4` |
| Signer set | `cert.signers RAW = [i, j, …] (… len=K)` | `[0, 2]`, `K=2` | `[0, 1, 2, 3]`, `K=4` |
| Signer mapping | one `signer <i> -> Node-…` line per signer | two distinct nodes | four distinct nodes |

The grading ladder was:

- **L2, target form:** four proposals and four signers. One trigger fans out
  through protocol broadcast and every committee node proposes and signs.
- **L1, acceptable multi-node form:** one proposal and four signers. The
  signature set still spans every committee node.
- **L0, platform limitation:** threshold greater than one never aggregates and
  the signer count remains one. Record the limitation and do not describe a
  single signature as committee-wide.

The observed stack reached L2: threshold two aggregated two distinct node
signatures and threshold four aggregated all four.

## 5. Failure playbook

| Symptom | First checks |
| --- | --- |
| Epoch does not advance after a sequenced submit | The sequenced channel may have dropped the inner submission. Rerun the epoch method through local execution and poll destination epoch info. |
| Round returns `true` but console remains empty | Console capture may have started after the trigger, or the instance name may be wrong. Recapture and use a fresh target. |
| Signer count remains one with threshold above one | Compare the staged committee with current node ids, then check that the configuration blob's trailing byte equals the intended threshold. |
| Certified call reaches state guard rejection | The first round may already have moved the target to a terminal state. Use a fresh target rather than re-triggering. |
| `shaker to-hex` returns the contract address | Re-derive the target. It addresses the LVM domain and must differ from the contract address. |

## 6. Operational discipline

1. Drive epoch methods and certification triggers through the local-execution
   channel and confirm state changes directly.
2. Use one trigger per target; retries create new rounds.
3. Start console capture before triggering. Treat exit code 124 from the replay
   command as expected.
4. Re-read node ids and reassert the target after every deployment.
5. Do not expose private keys through command arguments. The archival command
   above preserves what was observed, not a recommended reusable workflow.
6. On Git Bash, prefix `docker exec` and `docker cp` with
   `MSYS_NO_PATHCONV=1` and verify copied-file identity with checksums.
