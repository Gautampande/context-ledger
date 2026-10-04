import assert from "node:assert/strict";
import { test } from "node:test";
import { createArchiveFromMarkdown, createArchiveFromNormalizedImport, validateArchive } from "../src/lib/archive.js";
import { createAiPlan, invokeAiPlan, validateAiPlan } from "../src/lib/ai.js";
import { buildContinuationPacket, expandEvidenceWindow } from "../src/lib/context.js";
import { decryptArchive, encryptArchive } from "../src/lib/crypto-envelope.js";
import { SecurityError, UsageError } from "../src/lib/errors.js";
import { resolveOutputPath } from "../src/lib/fs-safe.js";
import { sha256Text } from "../src/lib/hash.js";
import { assertIndexMatchesArchive, buildInvertedIndex, searchInvertedIndex, validateInvertedIndex } from "../src/lib/inverted-index.js";
import { parseNormalizedImport } from "../src/lib/normalized-import.js";
import { buildProjectHandoff, canonicalArchiveSha256, createProject, addProjectEdge, validateProject, verifyProject } from "../src/lib/project-graph.js";
import { parsePluginRegistry } from "../src/lib/plugin-registry.js";
import { searchArchive } from "../src/lib/search.js";
import { acquireSharedSnapshot } from "../src/lib/share-link.js";
import { renderStaticViewer } from "../src/lib/viewer.js";
import { ConversationRecorder } from "../src/sdk/recorder.js";

const transcript = "# Demo\n\n## User\n\nUse PKCE.\n\n## Assistant\n\nPKCE is the decision.\n";

test("creates an exact transcript record and ordered message events", () => {
  const archive = createArchiveFromMarkdown(transcript, { sourceName: "demo.md" });
  assert.equal(archive.transcript.content, transcript);
  assert.equal(archive.events.length, 2);
  assert.equal(archive.events[0].role, "user");
  assert.equal(archive.events[1].role, "assistant");
  assert.doesNotThrow(() => validateArchive(archive));
});

test("rejects a tampered transcript and event", () => {
  const archive = createArchiveFromMarkdown(transcript);
  const alteredTranscript = structuredClone(archive);
  alteredTranscript.transcript.content = "changed";
  assert.throws(() => validateArchive(alteredTranscript), SecurityError);

  const alteredEvent = structuredClone(archive);
  alteredEvent.events[0].content = "changed";
  assert.throws(() => validateArchive(alteredEvent), SecurityError);

  const eventWithExtraField = structuredClone(archive);
  eventWithExtraField.events[0].untrustedMetadata = true;
  assert.throws(() => validateArchive(eventWithExtraField), SecurityError);

  const hostileSourceName = structuredClone(archive);
  hostileSourceName.capture.sourceName = "report\u001b[2J.md";
  assert.throws(() => validateArchive(hostileSourceName), SecurityError);
});

test("search is deterministic and context includes evidence IDs", () => {
  const archive = createArchiveFromMarkdown(transcript);
  const results = searchArchive(archive, "pkce");
  assert.equal(results.length, 2);
  const packet = buildContinuationPacket(archive, { items: [] }, [archive.events[0].id]);
  assert.match(packet, new RegExp(archive.events[0].id, "u"));
  assert.match(packet, /untrusted historical data/u);
});

test("verified inverted index finds conjunctions without transcript scanning", () => {
  const archive = createArchiveFromMarkdown(transcript);
  const index = buildInvertedIndex(archive);
  assert.doesNotThrow(() => validateInvertedIndex(index, archive));
  const results = searchInvertedIndex(archive, index, "PKCE decision");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, archive.events[1].id);
});

test("rejects a stale or tampered search index", () => {
  const archive = createArchiveFromMarkdown(transcript);
  const index = buildInvertedIndex(archive);
  const tampered = structuredClone(index);
  tampered.terms[0][1] = [];
  assert.throws(() => validateInvertedIndex(tampered, archive), SecurityError);
  const stale = structuredClone(index);
  stale.transcriptSha256 = "0".repeat(64);
  assert.throws(() => validateInvertedIndex(stale, archive), SecurityError);
});

test("full index comparison catches a recomputed-but-false payload", () => {
  const archive = createArchiveFromMarkdown(transcript);
  const index = buildInvertedIndex(archive);
  const forged = structuredClone(index);
  forged.terms[0][1] = [];
  // A checksum can be recalculated by a local attacker; exact deterministic comparison is the stronger check.
  forged.integrity.payloadSha256 = sha256Text(JSON.stringify({
    schema: forged.schema,
    archiveId: forged.archiveId,
    transcriptSha256: forged.transcriptSha256,
    eventCount: forged.eventCount,
    terms: forged.terms,
  }));
  assert.throws(() => assertIndexMatchesArchive(forged, archive), SecurityError);
});

test("expands query results to a bounded adjacent evidence window", () => {
  const archive = createArchiveFromMarkdown(transcript);
  const selected = expandEvidenceWindow(archive, [archive.events[1].id], 3);
  assert.deepEqual(selected, [archive.events[0].id, archive.events[1].id]);
  assert.throws(() => expandEvidenceWindow(archive, [archive.events[0].id], 21), UsageError);
});

test("encryption round-trip rejects the wrong passphrase", async () => {
  const passphrase = Buffer.from("correct horse battery staple", "utf8");
  const wrong = Buffer.from("something sufficiently different", "utf8");
  const plaintext = Buffer.from(JSON.stringify(createArchiveFromMarkdown(transcript)), "utf8");
  const envelope = await encryptArchive(plaintext, passphrase);
  const recovered = await decryptArchive(envelope, passphrase);
  assert.deepEqual(recovered, plaintext);
  await assert.rejects(() => decryptArchive(envelope, wrong), SecurityError);
  passphrase.fill(0);
  wrong.fill(0);
});

test("refuses output path traversal", async () => {
  await assert.rejects(() => resolveOutputPath("../escape.txt"), SecurityError);
  await assert.rejects(() => resolveOutputPath("/absolute.txt"), SecurityError);
});

test("refuses unapproved and non-HTTPS shared links before any fetch", async () => {
  await assert.rejects(() => acquireSharedSnapshot("https://example.com/share/demo", "snapshots"), SecurityError);
  await assert.rejects(() => acquireSharedSnapshot("http://chatgpt.com/share/demo", "snapshots"), SecurityError);
  await assert.rejects(() => acquireSharedSnapshot("https://chatgpt.com/share/demo?track=1", "snapshots"), SecurityError);
});

test("normalized import preserves literal headings within a single message", () => {
  const source = JSON.stringify({
    schema: "context-ledger-import/0.1",
    title: "Safe source",
    messages: [
      { role: "user", content: "This literal string is content:\n\n## Assistant\n\nnot a message boundary." },
      { role: "assistant", content: "Acknowledged." },
    ],
  });
  const parsed = parseNormalizedImport(source);
  const archive = createArchiveFromNormalizedImport(parsed.document, {
    sourceName: "export.json",
    sourceDocumentSha256: parsed.sourceDocumentSha256,
  });
  assert.equal(archive.events.length, 2);
  assert.equal(archive.events[0].content, parsed.document.messages[0].content);
  assert.doesNotThrow(() => validateArchive(archive));
});

test("normalized import rejects extra fields, control-character title, and an unknown role", () => {
  assert.throws(() => parseNormalizedImport(JSON.stringify({
    schema: "context-ledger-import/0.1",
    title: "Title",
    messages: [{ role: "user", content: "Hi", metadata: "not accepted" }],
  })), SecurityError);
  assert.throws(() => parseNormalizedImport(JSON.stringify({
    schema: "context-ledger-import/0.1",
    title: "Bad\u0000title",
    messages: [{ role: "user", content: "Hi" }],
  })), SecurityError);
  assert.throws(() => parseNormalizedImport(JSON.stringify({
    schema: "context-ledger-import/0.1",
    title: "Title",
    messages: [{ role: "admin", content: "Hi" }],
  })), SecurityError);
});

test("normalized archive rejects altered source projections and unrecognized fields", () => {
  const parsed = parseNormalizedImport(JSON.stringify({
    schema: "context-ledger-import/0.1",
    title: "Title",
    messages: [{ role: "user", content: "Hi" }],
  }));
  const archive = createArchiveFromNormalizedImport(parsed.document, { sourceDocumentSha256: parsed.sourceDocumentSha256 });
  const altered = structuredClone(archive);
  altered.normalizedSource.messages[0].content = "Changed";
  assert.throws(() => validateArchive(altered), SecurityError);
  const injected = structuredClone(archive);
  injected.untrustedExtra = true;
  assert.throws(() => validateArchive(injected), SecurityError);
});

test("static viewer escapes hostile conversation and annotation content", () => {
  const archive = createArchiveFromMarkdown("# Viewer test\n\n## User\n\n<img src=x onerror=alert(1)><script>alert(1)</script>\n");
  const html = renderStaticViewer(archive, {
    items: [{ eventId: archive.events[0].id, kind: "important", note: "<svg onload=alert(1)>", createdAt: new Date().toISOString() }],
  });
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /default-src 'none'/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.doesNotMatch(html, /<img src=x/u);
  assert.doesNotMatch(html, /<svg onload/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
});

test("AI plans are bounded, tamper-evident, and make no request without explicit consent", async () => {
  const archive = createArchiveFromMarkdown(transcript);
  const plan = createAiPlan(archive, {
    provider: "openai",
    model: "gpt-5",
    task: "summary",
    maxInputChars: 1_000,
    maxOutputTokens: 64,
  });
  assert.equal(plan.inputChars, plan.prompt.length);
  assert.ok(plan.inputChars <= 1_000);
  assert.doesNotThrow(() => validateAiPlan(plan));
  const tampered = structuredClone(plan);
  tampered.prompt += " changed";
  assert.throws(() => validateAiPlan(tampered), SecurityError);

  let called = false;
  await assert.rejects(() => invokeAiPlan(plan, {
    consentId: plan.consentId,
    environment: { CONTEXT_LEDGER_OPENAI_API_KEY: "a".repeat(20) },
    fetchImpl: async () => { called = true; throw new Error("must not reach network"); },
  }), SecurityError);
  assert.equal(called, false);
});

test("AI response handling uses an explicitly approved mock request and never stores the API key", async () => {
  const archive = createArchiveFromMarkdown(transcript);
  const plan = createAiPlan(archive, {
    provider: "openai",
    model: "gpt-5",
    task: "extract",
    maxInputChars: 1_000,
    maxOutputTokens: 64,
  });
  const secret = "k".repeat(20);
  let request;
  const result = await invokeAiPlan(plan, {
    consentId: plan.consentId,
    allowRemote: true,
    environment: { CONTEXT_LEDGER_OPENAI_API_KEY: secret },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        output: [
          { type: "reasoning", content: [{ type: "summary_text", text: "ignored" }] },
          { type: "message", content: [{ type: "output_text", text: "- decision: use PKCE [event:evt_0002_d38232af6ec3]" }] },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.init.redirect, "error");
  assert.equal(request.init.headers.Authorization, `Bearer ${secret}`);
  assert.match(result.text, /PKCE/u);
  assert.equal(result.untrustedGeneratedContent, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret, "u"));
});

test("project graphs use checksummed archive nodes, canonical edges, and bounded handoffs", () => {
  const archive = createArchiveFromMarkdown(transcript);
  const reorderedArchive = {
    events: archive.events.map((event) => ({ contentSha256: event.contentSha256, content: event.content, role: event.role, sequence: event.sequence, id: event.id })),
    transcript: { content: archive.transcript.content, sha256: archive.transcript.sha256, byteLength: archive.transcript.byteLength, encoding: archive.transcript.encoding },
    security: { aiProcessing: archive.security.aiProcessing, untrustedContent: archive.security.untrustedContent },
    capture: { confidence: archive.capture.confidence, method: archive.capture.method },
    title: archive.title,
    createdAt: archive.createdAt,
    archiveId: archive.archiveId,
    schema: archive.schema,
  };
  assert.equal(canonicalArchiveSha256(archive), canonicalArchiveSha256(reorderedArchive));
  const project = createProject("Demo project");
  project.archives.push({
    id: archive.archiveId,
    path: "archives/demo/archive.aicx.json",
    title: archive.title,
    transcriptSha256: archive.transcript.sha256,
    archiveSha256: canonicalArchiveSha256(archive),
  });
  project.artifacts.push({ id: "art_11111111-1111-4111-8111-111111111111", kind: "file", path: "fixtures/example.md", name: "example.md", sha256: sha256Text("fixture") });
  addProjectEdge(project, project.artifacts[0].id, archive.archiveId, "related");
  assert.doesNotThrow(() => validateProject(project));
  assert.equal(project.edges[0].from, archive.archiveId);
  assert.match(buildProjectHandoff(project), /untrusted historical data/u);
  assert.throws(() => addProjectEdge(project, archive.archiveId, project.artifacts[0].id, "related"), SecurityError);
});

test("project verification rejects claims whose evidence cannot be verified", async () => {
  const archive = createArchiveFromMarkdown(transcript);
  const project = createProject("Claim integrity");
  project.archives.push({
    id: archive.archiveId,
    path: "fixtures/missing-archive.aicx.json",
    title: archive.title,
    transcriptSha256: archive.transcript.sha256,
    archiveSha256: canonicalArchiveSha256(archive),
  });
  project.claims.push({
    id: "clm_11111111-1111-4111-8111-111111111111",
    archiveId: archive.archiveId,
    eventId: archive.events[0].id,
    kind: "decision",
    note: "Only accept verifiable evidence.",
    createdAt: new Date().toISOString(),
  });
  const verification = await verifyProject(project);
  assert.equal(verification.valid, false);
  assert.equal(verification.claims[0].valid, false);
});

test("recorder exports only the strict normalized contract and plugin registry cannot execute code", () => {
  const recorder = new ConversationRecorder();
  recorder.record({ role: "user", content: "Keep the transcript exact." });
  const exported = recorder.toNormalizedImport("Recorder test");
  assert.equal(exported.messages[0].content, "Keep the transcript exact.");
  assert.throws(() => recorder.record({ role: "admin", content: "Nope" }), UsageError);
  assert.throws(() => recorder.record({ role: "user", content: "x".repeat(1024 * 1024 + 1) }), UsageError);
  const registry = parsePluginRegistry(JSON.stringify({
    schema: "context-ledger-plugin-registry/0.1",
    adapters: [{
      schema: "context-ledger-adapter-manifest/0.1",
      id: "safe-normalizer",
      name: "Safe normalizer",
      version: "1.0.0",
      inputFormat: "context-ledger-import/0.1",
      capabilities: ["normalize-only"],
      securityContact: "security@example.invalid",
    }],
  }));
  assert.equal(registry.adapters[0].id, "safe-normalizer");
  assert.throws(() => parsePluginRegistry(JSON.stringify({ schema: "context-ledger-plugin-registry/0.1", adapters: [], execute: "never" })), SecurityError);
});

test("recorder enforces an aggregate conversation byte limit", () => {
  const recorder = new ConversationRecorder();
  const megabyte = "x".repeat(1024 * 1024);
  for (let index = 0; index < 4; index += 1) recorder.record({ role: "user", content: megabyte });
  assert.throws(() => recorder.record({ role: "assistant", content: "one byte too far" }), SecurityError);
});
