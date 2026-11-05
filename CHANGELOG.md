# Changelog

## Unreleased

### Documentation and examples

- Added a local synthetic reviewed-task quickstart with a runnable 13-operation example and exact state reconciliation.
- Added the authoritative synthetic cooo Lyquid source and a reproducible single-node local devnet launcher, status check, stop command, and reviewed-task runner.

## 0.7.0 — 2026-11-05

### Added

- Added MIT licensing and public repository metadata for `coooio/cooo-sdk`.
- Added caller-provided `AbortSignal` support.
- Added structured error details, retryability metadata, and an `aborted` error code.
- Added exact caller/operation/payload reconciliation helpers and `waitForOperation(...)`.
- Added `submitRawTransaction(...)`, which returns an explicit `submitted` outcome rather than implying business success.
- Added CI, release, security, contribution, API overview, and compatibility documentation.

### Changed

- Split the SDK into focused modules for types, errors, ABI encoding, validation, state validation, operation reconciliation, JSON-RPC, and the client.
- Trusted mutations now require both `expectedLyquidId` and `expectedContract` deployment pins.
- Authoritative state reads must report the target cooo protocol identity even when discovery pins are omitted.
- The SDK now supports Node.js 22 or newer and remains ESM-only.

### Boundary

This public release supports a verified single-node synthetic deployment. It does not provide custody, a production wallet adapter, or real-asset operation.

## 0.7.0-rc.2 — 2026-11-05

### Added

- Added MIT licensing and independent-repository metadata for the planned `cooo/sdk` GitHub project.
- Added caller-provided `AbortSignal` support.
- Added structured error details, retryability metadata, and an `aborted` error code.
- Added exact caller/operation/payload reconciliation helpers and `waitForOperation(...)`.
- Added `submitRawTransaction(...)`, which returns an explicit `submitted` outcome rather than implying business success.
- Added CI, release, security, and contribution infrastructure for the independent repository.

### Changed

- Trusted mutations now require both `expectedLyquidId` and `expectedContract` deployment pins.
- Authoritative state reads must report the target cooo protocol identity even when discovery pins are omitted.
- The SDK now supports Node.js 22 or newer and remains ESM-only.

### Boundary

This prerelease completed public repository review. It supported a verified single-node synthetic deployment and did not provide custody, a production wallet adapter, or real-asset operation.

## 0.7.0-rc.1 — 2026-11-05

### Changed

- Renamed the public protocol identity export from `SDK_PROTOCOL_VERSION` to `COOO_PROTOCOL_VERSION`.
- Changed the target wire identity to `cooo-local-v0.3-terms-bound-review` across the SDK, local Lyquid source, gateway, and integration fixtures.
- Updated package metadata for a public scoped release candidate and added package hygiene tests.

### Compatibility

This is a source-breaking prerelease. It targets a Lyquid rebuilt with the cooo protocol identity. Existing deployments that still return the historical wire identifier must be rebuilt and redeployed before consuming this SDK release candidate; the historical identifier is intentionally not advertised by this package.

### Boundary

This candidate remains private and unpublished. It supports a verified single-node synthetic deployment, not real-asset custody, multi-node consensus, or a production wallet adapter.

## 0.6.0 — 2026-11-01

- Canonical private package name is `@cooo/sdk`; exported types and clients use `CoooSdk`, `CoooSdkError`, `CoooState`, `CoooSdkOptions` and `CoooMethod`.
- Updated all repository consumers, examples and current documentation. This is a source-breaking namespace change; rebuild/relink local consumers.
- Preserved the exact existing deployment wire identifier and validation rules. No ledger, ABI, accepted terms or transaction semantics changed.
- No public package publication is implied.

## 0.5.0 — 2026-10-29

### Added

- Added `SignableTransaction` with exact chain ID, nonce, gas price, contract, calldata, gas, signer, and pinned deployment identity.
- Added `prepareTransaction(...)` for caller-held signing workflows.
- Added `sendRawTransaction(...)` using `eth_sendRawTransaction` after deployment rediscovery and optional exact-binding comparison.
- Added typed validation for authoritative operation-intent records returned by the updated Lyquid state response.
- Added the separate `@cooo/sdk/local-cast-signer` export for a caller-held local Foundry Cast test signer. It proves key-to-account control, signs both exact transactions and bounded challenge messages, and passes the key only through local Cast stdin.

### Changed

- Consolidated JSON-RPC request/response correlation and result/error validation.
- Kept the SDK runtime dependency-free; the local signer uses a separate export and no network service.

### Boundary

This is an unpublished synthetic integration release. It does not provide production signature verification, consent enforcement, custody, browser-wallet UI, or hosted transaction authorization. A transaction hash still is not application success.
