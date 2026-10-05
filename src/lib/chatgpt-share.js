import { createArchiveFromSharedConversation, writeArchiveBundle } from "./archive.js";
import { SecurityError, UsageError } from "./errors.js";
import { writeInvertedIndex } from "./inverted-index.js";
import { fetchApprovedSharedPage } from "./share-link.js";

export const CHATGPT_SHARE_PARSER = "chatgpt-share-dom/0.1";
const MAX_HTML_CHARACTERS = 5 * 1024 * 1024;
const UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MESSAGE_OPEN_TAG = /<(article|div)\b([^>]*?\bdata-message-author-role\s*=\s*(["'])([^"']+)\3[^>]*)>/giu;
const TAG = /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*?)?>/gu;
const BLOCK_TAGS = new Set(["address", "article", "blockquote", "div", "dl", "dt", "dd", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "main", "ol", "p", "section", "table", "tbody", "tfoot", "thead", "tr", "ul"]);
const SUPPRESSED_TAGS = new Set(["script", "style", "template", "noscript"]);
const UNSUPPORTED_ARTIFACT = /<(?:audio|canvas|embed|iframe|img|input\b[^>]*\btype\s*=\s*["']?file|object|svg|video)\b|\bdata-(?:attachment|artifact|file|image)\b/iu;

function decodeEntities(value) {
  return value.replace(/&(?:#(x[0-9a-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/giu, (entity, numeric) => {
    if (numeric) {
      const codePoint = numeric[0].toLowerCase() === "x" ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "�";
      return String.fromCodePoint(codePoint);
    }
    return ({ "&amp;": "&", "&apos;": "'", "&gt;": ">", "&lt;": "<", "&nbsp;": " ", "&quot;": '"' })[entity.toLowerCase()];
  });
}

function tagName(token) {
  const match = /^<\/?([A-Za-z][A-Za-z0-9:-]*)/u.exec(token);
  return match?.[1].toLowerCase();
}

function isClosingTag(token) {
  return /^<\//u.test(token);
}

function isSelfClosingTag(token) {
  return /\/\s*>$/u.test(token) || /^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/iu.test(token);
}

function findElementEnd(html, openingEnd, elementName) {
  const matcher = new RegExp(TAG.source, "gu");
  matcher.lastIndex = openingEnd;
  let depth = 1;
  let token;
  while ((token = matcher.exec(html)) !== null) {
    if (token[0].startsWith("<!--")) continue;
    const name = tagName(token[0]);
    if (name !== elementName) continue;
    if (isClosingTag(token[0])) {
      depth -= 1;
      if (depth === 0) return { contentEnd: token.index, elementEnd: matcher.lastIndex };
    } else if (!isSelfClosingTag(token[0])) {
      depth += 1;
    }
  }
  throw new SecurityError("ChatGPT share page has an unclosed visible message container.");
}

function normalizeVisibleText(value) {
  const pieces = value.replace(/\r\n?/gu, "\n").split("```");
  for (let index = 0; index < pieces.length; index += 1) {
    if (index % 2 === 0) {
      pieces[index] = pieces[index]
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n");
    } else {
      // Keep code indentation and empty lines intact, including the adapter's fence
      // boundary newlines so the Markdown fence remains syntactically valid.
      pieces[index] = pieces[index];
    }
  }
  return pieces.join("```").replace(/^\n+|\n+$/gu, "");
}

/** Converts the supported page DOM to text without running or trusting its HTML. */
export function visibleTextFromHtml(fragment) {
  if (typeof fragment !== "string" || fragment.length > MAX_HTML_CHARACTERS) {
    throw new SecurityError("HTML message fragment exceeds the parser safety limit.");
  }
  let result = "";
  let last = 0;
  let suppressedDepth = 0;
  let preDepth = 0;
  let match;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(fragment)) !== null) {
    if (match.index > last && suppressedDepth === 0) {
      const text = decodeEntities(fragment.slice(last, match.index));
      result += preDepth > 0 ? text : text.replace(/[\n\r ]+/gu, " ");
    }
    last = TAG.lastIndex;
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    const name = tagName(token);
    if (!name) continue;
    const closing = isClosingTag(token);
    if (SUPPRESSED_TAGS.has(name)) {
      if (closing) suppressedDepth = Math.max(0, suppressedDepth - 1);
      else if (!isSelfClosingTag(token)) suppressedDepth += 1;
      continue;
    }
    if (suppressedDepth > 0) continue;
    if (name === "pre") {
      if (closing) {
        preDepth = Math.max(0, preDepth - 1);
        result += "\n```\n";
      } else if (!isSelfClosingTag(token)) {
        if (preDepth === 0) result += "\n```\n";
        preDepth += 1;
      }
      continue;
    }
    if (name === "br") {
      result += "\n";
    } else if ((name === "td" || name === "th") && closing) {
      result += "\t";
    } else if (BLOCK_TAGS.has(name)) {
      result += "\n";
    }
  }
  if (last < fragment.length && suppressedDepth === 0) {
    const text = decodeEntities(fragment.slice(last));
    result += preDepth > 0 ? text : text.replace(/[\n\r ]+/gu, " ");
  }
  if (preDepth !== 0 || suppressedDepth !== 0) {
    throw new SecurityError("ChatGPT share page has an unclosed unsupported HTML section.");
  }
  const normalized = normalizeVisibleText(result);
  if (UNSAFE_CONTROL.test(normalized)) throw new SecurityError("ChatGPT share message contains an unsafe control character.");
  return normalized;
}

function titleFromHtml(html) {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html);
  const candidate = titleMatch ? visibleTextFromHtml(titleMatch[1]) : "";
  const withoutProviderSuffix = candidate.replace(/\s*(?:[-|–—]\s*)?ChatGPT\s*$/iu, "").trim();
  const title = withoutProviderSuffix || "ChatGPT shared conversation";
  if (UNSAFE_CONTROL.test(title)) throw new SecurityError("ChatGPT share title contains an unsafe control character.");
  return Array.from(title).slice(0, 120).join("");
}

/**
 * Parses the deliberately narrow, visible message-container surface of a public
 * ChatGPT share page. It does not run browser code, access an account, read hidden
 * state, or attempt to reconstruct attachments. Unsupported visual artifacts fail
 * closed so they cannot be silently omitted from an otherwise text-only archive.
 */
export function parseChatGptSharedHtml(html) {
  if (typeof html !== "string" || html.length === 0 || html.length > MAX_HTML_CHARACTERS) {
    throw new SecurityError("ChatGPT share HTML is empty or exceeds the 5 MiB parser safety limit.");
  }
  if (UNSAFE_CONTROL.test(html)) throw new SecurityError("ChatGPT share HTML contains an unsafe control character.");
  const messages = [];
  let consumedThrough = 0;
  let match;
  MESSAGE_OPEN_TAG.lastIndex = 0;
  while ((match = MESSAGE_OPEN_TAG.exec(html)) !== null) {
    if (match.index < consumedThrough) continue;
    const container = match[1].toLowerCase();
    const role = match[4].toLowerCase();
    const end = findElementEnd(html, MESSAGE_OPEN_TAG.lastIndex, container);
    consumedThrough = end.elementEnd;
    if (role !== "user" && role !== "assistant") {
      throw new SecurityError("ChatGPT share page contains an unsupported visible message role.");
    }
    const fragment = html.slice(MESSAGE_OPEN_TAG.lastIndex, end.contentEnd);
    if (UNSUPPORTED_ARTIFACT.test(fragment)) {
      throw new SecurityError("ChatGPT share page contains a visible unsupported artifact; no partial transcript was created.");
    }
    messages.push({ role, content: visibleTextFromHtml(fragment) });
    if (messages.length > 10_000) throw new SecurityError("ChatGPT share page exceeds the 10,000-message safety limit.");
  }
  if (messages.length === 0) {
    throw new SecurityError("No supported visible ChatGPT message containers were found in this shared page.");
  }
  return {
    document: {
      schema: "context-ledger-import/0.1",
      title: titleFromHtml(html),
      messages,
    },
    parser: CHATGPT_SHARE_PARSER,
    limitations: {
      captured: "visible text messages in supported public-share DOM containers",
      unavailable: ["hidden prompts", "internal reasoning", "tool state", "private files", "unsupported visible artifacts"],
      unknown: ["provider-side history outside this public snapshot", "alternate branches not rendered in the fetched HTML"],
    },
  };
}

/** End-to-end import used by the CLI and integration tests. */
export async function importChatGptSharedConversation(shareUrl, outputDirectory, { fetchImpl } = {}) {
  const page = await fetchApprovedSharedPage(shareUrl, { fetchImpl });
  if (page.provider !== "chatgpt") {
    throw new UsageError("import-chatgpt-share accepts only chatgpt.com/share public links.");
  }
  const parsed = parseChatGptSharedHtml(page.html);
  const archive = createArchiveFromSharedConversation(parsed.document, {
    provider: "chatgpt",
    captureMethod: "public_shared_link",
    completeness: "visible_snapshot",
    hiddenStateAvailable: false,
    sourceUrlSha256: page.sourceUrlSha256,
    sourceHtmlSha256: page.sourceHtmlSha256,
    parser: parsed.parser,
  });
  const bundle = await writeArchiveBundle(archive, outputDirectory);
  const index = await writeInvertedIndex(bundle.archive, archive);
  return {
    archive,
    bundle,
    index,
    capture: archive.capture,
    limitations: parsed.limitations,
  };
}
