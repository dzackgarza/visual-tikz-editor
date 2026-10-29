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
| PR #11 | Merged; live review threads all resolved on 2026-10-29 | Historical review record |
| Latest listed release | Prerelease `workbench-07f072a` | Qualify later changes independently |
| Project cards, including archived | Workspace plan and its feature | Use the current card and this inventory |

## Next work, ranked

1. Confirm the state defects below through focused reproductions. Read the whole complaint list and map it to the acceptance catalogue. Separate reproduced defects, existing behavior to preserve, and proposed capabilities. This is diagnosis for the design choice, not a full qualification run.
2. Settle the interaction model and release scope. Present alternatives only for decisions not already settled by the product guidance. Obtain the user's choice before major architecture changes. Define tool/construction stages, object/point selection, current-edit versus default scope, commit/cancel/undo transitions, snapping precedence, and available canvas space as one model.
3. Implement the chosen state transitions and the controls that use them in the dependency order below. Each slice delivers its final interaction and verifies continued editing. Run affected workflows as each slice lands.
4. Verify the full preserved host/source contract and agreed publication behavior against the finished interaction model. Repair demonstrated failures at their owners. Run combined qualification at the resulting revision.
5. The user performs physical-tablet qualification. Publish the tested immutable revision and artifacts after both gates pass.

### Implementation dependencies

The lettered rows below are an acceptance catalogue, not an execution sequence. They share owners and must be implemented in these slices:

| Order | Slice | Prerequisite and resulting behavior |
| --- | --- | --- |
| 1 | Interaction state and space allocation | Approved model. Define source transactions, commit/cancel/undo, tool and selection scopes, settings scope, and the shared panel/dock space policy. Use existing host/document ownership. |
| 2 | Continuous drawing and correction | Slice 1. Deliver refinement transitions together with their final correction surface and explicit defaults action. Drawing again and changing tools preserve accepted results. The same slice covers E and its B/G dependencies. |
| 3 | Construction and precision | Slice 1. Deliver persistent tool/stage presentation, grouped construction choices, constraint policy, and visible targets together. Cover C/F and their B dependencies. Reuse the geometry engines. |
| 4 | Object and point editing | Slices 1–3. Deliver contextual selection, point editing, lock, transforms, Layers, and target-aware properties/color together. Cover D/G and remaining B obligations. |
| 5 | Whole-workspace verification | Slices 2–4. Check A/H/I through real standalone and embedding sequences, including source navigation, saving, rendering, copy, undo, offline use, and reopen. Fix only failures established by these checks. |
| 6 | Qualification and release | Slice 5, then software and physical gates on the same revision. Publish artifacts and update public acceptance state. |

Slices 2 and 3 are independent after slice 1; their listed order is a workable default. Carry document-save visibility into the shared layout in slice 1 and check it throughout. Decide extra export/recovery/relationship capabilities at step 2 so they cannot force a later redesign of completed slices.

### Current source evidence

At `998283e`, the state defects reproduced at `cc5c5f2` are repaired and covered by stories in both tablet orientations: strokes and eraser sweeps started during recompute are kept, automatic fits survive further drawing, tool changes and Undo, per-stroke sliders leave defaults unchanged until "Use for new strokes", and the document bar shows storage status at every width with editor state separate. Slice 2 still owns the final correction surface around these transitions; slice 1 still owns the shared space policy.

Existing production paths include the typed request client in `src/editor-request.ts`, snapshot/source clients, and original-ink commands in `vendor/tikz-editor/embed/src/ink-commands.ts`. Existing stories cover native save/reopen, immediate view-switch saves, snapshot cancellation/restoration, source copying, and Quiver/view retention. These are preservation and verification surfaces under A/H, not instructions to build those features again.

## Workstreams and acceptance

These rows define final acceptance. They do not classify every listed feature as unfinished implementation. Use current evidence to identify repairs within each slice. Record the source requirement, tested revision, observation, evidence path, and remaining defect in the ledger below. Existing behavior stays in place unless an accepted design change requires its owner to change.

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

User decisions of 2026-10-29:

| Topic | Decision |
| --- | --- |
| Release scope | Partial erasing, autosave with interruption recovery, PDF/SVG/PNG export, and attached relationships (arrows and labels follow the nodes and objects they attach to, reusable styles, pencil hardware gestures) are release requirements. |
| Snapping precedence | Object features first (Ipe model): endpoints, intersections, and centers beat alignment guides, which beat the lattice. The guide names the chosen target. Angle snapping constrains direction after the point target. |
| Session state architecture | One XState statechart in the fork owns the session states of [the interaction model](docs/interaction-model.md) and replaces the independent mode states in `CanvasPanel.tsx`. |
| Pen input on existing points | Use iPadOS-native interaction patterns established by research, not preference. [Pen input on existing points](docs/research/pen-input-on-existing-points.md) derives the policy: a pen stroke starting on a point draws at once and attaches to it; a held finger modifier or a pen hold past a delay moves the point; double tap never moves points. |

The guidance also proposes reusable constructions and mixed handwritten annotation. Compare remaining proposals with the established contract and implementation. Proposals cannot silently become release requirements or disappear from the inventory. Preserve mixed mathematical figures and handwritten annotations within the agreed source model.

### Observations requiring disposition

- Freehand fits can place anchors close together near stroke ends: reproduce and assess geometry/editability under E.
- Floating panels do not automatically fit/recenter: resolve subject visibility under B; automatic Fit is only one possible mechanism.
- A freehand stroke started near the endpoint of an existing raw stroke replaced that stroke's first points instead of creating a new stroke (observed at `998283e`, portrait story geometry). Decide under E/F whether endpoint continuation is intended and how it is shown.

## Qualification and release

1. Verify the original complaints item by item, then exercise combined sessions and fresh sequences. Observe source and picture outcomes, continued editing, and undo. Command execution and dimensions alone do not prove coherent use.
2. Run affected stories during implementation. Use repository commit/push gates for full qualification in a fresh isolated checkout with `bun install --frozen-lockfile`. Record SHA and artifact paths. Pre-push `just test-push` shares the logic prerequisite and Mocha command with `just test`.
3. The user runs the physical-tablet session: device/browser, pen/fingers, palm contact, drawing/erasing, constrained geometry, curve/point editing, properties/Repeat, colors/settings, Layers, save/reopen, both orientations, and panel placement. Keep the gate open until actual results arrive.
4. After software and physical acceptance at the same revision, publish an immutable pin with standalone and qualification archives. Record release evidence. Consumer pins follow this artifact; notebook transactions/storage remain host-owned.
5. Reconcile public #1/#2 status with proven requirements and release evidence.

## Constraints and evidence ledger

Preserve user work and authored source. Keep the existing editors as semantic owners. Use the maintained source patch/vendor refresh workflow for fork changes; batch refreshes and exclude incidental fork dependency-lock rewrites. Reproduced regressions need committed failing stories before repairs. Negative gesture assertions need a positive baseline; Fit existing geometry before its first gesture.

Step 1 runtime evidence: the stories added in `cc5c5f2` failed for the reasons above and pass at `998283e`; the earlier freehand-result stories pass again. Full acceptance has not been rerun. Resume at ranked step 2.
