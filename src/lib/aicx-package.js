import { readAnnotations, validateAnnotations, validateArchive, writeArchiveBundle } from "./archive.js";
import { manualGraphEdges, readConversationGraph, validateConversationGraph, writeConversationGraph } from "./conversation-graph.js";
import { SecurityError, UsageError } from "./errors.js";
import { decodeUtf8, readSafeFile, workspaceRelativePath, writeNewFile } from "./fs-safe.js";
import { sha256 } from "./hash.js";
import { assertIndexMatchesArchive, buildInvertedIndex, validateInvertedIndex, writeInvertedIndex } from "./inverted-index.js";

export const PACKAGE_SCHEMA = "context-ledger-package/1.1";
export const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;

const ARCHIVE_ENTRY = "archive.aicx.json";
const INDEX_ENTRY = "archive.aicx.json.index.json";
const ANNOTATIONS_ENTRY = "archive.aicx.json.annotations.json";
const GRAPH_ENTRY = "archive.aicx.json.graph.json";
const MANIFEST_ENTRY = "manifest.json";
const ENTRY_ORDER = [MANIFEST_ENTRY, ARCHIVE_ENTRY, INDEX_ENTRY, ANNOTATIONS_ENTRY, GRAPH_ENTRY];
const REQUIRED_ENTRIES = new Set([MANIFEST_ENTRY, ARCHIVE_ENTRY, INDEX_ENTRY]);
const OPTIONAL_ENTRIES = new Set([ANNOTATIONS_ENTRY, GRAPH_ENTRY]);
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_ANNOTATIONS_BYTES = 2 * 1024 * 1024;

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SecurityError(`${label} must be an object.`);
  }
}

function assertOnlyFields(value, fields, label) {
  if (Object.keys(value).some((key) => !fields.has(key))) {
    throw new SecurityError(`${label} has unsupported fields.`);
  }
}

function parseJson(buffer, label) {
  let value;
  try {
    value = JSON.parse(decodeUtf8(buffer, label));
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError(`${label} is not valid JSON.`);
  }
  return value;
}

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function entryName(buffer, label) {
  const value = decodeUtf8(buffer, label);
  if (!ENTRY_ORDER.includes(value)) throw new SecurityError("Package contains an unsupported entry path.");
  if (!/^[\x20-\x7e]+$/u.test(value)) throw new SecurityError("Package entry path is invalid.");
  return value;
}

function assertEntryBytes(name, bytes) {
  const maximum = name === MANIFEST_ENTRY
    ? MAX_MANIFEST_BYTES
    : name === ANNOTATIONS_ENTRY
      ? MAX_ANNOTATIONS_BYTES
    : name === GRAPH_ENTRY
      ? 16 * 1024 * 1024
      : 10 * 1024 * 1024;
  if (bytes.length > maximum) throw new SecurityError(`Package entry ${name} exceeds its safety limit.`);
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function requireUInt32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new SecurityError(`${label} is outside the portable-package size limit.`);
  }
}

function localHeader(name, data, checksum) {
  const nameBytes = Buffer.from(name, "ascii");
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  header.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes, data]);
}

function centralHeader(name, data, checksum, localOffset) {
  const nameBytes = Buffer.from(name, "ascii");
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES);
  header.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, nameBytes]);
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const footer = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_BYTES);
  footer.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralSize, 12);
  footer.writeUInt32LE(centralOffset, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

/**
 * Writes the deliberately tiny stored-only ZIP subset used by Context Ledger.
 * It never accepts or creates compression, extra fields, comments, directories,
 * data descriptors, ZIP64 records, or arbitrary filenames.
 */
function writeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (!ENTRY_ORDER.includes(name)) throw new SecurityError("Package writer received an unsupported entry path.");
    assertEntryBytes(name, data);
    requireUInt32(offset, "Package offset");
    const checksum = crc32(data);
    const local = localHeader(name, data, checksum);
    localParts.push(local);
    centralParts.push(centralHeader(name, data, checksum, offset));
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  requireUInt32(offset, "Package central-directory offset");
  requireUInt32(central.length, "Package central-directory length");
  const result = Buffer.concat([...localParts, central, endOfCentralDirectory(entries.length, central.length, offset)]);
  if (result.length > MAX_PACKAGE_BYTES) throw new SecurityError("Portable package exceeds the 24 MiB safety limit.");
  return result;
}

function readUInt32(buffer, offset, label) {
  if (offset < 0 || offset + 4 > buffer.length) throw new SecurityError(`Malformed portable package ${label}.`);
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer, offset, label) {
  if (offset < 0 || offset + 2 > buffer.length) throw new SecurityError(`Malformed portable package ${label}.`);
  return buffer.readUInt16LE(offset);
}

function parseStoredZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < END_OF_CENTRAL_DIRECTORY_BYTES) {
    throw new SecurityError("Portable package is too small to be valid.");
  }
  if (buffer.length > MAX_PACKAGE_BYTES) throw new SecurityError("Portable package exceeds the 24 MiB safety limit.");
  const footerOffset = buffer.length - END_OF_CENTRAL_DIRECTORY_BYTES;
  if (readUInt32(buffer, footerOffset, "footer") !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new SecurityError("Portable package does not have the required ZIP footer.");
  }
  if (
    readUInt16(buffer, footerOffset + 4, "footer") !== 0 ||
    readUInt16(buffer, footerOffset + 6, "footer") !== 0 ||
    readUInt16(buffer, footerOffset + 20, "footer") !== 0
  ) {
    throw new SecurityError("Portable package uses an unsupported multi-disk or commented ZIP feature.");
  }
  const entryCount = readUInt16(buffer, footerOffset + 8, "footer");
  if (entryCount !== readUInt16(buffer, footerOffset + 10, "footer") || entryCount < 3 || entryCount > 5) {
    throw new SecurityError("Portable package has an invalid entry count.");
  }
  const centralSize = readUInt32(buffer, footerOffset + 12, "footer");
  const centralOffset = readUInt32(buffer, footerOffset + 16, "footer");
  if (centralOffset + centralSize !== footerOffset || centralOffset >= footerOffset) {
    throw new SecurityError("Portable package central directory is invalid.");
  }

  const locals = new Map();
  const localNames = [];
  let cursor = 0;
  while (cursor < centralOffset) {
    const localOffset = cursor;
    if (readUInt32(buffer, cursor, "local header") !== LOCAL_FILE_SIGNATURE) {
      throw new SecurityError("Portable package has an invalid local file header.");
    }
    if (
      readUInt16(buffer, cursor + 4, "local header") !== 20 ||
      readUInt16(buffer, cursor + 6, "local header") !== 0 ||
      readUInt16(buffer, cursor + 8, "local header") !== 0 ||
      readUInt16(buffer, cursor + 10, "local header") !== 0 ||
      readUInt16(buffer, cursor + 12, "local header") !== 0 ||
      readUInt16(buffer, cursor + 28, "local header") !== 0
    ) {
      throw new SecurityError("Portable package uses an unsupported ZIP local-file feature.");
    }
    const checksum = readUInt32(buffer, cursor + 14, "local header");
    const compressedBytes = readUInt32(buffer, cursor + 18, "local header");
    const uncompressedBytes = readUInt32(buffer, cursor + 22, "local header");
    const nameBytes = readUInt16(buffer, cursor + 26, "local header");
    if (compressedBytes !== uncompressedBytes) throw new SecurityError("Portable package may not use compressed entries.");
    const nameStart = cursor + LOCAL_HEADER_BYTES;
    const dataStart = nameStart + nameBytes;
    const dataEnd = dataStart + compressedBytes;
    if (dataEnd > centralOffset || dataEnd < dataStart) throw new SecurityError("Portable package local entry exceeds its allowed region.");
    const name = entryName(buffer.subarray(nameStart, dataStart), "Package entry path");
    const data = Buffer.from(buffer.subarray(dataStart, dataEnd));
    assertEntryBytes(name, data);
    if (crc32(data) !== checksum) throw new SecurityError("Portable package entry checksum failed.");
    if (locals.has(name)) throw new SecurityError("Portable package contains duplicate entries.");
    locals.set(name, { checksum, data, localOffset });
    localNames.push(name);
    cursor = dataEnd;
  }
  if (cursor !== centralOffset || locals.size !== entryCount) {
    throw new SecurityError("Portable package local entries do not match its directory.");
  }

  let centralCursor = centralOffset;
  const centralNames = [];
  while (centralCursor < footerOffset) {
    if (readUInt32(buffer, centralCursor, "central directory") !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new SecurityError("Portable package has an invalid central-directory header.");
    }
    if (
      readUInt16(buffer, centralCursor + 4, "central directory") !== 20 ||
      readUInt16(buffer, centralCursor + 6, "central directory") !== 20 ||
      readUInt16(buffer, centralCursor + 8, "central directory") !== 0 ||
      readUInt16(buffer, centralCursor + 10, "central directory") !== 0 ||
      readUInt16(buffer, centralCursor + 12, "central directory") !== 0 ||
      readUInt16(buffer, centralCursor + 14, "central directory") !== 0 ||
      readUInt16(buffer, centralCursor + 30, "central directory") !== 0 ||
      readUInt16(buffer, centralCursor + 32, "central directory") !== 0 ||
      readUInt16(buffer, centralCursor + 34, "central directory") !== 0 ||
      readUInt16(buffer, centralCursor + 36, "central directory") !== 0 ||
      readUInt32(buffer, centralCursor + 38, "central directory") !== 0
    ) {
      throw new SecurityError("Portable package uses an unsupported ZIP directory feature.");
    }
    const checksum = readUInt32(buffer, centralCursor + 16, "central directory");
    const compressedBytes = readUInt32(buffer, centralCursor + 20, "central directory");
    const uncompressedBytes = readUInt32(buffer, centralCursor + 24, "central directory");
    const nameBytes = readUInt16(buffer, centralCursor + 28, "central directory");
    const localOffset = readUInt32(buffer, centralCursor + 42, "central directory");
    if (compressedBytes !== uncompressedBytes) throw new SecurityError("Portable package may not use compressed entries.");
    const nameStart = centralCursor + CENTRAL_HEADER_BYTES;
    const next = nameStart + nameBytes;
    if (next > footerOffset || next < nameStart) throw new SecurityError("Portable package central-directory entry is truncated.");
    const name = entryName(buffer.subarray(nameStart, next), "Package entry path");
    const local = locals.get(name);
    if (!local || local.checksum !== checksum || local.data.length !== uncompressedBytes || local.localOffset !== localOffset) {
      throw new SecurityError("Portable package central-directory entry does not match its local entry.");
    }
    centralNames.push(name);
    centralCursor = next;
  }
  if (centralCursor !== footerOffset || centralNames.length !== entryCount || new Set(centralNames).size !== entryCount) {
    throw new SecurityError("Portable package central directory is inconsistent.");
  }
  const expectedNames = ENTRY_ORDER.filter((name) => locals.has(name));
  if (
    JSON.stringify(localNames) !== JSON.stringify(expectedNames) ||
    JSON.stringify(centralNames) !== JSON.stringify(expectedNames)
  ) {
    throw new SecurityError("Portable package entry order is invalid.");
  }
  for (const required of REQUIRED_ENTRIES) if (!locals.has(required)) throw new SecurityError(`Portable package is missing ${required}.`);
  for (const name of locals.keys()) if (!REQUIRED_ENTRIES.has(name) && !OPTIONAL_ENTRIES.has(name)) throw new SecurityError("Portable package contains an unsupported entry.");
  return new Map([...locals.entries()].map(([name, entry]) => [name, entry.data]));
}

function manifestFor(archive, files) {
  return {
    schema: PACKAGE_SCHEMA,
    archiveId: archive.archiveId,
    transcriptSha256: archive.transcript.sha256,
    files: files.map(({ name, data }) => ({ path: name, byteLength: data.length, sha256: sha256(data) })),
  };
}

function validateManifest(manifest, entries, archive) {
  assertPlainObject(manifest, "Package manifest");
  assertOnlyFields(manifest, new Set(["schema", "archiveId", "transcriptSha256", "files"]), "Package manifest");
  if (
    !new Set(["context-ledger-package/1.0", PACKAGE_SCHEMA]).has(manifest.schema) ||
    manifest.archiveId !== archive.archiveId ||
    manifest.transcriptSha256 !== archive.transcript.sha256 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== entries.size - 1
  ) {
    throw new SecurityError("Package manifest does not match its archive.");
  }
  const expected = ENTRY_ORDER.filter((name) => name !== MANIFEST_ENTRY && entries.has(name));
  if (manifest.schema === "context-ledger-package/1.0" && entries.has(GRAPH_ENTRY)) {
    throw new SecurityError("Package schema 1.0 may not contain a conversation graph.");
  }
  const observed = [];
  for (const file of manifest.files) {
    assertPlainObject(file, "Package manifest file");
    assertOnlyFields(file, new Set(["path", "byteLength", "sha256"]), "Package manifest file");
    const data = entries.get(file.path);
    if (
      typeof file.path !== "string" ||
      !entries.has(file.path) ||
      file.path === MANIFEST_ENTRY ||
      !Number.isSafeInteger(file.byteLength) ||
      file.byteLength < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(file.sha256) ||
      data.length !== file.byteLength ||
      sha256(data) !== file.sha256
    ) {
      throw new SecurityError("Package manifest file integrity check failed.");
    }
    observed.push(file.path);
  }
  if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new SecurityError("Package manifest file order is invalid.");
  return manifest;
}

function validatePackageEntries(entries) {
  const archive = validateArchive(parseJson(entries.get(ARCHIVE_ENTRY), "Package archive"));
  const index = validateInvertedIndex(parseJson(entries.get(INDEX_ENTRY), "Package index"), archive);
  assertIndexMatchesArchive(index, archive);
  let annotations;
  if (entries.has(ANNOTATIONS_ENTRY)) {
    annotations = validateAnnotations(parseJson(entries.get(ANNOTATIONS_ENTRY), "Package annotations"), archive);
  }
  let graph;
  if (entries.has(GRAPH_ENTRY)) {
    graph = validateConversationGraph(parseJson(entries.get(GRAPH_ENTRY), "Package conversation graph"), archive);
  }
  const manifest = validateManifest(parseJson(entries.get(MANIFEST_ENTRY), "Package manifest"), entries, archive);
  return { manifest, archive, index, annotations, graph };
}

function createPackageEntries(archive, annotations, graph) {
  validateArchive(archive);
  const index = buildInvertedIndex(archive);
  const files = [
    { name: ARCHIVE_ENTRY, data: encodeJson(archive) },
    { name: INDEX_ENTRY, data: encodeJson(index) },
  ];
  if (annotations.items.length > 0) {
    validateAnnotations(annotations, archive);
    files.push({ name: ANNOTATIONS_ENTRY, data: encodeJson(annotations) });
  }
  if (graph && manualGraphEdges(graph).length > 0) {
    validateConversationGraph(graph, archive);
    files.push({ name: GRAPH_ENTRY, data: encodeJson(graph) });
  }
  return [{ name: MANIFEST_ENTRY, data: encodeJson(manifestFor(archive, files)) }, ...files];
}

export async function exportPortablePackage(archivePath, outputPath) {
  if (!outputPath.endsWith(".aicx")) throw new UsageError("Portable package output must end in .aicx.");
  const archiveJson = parseJson(await readSafeFile(archivePath), "Archive");
  const archive = validateArchive(archiveJson);
  const annotations = await readAnnotations(archivePath, archive);
  const graph = await readConversationGraph(archivePath, archive);
  const packageBytes = writeStoredZip(createPackageEntries(archive, annotations, graph));
  const output = await writeNewFile(outputPath, packageBytes);
  return {
    package: output,
    archiveId: archive.archiveId,
    entries: 3 + (annotations.items.length > 0 ? 1 : 0) + (graph && manualGraphEdges(graph).length > 0 ? 1 : 0),
    byteLength: packageBytes.length,
  };
}

export async function importPortablePackage(inputPath, outputDirectory) {
  if (!inputPath.endsWith(".aicx")) throw new UsageError("Portable package input must end in .aicx.");
  const entries = parseStoredZip(await readSafeFile(inputPath, MAX_PACKAGE_BYTES));
  const parsed = validatePackageEntries(entries);
  const bundle = await writeArchiveBundle(parsed.archive, outputDirectory);
  try {
    const index = await writeInvertedIndex(bundle.archive, parsed.archive, parsed.index);
    let annotationPath;
    if (parsed.annotations) {
      const archiveRelative = await workspaceRelativePath(bundle.archive, "Imported archive");
      annotationPath = await writeNewFile(`${archiveRelative}.annotations.json`, encodeJson(parsed.annotations));
    }
    let graphPath;
    if (parsed.graph) {
      graphPath = (await writeConversationGraph(
        bundle.archive,
        parsed.archive,
        manualGraphEdges(parsed.graph),
      )).path;
    }
    return {
      archiveId: parsed.archive.archiveId,
      archive: bundle.archive,
      directory: bundle.directory,
      index: index.path,
      annotations: annotationPath,
      graph: graphPath,
      entries: entries.size,
    };
  } catch (error) {
    throw new SecurityError(`Portable package archive was only partially imported; inspect ${bundle.directory}: ${error.message}`);
  }
}

export function parsePortablePackageForTests(buffer) {
  return validatePackageEntries(parseStoredZip(buffer));
}
