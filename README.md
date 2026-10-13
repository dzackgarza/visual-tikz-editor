# Visual TikZ Editor

Visual TikZ Editor edits one mathematical diagram and its TikZ source. It runs as a standalone local web app. The `tikzpicture` view uses the pinned [TikZ Editor](https://github.com/DominikPeters/tikz-editor) fork. The `tikzcd` view uses the pinned [Quiver](https://github.com/varkor/quiver) fork. Both show the diagram directly while you edit. Drawing and visual preview do not run TeX.

This repository was extracted from [`zettlr-pandoc/packages/tikz-workbench`](https://github.com/dzackgarza/zettlr-pandoc/tree/tikz-workbench-module/packages/tikz-workbench). It holds the editor component, a standalone file host, the fork patches, and their pinned assets. The visual tools edit TikZ source through the host; the host owns the file.

## Run the standalone app

Install [Bun](https://bun.sh/), [just](https://github.com/casey/just), and Zenity for the native Open and Save As dialogs. The test suite also uses Node.js. Native file workflows require Xvfb, D-Bus, xdotool, ImageMagick, and Python's system PyGObject/AT-SPI bindings (`python3-gi` and `gir1.2-atspi-2.0` on Ubuntu). They run Chrome and the real Zenity chooser on a private display and session bus. Then run:

```sh
bun install --frozen-lockfile
just run
```

Open the local URL printed by `just run`. The app starts with a new `tikzpicture` in the drawing canvas. The New dialog offers `tikzpicture` and `tikzcd`; `tikzcd` opens Quiver. The **File** menu holds New, Open, Save, and Save As. **Save** or Ctrl+S opens a native Save As dialog for a new diagram. To open a file at launch, run `just run path/to/figure.tikz`. A disk change since the last load stops an ordinary save and reports a conflict. Image paths resolve from the file directory.

## Linux desktop package

Run `just package` to build a Debian package in `src-tauri/target/release/bundle/deb/`. The desktop host supplies native clipboard access. It contains a Tauri window, a compiled Bun file host, the editor assets, an application icon, and a desktop entry. Install the package with your system package manager, or run `just install-desktop` to sync a user installation under `XDG_DATA_HOME` (default `~/.local/share`). The user install stores the app in `visual-tikz-editor/`, the entry in `applications/`, and the icon in `icons/`. Run the installer again after a new build to update those files. Launch **Visual TikZ Editor** from the application menu or pass a `.tikz` or `.tikzcd` file to its command. The drawing view works without TeX; the optional **TeX render** view uses the tools and `~/.pandoc` configuration described below.

The workbench offers a **TeX render** view of the same source. It uses the local `pandoc`, `pdflatex`, and `pdf2svg` tools with the Pandoc filter and standalone template under `~/.pandoc`. The filter must support renderer protocol 3 (available in `pandoc-config` revision `f6e2e4c` and later). The standalone Quiver canvas starts with standard KaTeX macros; an embedding host supplies its document's macro definitions through the host interface. Code, preview, canvas, and Quiver have icons on two sidebars. Drag icons between the sidebars. Click an icon to open its view, or click the active icon to close it. One open view fills the center; two open views have a movable divider. The canvas toolbar opens **Properties**, **Layers**, and **Settings**. Its grip moves and docks the toolbar, and **Insert** holds drawing tools and equation insertion. **Copy source** copies the authored source without saving the file. The light theme is the default; the theme button saves the chosen appearance locally.

## Embed the workbench

Mount `src/ui/TikzWorkbench.vue` with `target`, `host`, and `theme`. Set `initialMode` for the opening view, or bind `requestedMode` when a host control must switch views after mount. The standalone host opens `tikzpicture` in its visual editor; Zettlr opens it in TeX render. A host that supplies only the visual editor opens the drawing canvas. `target` names the source bytes, their document range, the diagram language, and the document path. `host` implements `TikzWorkbenchHost` in `src/host.ts`:

| Service | Host responsibility |
| --- | --- |
| `readSource`, `writeSource` | Read and replace the source range. Send an updated target after a write. |
| `rendering` | Supply `render` and `figureUrl` together when the host offers a TeX render view. |
| `quiver` | Supply the Quiver page URL and KaTeX macro projection when the host edits `tikzcd`. |
| `imageBaseUrl` | Resolve figure image paths. |
| `editorUrl` | Serve the pinned drawing editor page under `vendor/`. |
| `requestSave` | Handle an explicit editor Save gesture when the host offers file saving. |
| `reportError` | Report an integration error. |

The source document is authoritative. The editor bridges reject stale source writes. The host must keep source identity and save transactions consistent with its own document model.

The mounted `/embedding.html` fixture exercises the iframe boundary and the exported `requestEditorSnapshot` client. A host creates a UUID session and sends typed `HostCommand` loads with strictly increasing load revisions and unique request IDs. The iframe accepts commands only from its parent at the referring origin. Notifications never execute commands. Each snapshot request names the session, load revision and exact source bytes; it waits for the editor's compute scheduler and returns matching source, SVG, viewBox, local bounds, original-stroke associations, selection, tool and viewport, or a typed failure. Local bounds use the exported SVG coordinate system in points; an empty scene has null bounds. Pass a saved snapshot's `state` with a later `load` to restore its tool, selection and viewport after the matching render. Its SVG definitions are namespaced to the session and source revision.

Pass an `AbortSignal` to `requestEditorSnapshot`; aborting cancels the request. On host disposal, abort with the reason `"disposed"` before removing the iframe to remove client listeners without sending further commands. Use `requestEditorSource` for current text, including an edit whose change notification has not arrived yet. It shares the snapshot client's peer, origin, session, request, timeout and disposal checks. Copying does not request a save.

`import-ink` accepts typed `OriginalStroke` records with figure-local keys, ordered samples, optional sensor channels and optional outlines. These records live in source comments inside their own scopes and therefore travel through source history and ordinary file storage. `interpret-ink` and `restore-ink` require the exact current source and stroke key. Strokes marked `ink` cannot be interpreted as geometry. Original-stroke controls remain available when their scope is selected after reopening. Clear **Interpret geometry** in the Freehand properties to keep new handwritten strokes outside fitting. SVG snapshots bundle image bytes and namespace definition IDs.

View switches retain the visual editor instance, including its selection, viewport, tool and source undo history. The host owns document identity and persistence. Snapshot state can restore a view into a fresh session; undo history remains session-local. Consumers pin the full commit of a reviewed release from this repository, keeping the public TypeScript API and vendored editor assets at that same revision. Release archives include the standalone build and qualification recordings.

## Build and provenance

`just build` builds the standalone page. `just test-commit` checks Vue and TypeScript. `just test` runs the workbench's Mocha tests on Node.js. The source under `vendor/tikz-editor` and `vendor/quiver` comes from pinned upstream revisions plus maintained patches. Each `PROVENANCE.toml` records the source revision. `just update-tikz-editor-vendor` and `just update-quiver-vendor` rebuild those assets.

The workbench is GPL-3.0. The bundled editors and their third-party assets retain their own license files. See [LICENSE](LICENSE) and the vendor provenance records.
