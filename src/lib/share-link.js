import { createHash } from "node:crypto";
import { decodeUtf8, writeNewFile } from "./fs-safe.js";
import { SecurityError, UsageError } from "./errors.js";

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const ALLOWED_SHARE_URLS = [
  { provider: "chatgpt", host: "chatgpt.com", prefix: "/share/" },
  { provider: "claude", host: "claude.ai", prefix: "/share/" },
  { provider: "gemini", host: "g.co", prefix: "/gemini/share/" },
  { provider: "gemini", host: "gemini.google.com", prefix: "/share/" },
];

function inspectShareUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new UsageError("Share link must be a valid URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash ||
    parsed.search ||
    parsed.hostname !== parsed.hostname.toLowerCase()
  ) {
    throw new SecurityError("Share link must be a clean HTTPS URL with no credentials, port, query, or fragment.");
  }
  const match = ALLOWED_SHARE_URLS.find(
    (allowed) => parsed.hostname === allowed.host && parsed.pathname.startsWith(allowed.prefix),
  );
  if (!match) throw new SecurityError("Share-link host or path is not supported by this release.");
  return { parsed, provider: match.provider };
}

async function readBoundedBody(response) {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_HTML_BYTES) {
    throw new SecurityError("Shared page exceeds the 5 MiB safety limit.");
  }
  if (!response.body) throw new SecurityError("Shared page did not include a response body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) throw new SecurityError("Shared page exceeds the 5 MiB safety limit.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/**
 * Fetches only an allowlisted public share page. The returned content remains
 * untrusted; callers must use a provider-specific parser before treating it as
 * conversation text. URLs are hashed in returned metadata and never persisted.
 */
export async function fetchApprovedSharedPage(shareUrl, { fetchImpl = fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new UsageError("A fetch implementation is required.");
  let { parsed: current, provider } = inspectShareUrl(shareUrl);
  const aborter = new AbortController();
  const timeout = setTimeout(() => aborter.abort(), TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: aborter.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ContextLedger/1.1 public-snapshot",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new SecurityError("Shared page sent a redirect without a location.");
        ({ parsed: current, provider } = inspectShareUrl(new URL(location, current).toString()));
        continue;
      }
      if (!response.ok) throw new SecurityError(`Shared page returned HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type") || "";
      if (!/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/iu.test(contentType)) {
        throw new SecurityError("Shared page did not return HTML.");
      }
      const body = await readBoundedBody(response);
      let html;
      try {
        html = decodeUtf8(body, "Shared page");
      } catch (error) {
        if (error instanceof SecurityError) throw error;
        throw new SecurityError("Shared page is not valid UTF-8 HTML.");
      }
      const digest = createHash("sha256").update(shareUrl).digest("hex");
      const pageHash = createHash("sha256").update(body).digest("hex");
      return {
        provider,
        html,
        sourceUrlSha256: digest,
        sourceHtmlSha256: pageHash,
        byteLength: body.byteLength,
      };
    }
    throw new SecurityError("Shared page exceeded the redirect limit.");
  } catch (error) {
    if (error?.name === "AbortError") throw new SecurityError("Shared-page request timed out after 10 seconds.");
    if (error instanceof SecurityError || error instanceof UsageError) throw error;
    throw new SecurityError("Unable to retrieve the shared page.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function acquireSharedSnapshot(shareUrl, outputDirectory, options = {}) {
  const page = await fetchApprovedSharedPage(shareUrl, options);
  const base = `${outputDirectory}/snapshot-${page.sourceHtmlSha256.slice(0, 16)}`;
  await writeNewFile(`${base}.html`, page.html);
  await writeNewFile(`${base}.json`, `${JSON.stringify({
    schema: "shared-snapshot/0.1",
    provider: page.provider,
    capturedAt: new Date().toISOString(),
    sourceUrlSha256: page.sourceUrlSha256,
    pageSha256: page.sourceHtmlSha256,
    byteLength: page.byteLength,
    parser: "none",
    warning: "Opaque untrusted HTML snapshot. It has not been parsed into a conversation transcript.",
  }, null, 2)}\n`);
  return { provider: page.provider, htmlPath: `${base}.html`, metadataPath: `${base}.json`, pageSha256: page.sourceHtmlSha256 };
}
