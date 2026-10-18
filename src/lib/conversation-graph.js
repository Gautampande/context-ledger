import { decodeUtf8, existsRegularFile, readSafeFile, replaceRegularFile, resolveOutputPath, workspaceRelativePath } from "./fs-safe.js";
import { SecurityError, UsageError } from "./errors.js";
import { sha256Text } from "./hash.js";

export const CONVERSATION_GRAPH_SCHEMA = "context-ledger-conversation-graph/0.1";
const MAX_GRAPH_BYTES = 16 * 1024 * 1024;
const MANUAL_EDGE_KINDS = new Set(["supports", "clarifies", "supersedes", "depends_on", "answers", "relates_to"]);
const GRAPH_FIELDS = new Set(["schema", "archiveId", "transcriptSha256", "nodes", "edges", "integrity"]);
const NODE_FIELDS = new Set(["id", "sequence", "role", "contentSha256"]);
const EDGE_FIELDS = new Set(["from", "to", "kind"]);
const INTEGRITY_FIELDS = new Set(["algorithm", "payloadSha256"]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SecurityError(`${label} must be an object.`);
  }
}

function assertOnlyFields(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new SecurityError(`${label} has unsupported fields.`);
  }
}

function graphPayload(graph) {
  return {
    schema: graph.schema,
    archiveId: graph.archiveId,
    transcriptSha256: graph.transcriptSha256,
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

function graphHash(graph) {
  return sha256Text(JSON.stringify(graphPayload(graph)));
}

function expectedNodes(archive) {
  return archive.events.map(({ id, sequence, role, contentSha256 }) => ({ id, sequence, role, contentSha256 }));
}

function expectedNextEdges(archive) {
  return archive.events.slice(0, -1).map((event, index) => ({
    from: event.id,
    to: archive.events[index + 1].id,
    kind: "next",
  }));
}

function canonicalManualEdges(archive, value) {
  if (!Array.isArray(value) || value.length > 20_000) {
    throw new SecurityError("Conversation graph manual edges are invalid.");
  }
  const sequenceById = new Map(archive.events.map((event) => [event.id, event.sequence]));
  const seen = new Set();
  const edges = value.map((edge) => {
    assertPlainObject(edge, "Conversation graph edge");
    assertOnlyFields(edge, EDGE_FIELDS, "Conversation graph edge");
    if (
      typeof edge.from !== "string" ||
      typeof edge.to !== "string" ||
      !MANUAL_EDGE_KINDS.has(edge.kind) ||
      !sequenceById.has(edge.from) ||
      !sequenceById.has(edge.to) ||
      sequenceById.get(edge.from) >= sequenceById.get(edge.to)
    ) {
      throw new SecurityError("Conversation graph manual edges must be known, forward-in-time event relationships.");
    }
    const unique = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
    if (seen.has(unique)) throw new SecurityError("Conversation graph contains duplicate manual edges.");
    seen.add(unique);
    return { from: edge.from, to: edge.to, kind: edge.kind };
  });
  return edges.sort((left, right) => (
    sequenceById.get(left.from) - sequenceById.get(right.from) ||
    sequenceById.get(left.to) - sequenceById.get(right.to) ||
    (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0)
  ));
}

function expectedEdges(archive, manualEdges) {
  return [...expectedNextEdges(archive), ...canonicalManualEdges(archive, manualEdges)];
}

export function buildConversationGraph(archive, manualEdges = []) {
  const graph = {
    schema: CONVERSATION_GRAPH_SCHEMA,
    archiveId: archive.archiveId,
    transcriptSha256: archive.transcript.sha256,
    nodes: expectedNodes(archive),
    edges: expectedEdges(archive, manualEdges),
  };
  return { ...graph, integrity: { algorithm: "sha256", payloadSha256: graphHash(graph) } };
}

export function validateConversationGraph(value, archive) {
  assertPlainObject(value, "Conversation graph");
  assertOnlyFields(value, GRAPH_FIELDS, "Conversation graph");
  if (
    value.schema !== CONVERSATION_GRAPH_SCHEMA ||
    value.archiveId !== archive.archiveId ||
    value.transcriptSha256 !== archive.transcript.sha256 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !value.integrity
  ) {
    throw new SecurityError("Conversation graph does not match this archive.");
  }
  for (const node of value.nodes) {
    assertPlainObject(node, "Conversation graph node");
    assertOnlyFields(node, NODE_FIELDS, "Conversation graph node");
  }
  assertPlainObject(value.integrity, "Conversation graph integrity");
  assertOnlyFields(value.integrity, INTEGRITY_FIELDS, "Conversation graph integrity");
  if (value.integrity.algorithm !== "sha256" || typeof value.integrity.payloadSha256 !== "string") {
    throw new SecurityError("Conversation graph integrity is invalid.");
  }
  const manualEdges = value.edges.filter((edge) => edge?.kind !== "next");
  const expected = buildConversationGraph(archive, manualEdges);
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new SecurityError("Conversation graph does not exactly match its archive and canonical manual edges.");
  }
  return value;
}

function graphPath(archivePath) {
  return `${archivePath}.graph.json`;
}

async function safeArchivePath(archivePath) {
  const relative = await workspaceRelativePath(archivePath, "Archive");
  return resolveOutputPath(relative);
}

function serializeGraph(graph) {
  const text = `${JSON.stringify(graph, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_GRAPH_BYTES) {
    throw new SecurityError("Conversation graph exceeds the 16 MiB safety limit.");
  }
  return text;
}

export async function readConversationGraph(archivePath, archive) {
  const candidate = graphPath(archivePath);
  if (!(await existsRegularFile(candidate))) return null;
  let graph;
  try {
    graph = JSON.parse(decodeUtf8(await readSafeFile(candidate, MAX_GRAPH_BYTES), "Conversation graph"));
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError("Conversation graph is not valid JSON.");
  }
  return validateConversationGraph(graph, archive);
}

export async function writeConversationGraph(archivePath, archive, manualEdges = []) {
  const safeArchive = await safeArchivePath(archivePath);
  const graph = buildConversationGraph(archive, manualEdges);
  const target = graphPath(safeArchive);
  await replaceRegularFile(target, serializeGraph(graph));
  return { path: target, graph };
}

export async function rebuildConversationGraph(archivePath, archive) {
  const existing = await readConversationGraph(archivePath, archive);
  const manualEdges = existing ? existing.edges.filter((edge) => edge.kind !== "next") : [];
  return writeConversationGraph(archivePath, archive, manualEdges);
}

export async function addConversationGraphEdge(archivePath, archive, edge) {
  if (!edge || typeof edge !== "object") throw new UsageError("Conversation graph edge is required.");
  const existing = await readConversationGraph(archivePath, archive);
  const manualEdges = existing ? existing.edges.filter((item) => item.kind !== "next") : [];
  const result = await writeConversationGraph(archivePath, archive, [...manualEdges, edge]);
  return result;
}

export function manualGraphEdges(graph) {
  return graph.edges.filter((edge) => edge.kind !== "next");
}

export function conversationGraphSidecarPath(archivePath) {
  return graphPath(archivePath);
}
