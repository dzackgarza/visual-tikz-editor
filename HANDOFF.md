# Handoff

## Task

Deliver the complete standalone, XDG-compliant mathematical diagram editor; no other application embeds it (spec FR-064). Drawing, selection, correction, source editing, saving, export, and reopening form one coherent pen-and-touch workflow, and authored TikZ stays authoritative. The user reports needed function and defects as an end user; the maintainer repairs every defect found. The interface follows established notebook and vector-editor conventions, recorded with their prior art under [docs/prior-art](docs/prior-art/).

The present work starts from the user's report of 2026-11-12: basic design and usability defects, each listed with its issues under Next work, item 1. The [design audit](specs/001-product-design/audit.md) states what those defects imply about the app's design. The [constitution](.specify/memory/constitution.md) states the principles, each with its prior art. The [product design specification](specs/001-product-design/spec.md) states the users, workflows, and information architecture that the repairs implement. Work follows Spec Kit from that specification: clarify, plan, tasks, implement.

## Completion condition

The work is complete when all of these hold at the head of `main`:

| Item | Acceptance condition | Status at `a95cbd4` |
| --- | --- | --- |
| A. Document safety | One source authority across canvas, Code, Quiver, and render; unsupported authored constructs survive; storage status agrees with the disk through New, Open, Save, Save As, conflicts, copy, undo, and reopen | Held by the standalone-file and mounted-host session stories, except the save conflict: open [#48](https://github.com/dzackgarza/visual-tikz-editor/issues/48) |
| B. Shell and space | Menu bar, views by document kind, fixed-height document bar with banners and toasts, status line, docked panes in landscape and nonmodal sheets in portrait, one anchored popover at a time; the edited subject stays visible in every layout | Open: [#34](https://github.com/dzackgarza/visual-tikz-editor/issues/34), [#35](https://github.com/dzackgarza/visual-tikz-editor/issues/35), [#42](https://github.com/dzackgarza/visual-tikz-editor/issues/42)–[#44](https://github.com/dzackgarza/visual-tikz-editor/issues/44), [#47](https://github.com/dzackgarza/visual-tikz-editor/issues/47), [#52](https://github.com/dzackgarza/visual-tikz-editor/issues/52), [#59](https://github.com/dzackgarza/visual-tikz-editor/issues/59) |
| C. Dock and construction | The dock holds tools, colour, and snapping as icons with one press rule; every construction finishes from the Geometry tool options and the status-line step, with Cancel and Finish | Open: [#27](https://github.com/dzackgarza/visual-tikz-editor/issues/27)–[#29](https://github.com/dzackgarza/visual-tikz-editor/issues/29), [#31](https://github.com/dzackgarza/visual-tikz-editor/issues/31) |
| D. Selection and editing | One selection menu with only applicable commands; object locks; point editing in isolation; transforms with one undo step each; Layers rows and views survive reopen | Open: [#39](https://github.com/dzackgarza/visual-tikz-editor/issues/39), [#40](https://github.com/dzackgarza/visual-tikz-editor/issues/40), [#55](https://github.com/dzackgarza/visual-tikz-editor/issues/55), [#56](https://github.com/dzackgarza/visual-tikz-editor/issues/56) |
| E. Freehand | Pen options apply as strokes are drawn; shapes form only on a hold, and Undo returns the stroke; Simplify and Restore Original Stroke on a selected curve; originals survive reopen; stroke ends stay where they were drawn | Open: [#57](https://github.com/dzackgarza/visual-tikz-editor/issues/57), [#58](https://github.com/dzackgarza/visual-tikz-editor/issues/58) |
| F. Geometry rules | Lattice, object, alignment, and angle snapping with the recorded precedence and named targets, at any zoom and lattice scale | Held by the snapping stories |
| G. Properties, colour, and preferences | Properties shows the next object's attributes or the selection's sections; one unlabelled colour well; labels and values only, with units; per-setting reset; shortcut list with reassignment | Open: [#37](https://github.com/dzackgarza/visual-tikz-editor/issues/37), [#38](https://github.com/dzackgarza/visual-tikz-editor/issues/38), [#60](https://github.com/dzackgarza/visual-tikz-editor/issues/60) |
| H. Standalone | No embedding surface remains (FR-064); the shell and the editor frame speak only the frame protocol of [contracts/frame-protocol.md](specs/001-product-design/contracts/frame-protocol.md); files live in the XDG directories (FR-063) | Open: tasks T004–T012 |
| I. Fidelity and export | Supported figures match their compiled output at every zoom; PDF, SVG, and PNG export of every figure | Held by the render and export stories, except [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18) |
| J. View | 100 % is printed size; a figure opens fitted and reopens at its last view; zoom readout and menu; rulers in centimetres | Open: [#63](https://github.com/dzackgarza/visual-tikz-editor/issues/63)–[#65](https://github.com/dzackgarza/visual-tikz-editor/issues/65) |
| K. Accessibility | Constitution Principle IX and spec FR-080 to FR-092: every control has its name, role, and state; interface text has 4.5:1 and marks 3:1, light and dark; the keyboard and taps of one pointer reach every command but path input; the focus is visible and returned; status is announced; reduced motion is followed (WCAG 2.2 Levels A and AA, [research R18](specs/001-product-design/research.md)) | Open: tasks T143–T162 of Phase 15, no story written; four tap mechanisms of FR-086 have no prior art chosen (R18); the level and the wording of Principle IX wait for the user's review |
| Software gate | Development diagnostics is green at the head, with no story retried | Red at `a95cbd4` ([43243506544](https://github.com/dzackgarza/visual-tikz-editor/actions/runs/43243506544)): one story fails on the runner only, as in two earlier runs; open [#67](https://github.com/dzackgarza/visual-tikz-editor/issues/67) |
| Release | Each green head that changes the product has a release | [workbench-2e59d93](https://github.com/dzackgarza/visual-tikz-editor/releases/tag/workbench-2e59d93) |
| Issues | No open issue | Open: epic [#17](https://github.com/dzackgarza/visual-tikz-editor/issues/17) with [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18) and the implementation issues #27–#66; [#67](https://github.com/dzackgarza/visual-tikz-editor/issues/67) |

No stub is permitted. The user's use of the editor on a physical tablet is continuing feedback, not a gate: an observation opens or reopens an issue, and that issue is ordinary work under step 2.

The rules behind A–J and the product decisions are in [the interaction model](docs/interaction-model.md), which follows the [prior-art specifications](docs/prior-art/). The intended experience is in [the product guidance](docs/guidance/README.md). [COMPLAINTS.md](COMPLAINTS.md) holds the user's original complaints and two audits; a new report of one of them is a defect, whatever an earlier story showed.

## Next work, ranked

1. Clarify, plan, and tasks for the [specification](specs/001-product-design/spec.md) are done. Run `/speckit-converge` to append the unbuilt requirements (the clarifications of 2026-11-13 added FR-006a, FR-017, FR-034, FR-054, FR-065) to [tasks.md](specs/001-product-design/tasks.md), then `/speckit-implement` phase by phase, and repeat until converge appends nothing. The maintainer derives the order of the work (constitution, Development Workflow) and asks the user only for product decisions. The per-surface specifications under docs/prior-art and their issues are corrected where they disagree with the specification. The reports and the issues filed for them:

   | User report | Issues |
   | --- | --- |
   | Zooming in or out makes the renderer fail | [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18) |
   | Default zoom is 15 % | [#63](https://github.com/dzackgarza/visual-tikz-editor/issues/63), [#64](https://github.com/dzackgarza/visual-tikz-editor/issues/64) |
   | The drawing toolbar holds a Layers button; Settings is a word, not an icon; the lasso icon is a rectangle | [#27](https://github.com/dzackgarza/visual-tikz-editor/issues/27), [#28](https://github.com/dzackgarza/visual-tikz-editor/issues/28) |
   | Properties and Layers share one popup | [#34](https://github.com/dzackgarza/visual-tikz-editor/issues/34) |
   | Menus for File, Export and others are not attached to their buttons | [#42](https://github.com/dzackgarza/visual-tikz-editor/issues/42), [#59](https://github.com/dzackgarza/visual-tikz-editor/issues/59) |
   | A tikzpicture can switch to Quiver, with help text on why Quiver is unavailable | [#44](https://github.com/dzackgarza/visual-tikz-editor/issues/44), [#47](https://github.com/dzackgarza/visual-tikz-editor/issues/47) |
   | The app teaches at every step | [#31](https://github.com/dzackgarza/visual-tikz-editor/issues/31), [#52](https://github.com/dzackgarza/visual-tikz-editor/issues/52) |
   | "New strokes" on what should be a standard colour selector | [#29](https://github.com/dzackgarza/visual-tikz-editor/issues/29) |
   | Buttons open but do not close; a Dark Theme button; help text on the eraser | Repaired locally: #26, #45, #53 |

   Each issue names the specification items it implements and the issues it depends on. A report is repaired when the running app no longer shows it; the specification items of its issue that the report does not need stay open on the issue. A repair starts with its acceptance story, committed red against the present build; the stories that assert the rule it replaces are rewritten in the same change ([stories that assert replaced rules](docs/prior-art/stories.md) lists them per issue). Then the repair. Record decisions on the issue, from prior art.
2. Read the software gate on the head of `main` (`gh run list --workflow development.yml --branch main --limit 1`). A red run on a story the reports touch is repaired with that report: read the failed story's trace from the run's `test-results` artifact ([Development](docs/development.md#tests)), reproduce the cause it shows with `bun run test:browser --grep '<story>'`, commit the red story, then repair it. A story that fails on the runner only is [#67](https://github.com/dzackgarza/visual-tikz-editor/issues/67) work; its body lists the hypotheses already falsified. Commit as the work goes and push once, when it is complete. [Development](docs/development.md) covers the story helpers and the traps of the fonts and the native file dialogs.
3. A question no specification answers is answered first from prior art in the owning specification, then in code. A new interface issue follows the template's Prior art section.
4. Publish a release for each green head that changes the product (`just release-assets <run-id>`, then `gh release create`; see [Development](docs/development.md#releases)). Reconcile [#1](https://github.com/dzackgarza/visual-tikz-editor/issues/1) and #2 against the release.
5. Accessibility (item K), after the open tasks of Phases 3 to 14: review [checklists/accessibility.md](specs/001-product-design/checklists/accessibility.md) against the specification and correct the specification where an item fails; record in research R18 the prior art for each tap mechanism marked open; then Phase 15 of [tasks.md](specs/001-product-design/tasks.md), each story red before its repair.

## Device behaviour the software gate cannot observe

| Item | Expected behaviour | Follow-up on a contrary observation |
| --- | --- | --- |
| Pen pointer type and hover in iPadOS Safari | The pen arrives as `pointerType: "pen"`, and hover shows the attachment target ([research](docs/research/pen-input-on-existing-points.md)) | Open an issue: the move modifier and the target marks need another signal. |
| Pencil double tap and squeeze | They do nothing on the canvas, as the platform limit predicts ([research](docs/research/pencil-hardware-gestures.md)) | Open an issue for the observed action. |
