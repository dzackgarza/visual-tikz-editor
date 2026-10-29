# Outstanding work

## Task and completion condition

Deliver the complete standalone mathematical diagram editor and reusable host API. Drawing, selection, correction, source editing, saving, export, and reopening must form one coherent pen-and-touch workflow. Authored TikZ remains authoritative. This is the authoritative work inventory. The agent-memory card `PLAN-TABLET-DIAGRAM-WORKSPACE` holds the planning context.

Completion requires every workstream below to meet its acceptance condition, a software gate on the resulting revision, physical-tablet qualification, and an immutable release with its artifacts. Closed issues and prereleases do not discharge unresolved requirements. No stub allowance is recorded.

## Sources and evidence limits

- [COMPLAINTS.md](COMPLAINTS.md): original complaints, interaction audit at `07f072a`, and screenshot audit at `4e7740c`. Read all three parts before execution. Later findings challenge earlier completion claims.
- [Product vision](docs/guidance/product-vision.md), [ideal GUI](docs/guidance/ideal-gui.md), and [mockup warnings](docs/guidance/mockup-interpretation-warnings.md): intended experience and design proposals.
- [Workspace audit](docs/audits/tablet-diagram-workflow.md) and [freehand study](docs/research/freehand-interpretation.md): alternatives, integration checks, and algorithm evidence.
- [Root #1](https://github.com/dzackgarza/visual-tikz-editor/issues/1), [complete contract #2](https://github.com/dzackgarza/visual-tikz-editor/issues/2), and its source issues #3–#5 and #7–#9. Read the full #2 contract, including embedding, ink, offline, and snapshots.

Inventory baseline: `17d6892`, inspected 2026-10-29. This inventory does not establish whether each older defect still occurs. Each remains open for current verification and repair.

| Inspected tracker | Recorded state | Required follow-up |
| --- | --- | --- |
| GitHub #1 | Open | Reconcile its delivery links with unresolved acceptance |
| GitHub #2–#5, #7–#9 | Closed | Retain their technical acceptance requirements |
| Open pull requests | None | Establish review state for subsequent implementation |
| PR #11 | Merged | Verify live threads against pending local `.pr/` records |
| Latest listed release | Prerelease `workbench-07f072a` | Qualify later changes independently |
| Project cards, including archived | Workspace plan and its feature | Earlier handoff references to `PLAN-VTE-REMEDIATION-ROADMAP` and `PHASE-VTE-M7` were not found in this inventory; recover their evidence before relying on them |

## Next work, ranked

1. Map every original complaint and later audit finding to current source/runtime evidence. Start with correction persistence, tool identity, save status, and usable canvas space. Keep requirements open until their actual user outcomes are proved.
2. Present alternatives and a recommendation for the shared interaction model. Obtain the user's choice before major architecture changes. Define tool stages, selection scope, edit scope, cancellation, undo, snapping, and panel space together.
3. Implement that model and repair the state defects. Construction, selection, refinement, color, and properties must use consistent scopes. Preserve source and host contracts throughout.
4. Complete integration and publication checks, then qualify combined workflows. Keep unresolved product decisions explicit.
5. The user performs the physical-tablet session. After software and physical acceptance, publish the tested immutable revision and artifacts.

## Workstreams and acceptance

Each row is unresolved for current acceptance. Verify existing implementations before deciding what needs repair. During execution, record the source requirement, tested revision, observation, evidence path, and remaining defect in the evidence ledger below.

| Workstream | Required outcome and coverage | Acceptance evidence |
| --- | --- | --- |
| A. Document safety | One source authority across canvas, source, Quiver, and render; unsupported authored constructs survive. Save status stays visible and clear. Verify New language choices, Open, Save, Save As, conflicts, native clipboard, copy without save, undo/redo, and reopening. | Real standalone and mounted-host sequences compare source bytes and picture across edits, view switches, copy, disk conflicts, and reopen. Status agrees with actual storage. |
| B. Canvas and hierarchy | Shared space budget for source, Properties, Layers, correction, keyboard, dock, and selection controls. Keep the subject visible on rotation/resize. Stable primary tools and undo; reliable grip; scrollable swatches; clear icons/labels; readable light/dark canvas, rulers, axes, origin, grid, startup extent, and bounds. | Inspect portrait, landscape, narrow, keyboard, panel combinations, and left-handed placement while drawing/editing. A useful drawing area and edited subject stay visible; button reachability alone is insufficient. |
| C. Tools and construction | Persistent active tool and accurate next-step instructions after picker dismissal. Group construction families and variants. Cover lines, arrows, paths, curves, circles, arcs, shapes, matrices, images, grids, and equations. Define Cancel/Finish and construction state. | Discover and finish supported constructions without being supplied their gesture sequence. Check geometry, cancellation, tool changes, and the next action. |
| D. Selection and editing | Consistent object/point controls; clear curve highlight, hover, nodes, handles, point subsets, selection lock, and touch context actions. Cover copy/paste, duplicate, Repeat, alignment, distribution, ordering, rotation, dilation, shear, layers, and source navigation without stealing focus. | Lock a curve, edit points/subsets, miss a target, transform, undo, and continue. Only applicable commands appear. Layer names, contents, order, visibility, and reference validity survive reopen; locks have explicit session semantics. |
| E. Refinement and edit scope | Accepted automatic fits survive drawing/tool changes. Separate current-stroke adjustments, future-tool settings, and saved defaults. Correct cancellation and undo. Preserve originals across history/reopen; handwriting stays ink. Live smoothing/simplification shows points, preserves corners, supports repeated passes and post-deletion smoothing, and uses understandable controls. | Draw, auto-fit, draw again, switch tool, undo/redo, restore/refit, save/reopen, and reapply. Cancel a local adjustment and verify unchanged next-stroke defaults. Compare source/geometry on the study corpus and near misses. |
| F. Geometry rules | Coherent lattice, object, angle, alignment, guide, and attachment snapping with visible precedence. Distinguish grid appearance from geometry constraints. Lattice units govern coordinate fields; physical size stays clearly related. Cover endpoints, Bézier handles, arcs, constrained squares/lines, axis moves, and alignment to extrema. | Observe targets and source coordinates at different zoom/scales, including conflicting constraints and nearby invalid cases. |
| G. Color and preferences | A coherent surface identifies pen, selected stroke, or fill; palette collections, opacity, and exact entry are clear. Properties describes its actual target. Canvas settings and remappable shortcuts persist with conflict/reserved-key handling. | Change targets, draw/edit, cancel, reopen, and compare stroke/fill/default effects. Editable fields keep native shortcuts; configured commands reach their owners. |
| H. Host API and integration | Preserve #2/#9 typed protocol, peer/origin/session/revision checks, scheduled exact-source snapshots, typed errors, source copy, cancellation/disposal, bounds, SVG isolation, raw-ink channels/outlines and associations, and offline assets. Keep standalone, Zettlr, and Math Notes source/storage ownership explicit. | Public mounted API sequences cover stale/duplicate/wrong-peer traffic, delayed/failed renders, abort/disposal, adjacent figures, import/edit/restore/reapply, fresh sessions, and cold offline startup. Verify stale Math Notes ownership links when the API settles. |
| I. Fidelity and publication | Compare supported circles, ellipses, arcs, arrows, nodes, grids, labels/macros, images, and tikzcd with compiled output. Preserve targeted source edits and external editability. Resolve export formats, bounds, size, fonts, and dependencies against the guidance. | Representative figures retain structure, placement, connections, and labels. Save/copy editable TikZ, export agreed formats, and reopen for further editing. |

### Product decisions to retain

The guidance proposes attached graph/arrow/label relationships, reusable styles/constructions, partial erasing, hardware pencil gestures, autosave/interruption recovery, and broader export formats. Compare each with the established contract and implementation. Record whether it is required, an approved extension, or a proposal awaiting a user decision. Proposals cannot silently become release requirements or disappear from the inventory. Preserve mixed mathematical figures and handwritten annotations within the agreed source model.

### Observations requiring disposition

- Freehand fits can place anchors close together near stroke ends: reproduce and assess geometry/editability under E.
- Floating panels do not automatically fit/recenter: resolve subject visibility under B; automatic Fit is only one possible mechanism.
- Local `.pr/` records list pending original-ink findings from merged PR #11: inspect live threads and current production paths. Commit accepted repairs before replying or resolving.

## Qualification and release

1. Verify the original complaints item by item, then exercise combined sessions and fresh sequences. Observe source and picture outcomes, continued editing, and undo. Command execution and dimensions alone do not prove coherent use.
2. Run affected stories during implementation. Use repository commit/push gates for full qualification in a fresh isolated checkout with `bun install --frozen-lockfile`. Record SHA and artifact paths. Pre-push `just test-push` shares the logic prerequisite and Mocha command with `just test`.
3. The user runs the physical-tablet session: device/browser, pen/fingers, palm contact, drawing/erasing, constrained geometry, curve/point editing, properties/Repeat, colors/settings, Layers, save/reopen, both orientations, and panel placement. Keep the gate open until actual results arrive.
4. After software and physical acceptance at the same revision, publish an immutable pin with standalone and qualification archives. Record release evidence. Consumer pins follow this artifact; notebook transactions/storage remain host-owned.
5. Reconcile public #1/#2 status with proven requirements and release evidence.

## Constraints and evidence ledger

Preserve user work and authored source. Keep the existing editors as semantic owners. Use the maintained source patch/vendor refresh workflow for fork changes; batch refreshes and exclude incidental fork dependency-lock rewrites. Reproduced regressions need committed failing stories before repairs. Negative gesture assertions need a positive baseline; Fit existing geometry before its first gesture.

Current acceptance has not been rerun for this inventory. Add criterion-specific evidence here during execution. Recover older roadmap/M7 evidence where available, but evaluate it against later audit findings. Resume at ranked step 1.
