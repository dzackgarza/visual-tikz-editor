# Handoff

## Task

Deliver the complete standalone, XDG-compliant mathematical diagram editor; no other application embeds it (spec FR-064). Drawing, selection, correction, source editing, saving, export, and reopening form one coherent pen-and-touch workflow, and authored TikZ stays authoritative. The user reports needed function and defects as an end user; the maintainer repairs every defect found. The interface follows established notebook and vector-editor conventions, recorded with their prior art under [docs/prior-art](docs/prior-art/).

The [design audit](specs/001-product-design/audit.md) states what the user's report of 2026-11-12 implies about the app's design. The [constitution](.specify/memory/constitution.md) states the principles. The [product design specification](specs/001-product-design/spec.md) states the users, workflows, and information architecture. Work follows Spec Kit from that specification, and [tasks.md](specs/001-product-design/tasks.md) holds every task.

On 2026-11-15 the user directed that the work necessary for the core of the editor be kept apart from the long tail of quality control and fine-tuning. The core is finished first.

## Scope: the core and the long tail

**The core** is the editing loop on the document: open or start a figure; draw, erase, select, move, edit points, colour, construct, place text; zoom and pan; undo and redo; save, reopen, render, export. Work is core when, without it, one of these holds in the built desktop app:

1. A step of the loop fails, stops the canvas, loses work, or changes the source in a way the person did not ask for.
2. A step of the loop has no route by pen.
3. An observation that the user reported still shows. Only the observation is core; the other items of its issue are tail.
4. No story shows 1–3 for a step of the loop, or its story has not run since the code under it changed.

**The long tail** is all other open work: a working control that is moved, renamed, or restyled to the [surfaces contract](specs/001-product-design/contracts/surfaces.md); a capability outside the loop; and quality control (story sweeps, fit tuning, runner failures, documents, citations, names, checks on a device).

The tail stays required by the completion condition below. It is not dropped and not narrowed. It is not started while core work is open, except where a core repair must change the same code. [tasks.md, Scope](specs/001-product-design/tasks.md#scope-the-core-and-the-long-tail-2026-11-15-at-e88486c) assigns each open task, and each open issue carries the label `scope:core` or `scope:tail`. The assignment is the maintainer's analysis; the user may move an item.

## Core work, ranked (status on the branch `claude/wonderful-hopper-df43y7`, 2026-11-16)

| Order | Work | Tasks | Status |
| --- | --- | --- | --- |
| 1 | Zooming makes the renderer fail ([#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18)), the user's report of 2026-11-12 | T097, T145 ([#71](https://github.com/dzackgarza/visual-tikz-editor/issues/71)) | Done on the branch `claude/wonderful-hopper-df43y7`; both issues close when it reaches `main`. Two failures, each reproduced on the package of `e88486c` with WebKitGTK 2.54.2 and gone after its repair. (a) With a pen stroke selected, as after each stroke, each zoom step parsed the whole source once for each point of the stroke: 1.0–1.3 s a step with six strokes, growing with the figure; now 90 ms (`7df221e`, `2aefa1d`). (b) A pinch on a touchpad magnified the whole window up to three times and left the figure; it now zooms the view under the pointer (`f1195ad`, `97d412d`, `c391099`, `8e27c76`). The launch log has its story (`32e249c`) |
| 1a | The time of a pen stroke grows with the figure, and the ink leaves the canvas at the lift ([#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89)), found in the work on #18 | T146 | Done on the branch. The pen's mark left the canvas at each lift for 150 ms in an empty figure and up to half a second in a figure of strokes; it now stays until the stroke is drawn. The lift takes 26 ms at the start, 50 ms at forty strokes, and 89 ms at eighty (80 ms and 512 ms before); forty strokes of 60 samples take 288 kB of source, not 795 kB. After the pen rests the canvas still computes the whole figure once (about 170 ms at forty strokes, 320 ms at eighty): T148, [#90](https://github.com/dzackgarza/visual-tikz-editor/issues/90), tail |
| 2 | The first object on an empty file refits the view, and a text placed first is not in edit ([#88](https://github.com/dzackgarza/visual-tikz-editor/issues/88)) | T142 | Done on the branch; both stories green |
| 3 | Read the gate of the head: name each failing story, assign it to its task, repair each one on a step of the loop | T127, T149, the story runs of T041, T049, T113 | Read on this machine with the TeX tools; the artifacts of run 43683352678 could not be read here. At `8e27c76`: 351 passing, 32 failing. At `f343c40`, one run of every `test/*.spec.ts` (43 min): 395 passing, 13 failing. Three of the 13 were defects of their stories (a label tapped beside the line that the lattice had moved; a field of the debug reading that no build has; a press meant for the shell that opened the title menu); they are repaired in `f343c40` and pass when run alone. Ten remain, none of a core task: six stories of the native file chooser, which type the path into zenity with `xdotool` (in this container the chooser gets two characters; they need the runner, [#67](https://github.com/dzackgarza/visual-tikz-editor/issues/67)); three that are red until T057 and T058 are built (the status line, twice, and the names of the zoom readout); and the fitter's error after Simplify ([#68](https://github.com/dzackgarza/visual-tikz-editor/issues/68), T098: 4.56 pt against 2 pt on the rectangle trace). The desktop stories (8) pass on the package of `f343c40` with WebKitGTK 2.52.6 and 2.54.2; the story of the audit failed once in fourteen runs on 2.52.6, while the suite was building, at the zoom readout, and not again. A Development diagnostics run of this head has not happened: the branch is not on `main` |
| 4 | Undo during a construction removes its last placed point (FR-034) | T100, T101 | Done on the branch |
| 5 | Each menu of the document bar opens its list under its own button (report of 2026-11-12) | T143, with T064, T086, T087 | Done on the branch in the form of the contract: the title menu, Share and Export, and More |
| 6 | Each construction emits its TikZ and finishes by pen | T042 | Done on the branch. The Shapes menu showed Cancel before a point was placed, and Finish and Cancel left the menu open over the canvas; both repaired |
| 7 | None of the twelve observations of the audit shows in the running desktop app | T096 | Done on the branch: a desktop story reads eleven of them in the built package on WebKitGTK 2.52.6 and 2.54.2 |

On the branch `claude/wonderful-hopper-df43y7` at `f343c40`, work 1–7 is done (`633cc88` holds the red stories of this batch; the red stories of #18 and #88 are earlier commits). The three conditions below are not met yet, and none can be met from the branch: it is not on `main` (the user decides the merge), no Development diagnostics run has read that head, and the installed app is an older build.

The core is complete when all of these hold at one head of `main`:

- Work 1–7 is done, each repair with its story committed red first.
- The Development diagnostics run of that head has no failing story of a core task, and each failing story is listed on [#17](https://github.com/dzackgarza/visual-tikz-editor/issues/17) with its tail task. No story is retried, skipped, or weakened.
- The desktop package of that head passes `just test-desktop` and is the installed app. The installed app was build `6075e99` at the last report (2026-11-15), which lacks the repairs of #86 and #87.

## Completion condition

The whole work is complete when all of these hold at the head of `main`. The two right columns divide what is open at `e88486c`.

| Item | Acceptance condition | Core, open | Long tail, open |
| --- | --- | --- | --- |
| A. Document safety | One source authority across canvas, Code, Quiver, and render; unsupported authored constructs survive; storage status agrees with the disk through New, Open, Save, Save As, conflicts, copy, undo, and reopen | Its file stories in the gate reading (work 3) | Compare and Overwrite ([#48](https://github.com/dzackgarza/visual-tikz-editor/issues/48)); the title menu and the save state's words (T061–T067); T108 |
| B. Shell and space | The document bar of the specification; views by document kind; panels at the side in landscape and as sheets in portrait; one anchored popover at a time; the edited subject stays visible in every layout | — (the title menu, Share and Export, and More are built on the branch: T143, T064, T086, T087) | View and the Code panel (T063, T068–T071, T073–T075, T084, T085; [#42](https://github.com/dzackgarza/visual-tikz-editor/issues/42)–[#44](https://github.com/dzackgarza/visual-tikz-editor/issues/44)); [#34](https://github.com/dzackgarza/visual-tikz-editor/issues/34), [#35](https://github.com/dzackgarza/visual-tikz-editor/issues/35), [#47](https://github.com/dzackgarza/visual-tikz-editor/issues/47), [#59](https://github.com/dzackgarza/visual-tikz-editor/issues/59); T090, T091, T099 |
| C. Toolbar and construction | The drawing toolbar of the specification with one press rule; every construction shows its stage by its points and preview and finishes from the Active Tool Menu | — (T100, T101, and T042 are done on the branch) | [#27](https://github.com/dzackgarza/visual-tikz-editor/issues/27)–[#29](https://github.com/dzackgarza/visual-tikz-editor/issues/29), [#31](https://github.com/dzackgarza/visual-tikz-editor/issues/31); T043, T044, T048 |
| D. Selection and editing | One object menu with only applicable commands; a locked selection; point editing; transforms with one undo step each; Layers rows and views survive reopen | Its stories in the gate reading (T041, T127) | [#39](https://github.com/dzackgarza/visual-tikz-editor/issues/39), [#40](https://github.com/dzackgarza/visual-tikz-editor/issues/40), [#55](https://github.com/dzackgarza/visual-tikz-editor/issues/55), [#56](https://github.com/dzackgarza/visual-tikz-editor/issues/56) |
| E. Freehand | Pen options apply as strokes are drawn; shapes form only on a hold, and Undo returns the stroke; Simplify and Restore Original Stroke on a selected curve; originals survive reopen; stroke ends stay where they were drawn | — ([#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89) is repaired on the branch, T146; the stories that T113 records are read in T149) | A held stroke becomes a shape (T045, T144; [#58](https://github.com/dzackgarza/visual-tikz-editor/issues/58)); [#57](https://github.com/dzackgarza/visual-tikz-editor/issues/57); [#68](https://github.com/dzackgarza/visual-tikz-editor/issues/68) (T098); T114; the recompute after a rest reads the whole figure (T148, [#90](https://github.com/dzackgarza/visual-tikz-editor/issues/90)) |
| F. Geometry rules | Lattice, object, alignment, and angle snapping with the recorded precedence and named targets, at any zoom and lattice scale | Its stories in the gate reading | — |
| G. Properties, colour, and preferences | Properties shows the figure or the selection; colour presets per tool; labels and values only, with units; per-setting reset; shortcut list with reassignment | — | [#38](https://github.com/dzackgarza/visual-tikz-editor/issues/38), [#60](https://github.com/dzackgarza/visual-tikz-editor/issues/60) |
| H. Standalone | No embedding surface remains (FR-064); files live in the XDG directories (FR-063) | — | The Zettlr names of the forks ([#69](https://github.com/dzackgarza/visual-tikz-editor/issues/69)) |
| I. Fidelity and export | Supported figures match their compiled output at every zoom; PDF, SVG, and PNG export of every figure | — ([#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18) is repaired on the branch) | One template for Render and Quiver (T106, T107) |
| J. View | 100 % is printed size; a figure opens fitted and reopens at its last view; canvas controls for zoom and snap; the status line; rulers and axes | — ([#88](https://github.com/dzackgarza/visual-tikz-editor/issues/88) is repaired on the branch) | Canvas controls and their names (T057; [#65](https://github.com/dzackgarza/visual-tikz-editor/issues/65)); the status line (T058; [#52](https://github.com/dzackgarza/visual-tikz-editor/issues/52)); rulers (T056); the startup window (T059); display calibration ([#63](https://github.com/dzackgarza/visual-tikz-editor/issues/63)); the Figures panel (T104, T105) |
| Software gate | Development diagnostics is green at the head, with no story retried | No failing story of a core task | Green: every tail story built; runner-only failures ([#67](https://github.com/dzackgarza/visual-tikz-editor/issues/67)) |
| Release | Each green head that changes the product has a release | The core head is packaged and installed | A release for each green head; the last is [workbench-2e59d93](https://github.com/dzackgarza/visual-tikz-editor/releases/tag/workbench-2e59d93) |
| Documents | The specification, the per-surface specifications, the interaction model, the user guide, and the issues agree | — | T093, T094, T095, T110 |
| Issues | No open issue | [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18), [#71](https://github.com/dzackgarza/visual-tikz-editor/issues/71), [#88](https://github.com/dzackgarza/visual-tikz-editor/issues/88), and [#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89) are repaired on the branch and close when it reaches `main` | Epic [#17](https://github.com/dzackgarza/visual-tikz-editor/issues/17) and every other open issue |

No stub is permitted. The user's use of the editor on a physical tablet is continuing feedback, not a gate: an observation opens or reopens an issue. A new observation is core when it meets the rule above.

The rules behind A–J and the product decisions are in the [specification](specs/001-product-design/spec.md); [the interaction model](docs/interaction-model.md) and the [prior-art specifications](docs/prior-art/) hold where they agree with it. [COMPLAINTS.md](COMPLAINTS.md) holds the user's original complaints and two audits; a new report of one of them is a defect, whatever an earlier story showed.

## How the work goes

1. Take the core work in its order. Work 1 and work 2 touch different code and can run together. Work 3 starts when a run of the head has completed (`gh run list --workflow development.yml --branch main --limit 1`); read each failed story's trace from the run's `test-results` artifact ([Development](docs/development.md#tests)).
2. A repair starts with its acceptance story, committed red against the present build, and names its issue. A story that the work replaces is rewritten in the same change; its old assertion is deleted, not weakened.
3. A closing word in a commit closes an issue only when every item of the issue's body is built or the issue records which item moved where. Issues #63, #64, and #70–#87 were closed by commit words on 2026-11-15 before any gate run; Each body was then compared with the story titles and the code, with no story run. #63 had an item that was not built (display calibration; tail) and #71 lacked the story of its "Done when" (the launch log; core): both are open again.
4. The implementation issues #27–#65 were written from the per-surface specifications of 2026-11-12. Where an issue or a per-surface specification disagrees with the product design specification, the specification holds, and the issue carries a comment that names the replaced items. T094 corrects the per-surface specifications.
5. A question no specification answers is answered first from prior art in the owning specification, then in code. The maintainer derives the order of the work and asks the user only for product decisions.
6. When the core is complete, record it on [#17](https://github.com/dzackgarza/visual-tikz-editor/issues/17) with the run and the head, then take the tail by the story priorities of the specification.
7. Publish a release for each green head that changes the product (`just release-assets <run-id>`, then `gh release create`; see [Development](docs/development.md#releases)).

This file is the handoff. A handoff kept under `.tmp/` is not in the repository and no other session can read it.

## Device behaviour the software gate cannot observe

| Item | Expected behaviour | Follow-up on a contrary observation |
| --- | --- | --- |
| Pen pointer type and hover in iPadOS Safari | The pen arrives as `pointerType: "pen"`, and hover shows the attachment target ([research](docs/research/pen-input-on-existing-points.md)) | Open an issue: the move modifier and the target marks need another signal. |
| Pencil double tap and squeeze | They do nothing on the canvas, as the platform limit predicts ([research](docs/research/pencil-hardware-gestures.md)) | Open an issue for the observed action. |
| A real pen in the desktop app (T129) | The hold on a point of a selected stroke moves the point; a double tap by pen or finger enters point editing | Open an issue with the contact and the timing. |
| A pinch on a touchpad in the desktop app | The view under the pointer zooms by the ratio of the fingers, and the window keeps its size. The stories give the pinch as GDK's touchpad events, on X11 and on Wayland | Open an issue with the session type and the launch log. |
| A two-finger pinch on a touch screen in the desktop app (T147) | The canvas zooms by its own touch pinch, and the window keeps its size. Not verified: no touch device exists in the stories' display | Open an issue: WebKitGTK's zoom gesture also takes touch sequences. |
