# Visual TikZ Editor

Visual TikZ Editor edits one mathematical diagram and its TikZ source. It runs as a standalone local web app. The `tikzpicture` view uses the pinned [TikZ Editor](https://github.com/DominikPeters/tikz-editor) fork. The `tikzcd` view uses the pinned [Quiver](https://github.com/varkor/quiver) fork. Both show the diagram directly while you edit. Drawing and visual preview do not run TeX.

This repository was extracted from [`zettlr-pandoc/packages/tikz-workbench`](https://github.com/dzackgarza/zettlr-pandoc/tree/tikz-workbench-module/packages/tikz-workbench). It holds the editor component, a standalone file host, the fork patches, and their pinned assets. The visual tools edit TikZ source through the host; the host owns the file.

## Run the standalone app

Install [Bun](https://bun.sh/), [just](https://github.com/casey/just), and Zenity for the native Open and Save As dialogs. The test suite also uses Node.js. Then run:

```sh
bun install --frozen-lockfile
just run
```

Open the local URL printed by `just run`. The app starts with a new `tikzpicture` in the drawing canvas. The **File** menu holds New, Open, Save, and Save As. **Save** or Ctrl+S opens a native Save As dialog for a new diagram. To open a file at launch, run `just run path/to/figure.tikz`. A disk change since the last load stops an ordinary save and reports a conflict. Image paths resolve from the file directory.

The workbench offers a **TeX render** view of the same source. It uses the local `pandoc`, `pdflatex`, and `pdf2svg` tools with the Pandoc filter and standalone template under `~/.pandoc`. The standalone Quiver canvas starts with standard KaTeX macros; an embedding host supplies its document's macro definitions through the host interface. Desktop opens with source beside the diagram; tablet widths open with the canvas. **Source** and **Properties** toggle independently without replacing the editor. **Copy source** copies the authored source without saving the file. The light theme is the default; the theme button saves the chosen appearance locally.

## Embed the workbench

Mount `src/ui/TikzWorkbench.vue` with `target`, `host`, and `theme`. Set `initialMode` for the opening view, or bind `requestedMode` when a host control must switch views after mount. The standalone host opens `tikzpicture` in its visual editor; Zettlr opens it in TeX render. A host that supplies only the visual editor opens the drawing canvas. `target` names the source bytes, their document range, the diagram language, and the document path. `host` implements `TikzWorkbenchHost` in `src/host.ts`:

| Service | Host responsibility |
| --- | --- |
| `readSource`, `writeSource` | Read and replace the source range. Send an updated target after a write. |
| `rendering` | Supply `render` and `figureUrl` together when the host offers a TeX render view. |
| `quiver` | Supply the Quiver page URL and KaTeX macro projection when the host edits `tikzcd`. |
| `imageBaseUrl` | Resolve figure image paths. |
| `editorUrl` | Serve the pinned drawing editor page under `vendor/`. |
| `reportError` | Report an integration error. |

The source document is authoritative. The editor bridges reject stale source writes. The host must keep source identity and save transactions consistent with its own document model.

The mounted `/embedding.html` fixture exercises the iframe boundary and the exported `requestEditorSnapshot` client. A host creates a UUID session and sends typed `HostCommand` loads with strictly increasing load revisions and unique request IDs. The iframe accepts commands only from its parent at the referring origin. Notifications never execute commands. Each snapshot request names the session, load revision and exact source bytes; it waits for the editor's compute scheduler and returns matching source, SVG, viewBox, selection, tool and viewport, or a typed failure. Its SVG definitions are namespaced to the session and source revision.

Pass an `AbortSignal` to `requestEditorSnapshot`; aborting cancels the request. On host disposal, abort with the reason `"disposed"` before removing the iframe to remove client listeners without sending further commands. This API is still under development in issue #2: original-ink transport, embedded image resources and the complete restore/reapply workflow are not yet an accepted consumer contract.

## Build and provenance

`just build` builds the standalone page. `just test-commit` checks Vue and TypeScript. `just test` runs the workbench's Mocha tests on Node.js. The source under `vendor/tikz-editor` and `vendor/quiver` comes from pinned upstream revisions plus maintained patches. Each `PROVENANCE.toml` records the source revision. `just update-tikz-editor-vendor` and `just update-quiver-vendor` rebuild those assets.

The workbench is GPL-3.0. The bundled editors and their third-party assets retain their own license files. See [LICENSE](LICENSE) and the vendor provenance records.
