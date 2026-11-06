# Compatibility policy

## Release channel

Version `0.7.3` is the current public patch release. During `0.x`, minor releases may change public APIs; patch releases preserve them. A `1.0` compatibility policy will be documented before `1.0`.

## Runtime

- Node.js 22 or newer.
- ESM imports only; CommonJS `require()` is unsupported.
- No runtime package dependencies.
- Browser execution is not a supported release target.

## Protocol

This SDK targets:

```text
cooo-local-v0.3-terms-bound-review
```

A deployment must expose compatible Lyquid discovery, state, and Ethereum JSON-RPC endpoints. The SDK compares the discovery contract with `expectedContract` and rejects authoritative state from another deployment or protocol identity.

The previous historical wire identifier is intentionally unsupported by this release.

## Deployment pins

Clients that create transactions must provide both:

```ts
expectedLyquidId: string;
expectedContract: Address;
```

Read-only clients may omit these pins, but `getState()` still requires the target protocol identity. `prepareTransaction`, `sendRawTransaction`, and typed mutation methods revalidate the bound deployment.

## Security boundary

The SDK is a protocol client. It does not provide key custody, transaction consent, production wallet integration, real-asset custody, or multi-node consensus validation.
