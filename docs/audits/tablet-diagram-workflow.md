# Tablet diagram workflow audit

Audit of the standalone app at `72954eb` and the pinned editor forks. This records observed gaps and a direction for a later implementation decision. It does not change the editor.

## Intended work

A diagram has one authored TikZ source and one visual work area. The author can draw, select, move, and revise geometric objects with a pen, touch, or mouse. The author can also edit source directly and inspect a rendered result. The visual work area remains useful without a TeX installation. The source stays readable and suitable for later paper editing.

The source and visual area form one workspace. For a `tikzpicture`, the right side can show the editable canvas or a TeX render. For a `tikzcd`, it can show Quiver or a TeX render. The left source pane is the same pane in either case. The canvas is the primary area on a tablet; source and detailed properties open when needed. The rendered view is an optional fidelity check, not a separate authoring mode.

Math Notes supplies a visual reference for a floating tool rail, selected-tool color, paper and desk surfaces, popovers, and large controls. Its notebook ink workflow remains distinct from editing a TikZ diagram. See [the tablet interface](https://github.com/dzackgarza/math-notes-app/blob/main/docs/specs/tablet-ui.md).

## Observed state

These captures show the app immediately after `just run`, before drawing. They record the current layout; they do not stand in for pen testing.

| View | Capture |
| --- | --- |
| Desktop, light system theme | [1280 × 800](standalone-light-1280.png) |
| Desktop, dark system theme | [1280 × 800](standalone-dark-1280.png) |
| Tablet-width browser, light system theme | [768 × 1024](standalone-light-768.png) |

| Area | Evidence in the inspected version | Design gap |
| --- | --- | --- |
| Workspace | `standalone/StandaloneApp.vue` switches between its own CodeMirror pane and an iframe that contains a second source pane. `src/ui/TikzWorkbench.vue` treats render, TikZ Editor, and Quiver as peer “preview modes.” | The source pane changes owner and layout when the right-side surface changes. Mode labels describe implementations instead of the author's task. |
| Screen space | The 768 px capture has four rows above the work area: file actions, provider choices, menus, and tools. It shows source, canvas, and inspector at once. The tool row and inspector tabs clip. | The diagram is too small and controls are cut off at tablet width. |
| Tool controls | Pinned TikZ Editor `Toolbar.module.css` gives standard buttons a 32 px height and width. `ToolbarToolPopup.module.css` gives several choices a 24 px height; its matrix cells are 20 px. Active buttons use a subtle gray fill. | Touch targets and selected-tool state are hard to identify or hit. The current detail can remain available in an expanded panel. |
| Inspector | The pinned editor keeps a right inspector beside source and canvas. Its property labels are often 10–11 px. | Properties need a consistent collapsible side panel or an anchored popup, with large controls when opened on a tablet. |
| Theme | `standalone/StandaloneApp.vue` takes `prefers-color-scheme` at startup and follows changes; it has no visible theme control. The dark capture shows dark chrome and low-emphasis control text around a white page. | The author cannot choose a legible light work surface when the system is dark. Contrast must be checked in every pane, popup, iframe, and editor state. |
| Input | The pinned editor uses pointer events and has touch viewport handling, but its toolbar, hints, menus, and inspector still rely on small targets and mouse-style modifiers. | Pen drawing, finger navigation, selection, object movement, and palm contact need explicit interaction rules and real-device evaluation. Existing touch code is a starting point, not proof of a tablet workflow. |
| Freehand | Pinned `freehand-tool.ts` drops samples by distance, then emits a cubic Bézier segment for each retained interval. Its draw-start code sets `shouldSnapToolStart` false for freehand. | Grid snap does not simplify a freehand path. One stroke can still become many decimal control points, and the current path has no semantic circle, ellipse, line, or rectangle result. |
| Mode state | `TikzWorkbench.vue` keys the active provider by provider ID and source identity. A provider change replaces its component. | Selection, viewport, and tool or undo state may be lost on a right-side view change. Confirm the exact loss in an interaction workflow before changing state ownership. |
| Host boundary | The standalone app owns its file actions; TikZ Editor and Quiver are embedded and bridged by source. Zettlr already owns a document editor. Math Notes will supply a captured doodle. | File commands, source display, and editing surface must have separate host contracts, so each integration can present one coherent workspace. |

The pinned upstream freehand implementation is [`freehand-tool.ts` at `be197d8`](https://github.com/DominikPeters/tikz-editor/blob/be197d85e278bf76c5fc052931b7902942e274e7/packages/app/src/ui/canvas-panel/freehand-tool.ts). The snap bypass is in [`useCanvasToolInteractions.ts` at the same revision](https://github.com/DominikPeters/tikz-editor/blob/be197d85e278bf76c5fc052931b7902942e274e7/packages/app/src/ui/canvas-panel/useCanvasToolInteractions.ts). The pinned version and fork boundary are recorded in `vendor/tikz-editor/PROVENANCE.toml`.

## Design decisions to make

| Choice | Benefit | Cost |
| --- | --- | --- |
| Add only outer CSS around the embedded editor | Small change to the host | The iframe still owns a second source pane, toolbar, inspector, and dark theme. It cannot deliver one workspace. |
| Change the pinned TikZ Editor fork's app shell and expose host controls through its bridge | Keeps its parser, scene, editing actions, and source fidelity while allowing one source pane and tablet controls | The source overlay must be maintained when upstream changes. Quiver needs the same host-level layout rules. |
| Replace the editor core | Full control of the surface | Rebuilds the hardest existing domain work: TikZ parsing, scene semantics, and edits that preserve authored source. |

**Recommendation:** keep the existing editors as owners of diagram semantics and edit operations. Refactor the shared workbench and the pinned editor's presentation layer together. The host should own the file identity and source pane; each right-side provider should own the diagram canvas or render. The adapter should expose the active tool, selection, settings actions, and view state needed by a host-level floating rail and inspector. Do not change the fork through generated assets alone; maintain a source patch and rebuild it through the existing vendor refresh path.

The first design pass should draw a desktop workspace and a tablet workspace from the same control model. Use the Math Notes theme tokens and icon direction as a reference, while keeping the math diagram tools and direct code editing. A light page and legible controls must be available regardless of system theme.

## Freehand interpretation

The current distance filter limits nearby samples, but it does not bound geometric error or reduce the Bézier count to a simple editable object. [Paper.js `Path.simplify(tolerance)`](https://paperjs.org/reference/path/) fits a small set of curves to input points with a stated maximum error; its documentation demonstrates use after a mouse or touch release. [`Path.toShape()`](https://paperjs.org/reference/path/) can recover a shape when the path already matches its geometry. Those APIs are candidates for curve fitting and exact-shape conversion, not evidence that they alone recognize a rough, nearly closed ellipse. [Ipe](https://ipe.otfried.org/) is the reference for exact snapping to diagram features. A gesture classifier such as the [$1 recognizer](https://faculty.washington.edu/wobbrock/pubs/uist-07.01.pdf) recognizes a stroke class, but its template result alone does not supply accurate TikZ geometry.

Evaluate a staged operation after pen release:

1. Keep the raw points for the current edit, including whether the author closed the stroke intentionally or ended near its start.
2. Fit candidate line, polyline, circle, ellipse, rectangle, arc, and few-curve paths. Compare geometric error, closure, orientation, and intersections against the raw stroke. Preserve corners where a smooth curve would change meaning.
3. Offer a local result popup: accept the simpler geometry, restore the original, or adjust the fit. Global and per-stroke aggressiveness controls should use an understandable visual example.
4. Let the author run simplification again on a selected freehand object. Define how the original stroke survives save and reopen before claiming that post-reopen reapplication works.
5. Apply grid or rational-coordinate snapping to recognized geometric parameters and meaningful anchors, then emit concise TikZ primitives when recognized. Snapping each sampled point first is insufficient.

An automatic result needs one undo step back to the raw stroke. A low-confidence fit must remain a freehand path and still allow manual simplification. Record sample drawings and expected structural source before selecting a library or tuning tolerance. Keep handwritten labels outside shape interpretation.

## Additional integration checks

- Verify that canvas, render, and Quiver all reflect one source edit without creating a second independent code history. Switching the right side must not silently replace unsupported TikZ or discard unsaved source.
- Check how a host can present TikZ Editor's tools while suppressing its file tabs, menus, source pane, and inspector. Check Quiver's analogous controls separately; do not assume the two forks expose one UI contract.
- Test tool selection, object drag, handle editing, undo/redo, canvas pan, pinch zoom, and popup dismissal with a pen plus touch, then with a mouse. [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) distinguishes these inputs; [`touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) decides whether the browser cancels a touch gesture.
- Check the visual canvas against a compiled figure on a corpus of supported constructs, including circles, ellipses, arcs, arrows, nodes, grids, and `tikzcd`. A visible approximation is acceptable for creation, but structure, placement, and connection points must be faithful.
- Check compact widths and landscape tablet sizes with source and inspector closed, open, and side by side. The canvas should remain visible when a popup opens.
- Keep the standalone file picker behind the host contract. The present Zenity dialog is a desktop host action and is not a reusable tablet file flow.
- Update Math Notes' TikZ contract when the new editor interface is settled: its current component-ownership link still names the old Zettlr package path.

## Acceptance for a redesign

The author can create a geometric diagram, move and edit it, inspect its TikZ source, and optionally inspect a TeX render in one workspace. At tablet width, the diagram remains the main surface; every active drawing tool is clear, controls are reachable by touch, and the inspector and source are available without permanent columns. Light and dark appearances are legible; light is selectable when the system is dark. A rough closed ellipse can become an editable TikZ ellipse when the fit is good, with an immediate undo or restore action; an irregular path can become a compact curve without losing intentional corners. Source edits and visual edits stay synchronized across view changes and all three hosts retain their source ownership.

The design and algorithm decisions require a separate implementation proposal with measured drawings and rendered comparisons. This audit fixes the outcome and the observed gaps; it does not select a tolerance or claim stylus behavior from browser simulation.
