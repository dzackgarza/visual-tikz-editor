# Visual TikZ Editor

Visual TikZ Editor edits one mathematical diagram and its TikZ source. It runs as a standalone local web app. The `tikzpicture` view uses the pinned [TikZ Editor](https://github.com/DominikPeters/tikz-editor) fork. The `tikzcd` view uses the pinned [Quiver](https://github.com/varkor/quiver) fork. Both show the diagram directly while you edit. Drawing and visual preview do not run TeX.

This repository was extracted from [`zettlr-pandoc/packages/tikz-workbench`](https://github.com/dzackgarza/zettlr-pandoc/tree/tikz-workbench-module/packages/tikz-workbench). It holds the editor component, a standalone file host, the fork patches, and their pinned assets. The visual tools edit TikZ source through the host; the host owns the file.

## Run the standalone app

Install [Bun](https://bun.sh/), [just](https://github.com/casey/just), and Zenity for the native Open and Save As dialogs. The test suite also uses Node.js. Then run:

```sh
bun install --frozen-lockfile
just run
```

Open the local URL printed by `just run`. The app starts with a new `tikzpicture` in the visual editor. **Save** or Ctrl+S opens a native Save As dialog for a new diagram. The toolbar also opens an existing `.tikz` or `.tikzcd` file and starts another new diagram. To open a file at launch, run `just run path/to/figure.tikz`. A disk change since the last load stops an ordinary save and reports a conflict. Image paths resolve from the file directory.

The workbench also offers **Compiled preview**. That command uses the local `pandoc`, `pdflatex`, and `pdf2svg` tools with the Pandoc filter and standalone template under `~/.pandoc`. It is separate from the visual editing surface. The standalone Quiver view starts with standard KaTeX macros; an embedding host supplies its document's macro definitions through the host interface.

## Embed the workbench

Mount `src/ui/TikzWorkbench.vue` with `target`, `host`, and `theme`. Set `initialMode` when the host needs a different opening view. The standalone host opens `tikzpicture` in its visual editor; Zettlr opens it in compiled preview. `target` names the source bytes, their document range, the diagram language, and the document path. `host` implements `TikzWorkbenchHost` in `src/host.ts`:

| Service | Host responsibility |
| --- | --- |
| `readSource`, `writeSource` | Read and replace the source range. Send an updated target after a write. |
| `render`, `figureUrl` | Run an explicitly requested compiled preview and provide its figure URL. |
| `quiverMacros` | Supply the host document's KaTeX macro projection. |
| `imageBaseUrl` | Resolve figure image paths. |
| `editorUrl`, `quiverUrl` | Serve the pinned editor pages under `vendor/`. |
| `reportError` | Report an integration error. |

The source document is authoritative. The editor bridges reject stale source writes. The host must keep source identity and save transactions consistent with its own document model.

## Build and provenance

`just build` builds the standalone page. `just test-commit` checks Vue and TypeScript. `just test` runs the workbench's Mocha tests on Node.js. The source under `vendor/tikz-editor` and `vendor/quiver` comes from pinned upstream revisions plus maintained patches. Each `PROVENANCE.toml` records the source revision. `just update-tikz-editor-vendor` and `just update-quiver-vendor` rebuild those assets.

The workbench is GPL-3.0. The bundled editors and their third-party assets retain their own license files. See [LICENSE](LICENSE) and the vendor provenance records.
