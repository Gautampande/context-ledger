# Phase 1 acceptance criteria

## Phase 1 target

Phase 1 is complete when one supported public AI conversation can be imported into a local archive that preserves the adapter-verified visible conversation, supports deterministic local search, manual annotations/pins, integrity verification, and deterministic continuation generation—without an AI API key.

The supported surface in 1.1 is the versioned `chatgpt-share-dom/0.1` adapter for public `https://chatgpt.com/share/...` pages whose fetched HTML exposes the recognized visible user/assistant containers. This is intentionally narrower than “all ChatGPT conversations.”

## Automated acceptance coverage

The test suite covers this complete path with owned, sanitized HTML fixtures and a mocked public HTTPS response:

```text
public URL
  -> safe fetch
  -> ChatGPT visible-DOM parser
  -> canonical events
  -> archive.aicx.json + transcript.md
  -> checksum-bound index
  -> deterministic search
  -> manual pin
  -> continuation packet
  -> archive/index verification
  -> copy to a different directory and reopen
```

The coverage asserts message ordering and message boundaries, code text, table text, link text, Unicode, empty messages, duplicate-looking messages, a long conversation, missing title metadata, malformed HTML, unsupported artifacts, and revoked HTTP responses. It also checks that the generated archive carries `visible_snapshot` limitations and does not contain the original public-share URL.

## Manual smoke test before a release

Use a disposable conversation that contains no private data. Create a public ChatGPT share link yourself, then run:

```sh
node src/cli.js import-chatgpt-share --url 'https://chatgpt.com/share/...' --out archives
node src/cli.js verify-index --archive archives/<archive-id>/archive.aicx.json
node src/cli.js search --archive archives/<archive-id>/archive.aicx.json --query '<known text>'
node src/cli.js continue --archive archives/<archive-id>/archive.aicx.json --out handoff.md
```

Compare the generated `transcript.md` against the visible shared page. Stop and report a bug if a turn is missing, duplicated, reordered, merged, or materially altered. Do not “repair” an archive manually and describe it as an exact capture.

## Explicit non-goals

This phase does not add a graph database, embeddings, vector search, AI summaries, semantic search, automatic decisions/tasks/entities, a browser extension, cloud sync, team collaboration, a multi-chat project graph workflow, or provider API integration for the public-share importer.
