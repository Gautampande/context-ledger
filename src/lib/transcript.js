import { sha256Text } from "./hash.js";

const ROLE_BY_HEADING = new Map([
  ["user", "user"],
  ["assistant", "assistant"],
  ["tool", "tool"],
  ["system", "system"],
]);
export const MAX_TITLE_CODE_POINTS = 120;

export function titleLength(value) {
  return typeof value === "string" ? Array.from(value).length : Number.NaN;
}

export function isValidTitle(value) {
  return (
    typeof value === "string" &&
    titleLength(value) >= 1 &&
    titleLength(value) <= MAX_TITLE_CODE_POINTS &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function truncateTitle(value) {
  return Array.from(value).slice(0, MAX_TITLE_CODE_POINTS).join("");
}

export function titleFromTranscript(transcript) {
  const candidate = transcript
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find((line) => line.length > 0 && !ROLE_BY_HEADING.has(line.toLowerCase()));
  return truncateTitle(candidate || "Untitled conversation");
}

export function eventsFromMarkdown(transcript) {
  const heading = /^##\s+(user|assistant|tool|system)\s*$/gimu;
  const matches = [...transcript.matchAll(heading)];
  if (matches.length === 0) {
    return [toEvent("unknown", transcript, 0)];
  }

  return matches.map((match, index) => {
    const role = ROLE_BY_HEADING.get(match[1].toLowerCase());
    const afterHeading = match.index + match[0].length;
    const lineEndingLength = transcript.startsWith("\r\n", afterHeading)
      ? 2
      : transcript.startsWith("\n", afterHeading)
        ? 1
        : 0;
    const start = afterHeading + lineEndingLength;
    const end = index + 1 < matches.length ? matches[index + 1].index : transcript.length;
    return toEvent(role, transcript.slice(start, end).replace(/(?:\r?\n){2}$/u, ""), index);
  });
}

export function eventsFromMessages(messages) {
  return messages.map((message, sequence) => toEvent(message.role, message.content, sequence));
}

/**
 * A provider can expose a message whose Markdown has an unclosed code fence.
 * Keep the message text exact in events/normalizedSource, but terminate that
 * fence in the display transcript so the next structural turn heading cannot
 * become part of the preceding message's code block.
 */
function displayContentWithClosedFence(content) {
  let activeFence;
  for (const line of content.split(/\r?\n/u)) {
    const match = /^(?: {0,3})(`{3,}|~{3,})(.*)$/u.exec(line);
    if (!match) continue;
    const marker = match[1][0];
    const suffix = match[2];
    if (!activeFence) {
      // A backtick fence whose info string contains a backtick is not a valid
      // opening fence in CommonMark, so it cannot change the display state.
      if (marker === "`" && suffix.includes("`")) continue;
      activeFence = { marker, length: match[1].length };
    } else if (
      marker === activeFence.marker &&
      match[1].length >= activeFence.length &&
      /^[ \t]*$/u.test(suffix)
    ) {
      activeFence = undefined;
    }
  }
  if (!activeFence) return content;
  const closer = activeFence.marker.repeat(activeFence.length);
  return `${content}${content.endsWith("\n") ? "" : "\n"}${closer}`;
}

export function renderNormalizedTranscript(title, messages) {
  const sections = [`# ${title}`, ""];
  for (const message of messages) {
    sections.push(
      `## ${message.role[0].toUpperCase()}${message.role.slice(1)}`,
      "",
      displayContentWithClosedFence(message.content),
      "",
    );
  }
  return sections.join("\n");
}

function toEvent(role, content, sequence) {
  const digest = sha256Text(`${sequence}\0${role}\0${content}`);
  return {
    id: `evt_${String(sequence + 1).padStart(4, "0")}_${digest.slice(0, 12)}`,
    sequence,
    role,
    content,
    contentSha256: sha256Text(content),
  };
}
