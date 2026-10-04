function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeText(value) {
  return escapeHtml(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�"));
}

function safeAttribute(value) {
  return escapeHtml(value.replace(/[\u0000-\u001f\u007f]/gu, "�"));
}

export function renderStaticViewer(archive, annotations) {
  const eventHtml = archive.events.map((event) => [
    "<article>",
    `<h2>${escapeHtml(event.id)} <span>${escapeHtml(event.role)}</span></h2>`,
    `<pre>${safeText(event.content)}</pre>`,
    "</article>",
  ].join("\n")).join("\n");
  const annotationHtml = annotations.items.length === 0
    ? "<li>No local annotations.</li>"
    : annotations.items.map((annotation) => `<li><strong>${escapeHtml(annotation.kind)}</strong> · ${safeText(annotation.note)} <code>${escapeHtml(annotation.eventId)}</code></li>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; style-src 'unsafe-inline'">
  <title>${safeAttribute(archive.title)} · Context Ledger</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    article { border: 1px solid #8886; border-radius: .55rem; margin: 1rem 0; padding: 1rem; }
    h1, h2 { overflow-wrap: anywhere; } h2 { font-size: 1rem; margin-top: 0; }
    h2 span { color: #777; font-weight: normal; } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 0; }
    code { overflow-wrap: anywhere; } .warning { border-left: .3rem solid #c88900; padding-left: .8rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(archive.title)}</h1>
  <p class="warning">This static file displays untrusted historical data. It contains no JavaScript, external requests, or executable attachments.</p>
  <dl>
    <dt>Archive ID</dt><dd><code>${escapeHtml(archive.archiveId)}</code></dd>
    <dt>Capture confidence</dt><dd>${escapeHtml(archive.capture.confidence)}</dd>
    <dt>Transcript SHA-256</dt><dd><code>${escapeHtml(archive.transcript.sha256)}</code></dd>
  </dl>
  <h2>Local annotations</h2>
  <ul>${annotationHtml}</ul>
  <h2>Conversation</h2>
  ${eventHtml}
</body>
</html>
`;
}
