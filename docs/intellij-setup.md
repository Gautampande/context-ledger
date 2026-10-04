# IntelliJ IDEA setup and run guide

Context Ledger is a Node.js 20 command-line project. It uses no runtime dependencies, so there is no `npm install` step.

## Open the project

1. In IntelliJ IDEA, choose **File → Open**.
2. Select the folder containing `package.json` (the `context-ledger` root), not the `src` folder.
3. Trust the project when IntelliJ asks.
4. In **Settings → Languages & Frameworks → Node.js**, select a Node.js 20-or-newer interpreter.

IntelliJ creates `.idea/` for your machine. Keep it local; Context Ledger ignores it because interpreter paths and workspace state should not be shared in Git.

## Useful run configurations

Create these through **Run → Edit Configurations**:

| Name | Type | Configuration |
| --- | --- | --- |
| `Test` | npm | package.json: `test` |
| `Static check` | npm | package.json: `check` |
| `Release check` | Node.js | JavaScript file: `src/cli.js`; parameters: `release-check`; working directory: project root |
| `CLI help` | Node.js | JavaScript file: `src/cli.js`; parameters: `help`; working directory: project root |
| `Import example` | Node.js | JavaScript file: `src/cli.js`; parameters: `import-json --input fixtures/normalized-example.json --out archives`; working directory: project root |

Do not put an AI key in a run configuration. Optional AI keys are read only from a short-lived environment variable when you intentionally run `ai-run`.

## Project layout

```text
context-ledger/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions checks
├── docs/
│   ├── adapter-contract.md        # Requirements for safe provider adapters
│   ├── intellij-setup.md          # This guide
│   ├── recorder-sdk.md            # SDK and registry contract
│   └── threat-model.md            # Controls and residual risks
├── fixtures/
│   ├── example.md
│   └── normalized-example.json
├── plugins/
│   └── registry.json              # Data-only adapter manifest registry
├── src/
│   ├── cli.js                     # Command-line entry point
│   ├── lib/
│   │   ├── ai.js                  # Optional consent-gated BYOK providers
│   │   ├── archive.js             # Canonical archive format and validation
│   │   ├── context.js             # Deterministic handoff packets
│   │   ├── crypto-envelope.js     # Encryption envelope
│   │   ├── errors.js
│   │   ├── fs-safe.js             # Safe file/path operations
│   │   ├── hash.js
│   │   ├── inverted-index.js      # Local token-free search index
│   │   ├── normalized-import.js
│   │   ├── plugin-registry.js
│   │   ├── project-graph.js       # Multi-archive project graph
│   │   ├── release.js
│   │   ├── search.js
│   │   ├── share-link.js
│   │   ├── transcript.js
│   │   └── viewer.js
│   └── sdk/
│       └── recorder.js
├── test/
│   └── core.test.js
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
└── package.json
```

The following folders are generated or local-only and must not be committed: `.idea/`, `archives/`, `snapshots/`, `work/`, encrypted archives, AI result files, project graph files containing private paths, index sidecars, and `.env`.

## Run from IntelliJ’s terminal

```sh
node --version
npm test
npm run check
node src/cli.js release-check
node src/cli.js help
```

Import the included safe fixture:

```sh
node src/cli.js import-json --input fixtures/normalized-example.json --out archives
```

The command prints the new archive path. Substitute that path below:

```sh
node src/cli.js search --archive archives/<archive-id>/archive.aicx.json --query authentication
node src/cli.js continue --archive archives/<archive-id>/archive.aicx.json --query authentication --out handoff.md
node src/cli.js viewer --archive archives/<archive-id>/archive.aicx.json --out archive-viewer.html
```

Everything above is local and uses zero AI tokens. For the optional two-step AI workflow, generate a plan first, review its consent ID, and only then deliberately run it with a provider key in the environment:

```sh
node src/cli.js ai-plan --archive archives/<archive-id>/archive.aicx.json --provider openai --model <model> --task summary
CONTEXT_LEDGER_OPENAI_API_KEY='...' node src/cli.js ai-run --archive archives/<archive-id>/archive.aicx.json --provider openai --model <model> --task summary --consent <consent-id> --allow-remote yes --out results/summary.ai.json
```
