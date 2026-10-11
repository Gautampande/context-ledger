# Compatibility matrix

**Last updated:** 2026-10-12
**Evidence rule:** an import is not a fidelity pass until a person compares the generated transcript to the visible source conversation and finds no missing, duplicated, reordered, merged, or materially altered visible user/assistant turns.

| Input path | Status | Parser / contract | Automated evidence | Live evidence | Important limits |
| --- | --- | --- | --- | --- | --- |
| Local Markdown | Supported | `import-markdown` | Unit and integration coverage | Not applicable | The user supplies the transcript; headings can only be inferred where the Markdown format permits it. |
| Normalized JSON | Supported | `context-ledger-import/0.1` | Strict-schema and fidelity tests | Not applicable | Only the documented allowlisted JSON shape is accepted. |
| Public ChatGPT share | Narrow / preliminary | `chatgpt-share-react-router/0.3` | Sanitized DOM and serialized-stream fixtures; end-to-end archive, index, handoff, and portability test | One disposable, user-owned import smoke test; not a representative fidelity study | Public `chatgpt.com/share/...` pages only; visible text messages in the recognized stream only; provider changes can cause a closed failure. |
| Public Claude share | Snapshot only | `fetch-share` | Acquisition-boundary tests | No transcript fidelity claim | HTML is saved as untrusted opaque data; no Claude transcript parser exists. |
| Public Gemini share | Snapshot only | `fetch-share` | Acquisition-boundary tests | No transcript fidelity claim | HTML is saved as untrusted opaque data; no Gemini transcript parser exists. |
| Private chats, account exports, browser sessions | Not supported | None | Not applicable | Not applicable | No cookies, account access, browser automation, private APIs, or consumer-UI scraping. |

## What the ChatGPT status means

The ChatGPT importer is a versioned compatibility surface, not a promise that every public ChatGPT share page will import. It reads no page JavaScript and accepts only the provider's recognized `linear_conversation` order and supported text parts. An unsupported visible representation is an error; it must never become a partial archive.

Before calling this support broad, maintainers must run the 20-share evidence gate in the [rollout plan](rollout-plan.md): publish attempted, imported, and manually verified fidelity-pass counts separately, plus sanitized failure categories and the parser version.

## Safe compatibility reporting

Use only dedicated, non-sensitive conversations. Do not publish transcripts, share URLs, raw HTML snapshots, API keys, passphrases, or private archive contents. A useful report records only:

- Test date and Context Ledger release/commit.
- Provider and parser version.
- Conversation shape category, such as short text, long text, code, tables, links, Unicode, or empty turns.
- Outcome: attempted, imported, fidelity pass, fidelity fail, or closed failure.
- A sanitized failure category and minimal synthetic reproduction if one is possible.

Hashes detect changes relative to a trusted copy. They do not establish authorship, legal admissibility, provider provenance, or completeness.
