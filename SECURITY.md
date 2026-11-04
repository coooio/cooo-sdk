# Security policy

## Supported versions

The SDK release candidate is pre-1.0. Security fixes target the latest tagged release only.

## Reporting a vulnerability

Email security issues to [team@cooo.io](mailto:team@cooo.io). Do not open a public issue for a suspected vulnerability.

Include reproduction details, affected versions, protocol identity, and any non-secret request/state shapes that help diagnosis. Do not send private keys, production credentials, seed phrases, or customer data.

## Trust boundary

The SDK does not hold keys or provide custody. A transaction hash is not proof that a business workflow succeeded. Model output is a proposal outside the authority boundary.
