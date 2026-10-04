# Git-ready project layout

Create a new IntelliJ project named `context-ledger`, then create **exactly** this tracked-file layout. This is the complete public source layout for the 1.0.0 Git release.

```text
context-ledger/
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
│   ├── adapter-contract.md
│   ├── git-ready-layout.md
│   ├── intellij-setup.md
│   ├── recorder-sdk.md
│   └── threat-model.md
├── fixtures/
│   ├── example.md
│   └── normalized-example.json
├── plugins/
│   └── registry.json
├── src/
│   ├── cli.js
│   ├── lib/
│   │   ├── ai.js
│   │   ├── archive.js
│   │   ├── context.js
│   │   ├── crypto-envelope.js
│   │   ├── errors.js
│   │   ├── fs-safe.js
│   │   ├── hash.js
│   │   ├── inverted-index.js
│   │   ├── normalized-import.js
│   │   ├── plugin-registry.js
│   │   ├── project-graph.js
│   │   ├── release.js
│   │   ├── search.js
│   │   ├── share-link.js
│   │   ├── transcript.js
│   │   └── viewer.js
│   └── sdk/
│       └── recorder.js
├── test/
│   └── core.test.js
├── .gitignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
└── package.json
```

## Do not create or commit these

```text
.idea/          # IntelliJ machine/project state
node_modules/    # no runtime dependencies are needed
.env             # API keys must never be committed
archives/        # private imported chats
snapshots/       # raw shared-page captures
work/            # test/smoke output
*.aicx.enc       # encrypted conversation data
*.ai.json        # optional AI output may contain private text
*.aicx.project.json
*.aicx.json.index.json
*.annotations.json
```

The supplied `.gitignore` already protects every item above. Do not remove those entries for a public repository.

## Create and publish from your own folder

1. Create the `context-ledger` folder in IntelliJ IDEA and recreate the tracked files above.
2. Set the Node interpreter to Node.js 20 or newer.
3. Copy the source contents from the reference implementation file-for-file. Do not copy its `work/`, `archives/`, or `.idea/` folders.
4. Run the checks below before the first commit.

```sh
npm test
npm run check
node src/cli.js release-check
```

5. Initialise and publish your repository:

```sh
git init
git add .
git status
git commit -m "Release Context Ledger 1.0.0"
git branch -M main
git remote add origin <your-git-repository-url>
git push -u origin main
```

Before committing, `git status` must not show `.idea/`, `.env`, `archives/`, `snapshots/`, `work/`, or any real conversation material.

## How a user runs the published repository

```sh
git clone <your-git-repository-url>
cd context-ledger
node --version
npm test
node src/cli.js import-json --input fixtures/normalized-example.json --out archives
```

There is no `npm install` required for 1.0.0 because the project has no runtime dependencies. `package.json` is deliberately `private: true`, so a public Git repository can be used safely without accidentally publishing an npm package.
