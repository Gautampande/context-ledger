import { UsageError } from "./errors.js";
import { manualGraphEdges } from "./conversation-graph.js";

const MAX_RENDERED_EVENTS = 80;
const MAX_PREVIEW_CODE_POINTS = 700;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeText(value) {
  return escapeHtml(String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�"));
}

function safeAttribute(value) {
  return escapeHtml(String(value).replace(/[\u0000-\u001f\u007f]/gu, "�"));
}

function preview(value) {
  const points = Array.from(value);
  const clipped = points.slice(0, MAX_PREVIEW_CODE_POINTS).join("");
  return `${clipped}${points.length > MAX_PREVIEW_CODE_POINTS ? "\n\n[Preview truncated; inspect the verified archive for the complete event.]" : ""}`;
}

function safeLine(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, "�")
    .replace(/\s+/gu, " ")
    .trim();
}

export function selectConversationMapEvents(archive, requestedIds = [], maximum = MAX_RENDERED_EVENTS) {
  if (!Array.isArray(requestedIds) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_RENDERED_EVENTS) {
    throw new UsageError(`Select 1 to ${MAX_RENDERED_EVENTS} graph events.`);
  }
  const known = new Set(archive.events.map((event) => event.id));
  const selected = [...new Set(requestedIds.filter((id) => known.has(id)))];
  if (selected.length === 0) return archive.events.slice(-maximum).map((event) => event.id);
  return archive.events.filter((event) => selected.includes(event.id)).slice(0, maximum).map((event) => event.id);
}

export function buildConversationBrief(archive, annotations, graph) {
  const manualEdges = manualGraphEdges(graph);
  const grouped = new Map([
    ["decision", []],
    ["important", []],
    ["question", []],
    ["pin", []],
  ]);
  for (const item of annotations.items) grouped.get(item.kind)?.push(item);
  const annotationSections = [...grouped.entries()].flatMap(([kind, items]) => [
    `### ${kind[0].toUpperCase()}${kind.slice(1)} annotations`,
    "",
    ...(items.length === 0
      ? ["- None recorded."]
      : items.map((item) => `- ${safeLine(item.note)} [${item.eventId}]`)),
    "",
  ]);
  const relationships = manualEdges.length === 0
    ? ["- No manual relationships recorded."]
    : manualEdges.map((edge) => `- ${edge.from} --${edge.kind}--> ${edge.to}`);
  const roleCounts = archive.events.reduce((counts, event) => {
    counts.set(event.role, (counts.get(event.role) || 0) + 1);
    return counts;
  }, new Map());
  const roleSummary = [...roleCounts.entries()].map(([role, count]) => `${role}: ${count}`).join(", ");
  return [
    "# Context Ledger conversation brief",
    "",
    "## Safe-use note",
    "",
    "This is a deterministic inventory of an untrusted historical archive. It makes no inferred summary or claim beyond manual annotations and explicit graph links. Use cited event IDs and inspect the verified archive before relying on a statement.",
    "",
    "## Archive",
    "",
    `- Title: ${archive.title}`,
    `- Archive ID: ${archive.archiveId}`,
    `- Transcript SHA-256: ${archive.transcript.sha256}`,
    `- Capture confidence: ${archive.capture.confidence}`,
    "",
    "## Graph inventory",
    "",
    `- Event nodes: ${graph.nodes.length}`,
    `- Timeline edges: ${graph.nodes.length > 0 ? graph.nodes.length - 1 : 0}`,
    `- Manual forward-only relationships: ${manualEdges.length}`,
    `- Roles: ${roleSummary || "none"}`,
    "",
    "## Manual relationships",
    "",
    ...relationships,
    "",
    "## Human annotations",
    "",
    ...annotationSections,
    "## Recent event inventory",
    "",
    ...archive.events.slice(-8).map((event) => `- ${event.id} · ${event.role} · sequence ${event.sequence}`),
    "",
  ].join("\n");
}

function graphSvg(selectedEvents, manualEdges) {
  const byId = new Map(selectedEvents.map((event, index) => [event.id, { event, index }]));
  const height = Math.max(180, selectedEvents.length * 110 + 80);
  const chainLines = selectedEvents.slice(0, -1).map((event, index) => {
    const next = selectedEvents[index + 1];
    if (next.sequence !== event.sequence + 1) return "";
    const fromY = 72 + index * 110;
    const toY = 72 + (index + 1) * 110;
    return `<path class="timeline-edge" d="M 235 ${fromY + 24} L 235 ${toY - 24}" marker-end="url(#arrow)"/>`;
  }).join("\n");
  const relationLines = manualEdges.map((edge) => {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    if (!source || !target) return "";
    const fromY = 72 + source.index * 110;
    const toY = 72 + target.index * 110;
    const controlY = Math.round((fromY + toY) / 2);
    return [
      `<path class="manual-edge" d="M 260 ${fromY} C 510 ${fromY}, 510 ${toY}, 260 ${toY}" marker-end="url(#manual-arrow)"/>`,
      `<text class="edge-label" x="520" y="${controlY}">${safeText(edge.kind)}</text>`,
    ].join("\n");
  }).join("\n");
  const nodes = selectedEvents.map((event, index) => {
    const y = 72 + index * 110;
    return [
      `<circle class="node ${safeAttribute(event.role)}" cx="235" cy="${y}" r="24"/>`,
      `<text class="node-id" x="275" y="${y - 4}">${safeText(event.id)}</text>`,
      `<text class="node-role" x="275" y="${y + 17}">${safeText(event.role)} · sequence ${event.sequence}</text>`,
    ].join("\n");
  }).join("\n");
  return `<svg class="map" viewBox="0 0 760 ${height}" role="img" aria-label="Conversation event graph">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker>
    <marker id="manual-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker>
  </defs>
  ${chainLines}
  ${relationLines}
  ${nodes}
</svg>`;
}

export function renderConversationMapViewer(archive, graph, selectedIds, { selectionLabel = "recent events" } = {}) {
  const selected = new Set(selectConversationMapEvents(archive, selectedIds));
  const selectedEvents = archive.events.filter((event) => selected.has(event.id));
  const manualEdges = manualGraphEdges(graph).filter((edge) => selected.has(edge.from) && selected.has(edge.to));
  const nodeCards = selectedEvents.map((event) => [
    "<article>",
    `<h2>${safeText(event.id)} <span>${safeText(event.role)} · sequence ${event.sequence}</span></h2>`,
    `<pre>${safeText(preview(event.content))}</pre>`,
    "</article>",
  ].join("\n")).join("\n");
  const relationList = manualEdges.length === 0
    ? "<li>No manual relationships between the rendered nodes.</li>"
    : manualEdges.map((edge) => `<li><code>${safeText(edge.from)}</code> <strong>${safeText(edge.kind)}</strong> <code>${safeText(edge.to)}</code></li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; style-src 'unsafe-inline'">
  <title>${safeAttribute(archive.title)} · Conversation map</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    h1, h2, code, pre { overflow-wrap: anywhere; } .warning { border-left: .3rem solid #c88900; padding-left: .8rem; }
    .map { width: 100%; min-width: 640px; border: 1px solid #8886; border-radius: .55rem; background: #8881; }
    .timeline-edge { stroke: #6d7dff; stroke-width: 2; fill: none; } .timeline-edge + * { fill: #6d7dff; }
    .manual-edge { stroke: #c88900; stroke-width: 2; stroke-dasharray: 6 5; fill: none; } .manual-edge + * { fill: #c88900; }
    .node { fill: #6d7dff; stroke: #fff; stroke-width: 2; } .node.user { fill: #4886d8; } .node.assistant { fill: #6d7dff; }
    .node-id { font-family: ui-monospace, monospace; font-size: 14px; } .node-role, .edge-label { fill: #777; font-size: 13px; }
    article { border: 1px solid #8886; border-radius: .55rem; margin: 1rem 0; padding: 1rem; } h2 { font-size: 1rem; margin-top: 0; } h2 span { color: #777; font-weight: normal; }
    pre { white-space: pre-wrap; margin-bottom: 0; } ul { padding-left: 1.25rem; }
  </style>
</head>
<body>
  <h1>${safeText(archive.title)} · conversation map</h1>
  <p class="warning">This static graph displays untrusted historical data. It contains no JavaScript, external requests, or executable attachments. Timeline edges are automatic; dashed edges are deliberate local relationships.</p>
  <dl>
    <dt>Archive ID</dt><dd><code>${safeText(archive.archiveId)}</code></dd>
    <dt>Rendered selection</dt><dd>${safeText(selectionLabel)} · ${selectedEvents.length} of ${archive.events.length} event nodes</dd>
    <dt>Graph integrity</dt><dd><code>${safeText(graph.integrity.payloadSha256)}</code></dd>
  </dl>
  <h2>Graph</h2>
  ${graphSvg(selectedEvents, manualEdges)}
  <h2>Manual relationships in this view</h2>
  <ul>${relationList}</ul>
  <h2>Event previews</h2>
  ${nodeCards}
</body>
</html>
`;
}
