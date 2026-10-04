#!/usr/bin/env node
import path from "node:path";
import { createAiPlan, invokeAiPlan } from "./lib/ai.js";
import { createArchiveFromMarkdown, createArchiveFromNormalizedImport, addAnnotation, readAnnotations, readArchive, writeArchiveBundle } from "./lib/archive.js";
import { expandEvidenceWindow, buildContinuationPacket } from "./lib/context.js";
import { decryptArchive, encryptArchive, samePassphrase } from "./lib/crypto-envelope.js";
import { SecurityError, UsageError } from "./lib/errors.js";
import { readSafeFile, readSafeUtf8, writeNewFile } from "./lib/fs-safe.js";
import { readInvertedIndex, searchInvertedIndex, verifyInvertedIndex, writeInvertedIndex } from "./lib/inverted-index.js";
import { parseNormalizedImport } from "./lib/normalized-import.js";
import {
  addArchiveToProject,
  addFileArtifact,
  addProjectClaim,
  addProjectEdge,
  addRepositoryArtifact,
  buildProjectHandoff,
  createProject,
  readProject,
  replaceProject,
  searchProject,
  verifyProject,
  writeNewProject,
} from "./lib/project-graph.js";
import { parsePluginRegistry } from "./lib/plugin-registry.js";
import { checkReleaseReadiness } from "./lib/release.js";
import { searchArchive } from "./lib/search.js";
import { acquireSharedSnapshot } from "./lib/share-link.js";
import { renderStaticViewer } from "./lib/viewer.js";

const HELP = `Context Ledger 1.0 — local-first AI conversation archives

Usage:
  import-markdown --input <file> --out <relative-directory>
  import-json --input <normalized-json-file> --out <relative-directory>
  index --archive <file>
  verify-index --archive <file>
  inspect --archive <file>
  search --archive <file> --query <text>
  annotate --archive <file> --event <event-id> --kind <decision|important|question> --note <text>
  continue --archive <file> --out <relative-file> [--select <event-id> ... | --query <text>]
  encrypt --input <archive-file> --out <relative-file>
  decrypt --input <encrypted-file> --out <relative-file>
  fetch-share --url <supported-public-share-link> --out <relative-directory>
  viewer --archive <file> --out <relative-html-file>
  ai-plan --archive <file> --provider <openai|anthropic|gemini|ollama> --model <model> --task <summary|extract|semantic> [--query <text>] [--max-input-chars <1000-200000>] [--max-output-tokens <16-8192>]
  ai-run --archive <file> --provider <openai|anthropic|gemini|ollama> --model <model> --task <summary|extract|semantic> --consent <plan-consent-id> --out <relative-ai-result-file> [--query <text>] [--max-input-chars <1000-200000>] [--max-output-tokens <16-8192>] [--allow-remote yes | --allow-local-ai yes]
  project-init --name <text> --out <relative-project-file>
  project-add-archive --project <file> --archive <file>
  project-add-file --project <file> --path <file>
  project-add-repository --project <file> --path <directory>
  project-link --project <file> --from <node-id> --to <node-id> --kind <related|continues|supersedes|depends_on|produced_by|supports>
  project-claim --project <file> --archive <file> --event <event-id> --kind <decision|task|question> --note <text>
  project-verify --project <file>
  project-search --project <file> --query <text>
  project-continue --project <file> --out <relative-file> [--query <text>]
  plugins
  release-check

The default commands make no AI API calls and use no tokens. Encrypted-command passphrases are read
from the terminal (or one newline-delimited value from standard input), never from a command argument.
AI runs are optional, require a reviewed consent ID plus an explicit network/local-AI flag, and accept API
keys only from provider-specific environment variables. No key is accepted as a CLI argument or stored.
`;

function parseArguments(argumentsList) {
  const [command, ...tokens] = argumentsList;
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new UsageError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new UsageError(`Missing value for --${key}`);
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
    index += 1;
  }
  return { command, values };
}

function one(values, key, { optional = false } = {}) {
  const found = values.get(key) || [];
  if (found.length === 0 && optional) return undefined;
  if (found.length !== 1) throw new UsageError(`Provide exactly one --${key} value.`);
  return found[0];
}

function many(values, key) {
  return values.get(key) || [];
}

function integer(values, key, fallback) {
  const value = one(values, key, { optional: true });
  if (typeof value === "undefined") return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new UsageError(`--${key} must be a whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new UsageError(`--${key} is outside the supported range.`);
  return parsed;
}

function yes(values, key) {
  const value = one(values, key, { optional: true });
  if (typeof value === "undefined") return false;
  if (value !== "yes") throw new UsageError(`--${key} must be exactly 'yes'.`);
  return true;
}

function aiOptions(values) {
  return {
    provider: one(values, "provider"),
    model: one(values, "model"),
    task: one(values, "task"),
    query: one(values, "query", { optional: true }),
    maxInputChars: integer(values, "max-input-chars", 24_000),
    maxOutputTokens: integer(values, "max-output-tokens", 800),
  };
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readPassphrase(prompt) {
  if (!process.stdin.isTTY) {
    const input = await new Promise((resolve, reject) => {
      const chunks = [];
      let length = 0;
      process.stdin.on("data", (chunk) => {
        length += chunk.length;
        if (length > 4_096) reject(new UsageError("Passphrase input exceeds the safety limit."));
        else chunks.push(chunk);
      });
      process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
      process.stdin.on("error", reject);
    });
    const lines = input.toString("utf8").split(/\r?\n/u).filter((line) => line.length > 0);
    if (lines.length < 1) throw new UsageError("Passphrase input is empty.");
    return Buffer.from(lines.shift(), "utf8");
  }

  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(Buffer.from(value, "utf8"));
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new UsageError("Passphrase entry cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f") value = value.slice(0, -1);
        else if (character >= " ") {
          if (Buffer.byteLength(value, "utf8") >= 1_024) return finish(new UsageError("Passphrase exceeds the safety limit."));
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function commandImportMarkdown(values) {
  const input = one(values, "input");
  const output = one(values, "out");
  const transcript = await readSafeUtf8(input);
  const archive = createArchiveFromMarkdown(transcript, { sourceName: path.basename(input), method: "manual" });
  const result = await writeArchiveBundle(archive, output);
  const index = await writeInvertedIndex(result.archive, archive);
  writeJson({ archiveId: archive.archiveId, archive: result.archive, index: index.path, directory: result.directory, aiCalls: 0 });
}

async function commandImportJson(values) {
  const input = one(values, "input");
  const output = one(values, "out");
  const parsed = parseNormalizedImport(await readSafeUtf8(input));
  const archive = createArchiveFromNormalizedImport(parsed.document, {
    sourceName: path.basename(input),
    sourceDocumentSha256: parsed.sourceDocumentSha256,
  });
  const result = await writeArchiveBundle(archive, output);
  const index = await writeInvertedIndex(result.archive, archive);
  writeJson({ archiveId: archive.archiveId, archive: result.archive, index: index.path, directory: result.directory, aiCalls: 0 });
}

async function commandInspect(values) {
  const archive = await readArchive(one(values, "archive"));
  writeJson({
    archiveId: archive.archiveId,
    title: archive.title,
    events: archive.events.map(({ id, sequence, role, contentSha256 }) => ({ id, sequence, role, contentSha256 })),
    transcript: { byteLength: archive.transcript.byteLength, sha256: archive.transcript.sha256 },
    capture: archive.capture,
  });
}

async function commandSearch(values) {
  const archivePath = one(values, "archive");
  const archive = await readArchive(archivePath);
  const query = one(values, "query");
  const index = await readInvertedIndex(archivePath, archive);
  const results = index ? searchInvertedIndex(archive, index, query) : searchArchive(archive, query);
  writeJson({ results, count: results.length, retrieval: index ? "checksum-bound-inverted-index" : "direct-scan" });
}

async function commandIndex(values) {
  const archivePath = one(values, "archive");
  const archive = await readArchive(archivePath);
  const result = await writeInvertedIndex(archivePath, archive);
  writeJson({ index: result.path, terms: result.index.terms.length, archiveId: archive.archiveId, aiCalls: 0 });
}

async function commandVerifyIndex(values) {
  const archivePath = one(values, "archive");
  const archive = await readArchive(archivePath);
  const index = await verifyInvertedIndex(archivePath, archive);
  writeJson({ verified: true, archiveId: archive.archiveId, terms: index.terms.length, aiCalls: 0 });
}

async function commandAnnotate(values) {
  const archivePath = one(values, "archive");
  const archive = await readArchive(archivePath);
  const sidecar = await addAnnotation(archivePath, archive, {
    eventId: one(values, "event"),
    kind: one(values, "kind"),
    note: one(values, "note"),
  });
  writeJson({ annotationSidecar: sidecar });
}

async function commandContinue(values) {
  const archivePath = one(values, "archive");
  const archive = await readArchive(archivePath);
  const annotations = await readAnnotations(archivePath, archive);
  const explicitlySelected = many(values, "select");
  const query = one(values, "query", { optional: true });
  if (query && explicitlySelected.length > 0) {
    throw new UsageError("Use either --query or --select for a continuation packet, not both.");
  }
  let selected = explicitlySelected;
  let retrieval = "explicit-or-recent";
  if (query) {
    const index = await readInvertedIndex(archivePath, archive);
    const results = index ? searchInvertedIndex(archive, index, query) : searchArchive(archive, query);
    selected = expandEvidenceWindow(archive, results.slice(0, 7).map((result) => result.id));
    retrieval = index ? "checksum-bound-inverted-index" : "direct-scan";
  }
  const content = buildContinuationPacket(archive, annotations, selected);
  const output = await writeNewFile(one(values, "out"), content);
  writeJson({ continuation: output, retrieval, aiCalls: 0 });
}

async function commandEncrypt(values) {
  const plaintext = await readSafeFile(one(values, "input"), 12 * 1024 * 1024);
  const first = await readPassphrase("Passphrase: ");
  const second = process.stdin.isTTY ? await readPassphrase("Confirm passphrase: ") : first;
  try {
    if (!samePassphrase(first, second)) throw new UsageError("Passphrases do not match.");
    const envelope = await encryptArchive(plaintext, first);
    const output = await writeNewFile(one(values, "out"), envelope);
    writeJson({ encryptedArchive: output });
  } finally {
    first.fill(0);
    if (second !== first) second.fill(0);
  }
}

async function commandDecrypt(values) {
  const envelope = await readSafeUtf8(one(values, "input"), 12 * 1024 * 1024);
  const passphrase = await readPassphrase("Passphrase: ");
  try {
    const plaintext = await decryptArchive(envelope, passphrase);
    const output = await writeNewFile(one(values, "out"), plaintext);
    writeJson({ decryptedArchive: output });
  } finally {
    passphrase.fill(0);
  }
}

async function commandFetchShare(values) {
  const result = await acquireSharedSnapshot(one(values, "url"), one(values, "out"));
  writeJson({ ...result, aiCalls: 0, parser: "none" });
}

async function commandViewer(values) {
  const archivePath = one(values, "archive");
  const archive = await readArchive(archivePath);
  const annotations = await readAnnotations(archivePath, archive);
  const output = await writeNewFile(one(values, "out"), renderStaticViewer(archive, annotations));
  writeJson({ viewer: output, aiCalls: 0, networkRequests: 0 });
}

function aiPlanSummary(plan) {
  return {
    archiveId: plan.archiveId,
    transcriptSha256: plan.transcriptSha256,
    provider: plan.provider,
    model: plan.model,
    task: plan.task,
    query: plan.query,
    inputChars: plan.inputChars,
    estimatedInputTokens: plan.estimatedInputTokens,
    maxOutputTokens: plan.maxOutputTokens,
    eventsIncluded: plan.eventsIncluded,
    consentId: plan.consentId,
    aiCalls: 0,
    nextStep: plan.provider === "ollama"
      ? "Review this plan, then re-run with the same options, --consent, and --allow-local-ai yes."
      : "Review this plan, then re-run with the same options, --consent, and --allow-remote yes.",
  };
}

async function commandAiPlan(values) {
  const archive = await readArchive(one(values, "archive"));
  const plan = createAiPlan(archive, aiOptions(values));
  writeJson(aiPlanSummary(plan));
}

async function commandAiRun(values) {
  const archive = await readArchive(one(values, "archive"));
  const plan = createAiPlan(archive, aiOptions(values));
  const allowRemote = yes(values, "allow-remote");
  const allowLocalAi = yes(values, "allow-local-ai");
  if (plan.provider === "ollama" && allowRemote) throw new UsageError("Ollama is local-only; use --allow-local-ai yes.");
  if (plan.provider !== "ollama" && allowLocalAi) throw new UsageError("Remote providers require --allow-remote yes.");
  const result = await invokeAiPlan(plan, {
    consentId: one(values, "consent"),
    allowRemote,
    allowLocalAi,
  });
  const output = await writeNewFile(one(values, "out"), `${JSON.stringify(result, null, 2)}\n`);
  writeJson({ result: output, archiveId: result.archiveId, provider: result.provider, model: result.model, task: result.task, untrustedGeneratedContent: true, aiCalls: 1 });
}

async function commandProjectInit(values) {
  const project = createProject(one(values, "name"));
  const output = await writeNewProject(one(values, "out"), project);
  writeJson({ project: output, projectId: project.projectId, aiCalls: 0 });
}

async function commandProjectAddArchive(values) {
  const projectPath = one(values, "project");
  const project = await readProject(projectPath);
  await addArchiveToProject(project, one(values, "archive"));
  const output = await replaceProject(projectPath, project);
  writeJson({ project: output, archives: project.archives.length, aiCalls: 0 });
}

async function commandProjectAddFile(values) {
  const projectPath = one(values, "project");
  const project = await readProject(projectPath);
  await addFileArtifact(project, one(values, "path"));
  const output = await replaceProject(projectPath, project);
  writeJson({ project: output, artifacts: project.artifacts.length, aiCalls: 0 });
}

async function commandProjectAddRepository(values) {
  const projectPath = one(values, "project");
  const project = await readProject(projectPath);
  await addRepositoryArtifact(project, one(values, "path"));
  const output = await replaceProject(projectPath, project);
  writeJson({ project: output, artifacts: project.artifacts.length, aiCalls: 0, limitation: "Only regular repositories with a readable loose HEAD ref are recorded." });
}

async function commandProjectLink(values) {
  const projectPath = one(values, "project");
  const project = await readProject(projectPath);
  addProjectEdge(project, one(values, "from"), one(values, "to"), one(values, "kind"));
  const output = await replaceProject(projectPath, project);
  writeJson({ project: output, edges: project.edges.length, aiCalls: 0 });
}

async function commandProjectClaim(values) {
  const projectPath = one(values, "project");
  const project = await readProject(projectPath);
  await addProjectClaim(project, one(values, "archive"), one(values, "event"), one(values, "kind"), one(values, "note"));
  const output = await replaceProject(projectPath, project);
  writeJson({ project: output, claims: project.claims.length, aiCalls: 0 });
}

async function commandProjectVerify(values) {
  const project = await readProject(one(values, "project"));
  writeJson({ projectId: project.projectId, ...(await verifyProject(project)), aiCalls: 0 });
}

async function commandProjectSearch(values) {
  const project = await readProject(one(values, "project"));
  const results = await searchProject(project, one(values, "query"));
  writeJson({ projectId: project.projectId, results, count: results.length, aiCalls: 0 });
}

async function commandProjectContinue(values) {
  const project = await readProject(one(values, "project"));
  const verification = await verifyProject(project);
  if (!verification.valid) throw new SecurityError("Project verification failed; repair or deliberately update its referenced archives, artifacts, or claims before creating a handoff.");
  const query = one(values, "query", { optional: true });
  const results = query ? await searchProject(project, query) : [];
  const output = await writeNewFile(one(values, "out"), buildProjectHandoff(project, results));
  writeJson({ continuation: output, projectId: project.projectId, selectedResults: results.length, aiCalls: 0 });
}

async function commandPlugins() {
  const registry = parsePluginRegistry(await readSafeUtf8("plugins/registry.json"));
  writeJson({ schema: registry.schema, adapters: registry.adapters.map(({ id, name, version, inputFormat, capabilities }) => ({ id, name, version, inputFormat, capabilities })), execution: "none", aiCalls: 0 });
}

async function commandReleaseCheck() {
  writeJson({ ...(await checkReleaseReadiness()), aiCalls: 0, networkRequests: 0 });
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2));
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  const commands = {
    "import-markdown": commandImportMarkdown,
    "import-json": commandImportJson,
    index: commandIndex,
    "verify-index": commandVerifyIndex,
    inspect: commandInspect,
    search: commandSearch,
    annotate: commandAnnotate,
    continue: commandContinue,
    encrypt: commandEncrypt,
    decrypt: commandDecrypt,
    "fetch-share": commandFetchShare,
    viewer: commandViewer,
    "ai-plan": commandAiPlan,
    "ai-run": commandAiRun,
    "project-init": commandProjectInit,
    "project-add-archive": commandProjectAddArchive,
    "project-add-file": commandProjectAddFile,
    "project-add-repository": commandProjectAddRepository,
    "project-link": commandProjectLink,
    "project-claim": commandProjectClaim,
    "project-verify": commandProjectVerify,
    "project-search": commandProjectSearch,
    "project-continue": commandProjectContinue,
    plugins: commandPlugins,
    "release-check": commandReleaseCheck,
  };
  if (!commands[command]) throw new UsageError(`Unknown command: ${command}`);
  const permittedOptions = {
    "import-markdown": ["input", "out"],
    "import-json": ["input", "out"],
    index: ["archive"],
    "verify-index": ["archive"],
    inspect: ["archive"],
    search: ["archive", "query"],
    annotate: ["archive", "event", "kind", "note"],
    continue: ["archive", "out", "select", "query"],
    encrypt: ["input", "out"],
    decrypt: ["input", "out"],
    "fetch-share": ["url", "out"],
    viewer: ["archive", "out"],
    "ai-plan": ["archive", "provider", "model", "task", "query", "max-input-chars", "max-output-tokens"],
    "ai-run": ["archive", "provider", "model", "task", "query", "max-input-chars", "max-output-tokens", "consent", "out", "allow-remote", "allow-local-ai"],
    "project-init": ["name", "out"],
    "project-add-archive": ["project", "archive"],
    "project-add-file": ["project", "path"],
    "project-add-repository": ["project", "path"],
    "project-link": ["project", "from", "to", "kind"],
    "project-claim": ["project", "archive", "event", "kind", "note"],
    "project-verify": ["project"],
    "project-search": ["project", "query"],
    "project-continue": ["project", "out", "query"],
    plugins: [],
    "release-check": [],
  };
  const allowed = new Set(permittedOptions[command]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new UsageError(`--${key} is not supported by ${command}.`);
  }
  await commands[command](values);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: error.name || "Error", message: error.message || "Unexpected failure" })}\n`);
  process.exitCode = 1;
});
