import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SecurityError, UsageError } from "./errors.js";

export const MAX_LOCAL_BYTES = 10 * 1024 * 1024;

function isMissing(error) {
  return error && error.code === "ENOENT";
}

function requireRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new UsageError(`${label} must be a non-empty relative path.`);
  }
  if (value.includes("\0") || /[\u0000-\u001f\u007f]/u.test(value) || path.isAbsolute(value)) {
    throw new SecurityError(`${label} must be a relative path without control characters.`);
  }
  const pieces = value.split(/[\\/]/u);
  if (pieces.some((piece) => piece === "" || piece === "." || piece === "..")) {
    throw new SecurityError(`${label} may not contain empty, '.' or '..' segments.`);
  }
  return value;
}

async function assertExistingPathHasNoSymlink(absolutePath) {
  const parsed = path.parse(absolutePath);
  const relative = path.relative(parsed.root, absolutePath);
  let current = parsed.root;

  for (const piece of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, piece);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new SecurityError(`Refusing symbolic-link path component: ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

export async function resolveOutputPath(relativePath) {
  requireRelativePath(relativePath, "Output path");
  const workingDirectory = path.resolve(process.cwd());
  const destination = path.resolve(workingDirectory, relativePath);
  if (!destination.startsWith(`${workingDirectory}${path.sep}`)) {
    throw new SecurityError("Output path escapes the current working directory.");
  }
  await assertExistingPathHasNoSymlink(destination);
  return destination;
}

export async function resolveWorkspacePath(inputPath, label = "Path") {
  requireRelativePath(inputPath, label);
  const workingDirectory = path.resolve(process.cwd());
  const destination = path.resolve(workingDirectory, inputPath);
  if (!destination.startsWith(`${workingDirectory}${path.sep}`)) {
    throw new SecurityError(`${label} escapes the current working directory.`);
  }
  await assertExistingPathHasNoSymlink(destination);
  return destination;
}

export async function workspaceRelativePath(inputPath, label = "Path") {
  if (typeof inputPath !== "string" || inputPath.length === 0 || inputPath.includes("\0")) {
    throw new UsageError(`${label} is required.`);
  }
  const workingDirectory = path.resolve(process.cwd());
  const absolutePath = path.resolve(inputPath);
  const relativePath = path.relative(workingDirectory, absolutePath);
  requireRelativePath(relativePath, label);
  await assertExistingPathHasNoSymlink(absolutePath);
  return relativePath;
}

export async function requireSafeDirectory(inputPath, label = "Directory") {
  const relativePath = await workspaceRelativePath(inputPath, label);
  const absolutePath = await resolveWorkspacePath(relativePath, label);
  const details = await lstat(absolutePath);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new SecurityError(`${label} must be a non-symbolic-link directory.`);
  }
  return { absolutePath, relativePath };
}

export async function readSafeFile(inputPath, maxBytes = MAX_LOCAL_BYTES) {
  if (typeof inputPath !== "string" || inputPath.length === 0 || inputPath.includes("\0")) {
    throw new UsageError("Input path is required.");
  }
  const absolutePath = path.resolve(inputPath);
  await assertExistingPathHasNoSymlink(absolutePath);
  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile()) throw new SecurityError("Input must be a regular file.");
    if (details.size > maxBytes) throw new SecurityError(`Input exceeds ${maxBytes} byte safety limit.`);
    return await handle.readFile();
  } finally {
    await handle?.close();
  }
}

export function decodeUtf8(buffer, label = "Input") {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new SecurityError(`${label} is not valid UTF-8.`);
  }
}

export async function ensurePrivateDirectory(relativePath) {
  const destination = await resolveOutputPath(relativePath);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await assertExistingPathHasNoSymlink(destination);
  const details = await lstat(destination);
  if (!details.isDirectory()) throw new SecurityError("Output directory is not a directory.");
  return destination;
}

export async function writeNewFile(relativePath, data) {
  const destination = await resolveOutputPath(relativePath);
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertExistingPathHasNoSymlink(parent);
  let handle;
  try {
    handle = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(data);
  } finally {
    await handle?.close();
  }
  return destination;
}

export async function replaceRegularFile(absolutePath, data) {
  await assertExistingPathHasNoSymlink(path.dirname(absolutePath));
  try {
    const details = await lstat(absolutePath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new SecurityError("Refusing to replace a non-regular or symbolic-link file.");
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const temporary = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(data);
  } finally {
    await handle?.close();
  }
  await rename(temporary, absolutePath);
}

export async function existsRegularFile(absolutePath) {
  try {
    const details = await lstat(absolutePath);
    return details.isFile() && !details.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function readSafeUtf8(inputPath, maxBytes = MAX_LOCAL_BYTES) {
  return decodeUtf8(await readSafeFile(inputPath, maxBytes));
}

export async function readUtf8UncheckedForTests(inputPath) {
  return readFile(inputPath, "utf8");
}
