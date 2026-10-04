# Contributing

Thank you for improving Context Ledger. This project prioritizes faithful, local-first archives over broad but unverifiable provider integrations.

## Before opening a change

- Do not commit real conversations, share links, credentials, passphrases, or exported account data.
- Keep runtime dependencies at zero unless there is a documented security and maintenance case.
- Run `npm test`, `npm run check`, and `node src/cli.js release-check`.
- Preserve the default zero-token, zero-network workflow.

## Provider adapters

Follow [docs/adapter-contract.md](docs/adapter-contract.md). Adapters must be pure local normalizers with sanitized owned fixtures, explicit fidelity limits, byte/event limits, and exact event-projection tests. They must not automate a browser, use undocumented authenticated endpoints, dynamically execute code, download attachments, or turn a raw share-page snapshot into an “exact” archive without evidence.

## Security-sensitive changes

Changes involving parsing, path handling, cryptography, rendering, remote requests, credentials, or import formats need tests that demonstrate both the intended behavior and a rejected unsafe input. Explain any residual risk in the pull request. Use private vulnerability reporting for security bugs rather than a public issue.
