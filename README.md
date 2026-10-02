# Visual TikZ Editor

Visual TikZ Editor edits one mathematical diagram and its TikZ source. It runs as a standalone local web app. The `tikzpicture` view uses the pinned [TikZ Editor](https://github.com/DominikPeters/tikz-editor) fork. The `tikzcd` view uses the pinned [Quiver](https://github.com/varkor/quiver) fork. Both show the diagram directly while you edit. Drawing and visual preview do not run TeX.

This repository was extracted from [`zettlr-pandoc/packages/tikz-workbench`](https://github.com/dzackgarza/zettlr-pandoc/tree/tikz-workbench-module/packages/tikz-workbench). It holds the editor component, a standalone file host, the fork patches, and their pinned assets. The visual tools edit TikZ source through the host; the host owns the file.

## Run the standalone app

Install [Bun](https://bun.sh/) and [just](https://github.com/casey/just). Then run:

```sh
bun install --frozen-lockfile
just run path/to/figure.tikz
```

The file must exist and have a `.tikz` or `.tikzcd` extension. Open the local URL printed by `just run`. The page starts in the visual editor for a `tikzpicture` or in Quiver for a `tikzcd` diagram. Save or Ctrl+S writes the file. A disk change since the last load stops the save and reports a conflict. Image paths resolve from the file directory.

The workbench also offers **Compiled preview**. That command uses the local `pandoc`, `pdflatex`, and `pdf2svg` tools with the Pandoc filter and standalone template under `~/.pandoc`. It is separate from the visual editing surface. The standalone Quiver view starts with standard KaTeX macros; an embedding host supplies its document's macro definitions through the host interface.

## Embed the workbench

Mount `src/ui/TikzWorkbench.vue` with `target`, `host`, and `theme`. `target` names the source bytes, their document range, the diagram language, and the document path. `host` implements `TikzWorkbenchHost` in `src/host.ts`:

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

`just build` builds the standalone page. `just test-commit` checks Vue and TypeScript. `just test` runs the workbench tests. The source under `vendor/tikz-editor` and `vendor/quiver` comes from pinned upstream revisions plus maintained patches. Each `PROVENANCE.toml` records the source revision. `just update-tikz-editor-vendor` and `just update-quiver-vendor` rebuild those assets.

The workbench is GPL-3.0. The bundled editors and their third-party assets retain their own license files. See [LICENSE](LICENSE) and the vendor provenance records.
