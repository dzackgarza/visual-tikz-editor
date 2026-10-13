# Visual TikZ Editor

Visual TikZ Editor edits one mathematical diagram and its TikZ source. It runs as a standalone local web app. The `tikzpicture` view uses the pinned [TikZ Editor](https://github.com/DominikPeters/tikz-editor) fork. The `tikzcd` view uses the pinned [Quiver](https://github.com/varkor/quiver) fork. Both show the diagram directly while you edit. Drawing and visual preview do not run TeX.

This repository was extracted from [`zettlr-pandoc/packages/tikz-workbench`](https://github.com/dzackgarza/zettlr-pandoc/tree/tikz-workbench-module/packages/tikz-workbench). It holds the editor component, a standalone file host, the fork patches, and their pinned assets. The visual tools edit TikZ source through the host; the host owns the file.

## Run the standalone app

Install [Bun](https://bun.sh/), [just](https://github.com/casey/just), and Zenity for the native Open and Save As dialogs. The test suite also uses Node.js. Then run:

```sh
bun install --frozen-lockfile
just run
```

Open the local URL printed by `just run`. Choose **tikzpicture** or **tikzcd** in the new-file dialog. The first opens the drawing canvas; the second opens Quiver. The **File** menu holds New, Open, Save, and Save As. **Save** or Ctrl+S opens a native Save As dialog for a new diagram. To open a file at launch, run `just run path/to/figure.tikz`. A disk change since the last load stops an ordinary save and reports a conflict. Image paths resolve from the file directory.

## Linux desktop package

Run `just package` to build a Debian package in `src-tauri/target/release/bundle/deb/`. It contains a Tauri window, a compiled Bun file host, the editor assets, an application icon, and a desktop entry. Install the package with your system package manager, or run `just install-desktop` to sync a user installation under `XDG_DATA_HOME` (default `~/.local/share`). The user install stores the app in `visual-tikz-editor/`, the entry in `applications/`, and the icon in `icons/`. Run the installer again after a new build to update those files. Launch **Visual TikZ Editor** from the application menu or pass a `.tikz` or `.tikzcd` file to its command. The drawing view works without TeX; the optional **TeX render** view uses the tools and `~/.pandoc` configuration described below.

The workbench offers a **TeX render** view of the same source. It uses the local `pandoc`, `pdflatex`, and `pdf2svg` tools with the Pandoc filter and standalone template under `~/.pandoc`. The standalone Quiver canvas starts with standard KaTeX macros; an embedding host supplies its document's macro definitions through the host interface. Code, preview, canvas, and Quiver have icons on two sidebars. Drag icons between the sidebars. Click an icon to open its view, or click the active icon to close it. One open view fills the center; two open views have a movable divider. **Properties** opens an inspector popup over the diagram. The light theme is the default. Theme, drawing preferences, and palette collections are saved under `XDG_CONFIG_HOME/visual-tikz-editor/preferences.json` (default `~/.config/visual-tikz-editor/preferences.json`) and survive changes to the launch port.

The canvas toolbar has selection, lasso, and eraser controls, an **Insert** popup, and buttons for properties, layers, and drawing settings. Drag its grip to move it. Click the zoom percentage for fit, grid, ruler, and snapping controls. Selected objects expose their applicable commands through floating action buttons. The drawing color popup edits RGBA or hex colors and manages named palette collections.

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
| `selectSource` | Highlight a canvas selection in an open source editor. |
| `clipboard` | Read and write the native clipboard. The desktop host supplies this service. |
| `savePreference` | Persist editor preferences across launches. |

The source document is authoritative. The editor bridges reject stale source writes. The host must keep source identity and save transactions consistent with its own document model.

For live diagnostics, call `window.visualTikzEditorDebug()` in the drawing iframe. It returns the current source and revision, scene, selection, handles, viewport, snapping and canvas settings, diagnostics, and developer logs.

## Build and provenance

`just build` builds the standalone page. `just test-commit` checks Vue and TypeScript. `just test` runs the workbench's Mocha tests on Node.js. The source under `vendor/tikz-editor` and `vendor/quiver` comes from pinned upstream revisions plus maintained patches. Each `PROVENANCE.toml` records the source revision. `just update-tikz-editor-vendor` and `just update-quiver-vendor` rebuild those assets.

The workbench is GPL-3.0. The bundled editors and their third-party assets retain their own license files. See [LICENSE](LICENSE) and the vendor provenance records.
