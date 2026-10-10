import { createArchiveFromSharedConversation, writeArchiveBundle } from "./archive.js";
import { SecurityError, UsageError } from "./errors.js";
import { writeInvertedIndex } from "./inverted-index.js";
import { fetchApprovedSharedPage } from "./share-link.js";

export const CHATGPT_SHARE_PARSER = "chatgpt-share-react-router/0.3";
const LEGACY_DOM_PARSER = "chatgpt-share-dom/0.1";
const MAX_HTML_CHARACTERS = 5 * 1024 * 1024;
const MAX_STREAM_CHUNKS = 16;
const MAX_FLAT_GRAPH_ENTRIES = 100_000;
const MAX_GRAPH_DEPTH = 200;
const CUSTOM_INSTRUCTIONS_PLACEHOLDER = "Original custom instructions no longer available";
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

function parseVisibleDomMessages(html) {
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
  return messages;
}

function routerStreamChunks(html) {
  const marker = "window.__reactRouterContext.streamController.enqueue(";
  const chunks = [];
  let from = 0;
  while (true) {
    const start = html.indexOf(marker, from);
    if (start < 0) return chunks;
    let index = start + marker.length;
    while (/\s/u.test(html[index] || "")) index += 1;
    if (html[index] !== '"') {
      from = index;
      continue;
    }
    const literalStart = index;
    index += 1;
    while (index < html.length) {
      if (html[index] === "\\") index += 2;
      else if (html[index] === '"') {
        index += 1;
        break;
      } else index += 1;
    }
    if (index > html.length || html[index - 1] !== '"') {
      throw new SecurityError("ChatGPT share stream has an unterminated string literal.");
    }
    try {
      const decoded = JSON.parse(html.slice(literalStart, index));
      if (typeof decoded === "string" && decoded.trim().startsWith("[")) {
        const flat = JSON.parse(decoded);
        if (!Array.isArray(flat) || flat.length === 0 || flat.length > MAX_FLAT_GRAPH_ENTRIES) {
          throw new SecurityError("ChatGPT share stream has an invalid graph size.");
        }
        chunks.push(flat);
        if (chunks.length > MAX_STREAM_CHUNKS) throw new SecurityError("ChatGPT share page exceeds the stream-chunk safety limit.");
      }
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      throw new SecurityError("ChatGPT share stream is not valid JSON.");
    }
    from = index;
  }
}

function reviveFlatGraph(flat) {
  const cache = new Map();
  function revive(reference, depth = 0) {
    if (typeof reference !== "number") return reference;
    if (!Number.isSafeInteger(reference) || reference < 0) return undefined;
    if (reference >= flat.length) throw new SecurityError("ChatGPT share stream contains an invalid reference.");
    if (cache.has(reference)) return cache.get(reference);
    if (depth > MAX_GRAPH_DEPTH) throw new SecurityError("ChatGPT share stream exceeds the graph-depth safety limit.");
    const raw = flat[reference];
    if (raw === null || typeof raw !== "object") return raw;
    if (Array.isArray(raw)) {
      const value = [];
      cache.set(reference, value);
      for (const child of raw) value.push(revive(child, depth + 1));
      return value;
    }
    const value = {};
    cache.set(reference, value);
    for (const [encodedKey, encodedValue] of Object.entries(raw)) {
      if (!/^_\d+$/u.test(encodedKey)) throw new SecurityError("ChatGPT share stream has an invalid object key.");
      const key = revive(Number(encodedKey.slice(1)), depth + 1);
      if (typeof key !== "string" || Object.hasOwn(value, key)) {
        throw new SecurityError("ChatGPT share stream has an invalid object mapping.");
      }
      value[key] = revive(encodedValue, depth + 1);
    }
    return value;
  }
  return revive(0);
}

function findLinearConversations(value, found = [], seen = new WeakSet(), depth = 0) {
  if (!value || typeof value !== "object") return found;
  if (depth > MAX_GRAPH_DEPTH) throw new SecurityError("ChatGPT share stream exceeds the graph-depth safety limit.");
  if (seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) findLinearConversations(child, found, seen, depth + 1);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "linear_conversation") {
      if (!Array.isArray(child)) throw new SecurityError("ChatGPT share linear conversation is invalid.");
      found.push(child);
    }
    findLinearConversations(child, found, seen, depth + 1);
  }
  return found;
}

function asMessageObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function isHiddenOrContextOnly(message) {
  const metadata = asMessageObject(message.metadata) || {};
  return (
    message.is_visually_hidden_from_conversation === true ||
    message.is_user_system_message === true ||
    message.is_redacted === true ||
    message.model_editable_context === true ||
    message.model_set_context === true ||
    metadata.is_visually_hidden_from_conversation === true ||
    metadata.is_user_system_message === true ||
    metadata.is_redacted === true ||
    metadata.model_editable_context === true ||
    metadata.model_set_context === true ||
    Object.hasOwn(message, "user_context_message_data") ||
    Object.hasOwn(metadata, "user_context_message_data")
  );
}

function messageFromLinearNode(node, sequence) {
  const message = asMessageObject(node?.message);
  if (!message) return null;
  const role = message.author?.role;
  if (role === "system") return null;
  if (role !== "user" && role !== "assistant") {
    throw new SecurityError("ChatGPT share page contains an unsupported linear-conversation role.");
  }
  if (isHiddenOrContextOnly(message)) return null;
  const content = asMessageObject(message.content);
  if (content?.content_type !== "text" || !Array.isArray(content.parts) || content.parts.some((part) => typeof part !== "string")) {
    throw new SecurityError("ChatGPT share page contains a visible unsupported message artifact; no partial transcript was created.");
  }
  const contentText = content.parts.join("\n");
  if (
    role === "user" &&
    typeof message.message_source !== "string" &&
    content.parts.length === 1 &&
    contentText === CUSTOM_INSTRUCTIONS_PLACEHOLDER
  ) {
    // This is an observed provider-generated pseudo-message, not a visible user
    // turn. It is a narrow fallback for a provider record lacking its usual
    // hidden/context metadata.
    return null;
  }
  if (role === "user" && typeof message.message_source === "string" && message.message_source !== contentText) {
    throw new SecurityError("ChatGPT share page has conflicting user-message text representations.");
  }
  if (UNSAFE_CONTROL.test(contentText)) throw new SecurityError("ChatGPT share message contains an unsafe control character.");
  if (typeof message.id !== "string" || message.id.length === 0 || message.id.length > 160) {
    throw new SecurityError("ChatGPT share message ID is invalid.");
  }
  return { id: message.id, sequence, role, content: contentText };
}

function parseReactRouterMessages(html) {
  const candidates = [];
  for (const chunk of routerStreamChunks(html)) {
    const linearConversations = findLinearConversations(reviveFlatGraph(chunk));
    if (linearConversations.length > 1) throw new SecurityError("ChatGPT share stream has multiple linear conversations.");
    if (linearConversations.length === 0) continue;
    for (const [sequence, node] of linearConversations[0].entries()) {
      const message = messageFromLinearNode(node, sequence);
      if (message) candidates.push(message);
    }
  }
  if (candidates.length === 0) return [];
  const ids = new Set();
  for (const message of candidates) {
    if (ids.has(message.id)) throw new SecurityError("ChatGPT share stream contains duplicate visible message IDs.");
    ids.add(message.id);
  }
  if (candidates.length > 10_000) throw new SecurityError("ChatGPT share page exceeds the 10,000-message safety limit.");
  return candidates.map(({ role, content }) => ({ role, content }));
}

/**
 * Parses only two versioned public-share representations: ChatGPT's server-sent
 * React Router graph (preferred) and the original visible-DOM fixture format.
 * No page JavaScript is executed. Unsupported visible/message representations
 * fail closed rather than being silently omitted from the transcript.
 */
export function parseChatGptSharedHtml(html) {
  if (typeof html !== "string" || html.length === 0 || html.length > MAX_HTML_CHARACTERS) {
    throw new SecurityError("ChatGPT share HTML is empty or exceeds the 5 MiB parser safety limit.");
  }
  if (UNSAFE_CONTROL.test(html)) throw new SecurityError("ChatGPT share HTML contains an unsafe control character.");
  const streamedMessages = parseReactRouterMessages(html);
  const messages = streamedMessages.length > 0 ? streamedMessages : parseVisibleDomMessages(html);
  if (messages.length === 0) throw new SecurityError("No supported visible ChatGPT messages were found in this shared page.");
  return {
    document: {
      schema: "context-ledger-import/0.1",
      title: titleFromHtml(html),
      messages,
    },
    parser: streamedMessages.length > 0 ? CHATGPT_SHARE_PARSER : LEGACY_DOM_PARSER,
    limitations: {
      captured: "visible text messages in supported public-share React Router data or legacy DOM containers",
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
