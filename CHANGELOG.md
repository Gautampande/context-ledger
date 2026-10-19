# Changelog

## 2.5.1 — 2026-10-19 release-status documentation correction

- Corrects the README, security policy, rollout plan, and guidebook to identify `v2.5.0` as published and `v2.5.1` as the current release.
- Makes no runtime, archive, package, parser, or security-behavior change.

## 2.5.0 — 2026-10-19 deterministic conversation map

This release combines the planned 2.1–2.5 map work without adding AI inference, cloud state, or a new provider scraper.

- Adds a deterministic `context-ledger-conversation-graph/0.1` sidecar. Every immutable archive event becomes a node and every adjacent pair receives an automatic `next` edge.
- Adds deliberate, forward-only `supports`, `clarifies`, `supersedes`, `depends_on`, `answers`, and `relates_to` links. A link cannot create a cycle or alter chronology.
- Adds `graph-build`, `graph-link`, `graph-verify`, `graph-brief`, and `graph-viewer`. Default graph commands make zero AI calls and zero network requests.
- Adds a deterministic graph brief and static SVG/HTML map viewer with no JavaScript, external resources, or executable attachments.
- Extends portable packaging to `context-ledger-package/1.1`, retaining non-empty manual graph links while still importing v2.0's `1.0` packages.
- Adds graph integrity, safe-viewer, CLI, package round-trip, and hostile-input regression coverage.

## 2.0.0 — 2026-10-18 portable single-conversation packages

This development line turns the existing loose local archive bundle into one portable, local-only package for a single conversation. It does not add automatic import to AI providers, provider credentials, browser automation, account exports, cloud storage, multi-conversation packaging, attachments, or AI use.

- Adds `package-export` and `package-import` for `.aicx` packages using a strict `context-ledger-package/1.0` stored-only ZIP subset.
- Packages contain only the canonical archive, a freshly rebuilt deterministic index, and non-empty validated annotations when present. Raw snapshots, public share URLs, executable content, arbitrary files, and AI results are excluded.
- Validates every package entry, manifest digest, canonical archive, deterministic index, and optional annotation sidecar before import. Unsupported ZIP features, duplicate/unknown paths, compression, unsafe output paths, and malformed content fail closed.
- Adds offline round-trip and hostile-package regression tests. Default package commands make zero AI calls and zero network requests.
- Ignores `.aicx` files by default because packages can contain private conversation content.

## Included but not separately released — 1.5.0 handoff evaluation

This untagged scope adds a reproducible local evaluation kit for testing the retrieval-selected handoff against an honest raw-tail baseline. It does not invoke an AI provider, estimate tokens, or claim that a score proves general model quality.

- Adds `evaluate-handoff`, which writes checksum-bound retrieval-handoff, raw-tail, evaluator-instruction, and manifest files into a new local directory.
- Matches the comparison on declared UTF-8 historical message-content bytes and records selected event IDs, byte budgets, and SHA-256 values.
- Adds a synthetic study fixture and fixed scoring rubric for three predeclared tasks. No external-chat results are claimed until somebody runs and publishes all outcomes, including losses or inconclusive results.
- Includes the unreleased guided-handoff work originally planned for `v1.4.0`; there will be no standalone `v1.4.0` tag.

## Included but not separately released — guided handoff work

This release focuses on making the existing local archive-to-new-chat workflow understandable without adding an automatic provider import claim.

- Adds `handoff`, a zero-token, zero-network command that creates one reviewed Markdown file ready to paste or attach in another AI chat.
- Keeps the source evidence bounded, retains archive/event identifiers, and tells both the person and receiving assistant how to treat historical text safely.
- Adds a documented independent-usability protocol. It has not been run and is not claimed as a completed validation.

## 1.3.0 — 2026-10-12

This release adds a repeatable local import path for a ChatGPT public-share snapshot already captured with `fetch-share`. It does not add another provider parser, browser automation, account access, or an origin/provenance claim.

- Adds `import-chatgpt-snapshot`, which verifies the local HTML byte count and SHA-256 against its strict `shared-snapshot/0.1` metadata before parsing.
- Records snapshot replay distinctly as `public_shared_snapshot`; it makes no network request and retains only source URL and HTML digests, never the source URL.
- Rejects a mismatched snapshot/metadata pair or non-ChatGPT snapshot metadata before an archive is written.

## 1.2.0 — 2026-10-12

This release is gated on a transparent three-scenario, manual-fidelity live canary. Twenty manually compared shares remain a rolling confidence target before any broad-support claim. It does not add a new provider parser, browser automation, or cloud service.

- Adds a privacy-preserving public-share study protocol that records only sanitized local outcomes and publishes aggregate compatibility evidence.
- Publishes an initial three-scenario ChatGPT public-share canary: 3 attempted, 3 imported, and 3 manually verified fidelity passes. This is not a broad-compatibility claim.

## 1.1.2 — 2026-10-12

The next release closes correctness, safety, and release-hygiene gaps before new input formats or portability features are considered.

- Ignores hidden/context-only ChatGPT provider records before validating role or content, while continuing to reject unsupported **visible** message artifacts.
- Builds a deterministic search index before writing a new imported archive, preventing an index-resource failure from leaving a partial-looking bundle behind.
- Rejects a non-ChatGPT URL passed to `import-chatgpt-share` before it makes a request; redirects remain allowlist-checked.
- Allows the CLI to read a bounded worst-case base64 encryption envelope for the existing 12 MiB plaintext cap, with tamper and KDF-profile regression coverage.
- Makes title and bounded-handoff truncation Unicode code-point safe.
- Replaces the hand-maintained syntax-check list with source-tree discovery; adds Node 20/22 CI across Ubuntu, macOS, and Windows plus monthly GitHub Actions update checks.
- Adds an explicit compatibility matrix, a synthetic no-network sample session, and the evidence-gated rollout plan.

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
