# Context Ledger

`Context Ledger` is a local-first, Git-hosted tool for retaining and handing off one important AI conversation at a time. It preserves the imported transcript, builds a deterministic local index, and creates bounded continuation packets. Related-archive project graph support is separate and optional.

It is deliberately **not** a universal ChatGPT/Claude/Gemini scraper. Version 1.1.1 includes one narrow adapter for the supported public ChatGPT shared-page React Router stream. It preserves only verified visible text messages and fails closed on unsupported representations or visible artifacts. It is not a claim of full account-export fidelity.

## What ships in 1.1.1

- Exact UTF-8 Markdown import and strict normalized-JSON import.
- Portable `aicx/0.3` JSON archive: immutable transcript, deterministic event projection, SHA-256 integrity fields, and readable companion files. Older `aicx/0.1` and `aicx/0.2` archives remain readable.
- Token-free local inverted-index search, annotations, static offline viewer, and evidence-bounded continuation packets.
- `import-chatgpt-share` for the supported `https://chatgpt.com/share/...` React Router stream surface. It creates an archive and index in one command, with no AI API key.
- Optional AES-256-GCM envelope encryption with scrypt-derived keys.
- A constrained shared-link snapshot boundary: HTTPS allowlist, no cookies, no credentials, validated redirects, no scripts or asset downloads.
- Optional bring-your-own-key AI summaries, extraction, and semantic retrieval. They are off by default and use no key or tokens until the user explicitly approves a plan.
- A local `aicx-project/0.1` graph binding archives, files, conservative Git HEAD references, links, and manual claims to hashes.
- A recorder SDK for apps that own their messages and a non-executable adapter registry. No extension, adapter, or registry entry is dynamically installed or run.

## What it does not claim

- It cannot reliably extract an exact private conversation from an arbitrary provider share page or consumer UI. Providers can change page formats, hide branches/attachments, or require authentication.
- It does not continuously synchronize a chat, access your accounts, scrape browser state, or import a share link that is not public and allowlisted.
- It does not make AI output authoritative. AI results are saved separately and marked untrusted.
- It cannot guarantee “no security gaps.” Review [the threat model](docs/threat-model.md) and use normal endpoint, disk, and backup protections.

## Quick start

Requires Node.js 20+. It has no runtime dependencies and no installation or API key is needed for default use.

```sh
node src/cli.js import-json --input fixtures/normalized-example.json --out archives
node src/cli.js inspect --archive archives/<archive-id>/archive.aicx.json
node src/cli.js search --archive archives/<archive-id>/archive.aicx.json --query authentication
node src/cli.js continue --archive archives/<archive-id>/archive.aicx.json --query authentication --out handoff.md
node src/cli.js viewer --archive archives/<archive-id>/archive.aicx.json --out archive-viewer.html
```

`import-markdown` accepts a local transcript. `import-json` accepts only [the documented normalized import contract](docs/adapter-contract.md), so headings inside a message cannot be mistaken for a new chat turn.

For a public ChatGPT link that you control and have checked is safe to disclose, use:

```sh
node src/cli.js import-chatgpt-share --url 'https://chatgpt.com/share/...' --out archives
```

The command performs one HTTPS request to the public page; it sends no cookies, credentials, referrer, scripts, or browser automation. It stores no share URL in the generated archive. It does not use an AI API or tokens.

## The portable data model

**V1 format decision:** an `.aicx` archive is the canonical JSON file named `archive.aicx.json`, not a ZIP container. A future multi-file container may use the `.aicx` extension, but this release does not produce or claim one.

An archive is one `archive.aicx.json` file plus optional derived files:

| File | Role |
| --- | --- |
| `archive.aicx.json` | Canonical portable record; transcript and exact event projection are validated on every read. |
| `archive.aicx.json.index.json` | Rebuildable local search index bound to archive and transcript hashes. |
| `archive.aicx.json.annotations.json` | Deliberate, separate human notes; not part of the immutable transcript. |
| `*.aicx.enc` | An encrypted archive envelope, if you choose to create one. |
| `*.aicx.project.json` | A project graph referring to local, checksum-bound archives and artifacts. |

Indices, viewers, handoffs, and AI results are derived outputs. Keep the canonical archive to move a conversation between systems. A receiving AI chat cannot silently import a file through a universal standard; paste or attach the generated continuation packet using the target product’s supported upload/share mechanism.

## Project graph (Phase 0.5)

```sh
node src/cli.js project-init --name "Auth redesign" --out projects/auth.aicx.project.json
node src/cli.js project-add-archive --project projects/auth.aicx.project.json --archive archives/<archive-id>/archive.aicx.json
node src/cli.js project-add-file --project projects/auth.aicx.project.json --path docs/architecture.md
node src/cli.js project-verify --project projects/auth.aicx.project.json
node src/cli.js project-search --project projects/auth.aicx.project.json --query PKCE
node src/cli.js project-continue --project projects/auth.aicx.project.json --query PKCE --out projects/auth-handoff.md
```

The graph is intentionally modest: nodes are archives, regular files, or repositories; edges and claims are explicit human data. It does not infer relationships with AI, crawl a repository, or run Git hooks. Repository support records only a safe, readable loose `HEAD` reference; linked worktrees and packed-only refs are deliberately out of scope.

## Optional BYOK AI (Phase 0.4)

The usual workflow is two steps: plan locally, then approve exactly that plan. Planning does not read a key or make a network request.

```sh
node src/cli.js ai-plan --archive archives/<archive-id>/archive.aicx.json \
  --provider openai --model <model> --task summary

CONTEXT_LEDGER_OPENAI_API_KEY='...' node src/cli.js ai-run \
  --archive archives/<archive-id>/archive.aicx.json \
  --provider openai --model <model> --task summary \
  --consent <consent-id-from-plan> --allow-remote yes --out results/summary.ai.json
```

Supported provider labels are `openai`, `anthropic`, `gemini`, and local `ollama`. Remote keys are read only from `CONTEXT_LEDGER_OPENAI_API_KEY`, `CONTEXT_LEDGER_ANTHROPIC_API_KEY`, or `CONTEXT_LEDGER_GEMINI_API_KEY`; keys are never accepted as arguments, written to output, or logged. A remote run must include `--allow-remote yes`; local Ollama must include `--allow-local-ai yes`. The plan hashes the exact selected content, task, limits, model, and instructions. Altering any of these changes the consent ID.

Remote processing sends the selected archival text to the chosen provider. Check that provider’s terms, data-retention controls, model availability, and account configuration yourself. The tool sends `store: false` to OpenAI’s Responses endpoint, but that is a request parameter—not a substitute for reviewing provider policy. AI results are untrusted generated content and are never merged into the source archive.

## Shared links and adapters

```sh
node src/cli.js fetch-share --url 'https://chatgpt.com/share/...' --out snapshots
node src/cli.js import-chatgpt-share --url 'https://chatgpt.com/share/...' --out archives
node src/cli.js plugins
```

`fetch-share` remains an acquisition boundary, not a parser: it stores raw allowed HTML with a digest of the URL and does not preserve the share URL itself. `import-chatgpt-share` is the one built-in provider importer. It accepts only a public `chatgpt.com/share/...` URL, decodes the supported embedded React Router `linear_conversation` stream without executing page code, and recognizes only verified visible text `user`/`assistant` messages. It rejects malformed pages, unknown message representations, and non-text artifacts rather than silently omitting them.

The resulting capture metadata says `provider: "chatgpt"`, `capture_method: "public_shared_link"`, `completeness: "visible_snapshot"`, and `hidden_state_available: false`. It also records hashes of the source URL and fetched HTML, not the URL itself. Hidden prompts, internal reasoning, tool state, private files, unrendered variants, and provider history outside the fetched public snapshot are unavailable or unknown. See [the adapter contract](docs/adapter-contract.md) and [Phase 1 acceptance criteria](docs/phase1-acceptance.md).

The [Recorder SDK](docs/recorder-sdk.md) is the reliable “direct” route for a product that already owns a conversation’s message stream. It does not capture a provider’s consumer chat UI.

## Security and release checks

```sh
npm test
npm run check
node src/cli.js release-check
```

The release check verifies local repository metadata and documentation; it does not prove that there are no secrets or vulnerabilities. `package.json` intentionally remains `private: true`: this is an Apache-2.0 Git source release and cannot be accidentally published to npm.

Read [SECURITY.md](SECURITY.md), [the threat model](docs/threat-model.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before using sensitive data or adding a provider adapter.

For IntelliJ IDEA project setup, run configurations, and the complete source tree, see [the IntelliJ guide](docs/intellij-setup.md).

If you are recreating this project in a new folder before publishing it, use the [Git-ready project layout](docs/git-ready-layout.md).
