# Implementation Plan: Product design of the Visual TikZ Editor

**Branch**: `main` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-product-design/spec.md`

## Summary

The editor gets one information architecture across the standalone app and every host: a
document bar that the workbench owns (title slot, Undo and Redo, View, Layers, Properties, Share
and Export, More), a drawing toolbar inside the canvas with the Lasso first and per-tool colour
presets, an Active Tool Menu, an object menu above the selection, canvas controls for zoom and
snapping, and separate Layers and Properties panels. The shell owns the document bar and the
views; the TikZ Editor fork owns every surface inside the canvas; the Quiver fork owns its view
([research](research.md) R1). The shell and the editors meet only through the
[host protocol](contracts/host-protocol.md). The surfaces and their controls are fixed by
[surfaces](contracts/surfaces.md); the state they show is in the [data model](data-model.md).

The user has decided FR-041 and FR-005. The other requirements and the research entries are the
maintainer's proposals; the user reviews them and sets the story priorities before
`/speckit-tasks` orders the work.

## Technical Context

**Language/Version**: TypeScript 5.9; Vue 3.5 in the shell; React 19 in the TikZ Editor fork;
JavaScript in the Quiver fork; Rust in the Tauri 2 desktop shell.

**Primary Dependencies**: The TikZ Editor fork at upstream 0.5.2
(`vendor/tikz-editor/PROVENANCE.toml`) with `@remixicon/react` 4.9, `@uiw/react-color-wheel`
2.10, xstate 5, and zustand 5; the Quiver fork (`vendor/quiver/PROVENANCE.toml`); CodeMirror 6
for the Code view; zod 4 for the protocol schemas. Research R6 and R7 add
`@uiw/react-color-alpha`, `@uiw/react-color-editable-input`, `@remixicon/vue`, and `lucide-react`
1.64.

**Storage**: The `.tikz` or `.tikzcd` file is the document. Preferences and per-file view state
(viewport, layer visibility and lock) are kept outside the source through `persistence-save`.

**Testing**: Mocha browser stories in Playwright Chromium (`bun run test:browser`) with the pen,
touch, and mouse helpers of `test/tablet.ts`, in portrait and landscape; the fork's Vitest specs
(`bun run test:logic`).

**Target Platform**: Chromium on a pen tablet and on a desktop; the Tauri desktop window; the
Zettlr and Math Notes hosts.

**Project Type**: A local web application with an embeddable component.

**Performance Goals**: The pen makes its mark on the first contact (Principle II).

**Constraints**: The page is served on `127.0.0.1` and makes no requests to other hosts. Fork
code changes go through `.cache/tikz-editor` and `ZETTLR.patch`, never `vendor/` in place.

**Scale/Scope**: Seven user stories; the surfaces of the surfaces contract; two document kinds.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Constitution version
2.0.0.

| Principle | Before research | After design |
| --- | --- | --- |
| I. Authored TikZ is the document | Pass: the spec keeps session state out of the source | Pass: the data model puts only Document source and Layer name and order in the source; layer visibility and lock are view state |
| II. Pen and touch first | Pass: every surface is tap-driven | Pass: every control in the surfaces contract has a 44 × 44 pt hit region; tooltips carry no command (R11) |
| III. Established conventions, cited | Pass: each requirement cites its prior art | Pass: each research entry cites its source; R17 cites Notability and GoodNotes |
| IV. The canvas has the attention | Pass: no instruction text (FR-070), no status line | Pass: R10 removes the status line; the object menu hides inapplicable commands (R14); Properties is dimmed, as a menu-bar item, with nothing selected (R13) |
| V. One scope per surface | Pass: the information architecture gives each control one surface | Pass: the surfaces contract lists each control once; popovers are anchored and single across the shell and the fork (R16, host protocol) |
| VI. One coordinate system | Pass: FR-042 | Pass: rulers in figure coordinates (R9); 100 % is printed size (FR-041) |
| VII. Design before implementation | Pass: this plan follows the spec | Pass: every surface and message traces to a spec item |
| VIII. Behaviour is proven on the real page | Pass | Pass: the [quickstart](quickstart.md) lists the stories that accept each story; replaced stories are rewritten with their rules |

The Architecture and Boundaries rules hold: each fork owns its interaction, a `tikzpicture`
never offers Quiver (FR-014), and the host protocol is typed and versioned.

## Project Structure

### Documentation (this feature)

```text
specs/001-product-design/
├── spec.md
├── audit.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── surfaces.md
│   └── host-protocol.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
standalone/              # the standalone shell: StandaloneApp.vue, HostedApp.vue, server.ts
src/
├── host.ts              # the typed host interface
├── quiver-bridge.ts     # Quiver messages
├── source-block.ts      # document kind detection
└── ui/                  # TikzWorkbench.vue (the document bar and views), previews
vendor/tikz-editor/
├── embed/src/           # repository-owned embed: commands.ts, events.ts, main.tsx
├── ZETTLR.patch         # the fork's changes, made in .cache/tikz-editor/packages/app/src/ui
└── src/                 # built assets, from just update-tikz-editor-vendor
vendor/quiver/
├── ZETTLR.patch         # the Quiver fork's changes
└── src/                 # built assets, from just update-quiver-vendor
src-tauri/               # the desktop shell
test/
├── workbench-browser.spec.ts
├── workbench-files.spec.ts
└── tablet.ts
docs/                    # interaction model, prior-art specifications, user guide, embedding
```

**Structure Decision**: The existing layout stays. The document bar is built in
`src/ui/TikzWorkbench.vue` so every host gets it (R2); the canvas surfaces are fork changes
carried by `vendor/tikz-editor/ZETTLR.patch`; the protocol messages are in
`vendor/tikz-editor/embed/src/` and `vendor/quiver/ZETTLR.patch`. The documents under `docs/`
that disagree with the specification are corrected in the same work (spec, Assumptions).

## Complexity Tracking

No principle is violated.
