import { sha256Text } from "./hash.js";

const ROLE_BY_HEADING = new Map([
  ["user", "user"],
  ["assistant", "assistant"],
  ["tool", "tool"],
  ["system", "system"],
]);

export function titleFromTranscript(transcript) {
  const candidate = transcript
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find((line) => line.length > 0 && !ROLE_BY_HEADING.has(line.toLowerCase()));
  return (candidate || "Untitled conversation").slice(0, 120);
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

export function renderNormalizedTranscript(title, messages) {
  const sections = [`# ${title}`, ""];
  for (const message of messages) {
    sections.push(`## ${message.role[0].toUpperCase()}${message.role.slice(1)}`, "", message.content, "");
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
