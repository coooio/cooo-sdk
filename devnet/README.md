# Local synthetic devnet quickstart

This directory provides a reproducible single-node backend for the reviewed-task SDK walkthrough. It is for local evaluation only; it does not provide real assets, custody, production signing, public access, or multi-node consensus.

## Prerequisites

- Linux, macOS, or Windows WSL2
- Docker Engine and Docker Compose v2
- `curl`
- Node.js 22 or newer
- Rust 1.99 with the `wasm32-unknown-unknown` target
- Lyquor LDK `0.8.0+9946920` installed under `~/.shakenup`

Install Lyquor LDK from the official site: <https://ldk.lyquor.dev>. The backend crate in `backend/cooo-lyquid` is built by Lyquor's official `shaker` command; this repository does not vendor the Lyquor runtime.

Check the installed version:

```sh
~/.shakenup/bin/shaker --version
```

The expected version is:

```text
0.8.0+9946920
```

On Windows, use a WSL2 distribution with Docker Engine running inside the distribution. Keep the devnet shell open while using the SDK.

## Start the devnet

From the repository root in a foreground shell:

```sh
./devnet/start.sh
```

The first run builds `backend/cooo-lyquid`, starts the official single-node Lyquor Compose stack, deploys a fresh cooo Lyquid, writes `.cooo-devnet/devnet.json`, and serves its proxy on loopback port 8080.

Keep this process running. It is the authoritative synthetic node for this walkthrough.

For a Windows repository checkout, use a command shaped like this from PowerShell, replacing the distribution and checkout path:

```powershell
wsl.exe -d <WSL-DISTRIBUTION> --cd /mnt/c/path/to/cooo-sdk -- ./devnet/start.sh
```

## Run the reviewed-task workflow

In a second shell from the repository root:

```sh
./devnet/run-quickstart.sh
```

On Windows PowerShell, while the WSL devnet shell remains open:

```powershell
.\devnet\run-quickstart.ps1
```

The runner:

1. Checks the proxy, deployment identity, protocol identity, and ledger conservation.
2. Selects four distinct unlocked accounts exposed by the local node.
3. Generates `.cooo-devnet/reviewed-task.env` with a new task ID and deadline.
4. Installs SDK dependencies if needed and builds `dist/`.
5. Executes the 13-operation `examples/reviewed-task-quickstart.mjs`.
6. Rechecks authoritative state and conservation.

Start a fresh task with:

```sh
./devnet/run-quickstart.sh --new
```

Re-running without `--new` reuses the generated environment. The example reconciles already confirmed operations and refuses a changed payload under the same caller and operation ID.

## Check status

```sh
./devnet/status.sh
```

The command prints the Lyquid ID, contract, protocol, task and operation counts, synthetic-asset state, and conservation result. It exits nonzero when the proxy, deployment binding, protocol, or conservation check fails.

## Stop and restart

Stop the node while keeping its Docker volume and local deployment metadata:

```sh
./devnet/stop.sh
```

Restart the same deployment:

```sh
./devnet/start.sh
```

The restart path checks that the recorded Lyquid is still visible before serving it. Authoritative state is expected to remain available from the node volume. Do not remove the Lyquor Docker volume if you want restart-recovery evidence.

To deploy a genuinely new Lyquid, stop the node and remove the local metadata directory:

```sh
./devnet/stop.sh
rm -rf .cooo-devnet
./devnet/start.sh
```

This creates a new deployment identity; it does not delete or rewrite the old node volume.

## Configuration overrides

All overrides are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `COOO_LDK_HOME` | `$HOME/.shakenup` | Lyquor LDK installation directory. |
| `COOO_SHAKER` | `$COOO_LDK_HOME/bin/shaker` | Explicit `shaker` executable. |
| `COOO_COMPOSE_FILE` | `$COOO_LDK_HOME/ldk/docker/single/docker-compose.yaml` | Official single-node Compose file. |
| `COOO_NODE_ENDPOINT` | `ws://127.0.0.1:10087/ws` | Lyquor node endpoint. |
| `COOO_NODE_HEALTH_URL` | Loopback node health URL | URL used before deployment. |
| `COOO_PROXY_LISTEN` | `127.0.0.1:8080` | Lyquid proxy binding. |
| `COOO_DEVNET_DATA_DIR` | `.cooo-devnet` | Local metadata and generated quickstart environment. |
| `COOO_CARGO_TARGET_DIR` | `$HOME/.cache/cooo-sdk-target` | Rust build cache. |

The default Rust cache is intentionally outside the repository. When the checkout is on a Windows filesystem mounted in WSL, keeping the build cache in the WSL filesystem avoids slow builds and Windows disk exhaustion.

## Security boundary

The devnet is deliberately synthetic and loopback-only. It uses unlocked local test accounts for the quickstart. It must not be exposed to a public network, used with real assets, or treated as production custody infrastructure.

## Use four process-separated agents

After the devnet is running, see [the independent agent walkthrough](../docs/independent-agents.md) to execute every authoritative operation in a separate process with a caller-held local test key isolated to that role.
