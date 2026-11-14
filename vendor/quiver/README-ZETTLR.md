# Zettlr Quiver vendor

This directory is a forked, vendored snapshot of `varkor/quiver` at the exact
commit recorded in `PROVENANCE.toml`. `ZETTLR.patch` is the complete Zettlr
delta against that upstream commit. `node scripts/update-quiver-vendor.mjs`
reconstructs `src/` from those two inputs and the separately pinned KaTeX
release.

The fork boundary is intentionally narrow:

- Quiver remains the owner of diagram layout, selection, touch/pointer
  interaction, arrow/vertex controls, TikZ-cd parsing and export.
- The host owns the document's one history. Each change names the Quiver
  history event it made or extended, so the edits Quiver collapses into one
  event (a label typed letter by letter) are one Undo step of the document.
  Quiver's Undo and Redo shortcuts post `zettlr-quiver:undo-request` and
  `zettlr-quiver:redo-request`, and its toolbar has no Undo or Redo.
- `zettlr-host.{html,css,mjs}` is a local iframe host. It exposes a small
  postMessage bridge for source, theme, macros, change events and Escape.
- While a menu of the host is open (`zettlr-quiver:host-popover`), the next
  press in the frame closes it (`zettlr-quiver:host-popover-dismissed`). The
  bridge keeps every event of a press on the diagram from Quiver, so that
  press makes no vertex and changes no selection. A press on a control of
  Quiver reaches that control.
- Diagram changes are emitted from Quiver's own history/autosave mutation
  boundary. Zettlr does not infer edits from Quiver's DOM. A source request is
  answered after the pending change is posted, so only `zettlr-quiver:change`
  carries edits.
- KaTeX is loaded locally; the embedded editor has no dependency on the hosted
  q.uiver.app site.
- Zettlr owns persistence, theme, macro configuration and source editing.
  Quiver's URL Save/autosave/theme/About actions are not registered in host
  mode, and the web import/export/share panes are not exposed.
- Quiver's generated round-trip URL comment is removed before source is written
  back to Markdown; the Markdown `tikzcd` environment is the source of truth.
- The host returns the imported bytes whenever Quiver's export equals its
  export of the diagram as imported. A history step back to the loaded diagram
  therefore restores the document's authored source.

Macro consistency has an explicit boundary. The host receives the user's typed
MathJax macro map plus simple one-line declarations from the same maintained
TikZ template graph used by compilation. Definitions whose semantics cannot be
represented faithfully by KaTeX/Quiver are reported to the user instead of
being silently rewritten.
