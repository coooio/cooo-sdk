# Local synthetic devnet

The devnet runs the cooo Lyquid source from `backend/cooo-lyquid` on a single local Lyquor node and exposes a loopback proxy for the SDK examples.

## Prerequisites

- Linux, macOS, or Windows WSL2
- Docker Engine and Docker Compose v2
- `curl`
- Node.js 22 or newer
- Rust 1.99 with the `wasm32-unknown-unknown` target
- Lyquor LDK `0.8.0+9946920` installed under `~/.shakenup`

Install Lyquor LDK from <https://ldk.lyquor.dev>. Verify the version:

```sh
~/.shakenup/bin/shaker --version
```

On Windows, use a WSL2 distribution with Docker Engine running inside the distribution.

## Start and stop

In one foreground shell:

```sh
./devnet/start.sh
```

The first run builds the backend, starts the official single-node Lyquor Compose stack, deploys a cooo Lyquid, writes `.cooo-devnet/devnet.json`, and serves the proxy on `127.0.0.1:8080`.

In a second shell:

```sh
./devnet/run-quickstart.sh
```

Windows PowerShell:

```powershell
.\devnet\run-quickstart.ps1
```

Use `--new` to generate a fresh task. Re-running without `--new` reuses the generated environment and reconciles already confirmed operations.

Check deployment health and conservation:

```sh
./devnet/status.sh
```

Stop the node while retaining its volume and deployment metadata:

```sh
./devnet/stop.sh
```

Restart the same deployment with `./devnet/start.sh`. To create a new deployment identity, remove `.cooo-devnet/` after stopping the node and start again.

## Configuration

| Variable | Default |
| --- | --- |
| `COOO_LDK_HOME` | `$HOME/.shakenup` |
| `COOO_SHAKER` | `$COOO_LDK_HOME/bin/shaker` |
| `COOO_COMPOSE_FILE` | `$COOO_LDK_HOME/ldk/docker/single/docker-compose.yaml` |
| `COOO_NODE_ENDPOINT` | `ws://127.0.0.1:10087/ws` |
| `COOO_NODE_HEALTH_URL` | Loopback node health endpoint |
| `COOO_PROXY_LISTEN` | `127.0.0.1:8080` |
| `COOO_DEVNET_DATA_DIR` | `.cooo-devnet` |
| `COOO_CARGO_TARGET_DIR` | `$HOME/.cache/cooo-sdk-target` |

For role-isolated caller-held signing, see [the independent agent walkthrough](../docs/independent-agents.md).
