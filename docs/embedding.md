# Embedding the editor

A host program embeds the editor in one of two ways: it mounts the Vue component, or it loads the drawing editor page in an iframe and talks to it with typed messages. In both cases the host owns the document, its storage, and its identity; the editor edits the TikZ source that the host gives it. The standalone app, [Zettlr](https://www.zettlr.com/), and Math Notes are the current hosts.

## Vue component

Mount [`src/ui/TikzWorkbench.vue`](../src/ui/TikzWorkbench.vue) with three props:

| Prop | Meaning |
| --- | --- |
| `target` | The source bytes, their range in the host document, the diagram language, and the document path |
| `host` | An implementation of `TikzWorkbenchHost` from [`src/host.ts`](../src/host.ts) |
| `theme` | `"light"` or `"dark"` |

Set `initialMode` for the first view, or bind `requestedMode` when a host control must switch views after mount. The standalone app opens a `tikzpicture` in the drawing canvas; Zettlr opens it in TeX render. A host without a TeX view opens the drawing canvas.

`TikzWorkbenchHost` has these members:

| Member | Host responsibility |
| --- | --- |
| `readSource`, `writeSource` | Read and replace the source range. After a write, pass an updated `target`. |
| `rendering` | Supply `render` and `figureUrl` together to offer the TeX render view. |
| `quiver` | Supply the Quiver page URL and the KaTeX macro projection to edit `tikzcd`. |
| `imageBaseUrl` | Resolve image paths in the figure. |
| `editorUrl` | Serve the pinned drawing editor page from `vendor/tikz-editor/src/`. |
| `requestSave` | Handle the editor's Save gesture, if the host saves files. |
| `reportError` | Report an integration error. |

The source document is authoritative, and the editor rejects stale source writes. The host keeps source identity and save transactions consistent with its own document model.

A view switch keeps one drawing editor instance, with its selection, viewport, tool, and undo history.

## Iframe protocol

The `/embedding.html` page of the standalone build ([`standalone/embedding.ts`](../standalone/embedding.ts)) is a working host of the iframe protocol. The message types are in [`vendor/tikz-editor/embed/src/`](../vendor/tikz-editor/embed/src/), and `src/host.ts` re-exports them.

A host creates a session with a UUID and sends typed `HostCommand` loads. Load revisions increase strictly, and every request ID is unique. The iframe accepts commands only from its parent at the referring origin; notifications never run commands.

### Snapshots

`requestEditorSnapshot` ([`src/editor-snapshot.ts`](../src/editor-snapshot.ts)) asks for a snapshot of one exact state. Each request names the session, the load revision, and the exact source bytes. The editor waits until its scene is computed, then returns either a typed failure or:

- the matching source and SVG, with its `viewBox`;
- the local bounds, in points in the SVG coordinate system (`null` for an empty scene);
- the associations between drawn paths and recorded pen strokes;
- the selection, tool, and viewport.

SVG definition IDs are namespaced to the session and source revision, and the SVG includes the bytes of its images. To restore a view in a fresh session, pass a saved snapshot's `state` with a later `load`; the editor restores the tool, selection, and viewport after the matching render. Undo history stays in its session.

Pass an `AbortSignal` to cancel a request. When the host disposes of the editor, abort with the reason `"disposed"` before it removes the iframe; the client then removes its listeners and sends no further commands.

`requestEditorSource` ([`src/editor-source.ts`](../src/editor-source.ts)) returns the current source, including an edit whose change notification has not arrived yet. It has the same peer, origin, session, request, timeout, and disposal checks as the snapshot client. Copying never requests a save.

### Recorded pen strokes

`import-ink` accepts typed `OriginalStroke` records: a stroke key local to the figure, ordered samples, and optional sensor channels and outlines. The records live in source comments inside their own scopes, so they travel with source history and ordinary file storage. `interpret-ink` and `restore-ink` require the exact current source and the stroke key. A stroke marked `ink` is never interpreted as geometry.

## Desktop launch options

A host program can open one of its diagrams in the desktop app. It passes two options before the file:

```sh
visual-tikz-editor --macros macros.json --resources /path/to/document figure.tikz
```

| Option | Effect |
| --- | --- |
| `--macros <file>` | A JSON object of MathJax macros that Quiver uses in place of the standard KaTeX macros |
| `--resources <directory>` | The directory from which image paths and TeX inputs resolve, in place of the file's directory |

## Pinning a revision

Pin the full commit of a [release](https://github.com/dzackgarza/visual-tikz-editor/releases). The public TypeScript interface and the vendored editor assets of one commit belong together. Each release carries the source tree with the built page, the Debian package, and the CI record of its revision.
