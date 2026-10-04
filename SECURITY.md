# Security policy

## Supported version

Only the latest `1.0.x` Git release is supported.

## Reporting a vulnerability

When this repository is published, use GitHub’s private vulnerability-reporting facility. Do not open a public issue with an exploit until maintainers acknowledge it.

Never include a private conversation transcript, public share link, API key, passphrase, or customer data in a report. Provide a minimal synthetic reproduction and state the affected version, environment, impact, and steps to reproduce.

## Scope and boundaries

Context Ledger processes untrusted chat content and optional user-provided API keys. The security controls and residual risks are documented in [docs/threat-model.md](docs/threat-model.md). The tool is local-first and dependency-free at runtime; its optional AI integration never runs without an explicit plan, consent ID, and provider/local-AI flag.

No security policy or software release can promise zero vulnerabilities. Please report issues responsibly.
