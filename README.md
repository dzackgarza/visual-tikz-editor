# Visual TikZ Editor

Visual TikZ Editor edits one mathematical diagram and its TikZ source with a pen, touch, or mouse. The file on disk always holds plain TikZ that compiles with LaTeX, so the diagram stays editable in any text editor. A `tikzpicture` opens in a drawing canvas, a pinned fork of [TikZ Editor](https://github.com/DominikPeters/tikz-editor). A `tikzcd` diagram opens in a pinned fork of [Quiver](https://github.com/varkor/quiver). Drawing runs no TeX.

The editor runs on Linux as a desktop window or as a local web page. Its controls are sized for a pen and fingers on a tablet screen, and a mouse and keyboard also work. Other programs embed the same editor through a typed host interface.

## Install

### Debian package

Download `visual-tikz-editor_0.1.0_amd64.deb` from the [latest release](https://github.com/dzackgarza/visual-tikz-editor/releases/latest) and install it:

```sh
sudo apt install ./visual-tikz-editor_0.1.0_amd64.deb
```

The package depends on Zenity, Pandoc, pdf2svg, librsvg, and TeX Live. It installs the command `visual-tikz-editor` and a **Visual TikZ Editor** menu entry.

### From source

Install [Bun](https://bun.sh/), [just](https://github.com/casey/just), Zenity, and librsvg (`rsvg-convert`). The desktop package also needs Rust and the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux). Then build and install the desktop app for your user:

```sh
git clone https://github.com/dzackgarza/visual-tikz-editor.git
cd visual-tikz-editor
bun install --frozen-lockfile
just install-desktop
```

`just install-desktop` builds the Debian package and copies its contents under `$XDG_DATA_HOME` (default `~/.local/share`): the app in `visual-tikz-editor/`, the menu entry in `applications/`, and the icon in `icons/`. It links `~/.local/bin/visual-tikz-editor`. Run it again after each update.

To use the editor in a browser without the desktop package, run `just run` from the checkout.

### TeX render and export

The **TeX render** view and **Export** compile the diagram with `pandoc`, `pdflatex`, and `pdf2svg`. They read a Pandoc filter and template from `~/.pandoc`, which must support renderer protocol 3. If `~/.pandoc` does not exist, copy the filter and template from this repository:

```sh
mkdir -p ~/.pandoc
cp -R test/fixtures/tikz-data/filters test/fixtures/tikz-data/templates ~/.pandoc/
```

Drawing and source editing work without these tools.

## First use

Start the editor with no file:

```sh
visual-tikz-editor
```

From a checkout, `just run` starts the same editor in your browser. It prints the local address, for example `TikZ workbench: http://127.0.0.1:41623/`.

1. In the New dialog, choose **tikzpicture**. The drawing canvas opens.
2. Choose **Pen** in the drawing dock and draw a stroke.
3. Open **File → Save As…** and save the diagram as `figure.tikz`.
4. Open `figure.tikz` in a text editor. It holds one `tikzpicture` environment with a `\draw` statement for the stroke.

To edit an existing file, pass its path: `visual-tikz-editor figure.tikz` or `just run figure.tikz`. The [user guide](docs/user-guide.md) describes the tools, snapping, layers, views, and settings.

## Files, state, and network

| Item | Location | Behaviour |
| --- | --- | --- |
| Diagram | The `.tikz` or `.tikzcd` file you open | Each accepted edit saves to the file. A change on disk stops the save and reports a conflict. |
| Recovery draft | `$XDG_STATE_HOME/visual-tikz-editor/recovery.json` (default `~/.local/state`) | Holds an untitled diagram until Save As, and the edits that a disk conflict stopped. The editor restores the last diagram after a restart. |
| Preferences | `$XDG_CONFIG_HOME/visual-tikz-editor/preferences.json` (default `~/.config`) | Canvas settings, snapping rules, shortcuts, and colour collections. |
| Render cache | `$XDG_CACHE_HOME/visual-tikz-editor` (default `~/.cache`) | Compiled TeX output for the render view and export. |
| Images | Relative to the diagram's directory | `\includegraphics` paths and TeX inputs resolve there. |

The editor serves its page on `127.0.0.1` only, on a free port. It makes no requests to other hosts. Layer locks and selection locks last only for the open session.

## More documentation

- [User guide](docs/user-guide.md): drawing, construction, snapping, layers, views, export, and settings.
- [Interaction model](docs/interaction-model.md): the rules for tools, selection, undo, snapping, and attachments.
- [Prior art](docs/prior-art/): the interface specifications, each with the applications, documentation, and screenshots it follows.
- [Embedding](docs/embedding.md): the host interface for programs that embed the editor.
- [Development](docs/development.md): building, testing, the vendored editors, and releases.

## License

GPL-3.0; see [LICENSE](LICENSE). The bundled editors keep their own licenses, recorded with their sources under `vendor/`.
