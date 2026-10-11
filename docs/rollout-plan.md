# Rollout and evidence plan

## Current status

The published baseline is `v1.1.2`. It has one deliberately narrow ChatGPT public-share adapter, deterministic local retrieval, optional local encryption, and no required AI API use. It has synthetic fixture coverage plus a disposable, user-owned live ChatGPT smoke test.

That is encouraging, but it is not enough evidence to call the adapter broadly reliable or the product launch-ready. The public release history includes `v1.0.0`, `v1.1.0`, `v1.1.1`, and `v1.1.2`.

The next version is **`v1.2.0` correctness and evidence**, not a new provider, ZIP container, cloud service, or automatic chat-transfer feature. Its required study protocol is in [chatgpt-compatibility-study.md](chatgpt-compatibility-study.md).

## Positioning

Context Ledger is a local-first archive and evidence-linked handoff tool for one important AI conversation at a time. It should be presented as tamper-evident only within a stated trust boundary:

- Archive hashes and deterministic projections detect accidental or unauthenticated modification relative to a trusted copy.
- They do **not** prove authorship, legal admissibility, provider provenance, or completeness.
- A party that can rewrite both data and hashes can construct a different internally consistent archive.

Do not claim that the tool can universally move chats between AI products. A receiving chat is still a human-mediated paste or attachment workflow.

## Release sequence

| Release | Theme | Exit gate |
| --- | --- | --- |
| `v1.1.2` | Stabilization and trustworthy failures | Cross-platform CI green; stated regression tests pass; docs match actual behavior. |
| `v1.2.0` | Correctness and evidence | A published, transparent real-chat compatibility result; no silent fidelity failure in a passing import. |
| `v1.3.0` | New input paths | Each new import method has a versioned parser, sanitized fixtures, documented limits, and its own compatibility evidence. |
| `v1.4.0` | Usability | Three new users complete a handoff unassisted in five minutes or less. |
| `v1.5.0` | Value measurement | A reproducible evaluation compares the bounded handoff against honest baselines. |
| `v2.0.0` | External validation | External security review is closed with no unresolved high-severity issue, and outside-user feedback is recorded. |

Dates are estimates, not promises. A gate that fails changes the plan rather than being waived.

## Completed `v1.1.2` stabilization scope

1. Check hidden/context provider records before role or content validation, so a hidden unsupported record cannot block an otherwise valid visible capture.
2. Permit the CLI to read a worst-case base64 encryption envelope while retaining a bounded encrypted payload.
3. Construct the deterministic search index before writing a new import bundle, so index-resource rejection does not leave a seemingly successful archive.
4. Validate that `import-chatgpt-share` received a ChatGPT URL before the HTTP request. A redirect is also checked after fetch.
5. Check syntax by walking all source modules rather than maintaining a hand-written file list.
6. Make release metadata validation version-agnostic and remove setup-only documentation from the required release surface.
7. Preserve UTF-8 code-point boundaries when truncating handoff evidence, and apply one code-point title-length rule.
8. Add regressions for unsafe redirects, oversized responses, timeouts, crypto tampering, bad KDF metadata, CLI argument errors, safe-path behavior, and Git reference handling.
9. Test Node 20 and 22 on Ubuntu, macOS, and Windows. Publish coverage information, but do not invent a threshold until the measurement is known.
10. Document a synthetic sample workflow and an accurate compatibility matrix.

`v1.1.2` does not claim broad provider support merely because its tests pass.

## Compatibility evidence

The compatibility matrix separates **import success** from **fidelity**. An import counts as a fidelity pass only if the visible user/assistant turns are manually compared and have no missing, duplicated, reordered, merged, or materially altered message.

Before a release claims broad ChatGPT-share support, test at least 20 user-owned, non-sensitive public shares selected across different chat lengths and formatting styles. Publish:

- Attempted, imported, and fidelity-pass counts separately.
- Selection method and test date.
- Sanitized failure categories and known limitations.
- Provider/parser version used for the test.

Until then, ChatGPT share support remains narrow and versioned, not universal. Claude and Gemini stay snapshot-only unless a separate adapter meets the contract in [adapter-contract.md](adapter-contract.md).

## Deferred work

The following are frozen until the stabilization and compatibility gates are met:

- New provider parsers or account-export importers.
- A ZIP `.aicx` container, attachments, and assets.
- Embeddings, vector databases, automatic extraction, or new graph features.
- Browser companions, cloud sync, accounts, teams, and executable plugins.

If a future export format requires ZIP handling, `node:zlib` alone is not treated as a ZIP parser. The project must choose and test a complete bounded implementation or deliberately review a dependency change.

## Measurement and launch discipline

For a handoff evaluation, publish the tokenizer/counting method, equal input/output budgets for baselines, scoring rubric, prompts, failure handling, and raw results—including losses. If bounded packets do not outperform a raw-tail baseline often enough to justify the product claim, reposition around archival integrity and retrieval rather than forcing the handoff claim.

Begin external-review preparation before the final launch stage. Any live compatibility canary must use a dedicated non-sensitive owned share, avoid logging its text, deduplicate failures, and be diagnostic rather than a merge blocker.

## Standing rules

1. Every provider adapter has sanitized fixtures, an explicit parser version, documented unavailable content, and compatibility evidence.
2. Every defect fix includes the regression test that would have caught it.
3. Every new feature has a measurable acceptance criterion.
4. Failure stays closed: an explicit error is better than a partial archive.
5. Update the compatibility matrix and changelog in the same commit as a behavior change.
