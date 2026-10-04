# Provider adapter contract

Context Ledger 1.0 does not ship a parser for a provider export until it has fixtures owned by the project and exactness tests. A provider page, export format, or undocumented API is never treated as a stable contract by assumption.

An adapter proposal must include:

1. A versioned, local-only normalizer with no network access, browser automation, dynamic evaluation, or execution of imported content.
2. Sanitized fixtures that cover message order, empty messages, Markdown/code blocks, attachments, alternate responses, and unsupported fields.
3. An explicit capture-confidence label and a list of content that cannot be represented.
4. Byte/event limits and strict schema validation before object construction.
5. A round-trip integrity test proving the canonical event projection matches the imported fixture.
6. A security review of filenames, URLs, HTML, archive paths, and parser-resource limits.

Until those criteria are met, use `import-json` with the documented normalized format, or import a Markdown transcript. The built-in registry lists manifests only; it never installs or executes an adapter. This avoids making an unverified scraper part of the trusted archive path.

## Normalized JSON format

```json
{
  "schema": "context-ledger-import/0.1",
  "title": "Authentication design",
  "messages": [
    { "role": "user", "content": "We need an auth design." },
    { "role": "assistant", "content": "Use OAuth with PKCE." }
  ]
}
```

Only `schema`, `title`, and `messages` are accepted. A message has exactly `role` and `content`; allowed roles are `user`, `assistant`, `tool`, and `system`. The source JSON is hashed, messages are preserved exactly in a normalized-source record, and the human-readable transcript is regenerated deterministically.
