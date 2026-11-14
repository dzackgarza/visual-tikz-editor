/**
 * The page that the window shows when a start cannot continue: the file that the
 * application cannot read, what that file holds, and the reason. The page has no script
 * and loads nothing, so it shows when no other part of the application runs.
 */

import STYLE from "./start-failure.css" with { type: "text" };

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
