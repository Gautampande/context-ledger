import path from "node:path";
import { sha256Text } from "./hash.js";
import { decodeUtf8, existsRegularFile, MAX_LOCAL_BYTES, readSafeFile, replaceRegularFile, resolveOutputPath } from "./fs-safe.js";
import { SecurityError, UsageError } from "./errors.js";

export const INDEX_SCHEMA = "aicx-inverted-index/0.1";
const MAX_TERMS = 100_000;
const MAX_TOKEN_OCCURRENCES = 500_000;
const MAX_QUERY_TOKENS = 16;
const TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SecurityError(`${label} must be an object.`);
  }
}

export function tokenise(value, { query = false } = {}) {
  if (typeof value !== "string") throw new UsageError("Text must be a string.");
  if (query && (value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value))) {
    throw new UsageError("Search query must contain 1 to 256 non-control characters.");
  }
  const tokens = (value.normalize("NFKC").toLowerCase().match(TOKEN_PATTERN) || [])
    .filter((token) => token.length <= 128);
  const unique = [...new Set(tokens)];
  if (query && (unique.length === 0 || unique.length > MAX_QUERY_TOKENS)) {
    throw new UsageError(`Search query must contain 1 to ${MAX_QUERY_TOKENS} searchable terms.`);
  }
  return unique;
}

function indexPayload(index) {
  return {
    schema: index.schema,
    archiveId: index.archiveId,
    transcriptSha256: index.transcriptSha256,
    eventCount: index.eventCount,
    terms: index.terms,
  };
}

function indexHash(index) {
  return sha256Text(JSON.stringify(indexPayload(index)));
}

export function buildInvertedIndex(archive) {
  const postings = new Map();
  let tokenOccurrences = 0;
  for (const event of archive.events) {
    const uniqueTerms = tokenise(event.content);
    tokenOccurrences += uniqueTerms.length;
    if (tokenOccurrences > MAX_TOKEN_OCCURRENCES) {
      throw new SecurityError("Archive is too token-dense for the Phase 0.2 index safety limit.");
    }
    for (const term of uniqueTerms) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(event.id);
    }
  }
  if (postings.size > MAX_TERMS) throw new SecurityError("Archive has too many unique search terms.");
  const index = {
    schema: INDEX_SCHEMA,
    archiveId: archive.archiveId,
    transcriptSha256: archive.transcript.sha256,
    eventCount: archive.events.length,
    terms: [...postings.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  };
  return { ...index, integrity: { algorithm: "sha256", payloadSha256: indexHash(index) } };
}

export function validateInvertedIndex(value, archive) {
  assertPlainObject(value, "Search index");
  if (
    value.schema !== INDEX_SCHEMA ||
    value.archiveId !== archive.archiveId ||
    value.transcriptSha256 !== archive.transcript.sha256 ||
    value.eventCount !== archive.events.length ||
    !Array.isArray(value.terms) ||
    value.terms.length > MAX_TERMS ||
    !value.integrity ||
    value.integrity.algorithm !== "sha256" ||
    typeof value.integrity.payloadSha256 !== "string"
  ) {
    throw new SecurityError("Search index does not match this archive.");
  }
  const eventIds = new Set(archive.events.map((event) => event.id));
  let prior = "";
  let occurrences = 0;
  for (const entry of value.terms) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1])) {
      throw new SecurityError("Search index has an invalid term record.");
    }
    const [term, ids] = entry;
    if (term <= prior || tokenise(term).length !== 1 || tokenise(term)[0] !== term) {
      throw new SecurityError("Search index term order is invalid.");
    }
    prior = term;
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length || ids.length === 0 || ids.some((id) => typeof id !== "string" || !eventIds.has(id))) {
      throw new SecurityError("Search index postings are invalid.");
    }
    occurrences += ids.length;
    if (occurrences > MAX_TOKEN_OCCURRENCES) throw new SecurityError("Search index exceeds the safety limit.");
  }
  if (value.integrity.payloadSha256 !== indexHash(value)) {
    throw new SecurityError("Search index integrity check failed.");
  }
  return value;
}

function sidecarPath(archivePath) {
  return `${archivePath}.index.json`;
}

async function writableArchivePath(archivePath) {
  const absolute = path.resolve(archivePath);
  const relative = path.relative(process.cwd(), absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new SecurityError("Indexes may be written only for archives below the current working directory.");
  }
  return resolveOutputPath(relative);
}

export async function writeInvertedIndex(archivePath, archive) {
  const safeArchivePath = await writableArchivePath(archivePath);
  const index = buildInvertedIndex(archive);
  const target = sidecarPath(safeArchivePath);
  const serialized = `${JSON.stringify(index, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_LOCAL_BYTES) {
    throw new SecurityError("Search index exceeds the 10 MiB safety limit.");
  }
  await replaceRegularFile(target, serialized);
  return { path: target, index };
}

export async function readInvertedIndex(archivePath, archive) {
  const candidate = sidecarPath(archivePath);
  if (!(await existsRegularFile(candidate))) return null;
  let index;
  try {
    index = JSON.parse(decodeUtf8(await readSafeFile(candidate), "Search index"));
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError("Search index is not valid JSON.");
  }
  return validateInvertedIndex(index, archive);
}

export async function verifyInvertedIndex(archivePath, archive) {
  const actual = await readInvertedIndex(archivePath, archive);
  if (!actual) throw new SecurityError("No search index exists for this archive.");
  assertIndexMatchesArchive(actual, archive);
  return actual;
}

export function assertIndexMatchesArchive(actual, archive) {
  const expected = buildInvertedIndex(archive);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new SecurityError("Search index does not exactly match a deterministic rebuild from this archive.");
  }
}

function indexMap(index) {
  return new Map(index.terms);
}

function directSnippet(content, terms) {
  const lowered = content.normalize("NFKC").toLowerCase();
  const positions = terms.map((term) => lowered.indexOf(term)).filter((position) => position >= 0);
  const position = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, position - 100);
  const end = Math.min(content.length, position + 180);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).replace(/\r?\n/g, " ")}${end < content.length ? "…" : ""}`;
}

export function searchInvertedIndex(archive, index, query) {
  const terms = tokenise(query, { query: true });
  const postings = indexMap(index);
  const matches = terms.map((term) => postings.get(term) || []);
  if (matches.some((ids) => ids.length === 0)) return [];
  const candidates = new Set(matches[0]);
  for (const ids of matches.slice(1)) {
    const available = new Set(ids);
    for (const id of candidates) if (!available.has(id)) candidates.delete(id);
  }
  return archive.events
    .filter((event) => candidates.has(event.id))
    .map((event) => ({
      id: event.id,
      sequence: event.sequence,
      role: event.role,
      score: terms.length,
      snippet: directSnippet(event.content, terms),
    }))
    .sort((left, right) => right.score - left.score || left.sequence - right.sequence);
}
