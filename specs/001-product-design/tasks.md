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

## Scope: the core and the long tail (2026-11-15, at `e88486c`)

The user directed on 2026-11-15 that the work necessary for the core of the editor be kept apart
from the long tail of quality control and fine-tuning. This section assigns every open task to one
of the two, and each open task line ends with its assignment. The assignment is the maintainer's
analysis from the specification, the code at `e88486c`, and the issues; the user may move a task.

**The core** is the editing loop on the document: open or start a figure; draw, erase, select,
move, edit points, colour, construct, place text; zoom and pan; undo and redo; save, reopen,
render, export. A task is core when, without it, one of these holds in the built desktop app:

1. A step of the loop fails, stops the canvas, loses work, or changes the source in a way the
   person did not ask for.
2. A step of the loop has no route by pen.
3. An observation that the user reported still shows. Only the observation is core; the other
   items of its issue are not ([HANDOFF](../../HANDOFF.md): "A report is repaired when the running
   app no longer shows it").
4. No story shows 1–3 for a step of the loop, or its story has not run since the code under it
   changed.

**The long tail** is every other open task. It has three kinds. *Surface*: a working route exists,
and the task moves, renames, or restyles it to [contracts/surfaces.md](contracts/surfaces.md).
*Feature*: a capability outside the loop. *QC*: story sweeps, fit tuning, runner failures,
documents, citations, names, and checks on a device.

A tail task stays required by the completion condition of [HANDOFF](../../HANDOFF.md). It is not
dropped and not narrowed. It is not started while a core task is open, except where a core repair
must change the same code.

### Core tasks, in order

| Order | Tasks | Issue | Subject | State at `e88486c` |
| --- | --- | --- | --- | --- |
| 1 | T097, with the wheel and pinch of T129; T145 | [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18), [#71](https://github.com/dzackgarza/visual-tikz-editor/issues/71) | Zooming makes the renderer fail; the launch log that is its evidence | The pinch on a touchpad is reproduced and repaired (`f1195ad`, `97d412d`): WebKitGTK magnified the whole window and left the figure. Ctrl+wheel and the zoom keys through the X server do not fail on WebKitGTK 2.52.6 under Xvfb, as in the installed app at `d9bedaf` (issue body). The log story exists (`32e249c`). Open: the reporter's word on whether the pinch is the reported failure, and a run with a real touchpad, GPU compositing, and WebKitGTK 2.54 |
| 2 | T142 | [#88](https://github.com/dzackgarza/visual-tikz-editor/issues/88) | The first object on an empty file refits the view, and a text placed first is not in edit | Cause known. Two stories are red by commit (`d18e610`, `e88486c`) |
| 3 | T127, and the story runs of T041, T049, and T113 | [#67](https://github.com/dzackgarza/visual-tikz-editor/issues/67) for a story that fails on the runner only | Read the gate of the head: name each failing story, assign it to its task, and repair each one that belongs to a step of the loop | Run 43683352678 of `e88486c` ended in failure (3 of 15 checks; the story run is the one correctness check); its failing stories are in its artifacts and are not read yet. It is the first completed run since `8fa9d62` (red), 151 commits before. T113 records six stories that failed on their first run. T046 and T047 are built and wait for this reading |
| 4 | T100, T101 | — | Undo during a construction removes the last placed point, not a step of the document (FR-034) | Not built: the embed has no `construction` message, so the document bar's Undo steps the document history. Read from the code; T100 is its red story |
| 5 | T143 | [#42](https://github.com/dzackgarza/visual-tikz-editor/issues/42) | File, Export, and More open their lists under their own buttons (report of 2026-11-12) | Read from the code: the lists are placed against the document bar. Not checked in the running app |
| 6 | T042 | — | Each construction emits its TikZ and finishes by pen, with Finish for an open path | The story that covered it was deleted in T032; no present story finishes an open path |
| 7 | T096 | [#17](https://github.com/dzackgarza/visual-tikz-editor/issues/17) | None of the twelve observations of [audit.md](audit.md) shows in the running desktop app | Not run. #18 and the menus of T143 are the two known to remain |

The core is complete when tasks 1–7 are done, the gate run of that head has no failing story of a
core task (each failing story is listed with its tail task), and the desktop package of that head
passes `just test-desktop` and is installed.

### Long tail

| Kind | Tasks | Open issues |
| --- | --- | --- |
| Surface | T048, T056, T057, T060–T071, T073–T075, T084–T087, T090, T091, T099 | [#27](https://github.com/dzackgarza/visual-tikz-editor/issues/27), [#28](https://github.com/dzackgarza/visual-tikz-editor/issues/28), [#29](https://github.com/dzackgarza/visual-tikz-editor/issues/29), [#31](https://github.com/dzackgarza/visual-tikz-editor/issues/31), [#34](https://github.com/dzackgarza/visual-tikz-editor/issues/34), [#35](https://github.com/dzackgarza/visual-tikz-editor/issues/35), [#38](https://github.com/dzackgarza/visual-tikz-editor/issues/38)–[#40](https://github.com/dzackgarza/visual-tikz-editor/issues/40), [#42](https://github.com/dzackgarza/visual-tikz-editor/issues/42)–[#44](https://github.com/dzackgarza/visual-tikz-editor/issues/44), [#47](https://github.com/dzackgarza/visual-tikz-editor/issues/47), [#55](https://github.com/dzackgarza/visual-tikz-editor/issues/55)–[#57](https://github.com/dzackgarza/visual-tikz-editor/issues/57), [#59](https://github.com/dzackgarza/visual-tikz-editor/issues/59), [#60](https://github.com/dzackgarza/visual-tikz-editor/issues/60), [#65](https://github.com/dzackgarza/visual-tikz-editor/issues/65) |
| Feature | T045 and T144 (a held stroke becomes a shape), T058 (status line), T104 and T105 (Figures panel), T106 and T107 (one template for Render and Quiver), T114 (a Pen colour as its `xcolor` expression) | [#48](https://github.com/dzackgarza/visual-tikz-editor/issues/48) (Compare and Overwrite), [#52](https://github.com/dzackgarza/visual-tikz-editor/issues/52), [#58](https://github.com/dzackgarza/visual-tikz-editor/issues/58), [#63](https://github.com/dzackgarza/visual-tikz-editor/issues/63) (display calibration) |
| QC | T043, T044, T059, T092–T095, T098, T108, T110, the pen checks of T129 | [#67](https://github.com/dzackgarza/visual-tikz-editor/issues/67), [#68](https://github.com/dzackgarza/visual-tikz-editor/issues/68), [#69](https://github.com/dzackgarza/visual-tikz-editor/issues/69) |

Notes on the assignment:

- The gate is red while a tail story is red. By the code, the stories of T052 and T053 are red
  until T057 and T058 are built: no control has the name "Pointer position" or "Zoom: *n* %". The
  story of T114 was committed red at `c8bd840`. Step 3 lists such stories; it does not repair them.
- T046 (`4944156`) and T047 (Cancel and Finish in `renderShapesMenu` of the fork's `Toolbar.tsx`,
  read from `ZETTLR.patch`) are built. Their boxes stay open until the story run of T049.
- T066 is met by the present code: `standalone/server.ts` answers 412, keeps the draft in
  `$XDG_STATE_HOME/visual-tikz-editor/recovery.json`, and the story "keeps both sources intact
  when an existing file changes on disk before the source editor Save shortcut"
  (`test/workbench-files.spec.ts`) covers it. What remains is the wording of T062 and T065.
- Present stories, by their titles, cover the data of T061, T104, and T108: "saves through the
  native chooser and reopens exact authored bytes after restarting", "carries one two-figure
  document through edits in each figure, the whole history, and a TeX compile", and "recovers an
  untitled authored diagram after a server interruption". Those tasks add the title menu's
  wording, the Figures panel, and the XDG path. Step 3 shows whether these stories pass.
- The implementation issues #27–#65 were written from the per-surface specifications of
  2026-11-12, before this specification. Where one disagrees with it, the specification holds
  ([spec.md](spec.md), Assumptions); each such issue carries a comment of 2026-11-15 that names
  the items the specification replaces.
- Issues #63, #64, and #70–#87 were closed by the closing words of commits on 2026-11-15, before
  any gate run. Each body was compared with the story titles and the code at `e88486c`; no story
  was run. Two issues are open again. #63 has an item that is not built, "Display calibration" in
  Settings › Canvas (tail). #71 lacks the story of its "Done when", which reads the launch log
  (core, T145). Each item of the others has a story or code, with these not shown by a story
  title: a bordered node under a colour tap (#78), an unreadable `recovery.json` at the start
  (#80), and Export and More under a press in Quiver (#82). Step 3 reads their stories.

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

- [X] T004 Move each of the 20 stories that open `embedding.html` or `quiver-embedding.html` in `test/workbench-browser.spec.ts` (from "persists the completed Quiver edit through the embedding owner…" near line 8580 to line 9621) to the standalone page `index.html`, asserting the same behaviour through the standalone shell; delete a story whose only subject is the host interface
- [X] T005 Trash the embedding pages and their test with `trash standalone/embedding.html standalone/embedding.ts standalone/hosted.html standalone/hosted.ts standalone/HostedApp.vue standalone/quiver-embedding.html standalone/quiver-embedding.ts standalone/QuiverEmbedding.vue test/hosted-browser.spec.ts`, and delete their entries `quiverEmbedding`, `embedding`, `hosted` from `vite.config.ts`
- [X] T006 Rewrite the module comment of `src/host.ts` to describe the boundary between the workbench and the standalone shell, delete the Zettlr text, and make `rendering`, `quiver`, and `selectSource` of `TikzWorkbenchHost` required, since the standalone server always supplies them; update `src/ui/TikzWorkbench.vue`, `TikzEditorPreview.vue`, `TikzCompilerPreview.vue`, `TikzQuiverPreview.vue` where they test for their absence
- [X] T007 [P] Trash `docs/embedding.md`; in `README.md` replace line 5 ("Other programs embed the same editor…") with the standalone, XDG-compliant statement and delete the Embedding link at line 79; in `docs/development.md:10` delete "and the embedding test pages"
- [X] T008 [P] Rewrite `HANDOFF.md` item H (Host API) to the standalone shell, and correct `docs/prior-art/stories.md` where it names the embedding pages

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

- [X] T019 [P] [US1] Story "the pen marks on first contact and the source gains a path; a width chosen in the Pen's Active Tool Menu applies to the next stroke as it is drawn" (scenario 1, FR-025) in `test/workbench-browser.spec.ts`, with the pen helpers of `test/tablet.ts`
- [X] T020 [P] [US1] Story "the eraser sweep removes the crossed parts of two strokes in one undo step" (scenario 2) in `test/workbench-browser.spec.ts`
- [X] T021 [P] [US1] Story "the drawing toolbar holds Lasso, Pen, Eraser, Shapes, Text, Fill, the active tool's presets, and Add colour, all as symbols, and nothing else" (scenario 3, FR-007, FR-008, FR-011, SC-002) in `test/workbench-browser.spec.ts`
- [X] T022 [P] [US1] Story "a second tap on the Pen closes its Active Tool Menu; opening File closes it, and opening it closes File" (scenario 4, FR-003, FR-004, FR-009; View replaces File in this story when T071 adds View) in `test/workbench-browser.spec.ts`
- [X] T023 [P] [US1] Story "the Lasso selects by tap, by Freehand, Rectangle, and Oval drag, and moves by a drag on the selection" (FR-012a) in `test/workbench-browser.spec.ts`
- [X] T024 [US1] Story for the independent test (three strokes, sweep, lasso two, move, Undo) in `test/workbench-browser.spec.ts`; run T019–T024 against the present code and commit them red

### Implementation

- [X] T025 [US1] Rebuild the dock of `.cache/tikz-editor/packages/app/src/ui/Toolbar.tsx:699-760` to the order Lasso, Pen, Eraser, Shapes, Text, Fill, separator, presets, Add colour, with SnapControl and ZoomDisplayControl after the presets until T057 moves them; delete Select (the Lasso is the one selection tool), the Lasso word, the colour target word (`:419-436`), Undo and Redo, the Layers, Properties, and Settings words (`:744-748`), and the step lane (`:750-754`) (done with SnapControl and ZoomDisplayControl in the canvas cell's lower corners, `CanvasPanelView.tsx`, which is part of T057: the T021 story requires Add colour last)
- [X] T026 [US1] Use Lucide `lasso` for the Lasso and `RiEraserLine` for the Eraser, give each item the accessible name of the surfaces contract and a 44 × 44 pt hit region in `.cache/tikz-editor/packages/app/src/ui/Toolbar.tsx`
- [X] T027 [US1] Make the Lasso the one selection tool with the Active Tool Menu option Freehand (default), Rectangle, Oval in `.cache/tikz-editor/packages/app/src/ui/tool-config.tsx` and the canvas selection handlers of `CanvasPanel.tsx`
- [X] T028 [US1] Open the Active Tool Menu on a second tap on the active tool and close it on a further tap in `.cache/tikz-editor/packages/app/src/ui/ToolbarToolPopup.tsx` (`openPopupMode` at `:83`); hold the options of data-model Tool per tool (the numeric entry of a circle or arc moved from Properties to the Shapes menu, `ShapeNumericEntry.tsx`)
- [X] T029 [US1] Keep one popover open in the window: the fork posts `popover-opened` when it opens one and closes its own on `dismiss-popover` (`vendor/tikz-editor/embed/src/main.tsx`); the shell closes its menus on `popover-opened` and sends `dismiss-popover` when it opens one (`src/ui/TikzWorkbench.vue`) (research R16)
- [X] T030 [US1] Move the toolbar only by its grip and dock it to any screen edge in `.cache/tikz-editor/packages/app/src/ui/DockLayout.tsx` (FR-010) (the grip lives in `Toolbar.tsx`)
- [X] T031 [US1] Make the Eraser sweep remove the crossed parts of every crossed stroke as one change event, so it is one step of the document history, in the fork's eraser tool under `.cache/tikz-editor/packages/app/src/` (the present code meets it: the T020 story passes with the document bar's Undo and Redo)
- [X] T032 [US1] Rewrite the replaced stories near lines 5012, 5067, 1445, and 1803 of `test/workbench-browser.spec.ts` to the toolbar and Lasso rules, and every other story that reaches a removed rail control (Select, Geometry, Freehand, Label, Bucket, `Color: New strokes`, rail Undo, Redo, Layers, Properties, Settings, `setSnapRule`) or the shared panel's tabs and `tabpanel`, to the new toolbar, the canvas corners, the document bar, and the separate Layers and Properties panels; run `just tikz-editor-patch && just update-tikz-editor-vendor` and the US1 stories green

**Checkpoint**: User Story 1 passes by itself.

---

## Phase 4: User Story 3 - Edit a selected object (P2)

**Goal**: the object menu above the selection with only the commands that apply; colour presets
that colour the selection without a target word.

**Independent Test**: a story selects a curve, a circle, and two objects in turn and compares each
object menu with the commands that apply.

### Stories (red first)

- [X] T033 [P] [US3] Story "each object menu holds exactly the commands of its selection" for one curve, one shape, several objects, and points in Edit Points, per contracts/surfaces.md Object menu, in `test/workbench-browser.spec.ts`
- [X] T034 [P] [US3] Story "a colour preset colours the tool and the selection, and no word names the target; each tool shows its own presets" (FR-020, FR-021) in `test/workbench-browser.spec.ts`; it also checks that a Lasso preset colours a selected rectangle's stroke, a Fill preset fills it, a preset chosen with nothing selected leaves every object as written and colours the next line drawn, and that with 12 presets every tool and Add colour stay in view and only the chosen preset is pressed (checks of the T032-deleted stories "applies one color control to selected stroke, selected fill, bucket, and new strokes" and "scrolls 24 saved colours in their own strip, marks the active one, and keeps the tools in view")
- [X] T035 [P] [US3] Story "a locked selection survives a tap that misses; Edit Points dims and locks the rest" (FR-052, FR-053) in `test/workbench-browser.spec.ts`
- [X] T036 [P] [US3] Story "a second tap on the active preset opens the palette, wheel, opacity, hex, and the exact `xcolor` field, and `red!50!blue` stays as authored" (FR-022) in `test/workbench-browser.spec.ts`; it also checks that a wheel colour at full opacity is written as `rgb,255:red,255;green,0;blue,0` and never as HTML hex, that an `xcolor` value applied in the exact field becomes the preset and one typed then dismissed by Escape is discarded, and that the palette is the active collection of Settings › Colors laid out in rows, following a new collection, a removed colour, and a switch back to Default (checks of the T032-deleted stories "writes a colour picked at full opacity as an xcolor value" and "picks a drawing colour from saved swatches, one spectrum, and opacity only", and of the rail palette checks removed from "creates, renames, switches and deletes colour collections in Settings"); commit T033–T036 red

### Implementation

- [X] T037 [US3] Rebuild the object menu in `.cache/tikz-editor/packages/app/src/ui/SelectionStrip.tsx` and `CanvasPanel.tsx:4944-4991`: above the selection at once, only the commands that apply, More with Cut, Copy, Paste, Delete, Transform, Reorder, Repeat… (research R14)
- [X] T038 [US3] Make Simplify and Restore Original Stroke object-menu commands on a selected curve, using `restore-ink` (FR-027), in `.cache/tikz-editor/packages/app/src/ui/SelectionStrip.tsx`
- [X] T039 [US3] Keep per-tool presets (three by default, at most 12, data-model Tool `presets[tool]` "`Colour[]`, 1–12") as preferences through `persistence-save` in the fork store `.cache/tikz-editor/packages/app/src/store/`
- [X] T040 [US3] Replace the native colour input of `.cache/tikz-editor/packages/app/src/ui/ColorPicker.tsx:199-228` with the colour options of research R6 (`@uiw/react-color-wheel`, `@uiw/react-color-alpha`, `@uiw/react-color-editable-input`, the palette, the exact `xcolor` field); write opacity as TikZ `opacity` only when below 1 (data-model Colour)
- [ ] T041 [US3] Rewrite the replaced stories near lines 8287 and 1886 of `test/workbench-browser.spec.ts`; rebuild the fork and run the US3 stories green **[Core]**

---

## Phase 5: User Story 4 - Construct exact geometry (P3)

**Goal**: constructions show their stage by points, provisional geometry, and the snap marker,
with no sentence; Cancel and Finish in the Active Tool Menu.

**Independent Test**: a story chooses each construction, places its points on lattice points, and
checks the emitted TikZ; at no stage does a sentence appear.

### Stories (red first)

- [ ] T042 [P] [US4] Story "each construction on lattice points emits its TikZ and shows no sentence at any stage" (independent test, FR-030, FR-031, SC-003) in `test/workbench-browser.spec.ts`; it also checks that the Shapes menu groups its illustrated choices by family (Lines and arrows, Curves, Circles and arcs, Shapes, Diagrams) with every choice drawn, that each construction finishes from its points (and Finish for an open path) and one Undo removes it, and that the Text menu offers Text and Equation, where Equation opens the equation editor (checks of the T032-deleted story "finishes every geometry construction by reading only the picker and the stage instruction") **[Core]**
- [ ] T043 [P] [US4] Story "after two points of the arc through three points the canvas shows the points, the provisional arc through the pen, and the snap marker" (scenario 1, FR-024) in `test/workbench-browser.spec.ts` **[Tail: QC]**
- [ ] T044 [P] [US4] Story "choosing another tool discards only the provisional construction; Cancel and Finish are in the Active Tool Menu" (scenario 2, FR-032, FR-033) in `test/workbench-browser.spec.ts`; it also checks that Cancel removes only the provisional arc through three points, leaves the source, and keeps Shapes chosen (checks of the T032-deleted story "names the chosen construction and its next step until it finishes or is cancelled") **[Tail: QC]**
- [ ] T045 [P] [US4] Story "a stroke held still at its end becomes a line, rectangle, circle, or ellipse, and Undo returns the stroke" (FR-026) in `test/workbench-browser.spec.ts`; commit T042–T045 red **[Tail: feature]**

### Implementation

- [ ] T046 [US4] Delete the step text of `.cache/tikz-editor/packages/app/src/ui/canvas-session.ts:214-268`, the instruction text of `InspectorPanel.tsx:1863-1946` and `CanvasPanel.tsx:5384-5410`, and the hint of `path-selection-hint.ts:25`; show the stage by placed points, provisional geometry, and the snap marker (research R10) **[Built; open until the story run of T049]**
- [ ] T047 [US4] Put Cancel and, for an open path, Finish in the Active Tool Menu during a construction in `.cache/tikz-editor/packages/app/src/ui/ToolbarToolPopup.tsx` **[Built; open until the story run of T049]**
- [ ] T048 [US4] Shorten the tooltips of `.cache/tikz-editor/packages/app/src/ui/tool-config.tsx:258-277,395-397` to the control's name and shortcut, shown on hover only (research R11, FR-070) **[Tail: surface]**
- [ ] T049 [US4] Rewrite the replaced stories near lines 4529 and 6106 of `test/workbench-browser.spec.ts`; rebuild the fork and run the US4 stories green **[Core]**

---

## Phase 6: User Story 8 - Navigate the figure (P4)

**Goal**: fit at open, 100 % as printed size, the origin and axes, rulers in figure coordinates,
canvas controls for zoom and snap, and the status line.

**Independent Test**: a story opens a figure with content and checks that all of it is visible with
the fit margin, chooses Normal Size and checks that 1 cm of the figure is 1 cm at the CSS
reference, and holds the pen over a lattice point and reads the status line.

### Stories (red first)

- [X] T050 [P] [US8] Story "a figure with content opens fitted with the 44 px margin and reopens at its last view" (FR-040, SC-005) in `test/workbench-browser.spec.ts`
- [X] T051 [P] [US8] Story "an empty figure opens at 100 % with the origin centred and the axes visible; Normal Size makes 1 cm of the figure 96 / 2.54 CSS px; the ruler labels and the status line read figure coordinates, with no pixel unit" (FR-041, FR-042, Principle VI) in `test/workbench-browser.spec.ts`
- [X] T052 [P] [US8] Story "the pen over (1, 2) makes the status line 'Pointer position' read 1 and 2 and nothing else" (FR-044) in `test/workbench-browser.spec.ts`
- [X] T053 [P] [US8] Story "the zoom readout opens Zoom to Fit, Zoom to Selection, Normal Size, and 10–1000 %; zooming changes neither source nor selection; Snap toggles and Snapping rules opens Lattice, Objects, Alignment, Angle" (FR-023, FR-043) in `test/workbench-browser.spec.ts`; commit T050–T053 red

### Implementation

- [X] T054 [US8] Set the scale so that 1 is printed size at 96 CSS px per inch: replace `CANVAS_ZOOM_BASE_SCALE=5` and the presets of `.cache/tikz-editor/packages/app/src/store/workspace-state.ts:18-20` (data-model Viewport `scale`: "1 is printed size at 96 CSS px per inch")
- [X] T055 [US8] Open a figure with content in Zoom to Fit with a 44 px margin, an empty figure at 100 % with the origin centred, and a known file at its kept viewport, in `.cache/tikz-editor/packages/app/src/ui/useCanvasViewportPersistence.ts:143-163` (research R8)
- [ ] T056 [US8] Label rulers in figure coordinates with Inkscape's `Ruler::draw_scale` step rule in `.cache/tikz-editor/packages/app/src/ui/geometry.ts:99-123` and `useCanvasGuidesAndRulers.ts:200-215`, and draw the origin and axes on the grid (research R9) **[Tail: surface]**
- [ ] T057 [US8] Add the canvas controls of contracts/surfaces.md: Zoom out, the readout "Zoom: *n* %", Zoom in at the lower trailing corner; Snap and Snapping rules at the lower leading corner; wire the `zoom` command of the frame protocol, in `.cache/tikz-editor/packages/app/src/ui/CanvasPanel.tsx`; delete SnapControl and ZoomDisplayControl from `Toolbar.tsx` **[Tail: surface]**
- [ ] T058 [US8] Add the status line under the canvas with the accessible name "Pointer position", reading the pointer's *x* and *y* in figure coordinates as the source writes them, in `.cache/tikz-editor/packages/app/src/ui/CanvasPanel.tsx` (research R10) **[Tail: feature]**
- [ ] T059 [US8] Reproduce the small startup window of COMPLAINTS.md:57 in the desktop window, whose size is `inner_size(1280.0, 800.0)` in `src-tauri/src/main.rs:34`; when it reproduces, file the defect with the prior art for the startup window size, and build the size that the prior art gives (Principle III) **[Tail: QC]**
- [ ] T097 [US8] Reproduce #18 (zooming makes the renderer fail) under the reporter's conditions of 2026-11-14 (issue comment): the desktop package (Tauri, WebKitGTK), the drawing canvas, and zoom by Ctrl+wheel, by trackpad pinch, and by the zoom keys, each as the window system delivers it; then repair it. Done on 2026-11-15, with the package of `e88486c` on WebKitGTK 2.52.6 under Xvfb: (a) the pinch fails. WebKitGTK magnifies the whole window up to three times and the figure keeps its scale; red story `f1195ad`, repair `97d412d` (the shell reports the pinch, and the canvas zooms by its ratio about the pointer; frame protocol 9). (b) Ctrl+wheel and the zoom keys, sent through the X server with `xdotool`, zoom from 4 % to 1506 % and the pictures of the display show the figure; the issue body records the same result for the installed app at `d9bedaf`. Open: the reporter has not said whether the pinch is the failure of the report. No run used a real touchpad, a Wayland session, a display with GPU compositing, WebKitGTK 2.54, the dark appearance, or the reporter's documents; a failure of the wheel or the keys there is read from the launch log (T145). A pinch over Quiver or the render view now does nothing, and a pinch on a touch screen is not tested **[Core]**
- [ ] T060 [US8] Rebuild the fork and run the US8 stories green **[Tail: surface]**

---

## Phase 7: User Story 2 - Open, save, and reopen a TikZ file (P5)

**Goal**: the title menu, the save state beside the title, and the save conflict.

**Independent Test**: a story opens a file with unsupported constructs, moves one point, and
compares the file byte for byte outside the edited statement.

### Stories (red first)

- [ ] T061 [P] [US2] Story "an edit is written and the title shows Saved; the file is unchanged outside the edited statement" (scenario 1, independent test, FR-006) in `test/workbench-files.spec.ts` **[Tail: surface]**
- [ ] T062 [P] [US2] Story "a file changed on disk stops the save, keeps a recovery draft in `$XDG_STATE_HOME/visual-tikz-editor/`, and shows Changed on disk" (scenario 2, FR-063) in `test/workbench-files.spec.ts` **[Tail: surface]**
- [ ] T063 [P] [US2] Story "the title opens New tikzpicture, New tikzcd, Open…, Save, Save As…, anchored to the title" (FR-001, FR-002) in `test/workbench-browser.spec.ts`; commit T061–T063 red **[Tail: surface]**

### Implementation

- [ ] T064 [US2] Replace the File `<details>` menu of `standalone/StandaloneApp.vue:3-29,699-711` with the title menu anchored to the title in the document bar of `standalone/StandaloneApp.vue`, closing on a second tap, an outside tap, and Escape **[Tail: surface]**
- [ ] T065 [US2] Show the save state beside the title from data-model Document `saveState` (`saved` | `unsaved` | `saving` | `conflict`) with its transitions, in the document bar of `standalone/StandaloneApp.vue` **[Tail: surface]**
- [ ] T066 [US2] Detect a changed file at save in `standalone/server.ts`, write the recovery draft under `$XDG_STATE_HOME/visual-tikz-editor/`, and report the conflict to the shell **[Tail: surface]**
- [ ] T067 [US2] Rewrite the replaced story at line 207 of `test/workbench-files.spec.ts`; run the US2 stories green **[Tail: surface]**

---

## Phase 8: User Story 5 - The Code panel and Render (P6)

**Goal**: View offers the document's editor and Render; Code is a panel beside the editor.

**Independent Test**: a story opens Code beside the canvas, selects an object, and checks that its
source is highlighted without taking focus.

### Stories (red first)

- [ ] T068 [P] [US5] Story "View offers Canvas and Render for a `tikzpicture` and Quiver and Render for a `tikzcd`, with no explanation of the other kind; a `.tikz` file opens in the canvas and a `.tikzcd` file in Quiver" (scenarios 1–2, FR-013, FR-014, FR-016) in `test/workbench-browser.spec.ts` **[Tail: surface]**
- [ ] T069 [P] [US5] Story "Code opens the panel beside the canvas and Quiver; edits show at once in the other; a selection highlights its source without focus; a second tap closes it; Layers closes it" (scenario 3, independent test, FR-015, FR-060) in `test/workbench-browser.spec.ts` **[Tail: surface]**
- [ ] T070 [P] [US5] Story "switching between the editor and Render keeps selection, viewport, and tool" (FR-015) in `test/workbench-browser.spec.ts`; commit T068–T070 red **[Tail: surface]**

### Implementation

- [ ] T071 [US5] Replace the view rails of `standalone/StandaloneApp.vue:42-75` and their drag (`:178-189`) with View (`RiLayoutColumnLine`, "View") trailing in the document bar of `standalone/StandaloneApp.vue`, a popover anchored to its button, listing the document's editor and Render, then Grid, Rulers, Guides, Output Bounds **[Tail: surface]**
- [X] T072 [US5] Offer Quiver only for a `tikzcd` from the kind of `src/source-block.ts:74-80` and `standalone/StandaloneApp.vue:289`; delete the unavailable-Quiver text of `src/ui/TikzWorkbench.vue:71-76` and `src/quiver-bridge.ts:89-94`, and the mode labels of `src/preview-modes.ts:46-79` that name the other kind. The shell has one editor view (`ViewId` `editor` of `standalone/StandaloneApp.vue`), and `tikzEditorMode` of `src/preview-modes.ts` gives its editor. A mode keeps its own failure on a source of its kind (`sourceError`): the canvas shows it for a source that is not empty and has no `tikzpicture` environment. Stories on the view rails: "a tikzpicture offers the canvas and no Quiver, and a tikzcd offers Quiver and no canvas" and "a source that becomes a tikzcd opens in Quiver and one that becomes a tikzpicture opens in the canvas, and no view tells why another is not there"; T068 and T075 move them to View
- [ ] T073 [US5] Add Code (`RiCodeLine`) to the document bar and show `standalone/SourceEditor.vue` as the Code panel beside the canvas or Quiver, a side pane in landscape and a sheet in portrait; send `panel: null` to the canvas when Code opens (FR-061, research R12) **[Tail: surface]**
- [ ] T074 [US5] Highlight the `source-selection` range in the Code panel without moving focus from the canvas in `standalone/SourceEditor.vue` **[Tail: surface]**
- [ ] T075 [US5] Rewrite the Quiver right-sidebar stories near lines 8557 and 10290 and the story near line 10262 of `test/workbench-browser.spec.ts` to View and the Code panel; run the US5 stories green **[Tail: surface]**

---

## Phase 9: User Story 6 - Layers and Properties (P7)

**Goal**: Layers and Properties as separate panels from the document bar; Properties shows the
figure with nothing selected.

**Independent Test**: a story opens Layers, adds a layer, moves objects into it, hides it, reopens
the file and finds visibility and lock kept outside the source, then opens Properties with and
without a selection.

### Stories (red first)

- [X] T076 [P] [US6] Story "Layers then Properties: one panel at a time; a second tap closes each" (scenarios 1–2, FR-060) in `test/workbench-browser.spec.ts`
- [X] T077 [P] [US6] Story "Properties shows the figure with nothing selected and the object after a selection; no other surface holds the figure's attributes" (scenario 3, FR-060a) in `test/workbench-browser.spec.ts`
- [X] T078 [P] [US6] Story "a hidden, locked layer reopens hidden and locked, and the source holds only its `scope` with `name=`" (data-model Layer, Principle I) in `test/workbench-files.spec.ts`; commit T076–T078 red

### Implementation

- [X] T079 [US6] Add Layers (`RiStackLine`) and Properties (`RiEqualizerLine`) to the document bar of `standalone/StandaloneApp.vue`, sending `panel` and following the `panel` event, with Code in the same one-panel state (data-model Panel `open`: none, `code`, `layers`, or `properties`)
- [X] T080 [US6] Split the shared panel of `.cache/tikz-editor/packages/app/src/ui/DockLayout.tsx:702-724` into a Layers panel and a Properties panel, each with its title and close button
- [X] T081 [US6] Show `<InspectorPanel figure />` in Properties when the selection is empty and post `selection` (`empty`); delete `DocumentPropertiesDialog.tsx` and its references in `App.tsx` and `editor-command-runtime.ts` under `.cache/tikz-editor/packages/app/src/`; delete the `document-properties` command, the `document-properties-closed` event and action of `vendor/tikz-editor/embed/src/`, the `tikz-embed-document-properties` listeners of `main.tsx`, and Document Properties… with its handlers in `standalone/StandaloneApp.vue`, `src/ui/TikzWorkbench.vue`, and `src/ui/TikzEditorPreview.vue`
- [X] T082 [US6] Keep layer visibility and lock as per-file view state through `view-state`, never in the source, in the fork store `.cache/tikz-editor/packages/app/src/store/`
- [X] T083 [US6] Rebuild the fork and run the US6 stories green

---

## Phase 10: User Story 7 - Export and reuse (P8)

**Goal**: Share and Export in the document bar with Copy TikZ first.

### Stories (red first)

- [ ] T084 [P] [US7] Story "Share and Export › PDF writes a compiled PDF and leaves the source unchanged" (scenario 1) in `test/workbench-files.spec.ts` **[Tail: surface]**
- [ ] T085 [P] [US7] Story "Share and Export › Copy TikZ puts the authored source on the clipboard" (scenario 2) in `test/workbench-browser.spec.ts`; commit T084–T085 red **[Tail: surface]**

### Implementation

- [ ] T086 [US7] Replace the Export `<details>` menu of `standalone/StandaloneApp.vue` with Share and Export (`RiShareBoxLine`) in the document bar of `standalone/StandaloneApp.vue`, holding Copy TikZ, then PDF…, SVG…, PNG…, anchored to its button (research R15) **[Tail: surface]**
- [ ] T087 [US7] Rewrite the story "Copy source" near line 8550 of `test/workbench-browser.spec.ts` to Copy TikZ; run the US7 stories green **[Tail: surface]**

---

## Phase 11: Polish and cross-cutting rules

- [X] T088 Story "Settings › Appearance: Match System Appearance on follows the system; off with Light shows a light surface under a dark system; the choice is kept in `$XDG_CONFIG_HOME/visual-tikz-editor/` and nothing is written beside the figure; Settings opens over Quiver for a tikzcd document" (FR-005, FR-062, FR-063), replacing the theme story "follows the system appearance in every view" of `test/workbench-browser.spec.ts`; commit it red
- [X] T089 Add More (`RiMoreLine`) with Settings… to the document bar of `standalone/StandaloneApp.vue`; build Settings with Appearance, Canvas, Colours, and Keyboard shortcuts, each changed setting with its own reset; delete the `prefers-color-scheme` theme of `standalone/StandaloneApp.vue:253-258` and the theme control; send `zettlr-quiver:theme` to Quiver; extend `.cache/tikz-editor/packages/app/src/ui/SettingsModal.tsx:11-14` with Appearance, which edits `general.colorScheme`; show that Settings window over the whole window, over Quiver for a tikzcd document (FR-062, user decision 2026-11-14, research R15, R17)
- [ ] T090 Story "Code, Layers, and Properties open as a side pane in landscape and as a sheet in portrait, and the selected object stays visible" (FR-061, Principle IV) in `test/workbench-browser.spec.ts` **[Tail: surface]**
- [ ] T091 Story "every surface holds exactly the controls of contracts/surfaces.md, found by accessible name, in portrait and landscape, each with a hit region of at least 44 × 44 CSS px" (SC-002, Principle II) in `test/workbench-browser.spec.ts` **[Tail: surface]**
- [ ] T092 Story "no reached state shows an instruction sentence, and every command is reached by pen taps alone" (SC-003, SC-004) in `test/workbench-browser.spec.ts` **[Tail: QC]**
- [ ] T093 [P] Correct `docs/interaction-model.md` and `docs/user-guide.md` where they disagree with the spec **[Tail: QC]**
- [ ] T094 [P] Correct `docs/prior-art/drawing-dock.md`, `shell.md`, `zoom-and-view.md` (item 4 puts the zoom readout in the status line), `panels.md`, `instructional-text.md`, and `selection-and-settings.md` where they disagree with the spec **[Tail: QC]**
- [ ] T095 Run each row of [quickstart.md](quickstart.md) "What the stories assert" by its story and record failures as tasks here (`/speckit-converge`) **[Tail: QC]**
- [ ] T096 Check SC-001 in the running app (`just run figure.tikz`): none of the twelve observations of [audit.md](audit.md) occurs; render and inspect each surface per the `design` skill **[Core]**

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

## Phase 12: Convergence

- [ ] T098 [US1] Repair #68 through its red story "preserves representative trace geometry through fitting and original restoration" in `test/workbench-browser.spec.ts`: a pen-drawn `sparse-corner` (three distinct samples) keeps its sample polyline; first confirm the probable cause, the fit gate of `interpretFreehandToolSource` (`vendor/tikz-editor/ZETTLR.patch`, `.cache/tikz-editor`), which counts the duplicate release sample; run the story green per US1/AC1 and `docs/research/freehand-interpretation.md` (partial) **[Tail: QC]**
- [ ] T099 [US1] Delete Undo and Redo from the canvas context menu (`.cache/tikz-editor/packages/app/src/context-menu/canvas-context-menu.ts:287,505`) and rewrite the stories that open them, so Undo and Redo appear only in the document bar and as keyboard shortcuts, per FR-012 (contradicts) **[Tail: surface]**
- [ ] T100 [US4] Story "with two points of the arc through three points placed, the document bar's Undo removes only the second point and leaves the source; a second Undo ends the construction; the next Undo acts on the document history" in `test/workbench-browser.spec.ts`; commit it red, per FR-034, US4/AC3 (partial) **[Core]**
- [ ] T101 [US4] Route the document bar's Undo to a construction in progress: the canvas posts `construction` (`active`) when a construction starts or ends (`vendor/tikz-editor/embed/src/main.tsx`), and while it is active the shell sends a command that runs `undoTransientCanvasStep` (`.cache/tikz-editor/packages/app/src/ui/canvas-panel/CanvasPanel.tsx:2480`) instead of stepping `src/document-history.ts`; add both messages to `contracts/frame-protocol.md` and raise the protocol version; run T100 green, per FR-034 (partial) **[Core]**
- [X] T102 [US3] Story "after Undo or Redo the selection is the objects the step changed; Undo of a drawn stroke leaves nothing selected; a Code edit that removes the selected object leaves nothing selected and Properties shows the figure" in `test/workbench-browser.spec.ts`; commit it red, per FR-054, FR-060a (missing)
- [X] T103 [US3] On `replace-source`, select the objects whose statements the new source changed and that the figure still holds, else nothing, and clear the point selection (`selectedNodeIndices` of `.cache/tikz-editor/packages/app/src/ui/canvas-panel/CanvasPanel.tsx`) with it, in the `replace-source` handler of `vendor/tikz-editor/embed/src/main.tsx` and the fork reducer; post `selection`; run T102 and the story "edits a locked curve point and subset, misses, undoes, and keeps editing" green, per FR-054 (missing)
- [ ] T104 [US8] Story "a file with two figures opens one figure; View offers Figures; the Figures panel shows a thumbnail of each and opens the tapped one; an edit changes only the open figure's source and the other figure stays byte for byte" in `test/workbench-browser.spec.ts`; commit it red, per FR-017 (missing) **[Tail: feature]**
- [ ] T105 [US8] Build the Figures panel from the canvas's figure selection (`activeFigureId` of the fork store): Figures in View (with T071), a panel of figure thumbnails, and a command to open a figure; add it to `contracts/surfaces.md` and `contracts/frame-protocol.md`; run T104 green, per FR-017 (missing) **[Tail: feature]**
- [ ] T106 [US5] Make Quiver take its macros from the template graph of `~/.pandoc/templates/standalone-tikz.tex` only: check that each macro of the MathJax file that Quiver uses is defined in that graph, then delete the MathJax input of `projectQuiverMacros` (`src/quiver-macros.ts`) and `--macros` of `standalone/server.ts:332`, and update `test/quiver-macros.spec.ts`, per FR-065 (contradicts) **[Tail: feature]**
- [ ] T107 [US5] Story "with `~/.pandoc/templates/standalone-tikz.tex` missing, Render shows an error that names that path" in `test/workbench-browser.spec.ts`, with a temporary `HOME`, per FR-065 (partial) **[Tail: feature]**
- [ ] T108 [US2] Story "an Untitled document's edit is kept as a draft in `$XDG_STATE_HOME/visual-tikz-editor/` and reopens after a restart; Save As writes it to the chosen path" in `test/workbench-files.spec.ts`, per FR-006a, FR-063 (partial) **[Tail: QC]**
- [X] T109 Make `bun run test:logic` run each fork spec whose surface the patch keeps, with `test/editor-reducer.spec.ts` and `test/web/editor-command-runtime.spec.ts` (which fails typecheck on `snapping`, `latticeLock`, `constrainGeometry`, `TOGGLE_INFINITE_CANVAS`) among them, in `.cache/tikz-editor/vitest.config.ts`; delete the specs of surfaces the patch removed, per plan: Testing (partial)
- [ ] T110 Review each rule of `spec.md`, `contracts/`, and `data-model.md` and add the source of each rule that cites none, per SC-006 (missing) **[Tail: QC]**
- [X] T112 Send the app's stdout and stderr to the launch log (`src-tauri/src/main.rs`), log WebKit's `web-process-terminated` reason, and add a page reporter that the file host serves in every HTML page and that posts errors to `/api/log` (`standalone/server.ts`), per FR-066 (#71) (missing)
- [ ] T113 [US1] Delete the Freehand result dialog that opens after each pen stroke and the "Interpret geometry" option of `InspectorPanel.tsx:1928`, so a Pen stroke stays as drawn with the Pen's smoothing applied as it is drawn (FR-025), becomes a shape only when held still (FR-026, T045), and is refitted only by Simplify (FR-027, T038); rewrite the stories near lines 4030, 9340, and 9926 of `test/workbench-browser.spec.ts` that use them (contradicts; the Pen's default became ink in the T025 commit, because each stroke's fit rewrote the previous stroke when the next one was drawn). Code and story rewrites done; the story run moves to the end: "keeps the curve refinement clear of its stroke, the rail", "shows only labels, values, and button names", "keeps an original stroke as an editable curve", "carries one offline pen session", "keeps each representative trace as drawn", "retains authored source and its drawing tool through rendered-view switches by pen" failed on the first run, and the session story of `test/workbench-files.spec.ts` was not run **[Core]**

## Phase 13: Convergence

- [ ] T114 [US1] Write a Pen stroke's colour as its preset's `xcolor` expression, as a shape writes it (`tikzColorOptions` of `packages/core/src/edit/color-value.ts`), not as an `{rgb,255:…}` triple, and keep the Pen's opacity apart from the colour in the ink record (`vendor/tikz-editor/embed/src/original-ink.ts`, `CanvasPanel.tsx` finishFreehand), per FR-020, FR-022, Principle I (contradicts) **[Tail: feature]**
- [X] T115 [US3] Keep a touch long press on a selected point in Edit Points from clearing it: `handleCurveNodePointerDown` (`CanvasPanel.tsx`) removes a point already in the selection on a pointerup within `POINT_HOLD_SLOP_PX`, so a finger held on the point counts as a tap; the landscape run of "edits a curve point from the curve's own control by touch" fails there, per FR-053 (contradicts)

## Phase 14: Defects of the drawing loop (reported 2026-11-14)

Each repair has a red story committed before it. The stories ran in Chromium, by pen, in portrait and landscape only.

- [X] T116 [US1] Paint each line of the figure at least one pixel wide, so an unselected stroke stays in view at the smallest zoom (#72, `86a201d`); story "keeps an earlier pen stroke in view when a second stroke is drawn at the smallest zoom"
- [X] T117 [US1] Remove a pen stroke's record with the last of its drawing, so Delete on a stroke keeps the canvas (#73, `bbe6497`); story "Delete removes a pen stroke with its record and keeps the canvas, and Undo returns both"
- [X] T118 [US3] Make a drag that starts on a selected path move the path, not one of its points (#74, `08d5238`); story "a drag that starts on the ink of a selected pen stroke moves the stroke"
- [X] T119 [US1] Make the press that closes a popover do nothing else on the canvas, with the ink tools excepted (#76, `9df62c3`); stories "the pen tap that closes the Shapes Active Tool Menu places nothing, and a pen stroke that closes the Pen's menu is drawn" and "the pen tap that closes the Lasso's Active Tool Menu keeps the selection"
- [X] T120 [US4] Make a tap with Text place plain text in edit, in the tool's colour, with no border and no placeholder to delete (#77, `dfe49e9`); story "a pen tap with Text places plain text in edit, and the keys typed next become that text"
- [X] T121 [US3] Make a colour tap colour selected text as text (`text=<colour>`) and a selected shape's lines, with no border on plain text (#78, `d3c1ec6`); story "a colour tap colours the text of selected text and the lines of a selected shape, and draws no border around plain text"
- [X] T122 [US8] Report a stroke record that cannot be read in the warning bar and keep its drawing as ordinary paths, so the canvas stays in use (#79, `1f24611`); story "a stroke record the editor cannot read leaves its drawing on the canvas, is reported, and stays in the source"; fork logic test "stroke records in the source"
- [X] T123 [US3] Finish #74: in Selecting, a pen held still on a point of the selected path moves that point; a double tap on the selected path enters point editing, a double tap on the path there adds a point, and a double tap off the path leaves (#56), by pen and by finger. The object menu of points holds Smooth, Corner, Split, Delete, Done (contracts/surfaces.md, Object menu), and a selection shows its object menu at once (FR-050); #56 asks for a menu without Done and is open on that clause
- [X] T124 [US1] Finish #76: check, each by a red story where it fails, the press that closes the colour, zoom, and snap popovers, the press by finger and by mouse, and the menus that listen on `window` for `pointerdown` themselves (`CanvasContextMenu`, `ColorPicker`, `AppMenuBar`, `CustomDropdown`). The colour, zoom, and snap popovers passed for each contact. The context menu, the Properties dropdown, and the colour picker now mark the closing press (`ui/closing-press.ts` in the fork). File, Export, and More close on a press in the canvas through `host-popover` and `host-popover-dismissed` of the frame protocol (version 8), on a press on another shell control, and on Escape. The embed does not render `AppMenuBar`
- [X] T125 [US4] Text tool residue of #77: a text that the Text tool placed and that got no key leaves nothing in the diagram or in its history, after Escape, after a tap elsewhere, and after a change of tool; the first key records placement and text as one step; while a text is in edit the canvas shows no coordinate tooltip and no snap label; a Text tap while the scene recomputes waits for the scene. Stories: "a text that gets no key leaves nothing in the diagram or in its history", "while a text is in edit, the canvas shows no coordinate tooltip and no snap label, by pen and mouse"
- [X] T126 [US3] Resolve the story "adds a curve point with a finger double tap, as its hint says" against T046 (no sentence is shown) and T123 (a double tap enters point editing): the story is now "a double tap on a curve enters point editing, a double tap on the curve there adds a point, and a double tap off the curve leaves", with a finger and with the pen
- [ ] T127 Run, in the final story pass, the stories of T116–T122 and the stories that their repairs changed ("edits a curve point from the curve's own control", "highlights, locks, and keeps a curve selected", "attaches an arrow end to a node, a label to a line, and a stroke to a point", "carries one session through a recolored shape", "a colour preset colours the tool and the selection", "a second tap on the active preset opens the palette") in each viewport and with each contact the story file defines; and the stories on the paths that T123 changed (a tap is reported after the release, a double tap is counted from pointer events, a finger tap on empty canvas keeps a held selection): "draws from an existing point with the pen, and moves it under a held finger or a held pen", "a locked selection survives a tap that misses; Edit Points dims and locks the rest", "edits a locked curve point and subset, misses, undoes, and keeps editing", "leaves point editing with Escape and keeps the curve ready to edit", "moves the touched point with a pen drag in point editing, as one undo step", "deletes a chosen subset of a curve's points", "shears a square from its right edge after a second tap with the pen", "scales a lasso-selected pair by 2 from a corner of their frame", "the Lasso selects by tap, by Freehand, Rectangle, and Oval drag, and moves by a drag on the selection", "selects every element from the empty-canvas long press", "lists each command under its menu and moves a shortcut to another command with a warning" (its double tap on an equation); and the stories on the paths that T124 changed (the context menu, a Properties dropdown, and the colour picker close in the capture phase; the shell's menus close on a press anywhere outside them): each story that opens the context menu by a long press, each story that sets a value from a Properties dropdown or the colour picker, "a second tap on the Pen closes its Active Tool Menu; opening File closes it, and opening it closes File", "opens an untitled tikzpicture at launch, starts each kind from File, and closes Save changes on Escape", and each story that chooses a command from File, Export, or More; and the stories on the paths that T125 changed (the tap tools place through one function, a Text tap waits for the scene, the selection of an added element reads the scene of the store's source): "a text that gets no key leaves nothing in the diagram or in its history", "while a text is in edit, the canvas shows no coordinate tooltip and no snap label, by pen and mouse", "a pen tap with Text places plain text in edit, and the keys typed next become that text", and each story that places a point, an image, a matrix, or a shape that is selected after it is drawn **[Core]**
- [X] T128 [US8] Repeat the drawing loop of T116–T122 in the desktop app (WebKitGTK): every probe of 2026-11-14 ran in Chromium. Done at `0a2c628` on the package of `just package`, driven by WebKitWebDriver with mouse contacts on an Xvfb display, on a new document and on a copy of a recovery draft that holds seven stroke records of an older build: strokes are recorded with no accept step, a tap selects, a drag on the ink moves, a colour tap recolours, Delete and Undo operate, the tap that closes the Shapes menu places nothing, Text takes the typed keys, and the canvas holds through the zoom levels of the zoom control and through Ctrl+wheel events made in the page (4 % to 1506 %)
- [ ] T129 [US8] Check in the desktop app what the driver cannot make: a pen contact (WebKitWebDriver stops a pen sequence after a `pointerdown` that the page prevents, in this build and in the build of 2026-11-13 alike), a wheel turn with Ctrl held and a two-finger pinch as the window system delivers them (the driver's wheel and key chords do not reach the canvas); with a real pen, the hold on a point of a selected stroke (a drag of the stroke starts after 4 px of travel, the hold ends after 6 px) and the double tap by pen and by finger, which the editor counts from pointer events (two taps within 500 ms and 60 CSS px) **[Tail: QC, except the wheel and the pinch, which are core with T097]**
- [X] T130 [US8] Show the reason in a window when the desktop app cannot start because a state file cannot be read, instead of an exit with no window (#80); red story first. The host reads `preferences.json`, `recovery.json`, and `view-state.json` through `readStartFile` in `standalone/server.ts`; the page is `standalone/start-failure.ts`; the story is "a start on a view-state file of an older build shows the file and the reason, and keeps the draft" (run it in the final story pass, T127)
- [X] T131 [US8] Stop the host process when the desktop app is ended by a signal (#81): the host stops at the end of its standard input, whose write end the shell holds (`TIKZ_WORKBENCH_STOP_AT_STDIN_END`). Stories "leaves no file host after SIGTERM" and "… after SIGKILL" (`test/desktop/desktop.spec.ts`)
- [X] T132 [US8] Give the desktop package its own stories: `test/desktop/desktop.spec.ts` drives the built package through WebKitWebDriver (`test/desktop/package.ts`: `TAURI_WEBVIEW_AUTOMATION=true`, capability `webkitgtk:browserOptions`, own XDG directories, Xvfb). `just test-desktop` builds the package and runs them, and `just release-assets` runs it first. The stories are the drawing loop of T128 and the start on an unreadable view-state file of T130
- [X] T137 [US1] Fix #83: after a press on a button of the bars, on an item of the More menu, or on a control of the document bar, the arrow keys, Escape, and Delete act on the selection (`vendor/tikz-editor/embed/src/button-focus.ts`, a `mousedown` listener of the canvas frame and of the shell window). Red stories: "after a press on a button, the arrow keys, Escape, and Delete act on the selection" (`test/workbench-browser.spec.ts`) and the drawing loop of `test/desktop/desktop.spec.ts`, which presses the controls through the driver
- [X] T138 [US1] Fix #84: on the dark canvas, text in the default colour shows in the light colour of a line in the default colour. The dark-appearance rules of `CanvasPanel.module.css` map the `stroke` and `fill` attributes and not the `color` attribute of text that MathJax renders. Red story: "on the dark canvas, text in the default colour shows in the colour of a line in the default colour" (`test/workbench-browser.spec.ts`)
- [X] T133 Clear the 34 eslint findings of the fork file `packages/app/src/ui/canvas-panel/CanvasPanel.tsx` (`bunx eslint` in `.cache/tikz-editor`: 18 no-confusing-void-expression, 9 react-hooks/exhaustive-deps, 4 prefer-optional-chain, 3 others); the other files of `canvas-panel/` that T123 touched are clean
- [X] T134 [US1] Fix #82: a press in the Quiver view closes File, Export, and More and does nothing else. The Quiver bridge (`src/ui/TikzQuiverPreview.vue`, `vendor/quiver/ZETTLR.patch`) takes the shell's report that a menu opened and reports the next press, as `host-popover` and `host-popover-dismissed` do for the canvas frame. The red story is "a press in the Quiver view closes File and places nothing"
- [X] T139 [US5] Fix #85: each edit that Quiver shows reaches the source as one step of the document history. `UI.autosave_diagram` (`vendor/quiver/ZETTLR.patch`) reads the history event of a change before `History.add` counts it, so a vertex made by presses, a move, a connection, and a deletion carry the event before them, and the first carries none. The red stories are "the first vertex that presses add in the Quiver view reaches the source" and "Undo after a label and a new vertex in Quiver takes back only the vertex"
- [X] T136 [US8] Show the reason in a window when the host stops before the window opens for a cause other than an unreadable start file (#80): the desktop shell (`src-tauri/src/main.rs`, `CommandEvent::Terminated`) keeps what the host wrote to stderr and serves a page with it, the exit status, and the log path at `start-failure://localhost/`; the style is `standalone/start-failure.css`, which the host's page uses too. The story is "shows in a window why the file host stopped, for a command line that names no file"
- [X] T135 [US4] A text whose edit ends with all of its characters deleted: check, by a red story where it fails, that the text leaves nothing in the diagram (`\node at (x,y) {};` draws nothing and cannot be found again) and that the history holds no step that changes nothing. tldraw deletes a text shape whose edit ends with no text (https://tldraw.dev/sdk-features/text-shape) and fixed a phantom undo entry from that path in v5.4.0 (https://tldraw.dev/releases/v5.4.0)
- [X] T140 [US1] Fix #86: the canvas opens on a source that has no text, and the first stroke writes its `tikzpicture` to the source and to the file. `sourceError` of the `visual` mode (`src/preview-modes.ts`) gives its failure text only for a source with text and no environment, the condition of tikz-editor's own `missing-tikzpicture` diagnostic. Story "a stroke on the canvas of an empty file makes its tikzpicture" A shape on an empty file also makes the environment: `insertElementIntoSource` of tikz-editor (`packages/core/src/edit/element-templates.ts`) makes it for a source with no text before it checks the closing token of the placeholder figure that the parse gives such a source. Story "a shape on the canvas of an empty file makes its tikzpicture".
- [X] T141 [US5] Fix #87: a `tikzcd` with a comment, white space, or `\[` before `\begin{tikzcd}` has the kind `tikzcd`, as Quiver's own parser accepts it (`parse_diagram`): `isTikzcdSource` of `src/source-block.ts`. Story "a tikzcd that Quiver exported, with its link comment and its display-math brackets, opens in Quiver and renders"
- [ ] T142 [US1] Fix #88: the first object on an empty file keeps the view, and a text placed first is in edit. tikz-editor keys the view (`useCanvasViewportPersistence.ts`, `makeFigureViewportKey`), the reset of drafts and of the text edit (`CanvasPanel.tsx`, the layout effect on `canvasFigureContextKey`) and the guides (`guidesByFigureKey`) by the active figure, so the change from no figure to `figure:0` reads as a visit to another figure. Give a source with no figure and the first figure of a document one key in the three places; then a load with no kept view must install the opening view itself (Zoom to Fit, or the origin centred at 100 % for no content), because `load` of `vendor/tikz-editor/embed/src/main.tsx` keeps the document and so keeps the key. Red story for the view first (zoom readout stays 100 % after the first stroke, after Undo and after Redo). Story "a text on the canvas of an empty file makes its tikzpicture" is red until this task is done. **[Core]**

## Phase 15: Scope of 2026-11-15

- [ ] T143 [US2] Make File, Export, and More open their lists under their own buttons (audit, report "File, Export, and other menus are not attached to their buttons"; FR-002). From the code they do not: `.file-menu-items` of `standalone/StandaloneApp.vue` is placed against `.document-bar` (`position: absolute; right: 12px`), so each list opens at the trailing end of the bar. Check it in the running app first. Red story: the box of each list starts under the box of its button, in portrait and landscape. The repair anchors the present lists; T064 and T086 later replace File and Export with the title menu and Share and Export, which keep the anchor **[Core]**
- [ ] T144 [US4] Build FR-026 (#58): a Pen stroke that ends with the pen held still becomes a line, rectangle, circle, or ellipse as its own step, and Undo returns the stroke. T045 is its story, and no task builds it **[Tail: feature]**
- [X] T145 [US8] Story in `test/desktop/desktop.spec.ts` for the "Done when" of #71: the launch log of the built package holds an uncaught error thrown in the editor frame, with the frame and the stack, and the end of the web process, with WebKit's reason. Story "holds an error thrown in the editor frame, with the frame and the stack, and the end of the web process, with WebKit's reason" (`32e249c`); it passes on WebKitGTK 2.52.6 under Xvfb and has not run on the maintainer's machine. T097 reads this log on the reporter's machine
