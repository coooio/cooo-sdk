# Changelog

## 0.7.3 — 2026-11-06

- Migrated protected npm releases to Trusted Publishing with GitHub Actions OIDC.
- Updated CI and release actions to Node 24-compatible versions.

## 0.7.2 — 2026-11-06

- Added a role-isolated independent-agent walkthrough using caller-held local test keys and exact authoritative reconciliation.

## 0.7.1 — 2026-11-06

- Added the synthetic cooo Lyquid backend and a reproducible single-node devnet.
- Added a 13-operation reviewed-task example, status checks, and restart path.

## 0.7.0 — 2026-11-05

### Added

- Added MIT licensing and public repository metadata.
- Added caller-provided `AbortSignal` support.
- Added structured errors, retryability metadata, and an `aborted` error code.
- Added exact operation reconciliation and `waitForOperation(...)`.
- Added `submitRawTransaction(...)`, which returns an explicit submitted outcome.
- Added CI, release, security, contribution, API, and compatibility documentation.

### Changed

- Organized the client into focused modules for types, errors, ABI encoding, validation, state, operations, JSON-RPC, and transport.
- Required both `expectedLyquidId` and `expectedContract` for trusted mutations.
- Required authoritative state to report the target cooo protocol identity.
- Targeted Node.js 22 or newer with an ESM-only package.
