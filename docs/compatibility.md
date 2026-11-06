# Compatibility policy

## Release channel

The current release is `0.7.x`. During `0.x`, minor releases may change public APIs; patch releases preserve them. The `1.0` policy will be published before a `1.0` release.

## Runtime

- Node.js 22 or newer.
- ESM imports only; CommonJS `require()` is unsupported.
- No runtime package dependencies.
- Browser execution is unsupported.

## Protocol

```text
cooo-local-v0.3-terms-bound-review
```

A deployment must expose compatible Lyquid discovery, state, and Ethereum JSON-RPC endpoints. The SDK compares discovery with the configured contract and rejects state from another deployment or protocol identity.

## Deployment pins

Mutation-capable clients must provide both:

```ts
expectedLyquidId: string;
expectedContract: Address;
```

Read-only clients may omit these pins, but `getState()` still requires the target protocol identity. `prepareTransaction`, `sendRawTransaction`, and typed mutation methods revalidate the deployment.

## Security

Keys remain with callers. The SDK signs no transactions itself and provides no custody service.
