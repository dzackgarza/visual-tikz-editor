/**
 * The page that the window shows when a start cannot continue: the file that the
 * application cannot read, what that file holds, and the reason. The page has no script
 * and loads nothing, so it shows when no other part of the application runs.
 */

export type UnreadableFile = {
  /** The absolute path of the file. */
  file: string;
  /** What the file holds, as one sentence. */
  holds: string;
  /** What a start does when the file is absent, as one sentence. */
  withoutIt: string;
  /** Why the read failed: one line for each fault of the file. */
  reason: string;
};

// The colours and the type are those of the workbench shell (StandaloneApp.vue). The colour
// scheme follows the system, because the preferences file can be the file that cannot be read.
const STYLE = `
:root {
  color-scheme: light dark;
  --board: #daddd5;
  --leaf: #eef0ea;
  --ink: #1c2430;
  --graphite: #555d67;
  --ribbon: #9e2a2b;
  --paper: #fbfaf6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --board: #252c34;
    --leaf: #313b45;
    --ink: #f3f2ed;
    --graphite: #d1d5d8;
    --ribbon: #ef9b9c;
    --paper: #1d242b;
  }
}
html, body { height: 100%; margin: 0; }
body {
  display: grid;
  place-items: center;
  font: 16px/1.5 system-ui, sans-serif;
  color: var(--ink);
  background: var(--board);
}
main {
  box-sizing: border-box;
  width: min(100% - 32px, 44rem);
  max-height: calc(100% - 32px);
  overflow: auto;
  padding: 28px 32px 32px;
  border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
  border-top: 4px solid var(--ribbon);
  border-radius: 14px;
  background: var(--leaf);
  box-shadow: 0 3px 12px color-mix(in srgb, var(--ink) 15%, transparent);
}
h1 { margin: 0 0 4px; font-size: 1.5rem; line-height: 1.25; }
p { margin: 0; }
.lead { color: var(--graphite); }
dl { margin: 24px 0; }
dt {
  margin-top: 16px;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--graphite);
}
dd { margin: 4px 0 0; }
code, pre {
  font: 0.875rem/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  border-radius: 8px;
  background: var(--paper);
  border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
}
code { display: block; padding: 8px 12px; overflow-wrap: anywhere; }
pre { margin: 0; padding: 8px 12px; max-height: 14rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

export function startFailurePage(unreadable: UnreadableFile): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Visual TikZ Editor cannot start</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>Visual TikZ Editor cannot start</h1>
    <p class="lead">The application cannot read one of its files.</p>
    <dl role="alert">
      <dt>File</dt>
      <dd><code>${Bun.escapeHTML(unreadable.file)}</code></dd>
      <dt>Contents</dt>
      <dd>${Bun.escapeHTML(unreadable.holds)}</dd>
      <dt>Reason</dt>
      <dd><pre>${Bun.escapeHTML(unreadable.reason)}</pre></dd>
    </dl>
    <p>Correct the file, or move it to a different folder. Then start the application again. ${Bun.escapeHTML(unreadable.withoutIt)}</p>
  </main>
</body>
</html>
`;
}
