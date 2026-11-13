# Tasks: Product design of the Visual TikZ Editor

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/surfaces.md](contracts/surfaces.md),
[contracts/frame-protocol.md](contracts/frame-protocol.md), [quickstart.md](quickstart.md),
constitution 2.3.0.

**Tests**: Required. Principle VIII accepts each story by browser stories on the real page. In each
story phase the stories come first: write them, run them against the present code with
`bun run test:browser --grep '<title>'`, check that each failure shows the gap that the scenario
names, and commit them before the repair (`ai-review-ci red-commit --issue <issue> -m <message>`
when a hook rejects the red commit). The red commit names the open issue that reports the gap; when
none exists, the maintainer files one with its Prior art section and the specification items it
serves (constitution, Development Workflow). A story that this work replaces is rewritten to the new rule
in the same phase; its old assertion is deleted, not weakened.

**Fork rules**: Fork code changes are made in `.cache/tikz-editor/packages/app/src/` (from
`just tikz-editor-checkout`) and carried by `just tikz-editor-patch && just update-tikz-editor-vendor`.
`vendor/tikz-editor/embed/` is repository source. Quiver changes go into `vendor/quiver/ZETTLR.patch`
and `just update-quiver-vendor`. Nothing under `vendor/*/src/` is edited in place.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story of the task (US1–US8)

---

## Phase 1: Setup

- [X] T001 [P] Add `@remixicon/vue` to the shell with `bun add @remixicon/vue` in `package.json` (research R7)
- [X] T002 [P] Add `lucide-react@1.64`, `@uiw/react-color-alpha`, and `@uiw/react-color-editable-input` to the fork with `bun add` in `.cache/tikz-editor/packages/app/package.json` (research R6, R7)
- [X] T003 [P] Replace the `node scripts/…` refresh note with the `just update-tikz-editor-vendor` recipe in `vendor/tikz-editor/PROVENANCE.toml`

---

## Phase 2: Foundational

**Purpose**: the standalone shell with one document history and the new frame protocol. Every
story that uses Undo or the document bar depends on this phase; the open view of US8 does not.

### The editor is standalone (FR-064, research R2)

- [ ] T004 Move each of the 20 stories that open `embedding.html` or `quiver-embedding.html` in `test/workbench-browser.spec.ts` (from "persists the completed Quiver edit through the embedding owner…" near line 8580 to line 9621) to the standalone page `index.html`, asserting the same behaviour through the standalone shell; delete a story whose only subject is the host interface
- [ ] T005 Trash the embedding pages and their test with `trash standalone/embedding.html standalone/embedding.ts standalone/hosted.html standalone/hosted.ts standalone/HostedApp.vue standalone/quiver-embedding.html standalone/quiver-embedding.ts standalone/QuiverEmbedding.vue test/hosted-browser.spec.ts`, and delete their entries `quiverEmbedding`, `embedding`, `hosted` from `vite.config.ts`
- [ ] T006 Rewrite the module comment of `src/host.ts` to describe the boundary between the workbench and the standalone shell, delete the Zettlr text, and make `rendering`, `quiver`, and `selectSource` of `TikzWorkbenchHost` required, since the standalone server always supplies them; update `src/ui/TikzWorkbench.vue`, `TikzEditorPreview.vue`, `TikzCompilerPreview.vue`, `TikzQuiverPreview.vue` where they test for their absence
- [ ] T007 [P] Trash `docs/embedding.md`; in `README.md` replace line 5 ("Other programs embed the same editor…") with the standalone, XDG-compliant statement and delete the Embedding link at line 79; in `docs/development.md:10` delete "and the embedding test pages"
- [ ] T008 [P] Rewrite `HANDOFF.md` item H (Host API) to the standalone shell, and correct `docs/prior-art/stories.md` where it names the embedding pages

### Frame protocol (contracts/frame-protocol.md)

- [X] T009 In `vendor/tikz-editor/embed/src/commands.ts` add `replace-source` (`source`), rename `inspector` to `panel` with `panel: 'layers' | 'properties' | null`, add `dismiss-popover` and `zoom` (`direction: 'in' | 'out' | 'fit' | 'selection' | 'normal'` or `scale`), and delete `undo`, `redo`, `history`, `input`, `import-ink`, `interpret-ink`, and `restore-ink` (only an embedding host sent the ink commands; the canvas restores an original stroke itself through `src/original-ink.ts`); raise the protocol version that `init` reports
- [X] T010 In `vendor/tikz-editor/embed/src/events.ts` add `undo-request`, `redo-request`, `selection` (`empty`), `panel` (`panel: 'layers' | 'properties' | null`), and `popover-opened`
- [X] T011 Wire the new commands and events in `vendor/tikz-editor/embed/src/main.tsx`: `replace-source` loads the source and keeps viewport and tool; the canvas Undo and Redo shortcuts post `undo-request` and `redo-request` instead of acting on the fork's history
- [X] T012 In the fork, delete the past and future stacks of the store (`UNDO` and its pair in `.cache/tikz-editor/packages/app/src/store/reducer.ts:958` and `store/types.ts`) so the canvas keeps no history of its own, and keep the points where the reducer records a step: at each one the embed posts one `change`, so a gesture is one step and not one debounce flush (`vendor/tikz-editor/embed/src/main.tsx:302-312`); route the Undo and Redo commands of `ui/editor-command-runtime.ts`, `app-menu/default-menu.ts:148`, `context-menu/canvas-context-menu.ts:287,505`, and the shortcut of `ui/canvas-panel/useCanvasKeyboardClipboard.ts:248-249` to `undo-request` and `redo-request`. Keep `undoTransientCanvasStep`, which removes the last placed point of a construction (FR-034)
- [X] T013 In `vendor/quiver/ZETTLR.patch` post `zettlr-quiver:undo-request` and `zettlr-quiver:redo-request` from Quiver's Undo and Redo shortcuts, accept `zettlr-quiver:source` after Undo or Redo, give each `zettlr-quiver:change` the Quiver history event it made or extended as its `step`, post the pending change before a source reply, and hide Undo, Redo, Save, autosave, theme, and About in Quiver's toolbar; rebuild with `just update-quiver-vendor`; `src/ui/TikzQuiverPreview.vue` answers the two requests with the document's Undo and Redo
- [X] T014 Update `src/host.ts` exports and `src/editor-bridge.ts` to the new command and event schemas, and refuse an editor whose `init` version differs

### One document history (FR-012b, research R3, data-model History)

- [X] T015 Write the red story "Undo acts on the one document history in every view" in `test/workbench-browser.spec.ts`: drag one point on the canvas, then type in the source editor, then tap Undo twice; the first Undo removes the whole typing and the second the whole drag, and after each the canvas and the source editor show the same source; Redo restores the drag; repeat with a label edited in Quiver for a `tikzcd`; commit it red
- [X] T016 Create `src/document-history.ts`: the document is a headless CodeMirror `EditorState` from `@codemirror/state` with `history({ newGroupDelay: 500, joinToEvent })` from `@codemirror/commands`; every edit names its step (a canvas gesture its frame `step`, a Quiver write its own, the source editor `code`), and `joinToEvent` joins an edit to the Undo step before it only when both name the same step; only `change` writes canvas source, and the frame posts it before `source-selection`; Undo and Redo are `undo` and `redo` on that state; `undoDepth` and `redoDepth` dim the buttons; a new edit after Undo empties `future` (data-model History: "A step is one edit of the source in any view; typing in the Code panel groups changes no more than 500 ms apart")
- [X] T017 Mount the source editor of `standalone/SourceEditor.vue` (the later Code panel) on the document state of `src/document-history.ts`, so it keeps no history of its own: delete its `history()` extension and `historyKeymap` (`standalone/SourceEditor.vue:12,58-59`) and bind `Mod-z` and `Mod-Shift-z` to the document history
- [X] T018 In the document bar of `standalone/StandaloneApp.vue` (contracts/surfaces.md): the title leading; Undo (`RiArrowGoBackLine`, "Undo") and Redo (`RiArrowGoForwardLine`, "Redo") in the centre. Undo and Redo act on `src/document-history.ts`, answer `undo-request` and `redo-request` from the canvas frame, and send `replace-source` to the canvas and `zettlr-quiver:source` to Quiver after each step; run the T015 story green

**Checkpoint**: the shell is standalone, the protocol is at its new version, and Undo acts on the document in every view.

---

## Phase 3: User Story 1 - Draw a figure by pen (P1) 🎯 MVP

**Goal**: the drawing toolbar of the surfaces contract, the Active Tool Menu, single popovers, and
the eraser sweep.

**Independent Test**: a story with pen events draws three strokes, erases one by sweeping, lassoes
the other two, moves them, and undoes the move.

### Stories (red first)

- [ ] T019 [P] [US1] Story "the pen marks on first contact and the source gains a path; a width chosen in the Pen's Active Tool Menu applies to the next stroke as it is drawn" (scenario 1, FR-025) in `test/workbench-browser.spec.ts`, with the pen helpers of `test/tablet.ts`
- [ ] T020 [P] [US1] Story "the eraser sweep removes the crossed parts of two strokes in one undo step" (scenario 2) in `test/workbench-browser.spec.ts`
- [ ] T021 [P] [US1] Story "the drawing toolbar holds Lasso, Pen, Eraser, Shapes, Text, Fill, the active tool's presets, and Add colour, all as symbols, and nothing else" (scenario 3, FR-007, FR-008, FR-011, SC-002) in `test/workbench-browser.spec.ts`
- [ ] T022 [P] [US1] Story "a second tap closes the Active Tool Menu; a tap on View closes it and opens View" (scenario 4, FR-003, FR-004, FR-009) in `test/workbench-browser.spec.ts`
- [ ] T023 [P] [US1] Story "the Lasso selects by tap, by Freehand, Rectangle, and Oval drag, and moves by a drag on the selection" (FR-012a) in `test/workbench-browser.spec.ts`
- [ ] T024 [US1] Story for the independent test (three strokes, sweep, lasso two, move, Undo) in `test/workbench-browser.spec.ts`; run T019–T024 against the present code and commit them red

### Implementation

- [ ] T025 [US1] Rebuild the dock of `.cache/tikz-editor/packages/app/src/ui/Toolbar.tsx:699-760` to the order Lasso, Pen, Eraser, Shapes, Text, Fill, separator, presets, Add colour, with SnapControl and ZoomDisplayControl after the presets until T057 moves them; delete Select (the Lasso is the one selection tool), the Lasso word, the colour target word (`:419-436`), Undo and Redo, the Layers, Properties, and Settings words (`:744-748`), and the step lane (`:750-754`)
- [ ] T026 [US1] Use Lucide `lasso` for the Lasso and `RiEraserLine` for the Eraser, give each item the accessible name of the surfaces contract and a 44 × 44 pt hit region in `.cache/tikz-editor/packages/app/src/ui/Toolbar.tsx`
- [ ] T027 [US1] Make the Lasso the one selection tool with the Active Tool Menu option Freehand (default), Rectangle, Oval in `.cache/tikz-editor/packages/app/src/ui/tool-config.tsx` and the canvas selection handlers of `CanvasPanel.tsx`
- [ ] T028 [US1] Open the Active Tool Menu on a second tap on the active tool and close it on a further tap in `.cache/tikz-editor/packages/app/src/ui/ToolbarToolPopup.tsx` (`openPopupMode` at `:83`); hold the options of data-model Tool per tool
- [ ] T029 [US1] Keep one popover open in the window: the fork posts `popover-opened` when it opens one and closes its own on `dismiss-popover` (`vendor/tikz-editor/embed/src/main.tsx`); the shell closes its menus on `popover-opened` and sends `dismiss-popover` when it opens one (`src/ui/TikzWorkbench.vue`) (research R16)
- [ ] T030 [US1] Move the toolbar only by its grip and dock it to any screen edge in `.cache/tikz-editor/packages/app/src/ui/DockLayout.tsx` (FR-010)
- [ ] T031 [US1] Make the Eraser sweep remove the crossed parts of every crossed stroke as one change event, so it is one step of the document history, in the fork's eraser tool under `.cache/tikz-editor/packages/app/src/`
- [ ] T032 [US1] Rewrite the replaced stories near lines 5012, 5067, 1445, and 1803 of `test/workbench-browser.spec.ts` to the toolbar and Lasso rules; run `just tikz-editor-patch && just update-tikz-editor-vendor` and the US1 stories green

**Checkpoint**: User Story 1 passes by itself.

---

## Phase 4: User Story 3 - Edit a selected object (P2)

**Goal**: the object menu above the selection with only the commands that apply; colour presets
that colour the selection without a target word.

**Independent Test**: a story selects a curve, a circle, and two objects in turn and compares each
object menu with the commands that apply.

### Stories (red first)

- [ ] T033 [P] [US3] Story "each object menu holds exactly the commands of its selection" for one curve, one shape, several objects, and points in Edit Points, per contracts/surfaces.md Object menu, in `test/workbench-browser.spec.ts`
- [ ] T034 [P] [US3] Story "a colour preset colours the tool and the selection, and no word names the target; each tool shows its own presets" (FR-020, FR-021) in `test/workbench-browser.spec.ts`
- [ ] T035 [P] [US3] Story "a locked selection survives a tap that misses; Edit Points dims and locks the rest" (FR-052, FR-053) in `test/workbench-browser.spec.ts`
- [ ] T036 [P] [US3] Story "a second tap on the active preset opens the palette, wheel, opacity, hex, and the exact `xcolor` field, and `red!50!blue` stays as authored" (FR-022) in `test/workbench-browser.spec.ts`; commit T033–T036 red

### Implementation

- [ ] T037 [US3] Rebuild the object menu in `.cache/tikz-editor/packages/app/src/ui/SelectionStrip.tsx` and `CanvasPanel.tsx:4944-4991`: above the selection at once, only the commands that apply, More with Cut, Copy, Paste, Delete, Transform, Reorder, Repeat… (research R14)
- [ ] T038 [US3] Make Simplify and Restore Original Stroke object-menu commands on a selected curve, using `restore-ink` (FR-027), in `.cache/tikz-editor/packages/app/src/ui/SelectionStrip.tsx`
- [ ] T039 [US3] Keep per-tool presets (three by default, at most 12, data-model Tool `presets[tool]` "`Colour[]`, 1–12") as preferences through `persistence-save` in the fork store `.cache/tikz-editor/packages/app/src/store/`
- [ ] T040 [US3] Replace the native colour input of `.cache/tikz-editor/packages/app/src/ui/ColorPicker.tsx:199-228` with the colour options of research R6 (`@uiw/react-color-wheel`, `@uiw/react-color-alpha`, `@uiw/react-color-editable-input`, the palette, the exact `xcolor` field); write opacity as TikZ `opacity` only when below 1 (data-model Colour)
- [ ] T041 [US3] Rewrite the replaced stories near lines 8287 and 1886 of `test/workbench-browser.spec.ts`; rebuild the fork and run the US3 stories green

---

## Phase 5: User Story 4 - Construct exact geometry (P3)

**Goal**: constructions show their stage by points, provisional geometry, and the snap marker,
with no sentence; Cancel and Finish in the Active Tool Menu.

**Independent Test**: a story chooses each construction, places its points on lattice points, and
checks the emitted TikZ; at no stage does a sentence appear.

### Stories (red first)

- [ ] T042 [P] [US4] Story "each construction on lattice points emits its TikZ and shows no sentence at any stage" (independent test, FR-030, FR-031, SC-003) in `test/workbench-browser.spec.ts`
- [ ] T043 [P] [US4] Story "after two points of the arc through three points the canvas shows the points, the provisional arc through the pen, and the snap marker" (scenario 1, FR-024) in `test/workbench-browser.spec.ts`
- [ ] T044 [P] [US4] Story "choosing another tool discards only the provisional construction; Cancel and Finish are in the Active Tool Menu" (scenario 2, FR-032, FR-033) in `test/workbench-browser.spec.ts`
- [ ] T045 [P] [US4] Story "a stroke held still at its end becomes a line, rectangle, circle, or ellipse, and Undo returns the stroke" (FR-026) in `test/workbench-browser.spec.ts`; commit T042–T045 red

### Implementation

- [ ] T046 [US4] Delete the step text of `.cache/tikz-editor/packages/app/src/ui/canvas-session.ts:214-268`, the instruction text of `InspectorPanel.tsx:1863-1946` and `CanvasPanel.tsx:5384-5410`, and the hint of `path-selection-hint.ts:25`; show the stage by placed points, provisional geometry, and the snap marker (research R10)
- [ ] T047 [US4] Put Cancel and, for an open path, Finish in the Active Tool Menu during a construction in `.cache/tikz-editor/packages/app/src/ui/ToolbarToolPopup.tsx`
- [ ] T048 [US4] Shorten the tooltips of `.cache/tikz-editor/packages/app/src/ui/tool-config.tsx:258-277,395-397` to the control's name and shortcut, shown on hover only (research R11, FR-070)
- [ ] T049 [US4] Rewrite the replaced stories near lines 4529 and 6106 of `test/workbench-browser.spec.ts`; rebuild the fork and run the US4 stories green

---

## Phase 6: User Story 8 - Navigate the figure (P4)

**Goal**: fit at open, 100 % as printed size, the origin and axes, rulers in figure coordinates,
canvas controls for zoom and snap, and the status line.

**Independent Test**: a story opens a figure with content and checks that all of it is visible with
the fit margin, chooses Normal Size and checks that 1 cm of the figure is 1 cm at the CSS
reference, and holds the pen over a lattice point and reads the status line.

### Stories (red first)

- [ ] T050 [P] [US8] Story "a figure with content opens fitted with the 44 px margin and reopens at its last view" (FR-040, SC-005) in `test/workbench-browser.spec.ts`
- [ ] T051 [P] [US8] Story "an empty figure opens at 100 % with the origin centred and the axes visible; Normal Size makes 1 cm of the figure 96 / 2.54 CSS px; the ruler labels and the status line read figure coordinates, with no pixel unit" (FR-041, FR-042, Principle VI) in `test/workbench-browser.spec.ts`
- [ ] T052 [P] [US8] Story "the pen over (1, 2) makes the status line 'Pointer position' read 1 and 2 and nothing else" (FR-044) in `test/workbench-browser.spec.ts`
- [ ] T053 [P] [US8] Story "the zoom readout opens Zoom to Fit, Zoom to Selection, Normal Size, and 10–1000 %; zooming changes neither source nor selection; Snap toggles and Snapping rules opens Lattice, Objects, Alignment, Angle" (FR-023, FR-043) in `test/workbench-browser.spec.ts`; commit T050–T053 red

### Implementation

- [ ] T054 [US8] Set the scale so that 1 is printed size at 96 CSS px per inch: replace `CANVAS_ZOOM_BASE_SCALE=5` and the presets of `.cache/tikz-editor/packages/app/src/store/workspace-state.ts:18-20` (data-model Viewport `scale`: "1 is printed size at 96 CSS px per inch")
- [ ] T055 [US8] Open a figure with content in Zoom to Fit with a 44 px margin, an empty figure at 100 % with the origin centred, and a known file at its kept viewport, in `.cache/tikz-editor/packages/app/src/ui/useCanvasViewportPersistence.ts:143-163` (research R8)
- [ ] T056 [US8] Label rulers in figure coordinates with Inkscape's `Ruler::draw_scale` step rule in `.cache/tikz-editor/packages/app/src/ui/geometry.ts:99-123` and `useCanvasGuidesAndRulers.ts:200-215`, and draw the origin and axes on the grid (research R9)
- [ ] T057 [US8] Add the canvas controls of contracts/surfaces.md: Zoom out, the readout "Zoom: *n* %", Zoom in at the lower trailing corner; Snap and Snapping rules at the lower leading corner; wire the `zoom` command of the frame protocol, in `.cache/tikz-editor/packages/app/src/ui/CanvasPanel.tsx`; delete SnapControl and ZoomDisplayControl from `Toolbar.tsx`
- [ ] T058 [US8] Add the status line under the canvas with the accessible name "Pointer position", reading the pointer's *x* and *y* in figure coordinates as the source writes them, in `.cache/tikz-editor/packages/app/src/ui/CanvasPanel.tsx` (research R10)
- [ ] T059 [US8] Reproduce the small startup window of COMPLAINTS.md:57 in the desktop window, whose size is `inner_size(1280.0, 800.0)` in `src-tauri/src/main.rs:34`; when it reproduces, file the defect with the prior art for the startup window size, and build the size that the prior art gives (Principle III)
- [ ] T097 [US8] Reproduce #18 (zooming makes the renderer fail) as a red story in `test/workbench-browser.spec.ts`, starting from the paths the issue has not tried: the Render view (Viewer.js), the zoom presets, a large figure, and zoom during a re-render; then repair it
- [ ] T060 [US8] Rebuild the fork and run the US8 stories green

---

## Phase 7: User Story 2 - Open, save, and reopen a TikZ file (P5)

**Goal**: the title menu, the save state beside the title, and the save conflict.

**Independent Test**: a story opens a file with unsupported constructs, moves one point, and
compares the file byte for byte outside the edited statement.

### Stories (red first)

- [ ] T061 [P] [US2] Story "an edit is written and the title shows Saved; the file is unchanged outside the edited statement" (scenario 1, independent test, FR-006) in `test/workbench-files.spec.ts`
- [ ] T062 [P] [US2] Story "a file changed on disk stops the save, keeps a recovery draft in `$XDG_STATE_HOME/visual-tikz-editor/`, and shows Changed on disk" (scenario 2, FR-063) in `test/workbench-files.spec.ts`
- [ ] T063 [P] [US2] Story "the title opens New tikzpicture, New tikzcd, Open…, Save, Save As…, anchored to the title" (FR-001, FR-002) in `test/workbench-browser.spec.ts`; commit T061–T063 red

### Implementation

- [ ] T064 [US2] Replace the File `<details>` menu of `standalone/StandaloneApp.vue:3-29,699-711` with the title menu anchored to the title in the document bar of `standalone/StandaloneApp.vue`, closing on a second tap, an outside tap, and Escape
- [ ] T065 [US2] Show the save state beside the title from data-model Document `saveState` (`saved` | `unsaved` | `saving` | `conflict`) with its transitions, in the document bar of `standalone/StandaloneApp.vue`
- [ ] T066 [US2] Detect a changed file at save in `standalone/server.ts`, write the recovery draft under `$XDG_STATE_HOME/visual-tikz-editor/`, and report the conflict to the shell
- [ ] T067 [US2] Rewrite the replaced story at line 207 of `test/workbench-files.spec.ts`; run the US2 stories green

---

## Phase 8: User Story 5 - The Code panel and Render (P6)

**Goal**: View offers the document's editor and Render; Code is a panel beside the editor.

**Independent Test**: a story opens Code beside the canvas, selects an object, and checks that its
source is highlighted without taking focus.

### Stories (red first)

- [ ] T068 [P] [US5] Story "View offers Canvas and Render for a `tikzpicture` and Quiver and Render for a `tikzcd`, with no explanation of the other kind; a `.tikz` file opens in the canvas and a `.tikzcd` file in Quiver" (scenarios 1–2, FR-013, FR-014, FR-016) in `test/workbench-browser.spec.ts`
- [ ] T069 [P] [US5] Story "Code opens the panel beside the canvas and Quiver; edits show at once in the other; a selection highlights its source without focus; a second tap closes it; Layers closes it" (scenario 3, independent test, FR-015, FR-060) in `test/workbench-browser.spec.ts`
- [ ] T070 [P] [US5] Story "switching between the editor and Render keeps selection, viewport, and tool" (FR-015) in `test/workbench-browser.spec.ts`; commit T068–T070 red

### Implementation

- [ ] T071 [US5] Replace the view rails of `standalone/StandaloneApp.vue:42-75` and their drag (`:178-189`) with View (`RiLayoutColumnLine`, "View") trailing in the document bar of `standalone/StandaloneApp.vue`, a popover anchored to its button, listing the document's editor and Render, then Grid, Rulers, Guides, Output Bounds
- [ ] T072 [US5] Offer Quiver only for a `tikzcd` from the kind of `src/source-block.ts:74-80` and `standalone/StandaloneApp.vue:289`; delete the unavailable-Quiver text of `src/ui/TikzWorkbench.vue:71-76` and `src/quiver-bridge.ts:89-94`, and the mode labels of `src/preview-modes.ts:46-79` that name the other kind
- [ ] T073 [US5] Add Code (`RiCodeLine`) to the document bar and show `standalone/SourceEditor.vue` as the Code panel beside the canvas or Quiver, a side pane in landscape and a sheet in portrait; send `panel: null` to the canvas when Code opens (FR-061, research R12)
- [ ] T074 [US5] Highlight the `source-selection` range in the Code panel without moving focus from the canvas in `standalone/SourceEditor.vue`
- [ ] T075 [US5] Rewrite the Quiver right-sidebar stories near lines 8557 and 10290 and the story near line 10262 of `test/workbench-browser.spec.ts` to View and the Code panel; run the US5 stories green

---

## Phase 9: User Story 6 - Layers and Properties (P7)

**Goal**: Layers and Properties as separate panels from the document bar; Properties shows the
figure with nothing selected.

**Independent Test**: a story opens Layers, adds a layer, moves objects into it, hides it, reopens
the file and finds visibility and lock kept outside the source, then opens Properties with and
without a selection.

### Stories (red first)

- [ ] T076 [P] [US6] Story "Layers then Properties: one panel at a time; a second tap closes each" (scenarios 1–2, FR-060) in `test/workbench-browser.spec.ts`
- [ ] T077 [P] [US6] Story "Properties shows the figure with nothing selected and the object after a selection; no other surface holds the figure's attributes" (scenario 3, FR-060a) in `test/workbench-browser.spec.ts`
- [ ] T078 [P] [US6] Story "a hidden, locked layer reopens hidden and locked, and the source holds only its `scope` with `name=`" (data-model Layer, Principle I) in `test/workbench-files.spec.ts`; commit T076–T078 red

### Implementation

- [ ] T079 [US6] Add Layers (`RiStackLine`) and Properties (`RiEqualizerLine`) to the document bar of `standalone/StandaloneApp.vue`, sending `panel` and following the `panel` event, with Code in the same one-panel state (data-model Panel `open`: none, `code`, `layers`, or `properties`)
- [ ] T080 [US6] Split the shared panel of `.cache/tikz-editor/packages/app/src/ui/DockLayout.tsx:702-724` into a Layers panel and a Properties panel, each with its title and close button
- [ ] T081 [US6] Show `<InspectorPanel figure />` in Properties when the selection is empty and post `selection` (`empty`); delete `DocumentPropertiesDialog.tsx` and its references in `App.tsx` and `editor-command-runtime.ts` under `.cache/tikz-editor/packages/app/src/`; delete the `document-properties` command, the `document-properties-closed` event and action of `vendor/tikz-editor/embed/src/`, the `tikz-embed-document-properties` listeners of `main.tsx`, and Document Properties… with its handlers in `standalone/StandaloneApp.vue`, `src/ui/TikzWorkbench.vue`, and `src/ui/TikzEditorPreview.vue`
- [ ] T082 [US6] Keep layer visibility and lock as per-file view state through `persistence-save`, never in the source, in the fork store `.cache/tikz-editor/packages/app/src/store/`
- [ ] T083 [US6] Rebuild the fork and run the US6 stories green

---

## Phase 10: User Story 7 - Export and reuse (P8)

**Goal**: Share and Export in the document bar with Copy TikZ first.

### Stories (red first)

- [ ] T084 [P] [US7] Story "Share and Export › PDF writes a compiled PDF and leaves the source unchanged" (scenario 1) in `test/workbench-files.spec.ts`
- [ ] T085 [P] [US7] Story "Share and Export › Copy TikZ puts the authored source on the clipboard" (scenario 2) in `test/workbench-browser.spec.ts`; commit T084–T085 red

### Implementation

- [ ] T086 [US7] Replace the Export `<details>` menu of `standalone/StandaloneApp.vue` with Share and Export (`RiShareBoxLine`) in the document bar of `standalone/StandaloneApp.vue`, holding Copy TikZ, then PDF…, SVG…, PNG…, anchored to its button (research R15)
- [ ] T087 [US7] Rewrite the story "Copy source" near line 8550 of `test/workbench-browser.spec.ts` to Copy TikZ; run the US7 stories green

---

## Phase 11: Polish and cross-cutting rules

- [ ] T088 Story "Settings › Appearance: Match System Appearance on follows the system; off with Light shows a light surface under a dark system; the choice is kept in `$XDG_CONFIG_HOME/visual-tikz-editor/` and nothing is written beside the figure" (FR-005, FR-063), replacing the theme story at line 208 of `test/workbench-browser.spec.ts`; commit it red
- [ ] T089 Add More (`RiMoreLine`) with Settings… to the document bar of `standalone/StandaloneApp.vue`; build Settings with Appearance, Canvas, Colours, and Keyboard shortcuts, each changed setting with its own reset; delete the `prefers-color-scheme` theme of `standalone/StandaloneApp.vue:253-258` and the theme control; send `settings.general.colorScheme` to the canvas and `zettlr-quiver:theme` to Quiver; extend `.cache/tikz-editor/packages/app/src/ui/SettingsModal.tsx:11-14` (FR-062, research R15, R17)
- [ ] T090 Story "Code, Layers, and Properties open as a side pane in landscape and as a sheet in portrait, and the selected object stays visible" (FR-061, Principle IV) in `test/workbench-browser.spec.ts`
- [ ] T091 Story "every surface holds exactly the controls of contracts/surfaces.md, found by accessible name, in portrait and landscape, each with a hit region of at least 44 × 44 CSS px" (SC-002, Principle II) in `test/workbench-browser.spec.ts`
- [ ] T092 Story "no reached state shows an instruction sentence, and every command is reached by pen taps alone" (SC-003, SC-004) in `test/workbench-browser.spec.ts`
- [ ] T093 [P] Correct `docs/interaction-model.md` and `docs/user-guide.md` where they disagree with the spec
- [ ] T094 [P] Correct `docs/prior-art/drawing-dock.md`, `shell.md`, `zoom-and-view.md` (item 4 puts the zoom readout in the status line), `panels.md`, `instructional-text.md`, and `selection-and-settings.md` where they disagree with the spec
- [ ] T095 Run each row of [quickstart.md](quickstart.md) "What the stories assert" by its story and record failures as tasks here (`/speckit-converge`)
- [ ] T096 Check SC-001 in the running app (`just run figure.tikz`): none of the twelve observations of [audit.md](audit.md) occurs; render and inspect each surface per the `design` skill

---

## Dependencies

| Phase | Needs |
| --- | --- |
| Setup | — |
| Foundational | Setup |
| US1 (P1) | Foundational |
| US3 (P2) | US1 (objects, Lasso) |
| US4 (P3) | US1 (Shapes, Active Tool Menu) and the fork's present snapping; the Snap canvas control comes with US8 |
| US8 (P4) | US1 (canvas) |
| US2 (P5) | Foundational; its story uses an edit from US1 |
| US5 (P6) | US3 (selection highlight) |
| US6 (P7) | US3 (selection), US2 (reopen) |
| US7 (P8) | US2 (saved source) |
| Polish | all stories |

Inside a story phase: the stories, then the fork and shell changes, then the rewrite of replaced
stories and the green run.

## Parallel work

- Setup: T001–T003.
- Foundational: T007 and T008 beside T004–T006; T013 (Quiver) beside T009–T012 (canvas).
- In each story phase the [P] stories are separate `story(...)` blocks; they are written in
  parallel but land in one file, so they are committed together.
- After US1: US3, US4, and US8 touch different fork files (selection strip and colour picker;
  construction session and tool popup; viewport, rulers, and canvas controls) and can proceed in
  parallel. US2 touches the shell and the server only and can run beside them.
- Polish: T093 and T094.

## Implementation strategy

The order weighs each user report by how much of the work it stops, then by dependency:

1. Setup and Foundational: the standalone shell, the protocol, and one document history. T009–T012
   leave the canvas without a history of its own, so Undo works again only after T018.
2. From US8, the open view and the renderer: T050, T051, T054, T055, and T097. Every figure opens
   as a speck at 5–15 % (#64), 100 % is 3.76 times printed size (#63), and zooming can make the
   renderer fail (#18). Upstream `be197d85` already opens fitted (`computeFitToContentScale`).
   T097 needs no fork change and runs beside step 1.
3. US1 (MVP): the drawing toolbar, the Lasso, the Active Tool Menu, and single popovers. Stop and
   run the US1 stories in portrait and landscape.
4. US3, US4, and the rest of US8, in that order (or in parallel), each accepted by its stories.
5. US2, US5, US6, US7, each accepted by its stories.
6. Polish, then `/speckit-converge` and `/speckit-implement` until converge appends no task.
