# ChatGPT public-share compatibility study

## Purpose

This protocol produces the initial live-canary evidence required for a `v1.2.0` statement about the narrow `chatgpt-share-react-router/0.3` adapter. It measures real public-share pages without collecting private transcripts, share URLs, raw snapshots, or account information in Git.

This is not an automated scraping study. A successful import is not automatically a fidelity pass: a person must compare `transcript.md` with the visible share page.

## Safety rules

- Use only dedicated, non-sensitive conversations you own and are willing to make public temporarily.
- Never commit a share URL, transcript, archive, snapshot, handoff, screenshot, API key, passphrase, or raw HTML.
- Keep per-run notes only under the ignored `work/` directory.
- Do not send share URLs or transcript content to a collaborator merely to count a result.
- Revoke or delete a public share after the comparison if the provider offers that control.

## `v1.2.0` minimum canary

Run three distinct public-share attempts. A conversation can cover multiple formatting categories, but record the primary category so the public result is understandable.

| Primary category | Minimum attempts | Include |
| --- | ---: | --- |
| Short boundary case | 1 | 1–5 visible turns; include an unclosed source code fence only if the provider visibly renders one |
| Multi-turn plain text | 1 | At least 8 visible turns |
| Rich formatting | 1 | Code, Unicode, an HTTPS link, and a Markdown-like table |

If a category cannot be represented by a public share, record it as unavailable rather than replacing it silently. The final report must state that limitation. Existing sanitized automated fixtures cover a 240-turn conversation, malformed content, unsupported artifacts, empty messages, duplicate-looking content, and provider-state exclusions.

## Rolling confidence target

After `v1.2.0`, collect compatibility reports gradually from user-owned, non-sensitive conversations. Twenty distinct manually compared attempts across lengths and formatting styles are required before describing the adapter as broadly compatible. This is a confidence target, not a requirement for one person to manufacture twenty chats before publishing a bug-fix/evidence release.

## Per-run procedure

1. Create a disposable share and open it in a logged-out/private browser view if practical. Confirm the visible text is what you expect to test.
2. Import it locally into an ignored work directory:

   ```sh
   node src/cli.js import-chatgpt-share --url 'https://chatgpt.com/share/...' --out work/v1.2-compatibility
   ```

3. If it imports, run `verify-index`, open the generated `transcript.md`, and compare every visible user and assistant turn in order. A structural closing fence may appear after an otherwise unterminated source code fence; it protects the next turn boundary and is not source text.
4. Record the outcome in a local ledger. Do not add the ledger to Git.
5. If an imported transcript has any missing, duplicated, reordered, merged, or materially changed visible turn, stop the study and treat it as a release-blocking fidelity defect.
6. If the command fails closed, record a sanitized error category. A closed failure is preferable to a partial archive, but it still counts as an attempted run.

## Local-only ledger

Create a ledger under `work/` with no link, text, archive ID, transcript hash, or provider conversation ID:

```sh
mkdir -p work/v1.2-compatibility
printf 'run_date\tcategory\tvisible_turns\timport_outcome\tfidelity_outcome\tparser\tfailure_category\n' > work/v1.2-compatibility/results.tsv
```

For each attempt, append one sanitized row. Allowed outcome values are:

- `imported` or `closed_failure` for `import_outcome`
- `pass`, `fail`, `not_applicable`, or `not_compared` for `fidelity_outcome`
- A broad error category such as `unsupported_visible_representation`, `no_recognized_stream`, `fetch_http_error`, `network_timeout`, or `other_closed_failure`

## Publication rule

The public compatibility matrix reports aggregates only:

- Number attempted.
- Number imported.
- Number manually compared.
- Number that passed fidelity comparison.
- Sanitized failure-category counts.
- Test date and parser version.

Do not report an import as a fidelity pass if it was not manually compared. Do not claim broad compatibility with fewer than 20 attempts, or if any passing import is later found to have a fidelity defect.

## `v1.2.0` exit gate

`v1.2.0` may be considered only when all of the following are true:

1. The three minimum canary attempts are recorded under this protocol.
2. Aggregate results and known limits are added to [compatibility.md](compatibility.md).
3. Every successful import counted as a fidelity pass was manually compared.
4. There is no known silent-fidelity defect in a passing import.
5. The automated suite, syntax check, release check, and cross-platform CI are green.

This gate permits transparent closed failures. It does not permit silently incomplete archives.
