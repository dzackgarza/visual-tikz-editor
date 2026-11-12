# Handoff

## Task

Deliver the complete standalone mathematical diagram editor and its reusable host API. Drawing, selection, correction, source editing, saving, export, and reopening form one coherent pen-and-touch workflow, and authored TikZ stays authoritative. The user reports needed function and defects as an end user; the maintainer repairs every defect found.

## Completion condition

The work is complete when all of these hold at the head of `main`:

| Item | Acceptance condition | Status at `2e59d93` |
| --- | --- | --- |
| A. Document safety | One source authority across canvas, Code, Quiver, and render; unsupported authored constructs survive; storage status agrees with the disk through New, Open, Save, Save As, conflicts, copy, undo, and reopen | Held by the standalone-file and mounted-host session stories |
| B. Canvas and space | The rail, Properties, Layers, refinement, keyboard, and selection controls share the screen, and the edited subject stays visible in portrait, landscape, narrow, and docked layouts | Held by the space and dock stories in both orientations |
| C. Construction | Every construction finishes from the Geometry picker and the stage instruction alone, with Cancel and Finish | Held by the picker story |
| D. Selection and editing | One selection strip with only applicable actions; locks; point subsets; transforms with one undo step each; Layers survive reopen | Held by the selection, point, transform, and layer stories |
| E. Refinement | Accepted fits survive drawing, tool changes, and undo; current-stroke, new-stroke, and default scopes stay separate; originals survive reopen | Held by the refinement stories |
| F. Geometry rules | Lattice, object, alignment, and angle snapping with the recorded precedence and named targets, at any zoom and lattice scale | Held by the snapping stories |
| G. Colour and preferences | One colour control with a named target; settings and shortcuts persist with conflict alerts | Held by the colour, settings, and shortcut stories |
| H. Host API | The typed protocol of [#2](https://github.com/dzackgarza/visual-tikz-editor/issues/2) and [#9](https://github.com/dzackgarza/visual-tikz-editor/issues/9): peer, origin, session, and revision checks; exact-source snapshots; cancellation and disposal; recorded ink; offline assets | Held by the hosted and embedding stories |
| I. Fidelity and export | Supported figures match their compiled output; PDF, SVG, and PNG export of every figure | Held by the render and export stories |
| Software gate | Development diagnostics is green at the head | Green at `2e59d93` ([43198269710](https://github.com/dzackgarza/visual-tikz-editor/actions/runs/43198269710)); later heads are test and documentation changes |
| Release | Each green head that changes the product has a release | [workbench-2e59d93](https://github.com/dzackgarza/visual-tikz-editor/releases/tag/workbench-2e59d93) |
| Issues | No open issue | None open |

No stub is permitted. The user's use of the editor on a physical tablet is continuing feedback, not a gate: an observation opens or reopens an issue, and that issue is ordinary work under step 1.

The rules behind A–G and the product decisions are in [the interaction model](docs/interaction-model.md). The intended experience is in [the product guidance](docs/guidance/README.md). [COMPLAINTS.md](COMPLAINTS.md) holds the user's original complaints and two audits; a new report of one of them is a defect, whatever an earlier story showed.

## Next work, ranked

1. Read the software gate on the head of `main` (`gh run list --workflow development.yml --branch main --limit 1`). A red run is the first work: reproduce the failing story with `bun run test:browser --grep '<story>'`, commit the red story, then repair it. A story that fails in a run made during a session is that session's work. Commit as the work goes and push once, when it is complete. [Development](docs/development.md) covers the story helpers and the traps of the fonts and the native file dialogs.
2. Work each open issue the same way: a failing story that reproduces the report, then the repair. Record decisions on the issue. Decide established interface questions from prior art and cite it.
3. Publish a release for each green head that changes the product (`just release-assets <run-id>`, then `gh release create`; see [Development](docs/development.md#releases)). Reconcile [#1](https://github.com/dzackgarza/visual-tikz-editor/issues/1) and #2 against the release.

## Device behaviour the software gate cannot observe

| Item | Expected behaviour | Follow-up on a contrary observation |
| --- | --- | --- |
| Pen pointer type and hover in iPadOS Safari | The pen arrives as `pointerType: "pen"`, and hover shows the attachment target ([research](docs/research/pen-input-on-existing-points.md)) | Open an issue: the move modifier and the target marks need another signal. |
| Pencil double tap and squeeze | They do nothing on the canvas, as the platform limit predicts ([research](docs/research/pencil-hardware-gestures.md)) | Open an issue for the observed action. |
