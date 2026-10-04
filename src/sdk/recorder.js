import { SecurityError, UsageError } from "../lib/errors.js";
import { validateNormalizedImport } from "../lib/archive.js";

const ROLES = new Set(["user", "assistant", "tool", "system"]);
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_CONVERSATION_BYTES = 4 * 1024 * 1024;

/**
 * Minimal in-memory recorder for applications that control their own model API calls.
 * It never intercepts a provider UI, sends data over the network, or stores credentials.
 */
export class ConversationRecorder {
  #messages = [];
  #byteLength = 0;

  record({ role, content }) {
    const byteLength = typeof content === "string" ? Buffer.byteLength(content, "utf8") : Infinity;
    if (!ROLES.has(role) || typeof content !== "string" || byteLength > MAX_MESSAGE_BYTES) {
      throw new UsageError("Recorded message must have an allowed role and at most 1 MiB of text.");
    }
    if (this.#messages.length >= 10_000) throw new SecurityError("Recorder message limit exceeded.");
    if (this.#byteLength + byteLength > MAX_CONVERSATION_BYTES) throw new SecurityError("Recorder conversation exceeds the 4 MiB safety limit.");
    this.#messages.push(Object.freeze({ role, content }));
    this.#byteLength += byteLength;
    return this.#messages.length - 1;
  }

  messages() {
    return this.#messages.map((message) => ({ ...message }));
  }

  toNormalizedImport(title) {
    const document = { schema: "context-ledger-import/0.1", title, messages: this.messages() };
    validateNormalizedImport(document);
    return document;
  }
}
