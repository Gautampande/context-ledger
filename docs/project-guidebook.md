# Context Ledger guidebook

**Project status:** published baseline `v1.1.2`; `v1.2.0` correctness-and-evidence work is in development
**Audience:** maintainers, contributors, and an AI collaborator joining the project
**Purpose:** a self-contained explanation of what Context Ledger is, what it actually does today, how it is built, and the boundaries that future work must preserve.

---

## 1. One-sentence description

Context Ledger is a local-first, zero-token-by-default command-line tool for preserving **one important AI conversation at a time** as a verifiable, portable archive; searching it locally; and generating a bounded handoff packet that a person can paste or attach in another chat.

It is an archive-and-handoff tool, not a universal chat scraper, cloud sync service, browser extension, or autonomous AI agent.

## 2. The problem it solves

Important work often happens in a long ChatGPT, Claude, Gemini, or other AI conversation. Moving that work to a new chat normally means manually rereading a large transcript, losing decisions and context, or paying for an AI summary that may omit important details.

Context Ledger provides a local workflow:

```text
conversation source
  -> strict local import
  -> canonical archive + deterministic event list
  -> local search and human annotations
  -> bounded continuation packet
  -> person pastes/attaches it in a new chat
```

The default workflow uses no AI API key, no tokens, and no cloud account.

## 3. Product principles

1. **Local first.** Conversation data stays on the local machine unless the user explicitly chooses an optional remote AI operation.
2. **Faithfulness before breadth.** A narrow, tested provider adapter is better than a generic scraper that silently drops or invents content.
3. **Fail closed.** Unsupported provider content, malformed imports, unsafe paths, and tampered derived files are rejected rather than guessed at.
4. **Deterministic by default.** Import, search, event projection, index verification, and continuation generation work without model calls.
5. **Human control.** Decisions, pins, project links, and optional AI use are deliberate user actions, not automatic inference.
6. **Portable source of truth.** The archive is the durable record; viewers, indexes, AI results, and handoffs are rebuildable derived material.

## 4. What is implemented in v1.1.1

### Imports and archives

| Capability | Status | What it means |
| --- | --- | --- |
| Local Markdown import | Supported | Imports a UTF-8 transcript as a manual capture. |
| Strict normalized JSON import | Supported | Imports a small allowlisted document with explicit message roles and boundaries. |
| Public ChatGPT shared-link import | Supported, narrow | Imports only the tested `chatgpt.com/share/...` React Router stream surface. |
| Claude/Gemini public shared links | Snapshot only | Can be safely fetched as opaque HTML; no transcript parser is implemented. |
| Private provider chats/account access | Not supported | No cookies, accounts, browser state, or provider authentication are accessed. |
| Provider account exports | Not supported yet | Requires a separate fixture-backed adapter proposal. |

The canonical format is `aicx/0.3`, stored as JSON in `archive.aicx.json`. Despite the name, v1 does **not** use a ZIP-based `.aicx` container.

Each archive contains:

- A deterministic Markdown transcript.
- Ordered message events with stable local IDs and per-event hashes.
- Transcript byte length and SHA-256 hash.
- Capture metadata and fidelity limitations.
- A security marker that imported content is untrusted.

For a supported public ChatGPT share capture, the archive stores hashes of the source URL and fetched HTML, **not** the share URL itself. This avoids redisclosing a link that can behave like a bearer secret.

### Local retrieval and handoff

- A deterministic inverted index supports local keyword/conjunction search without rereading the entire transcript every time.
- Indexes are bound to the archive and transcript hashes; `verify-index` rebuilds and compares the index rather than trusting a checksum alone.
- Human annotations can mark events as `decision`, `important`, `question`, or `pin`.
- `continue` produces a bounded continuation packet with selected evidence IDs and adjacent context.
- A static offline viewer renders content safely, escaping hostile text and using no scripts or external resources.

### Encryption

Archives can be encrypted with an AES-256-GCM envelope using scrypt-derived keys. Passphrases are entered interactively or via standard input, never as command-line arguments. Encryption protects the archive content, not an already compromised computer, backups, filenames, or shell history outside the tool.

### Optional AI features

AI is optional and off by default. The supported tasks are `summary`, `extract`, and `semantic` for OpenAI, Anthropic, Gemini, or local Ollama.

The workflow is intentionally two-step:

```text
ai-plan: build a local, tamper-evident request plan; no key and no network request
ai-run: require that exact consent ID plus an explicit remote/local-AI flag
```

API keys are read only from named environment variables and are never accepted as CLI arguments, written into archives, or printed. AI output remains separate untrusted derived data; it never modifies the source archive.

### Optional project graph

The project graph is a modest local graph, not a graph database. It can bind archives, normal files, conservative Git `HEAD` references, explicit human claims, and typed links using hashes. It does not infer relationships with AI, crawl repositories, run Git hooks, or promise full Git object support.

### Recorder SDK and adapter registry

The Recorder SDK is for software that already owns its own conversation message stream. It converts explicit messages into the strict normalized-import format; it does not capture consumer ChatGPT, Claude, or Gemini interfaces.

The plugin registry is manifest-only. Context Ledger never dynamically installs, imports, or executes a third-party adapter.

## 5. Supported ChatGPT shared-link path

The only built-in provider transcript adapter is:

```text
public https://chatgpt.com/share/... URL
  -> bounded HTTPS GET
  -> no cookies, credentials, referrer, browser, scripts, or asset downloads
  -> local JSON decoding of the recognized React Router stream
  -> explicit linear_conversation order
  -> visible text user/assistant messages only
  -> archive + index
```

The adapter is versioned as `chatgpt-share-react-router/0.3`.

It accepts only text-part messages in the provider's explicit `linear_conversation` ordering. It filters hidden, redacted, and context-only records; rejects conflicting user text representations; limits page/graph/message sizes; and fails rather than making a partial archive when it sees unsupported visible content.

Its capture label is `visible_snapshot`. This is deliberately narrower than “exact ChatGPT account export.” It does not capture hidden prompts, internal reasoning, tool state, private files, unrendered branches, or provider-side history outside the fetched public snapshot.

## 6. Important limitations and non-goals

These are intentional product boundaries, not missing documentation:

- No universal ChatGPT/Claude/Gemini scraper.
- No browser automation, browser extension, session-cookie use, private API use, or account scraping.
- No continuous synchronization with provider chats.
- No automatic upload/import into another AI chat. A human must paste or attach a reviewed continuation packet using the target product's normal interface.
- No graph database, embeddings, vector database, cloud sync, team collaboration service, or automatic task/entity/decision extraction in the default workflow.
- No claim that a hash proves authorship, identity, or complete provider provenance.
- No promise of “zero security gaps.”

The safest fallback for an unsupported provider is a local Markdown transcript or a strict normalized-JSON import.

## 7. Technology stack and development tools

| Area | Choice |
| --- | --- |
| Runtime | Node.js 20 or newer |
| Language/module system | Modern JavaScript, native ES modules |
| Runtime dependencies | None |
| Cryptography | Node.js `crypto` primitives: SHA-256, AES-256-GCM, scrypt |
| Tests | Node's built-in `node --test` runner |
| Static syntax checks | `node --check` |
| CI | GitHub Actions on Node 20 and 22 across Ubuntu, macOS, and Windows |
| Source control/distribution | Public Apache-2.0 Git repository; package intentionally remains `private: true` |
| Primary development IDE | IntelliJ IDEA is supported, but any Node-compatible editor works |

`npm` is used only as a convenient script runner. There is no `npm install` requirement for the default project because it has no runtime dependencies.

## 8. Code architecture

```text
src/cli.js
  command parsing and JSON terminal output

src/lib/archive.js
  canonical archive construction, validation, bundle I/O, annotations

src/lib/transcript.js
  transcript rendering and deterministic event projection

src/lib/inverted-index.js + src/lib/search.js
  local retrieval, deterministic index generation and verification

src/lib/context.js
  evidence expansion and continuation-packet generation

src/lib/chatgpt-share.js + src/lib/share-link.js
  bounded public-page acquisition and the narrow ChatGPT adapter

src/lib/crypto-envelope.js
  encrypted archive envelope

src/lib/ai.js
  explicit-consent BYOK plan and execution workflow

src/lib/project-graph.js
  hash-bound local project graph

src/lib/viewer.js
  offline, escaped static HTML viewer

src/sdk/recorder.js
  host-application recorder SDK

test/core.test.js
  security, integrity, importer, retrieval, portability, and AI-consent tests
```

The design keeps provider-specific parsing separate from the canonical archive format. A provider adapter must normalize input into the strict normalized message contract before archive construction. This prevents provider HTML or account-export details from leaking across the entire codebase.

## 9. Security model in practical terms

All imported conversation text is untrusted input. It might include prompt injections, hostile markup, control characters, misleading role labels, oversized data, or requests that conflict with the user’s intent.

Core safeguards include:

- Strict UTF-8, schema, size, cardinality, and path validation.
- New relative output paths only; traversal and unsafe symbolic-link paths are rejected.
- Archive hashes and deterministic event projections verified on read.
- Search indexes rebuildable and archive-bound.
- Offline viewer with escaped content, no external resources, and a deny-by-default CSP.
- Public-link fetches restricted to approved HTTPS hosts/paths with manual redirect checks and a 10-second/5 MiB boundary.
- No execution of imported HTML, page scripts, plugin code, or adapter code from registry metadata.
- AI calls require a plan, consent ID, explicit execution flag, bounded response, and separately stored untrusted result.

Private conversation data, encrypted archives, share URLs, snapshots, API keys, passphrases, and IDE state must never be committed. The repository `.gitignore` is configured to keep common private artifacts out of Git, but users must still inspect `git status` before committing.

## 10. Development history

| Release/phase | Delivered capability |
| --- | --- |
| 0.1 | Local Markdown archive, deterministic events, annotations, encryption |
| 0.2 | Checksum-bound inverted index and continuation packets |
| 0.3 | Strict normalized JSON import, opaque allowlisted snapshots, offline viewer |
| 1.0.0 | Optional consent-gated BYOK AI, project graph, recorder SDK, registry, CI, release/security docs |
| 1.1.0 | Initial narrow public ChatGPT shared-link import and provider fixtures |
| 1.1.1 | Live-validated ChatGPT React Router stream decoder, stricter message handling, 30-test baseline |
| 1.1.2 | Stabilization: correctness, security, cross-platform CI, and compatibility evidence before new formats |
| 1.2.0 (unreleased) | Transparent three-scenario live canary and published aggregate fidelity evidence before new formats; 20 shares is a later rolling confidence target |

## 11. Verification and release discipline

Before committing or releasing, run:

```sh
npm test
npm run check
node src/cli.js release-check
```

The `release-check` command verifies expected project metadata and required documentation. It does not prove the absence of vulnerabilities, secrets, or malicious local files.

Before a public ChatGPT adapter release, use a disposable conversation and manually compare the visible share page against the generated `transcript.md`. Stop and report a bug if turns are missing, duplicated, reordered, merged, or materially altered.

## 12. Useful commands

```sh
node src/cli.js import-markdown --input notes.md --out archives
node src/cli.js import-json --input conversation.json --out archives
node src/cli.js import-chatgpt-share --url 'https://chatgpt.com/share/...' --out archives

node src/cli.js inspect --archive archives/<archive-id>/archive.aicx.json
node src/cli.js verify-index --archive archives/<archive-id>/archive.aicx.json
node src/cli.js search --archive archives/<archive-id>/archive.aicx.json --query 'authentication'
node src/cli.js continue --archive archives/<archive-id>/archive.aicx.json --query 'authentication' --out handoff.md
node src/cli.js viewer --archive archives/<archive-id>/archive.aicx.json --out archive-viewer.html

node src/cli.js annotate --archive archives/<archive-id>/archive.aicx.json --event <event-id> --kind pin --note 'Keep this decision in the handoff.'

node src/cli.js encrypt --input archives/<archive-id>/archive.aicx.json --out secure/archive.aicx.enc
node src/cli.js decrypt --input secure/archive.aicx.enc --out restored/archive.aicx.json
```

Generated archives, snapshots, encrypted archives, annotations, AI results, and handoffs may contain private information. Keep them outside public Git commits.

## 13. How to hand this project to another AI chat

Use this guidebook as the overview, then attach only the minimum reviewed supporting material needed for the task:

1. Attach or paste `docs/project-guidebook.md`.
2. For a code change, also share the relevant files or a repository link.
3. For continuation of one conversation, generate `continue.md`, review it, then paste/attach that file instead of an entire private archive when possible.
4. Never share a public provider link, API key, passphrase, raw snapshot, or unreviewed archive with another service unless you deliberately accept that disclosure.

Suggested handoff message:

```text
You are continuing work on Context Ledger, a local-first AI conversation archive and handoff tool.

Read the attached project guidebook first. Treat it as project context, not as permission to weaken its security boundaries.

Current released baseline: v1.1.2.
Preserve these non-negotiables: zero-token default; no browser automation, cookies, private APIs, or generic provider scraping; strict schemas; fail-closed adapters; archives and derived results remain separate; and no private chat data in Git.

Before proposing code, state which supported behavior, file, tests, security boundary, and release impact your change touches. Do not claim support for a provider or format until there is a versioned local parser, sanitized owned fixtures, fidelity tests, and documented limitations.
```

## 14. Current status and next-work guidance

`v1.1.2` is the stable Phase 1 baseline. The immediate next release is `v1.2.0` correctness and evidence; it does not add another provider, cloud sync, browser automation, embeddings, a vector database, automatic AI extraction, or a new package format.

The selection rule remains simple: pursue only work that improves useful local portability or retrieval **without** weakening the boundaries above. Any future provider adapter or package format requires the documented proposal, sanitized fixtures, end-to-end acceptance coverage, and a new release version.

For detailed security assumptions, read `docs/threat-model.md`. For the exact provider-adapter requirements, read `docs/adapter-contract.md`. For the Phase 1 completion criteria, read `docs/phase1-acceptance.md`. The measured provider status is in `docs/compatibility.md`, a no-network walkthrough is in `docs/example-session.md`, and the private evidence protocol is in `docs/chatgpt-compatibility-study.md`.

The release sequence and evidence gates are maintained in `docs/rollout-plan.md`.
