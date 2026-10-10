# Changelog

## 1.1.1 — 2026-10-06

Corrects the public ChatGPT shared-link adapter after live smoke testing.

- Replaces the unproven DOM-only route with a bounded, non-executing decoder for ChatGPT's embedded React Router stream, `chatgpt-share-react-router/0.3`.
- Reads only the provider's explicit `linear_conversation` ordering and current visible text parts; verifies an optional older user `message_source` against those parts when present; rejects conflicting text and non-text artifacts.
- Excludes hidden/context-only records and the provider's custom-instructions pseudo-message. It never falls back to a broad string scrape of the page.
- Adds owned serialized-stream tests covering ordered multi-turn capture, code and Unicode preservation, internal-message exclusion, unsupported artifacts, and the full archive/index/handoff portability workflow.

## 1.1.0 — 2026-10-04

Phase 1 completion release.

- Adds a narrow, dependency-free `import-chatgpt-share` path for supported public `chatgpt.com/share/...` pages. It fetches without credentials, cookies, referrers, scripts, or browser automation; parses only recognized visible `user`/`assistant` message containers; and fails closed on malformed content and visible non-text artifacts.
- Adds immutable `aicx/0.3` shared-link capture metadata, including provider, capture method, visible-snapshot completeness, unavailable hidden state, and SHA-256 digests of the source URL and fetched HTML. The bearer-style source URL itself is not stored in the archive.
- Adds owned/sanitized provider fixtures and end-to-end tests for visible order and boundaries, Markdown-like text, code, table text, links, Unicode, empty messages, duplicate-looking messages, missing metadata, malformed pages, revoked links, annotations/pins, deterministic search, integrity, and cross-directory reopening.
- Documents that the v1 portable format is the canonical JSON file `archive.aicx.json`; it is not a ZIP container. A multi-file `.aicx` container remains a possible future format.

## 1.0.0 — 2026-10-04

First Git-source launch candidate.

- Phase 0.4: optional, consent-gated BYOK AI plans and separate untrusted results for OpenAI Responses, Anthropic Messages, Gemini GenerateContent, and local Ollama.
- Phase 0.5: portable checksum-bound project graph for archives, files, conservative Git HEAD references, human claims, and graph links.
- Phase 1: recorder SDK, non-executable adapter registry, release checks, contributor/security documentation, and CI.

## 0.3.0

- Strict normalized JSON import, opaque approved shared-link snapshots, and an offline static viewer.

## 0.2.0

- Checksum-bound inverted search index and deterministic continuation packets.

## 0.1.0

- Local Markdown transcript archive, event projection, annotations, and encryption.
