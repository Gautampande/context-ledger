import { UsageError } from "./errors.js";

function normaliseQuery(query) {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > 256) {
    throw new UsageError("Search query must contain 1 to 256 characters.");
  }
  if (/[\u0000-\u001f\u007f]/u.test(query)) {
    throw new UsageError("Search query may not contain control characters.");
  }
  return query.toLocaleLowerCase();
}

function snippet(content, index, queryLength) {
  const start = Math.max(0, index - 100);
  const end = Math.min(content.length, index + queryLength + 180);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).replace(/\r?\n/g, " ")}${end < content.length ? "…" : ""}`;
}

export function searchArchive(archive, query) {
  const target = normaliseQuery(query);
  return archive.events.flatMap((event) => {
    const position = event.content.toLocaleLowerCase().indexOf(target);
    return position === -1
      ? []
      : [{ id: event.id, sequence: event.sequence, role: event.role, snippet: snippet(event.content, position, query.length) }];
  });
}
