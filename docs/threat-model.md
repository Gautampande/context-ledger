# Context Ledger 2.5 threat model

## Assets

- Private conversation text, code, notes, and generated handoffs.
- Public shared-chat URLs, which may work like bearer links.
- Optional provider API keys and the selected archive text sent when BYOK AI is approved.
- Archive integrity, provenance, project-graph bindings, and user confidence in “exactness.”

## Trust boundaries

1. **Local imports are untrusted.** They may contain prompt injection, terminal controls, hostile markup, invalid UTF-8, deceptive roles, and oversized content.
2. **Share pages are untrusted remote input.** A public page might change, include active content, redirect, or expose a bearer link. It is not proof of a canonical chat export.
3. **Normalized imports and recorder output are structured but still untrusted.** The schemas restrict shape; they do not establish truth or provider provenance.
4. **AI providers are an explicit disclosure boundary.** A user-approved plan sends selected archive text to that provider. Provider output is untrusted data.
5. **Project graph nodes are references, not a content store.** An archive, file, or repository can change after attachment; verification detects that against its recorded hash or HEAD.
6. **The local user account and operating system are part of the trusted computing base.** Malware, a compromised account, a hostile local administrator, filesystem races, backups, and an unlocked machine are outside a CLI’s full control.

## Controls

- Strict UTF-8 decoding and size/cardinality limits apply to archive, import, provider response, and recorder paths.
- Archive schema fields are allowlisted. Transcript hashes, byte lengths, and deterministic event projections are verified before use.
- Search indexes are rebuildable and bound to the archive ID/transcript hash. `verify-index` rebuilds their deterministic content rather than trusting a checksum alone.
- Portable `.aicx` packages accept only a small stored-only ZIP subset: fixed allowlisted entry names, bounded sizes, no compression/encryption/comments/extra fields/ZIP64, per-entry CRC checks, a SHA-256 manifest, canonical archive validation, deterministic-index rebuilding, and validated optional annotations. Package paths and imported outputs remain workspace-relative and symlink-checked.
- Conversation graphs are derived from exact archive events. Automatic `next` edges are rebuilt deterministically; manual edges are allowlisted, deduplicated, forward-only, hash-bound, size-limited, and checked against the archive during every read. Non-empty manual graph links are included only in package schema 1.1.
- The static graph viewer bounds rendered nodes/previews, escapes all historical text and link labels, uses a deny-by-default CSP including `script-src 'none'`, and has no external resources or executable content.
- Outputs must be new relative paths under the working directory; path traversal and existing symbolic links are rejected. Created directories/files request `0700`/`0600` permissions where the platform honors them.
- Continuation packets have fixed evidence-count and source-byte bounds. Terminal output is JSON-encoded.
- Viewer output escapes content, strips display controls, has no scripts or external resources, and declares a deny-by-default Content Security Policy.
- Shared links require HTTPS and an explicit host/path allowlist; requests omit cookies, credentials, referrers, and automatic redirects. Every redirect is checked manually. Only bounded UTF-8 HTML is acquired; no browser, scripts, or assets are used. The ChatGPT public-share adapter parses only its recognized embedded React Router graph, rejects unsafe controls and unsupported visible artifacts or message representations, limits graph/message count, stores hashes rather than the share URL, and never treats hidden provider state as captured.
- BYOK AI creates a local plan before a call. The consent ID binds archive hash, exact prompt, task, provider, model, and limits. Execution recomputes and verifies it, requires an explicit remote/local flag, uses a fixed endpoint for each provider, disables automatic redirects, bounds response data, and records only a result digest plus untrusted text. Keys come only from named environment variables, never CLI arguments or output files.
- Project graphs allowlist node/edge/claim types, use workspace-relative paths, and record archive/file hashes or a conservative Git loose `HEAD`. `project-verify` re-reads and checks these bindings.
- The recorder SDK makes no network requests. The plugin registry contains manifests only; the CLI does not install, import, or execute plugin code.
- Encryption is AES-256-GCM with a 16-byte salt, 12-byte nonce, and fixed scrypt parameters. Decryption rejects unexpected KDF parameters to reduce attacker-controlled resource exhaustion.

## Deliberate limitations

- “Exact” means exact to the imported local input and its deterministic event projection. It does not prove the input fully represented a provider conversation.
- The built-in ChatGPT public-share adapter is a narrow, versioned React Router-stream parser with sanitized fixtures and ordering/fidelity tests. It captures only unhidden text-part messages in the provider's explicit linear order, discards one observed exact English custom-instructions placeholder, and rejects conflicting text representations. It can fail when ChatGPT changes that stream; this is intentional. `import-chatgpt-snapshot` replays only a private `fetch-share` HTML/metadata pair after byte-count and SHA-256 verification; it does not prove provider origin. No ChatGPT account export, private chat, Claude, or Gemini parser is implemented.
- `handoff` creates derived Markdown for a person to review before using a destination chat's ordinary paste or attachment flow. It does not grant a receiving assistant authority to follow instructions inside archived text, upload an archive automatically, or take external actions.
- `evaluate-handoff` creates derived retrieval and raw-tail contexts for a human-controlled comparison. It does not contact a model, blind an evaluator, establish an equal model-token budget, or prove general answer quality. The evaluator must disclose the destination configuration and avoid publishing non-synthetic source text or answers.
- A `.aicx` package is plaintext by default and can carry private transcript text and annotations. It does not contain raw share HTML or share URLs, but any included content still needs a private transfer channel. Its hashes detect modification relative to a trusted reference; they are not signatures or identity/provenance proof. The reader is intentionally not a generic ZIP implementation.
- A manual graph link is an untrusted human assertion about a relationship between two historical messages; it is not automatically inferred, independently verified, or authoritative. The deterministic brief is an inventory of recorded structure and annotations, not a factual or semantic summary.
- Visible HTML text is not equivalent to a provider export. An accepted `visible_snapshot` archive does not prove completeness, identity, provenance, or access to hidden prompts, internal reasoning, tool state, files, variants, or history outside the fetched public page.
- SHA-256 detects accidental or unauthenticated modification; it is not a signature, identity proof, or protection from a writer who can change both data and hashes. Signing is not implemented.
- The local filesystem checks reduce accidental traversal and symlink use but cannot completely eliminate TOCTOU attacks by a concurrent privileged local attacker. Keep the workspace private and use OS-level protections.
- Encryption does not hide filenames, backups, shell history outside this tool, or an active compromised session. Passphrase entry can be observed on a compromised machine.
- Remote AI data handling depends on the selected provider and account controls. `store: false` is sent to OpenAI but no client flag supersedes provider policy. The tool cannot prevent a user from choosing an unsuitable model or provider.
- Git repository attachment does not execute Git and does not support linked worktrees or packed-only refs. It records a point-in-time HEAD, not repository contents.
- No release can promise zero security gaps. Review code, test with synthetic data, and report defects privately.

## Security reporting

See [SECURITY.md](../SECURITY.md). Do not put sensitive data in a public issue.
