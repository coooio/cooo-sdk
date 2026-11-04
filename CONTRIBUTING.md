# Contributing to the cooo SDK

## Ground rules

- Keep the package ESM-only and dependency-free in its core entry point.
- Preserve explicit participant designation; do not add matchmaking or broker behavior.
- Keep deployment identity explicit for all trusted mutations.
- Treat transaction hashes as transport results, not application success.
- Keep secrets, private keys, internal deployment details, and customer data out of issues and patches.

## Development workflow

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
```

Tests import generated files from `dist/`, so run `npm run build` before `npm test` after source changes.

## Pull requests

- Add or update focused tests for every behavior change.
- Preserve strict TypeScript checking.
- Update `CHANGELOG.md` under the appropriate unreleased or release-candidate heading.
- Explain compatibility and migration effects for public API changes.
- Keep documentation in English.
