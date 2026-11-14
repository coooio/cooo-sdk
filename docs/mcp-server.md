# cooo MCP server

`examples/mcp-server.mjs` is an experimental, zero-dependency MCP server for the
cooo SDK (from issue #10). It exposes read helpers and SDK write methods over
newline-delimited JSON-RPC 2.0 on stdio, so an MCP-capable model or client can
propose Lyquid operations with typed arguments.

The trust boundary is unchanged: models propose, while the deterministic cooo
SDK and Lyquid protocol decide whether an operation is valid. The MCP server does
not add authority, custody, or policy bypasses.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `COOO_RPC_URL` | `http://127.0.0.1:8080/lyquid/api` | Lyquid RPC endpoint |
| `COOO_INFO_URL` | `http://127.0.0.1:8080/lyquid/info` | Lyquid info endpoint |
| `COOO_STATE_URL` | `http://127.0.0.1:8080/api/state` | State read endpoint |
| `COOO_LYQUID_ID` | unset | Optional expected Lyquid id pin |
| `COOO_CONTRACT` | unset | Optional expected contract pin |
| `COOO_TIMEOUT_MS` | `30000` | SDK request timeout |
| `COOO_CALLER` | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `from` address for writes |

Operators must set `COOO_CALLER` to their own address. The default is only a
well-known local development account.

## Quickstart

Build the SDK first so `examples/mcp-server.mjs` can import `../dist/index.js`:

```sh
npm run build
node examples/mcp-server.mjs
```

The process speaks MCP over stdin/stdout. Diagnostics go to stderr; stdout must
contain only protocol messages.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "cooo": {
      "command": "node",
      "args": ["/path/to/cooo-sdk/examples/mcp-server.mjs"],
      "env": {
        "COOO_RPC_URL": "http://127.0.0.1:8080/lyquid/api",
        "COOO_CALLER": "0xYOUR_ADDRESS"
      }
    }
  }
}
```

## Safety notes

- Unlocked submission is loopback-only under SDK policy. Do not expose the MCP
  server or its upstream state/RPC endpoints to untrusted networks.
- The server has no custody and no signing keys beyond the configured caller
  address flow used by the SDK.
- A write tool's transaction hash is a sequencing receipt, not finality. Confirm
  application state with `cooo_wait_for_state` or `cooo_task_detail`.

## Limitations

- `transactionSender` support is not implemented yet.
- `cooo_sha256_text` is a text-only digest helper. Hashing bytes, files, or
  structured evidence payloads is out of scope for this example.
