# Provider adapter contract

Context Ledger 1.1 ships one deliberately narrow public-share adapter: `chatgpt-share-dom/0.1`. A provider page, export format, or undocumented API is never treated as a stable contract by assumption. The adapter is supported only when the fetched public `https://chatgpt.com/share/...` HTML contains the visible message containers it recognizes.

## Built-in ChatGPT public-share adapter

`import-chatgpt-share` uses a bounded HTTPS GET with credentials omitted, a no-referrer policy, manually checked redirects, a 10-second timeout, and a 5 MiB HTML limit. It does not open a browser, execute page JavaScript, access an account, use provider APIs, download assets, or send an AI request.

The local parser accepts only visible `article` or `div` message containers marked with `data-message-author-role="user"` or `data-message-author-role="assistant"`. It preserves their order and normalizes their visible text into the strict normalized-message contract. Code blocks are emitted as fenced text; displayed link text and table cells are retained. It fails rather than creating a partial transcript if it encounters malformed containers, unsupported roles, unsafe control characters, or visible images/files/audio/video/canvas/SVG/embedded content.

An accepted archive records:

```json
{
  "provider": "chatgpt",
  "capture_method": "public_shared_link",
  "completeness": "visible_snapshot",
  "hidden_state_available": false
}
```

It also records SHA-256 hashes of the source URL and fetched HTML. The source URL itself is not stored because public share links can behave like bearer links.

`visible_snapshot` means only the verified visible text from that HTTP response. It does not establish access to hidden prompts, internal reasoning, tool state, private files, unrendered branches/variants, or conversation history not in the fetched page. A changed provider DOM is an expected compatibility failure, not permission to guess or scrape another surface.

The implementation and its fixtures are intentionally not a generic HTML-to-chat converter. Adding Claude, Gemini, a new ChatGPT layout, attachment extraction, or an account/export route requires a separate adapter proposal.

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
