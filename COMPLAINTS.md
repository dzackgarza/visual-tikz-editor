For the visual tikz editor, there are some problems:

- Eraser doesn't work like a standard notebook app eraser (i.e. drag, erase any stokes it encounters). Instead, it requires you to precisely select a specific element to delete

- Selecting an element should (if the code editor is open) navigate to that element's code and highlight it

- It doesn't seem you can select a point on a curve, and there is no visual indicator when you hover over it (e.g. highlighting) or when it is selected

- Selecting a curve is noisy. It doesn't highlight the curve in any way, the circle vs square node selection for points vs control points is very noisy on complicated curves, it's unclear how to apply operations to the entire curve. Really, selecting the curve should spawn a floating button in the rectangular region containing it (which is already shown) which contains the relevant right-click options, accessible by touch, with some visual indication on the button that an entire curve is selected, and the options available should only be those that can apply to the entire curve anyway. Having grayed out options that don't apply is just noise. Similarly, if you select a point, you want a similar but new button for the options at that point, instead of right-clicking, again specific to only those options that can even apply. Also, when selecting a curve, you should be able to lock and unlock the selection, otherwise an errant click or touch can deselect the entire thing. The workflow would be: select a curve, click a visual button to lock (with a locked/unlocked indicator), then any further clicks either select things direcetly relevant to that curve (nodes, control points, etc) and never deselect the curve -- if you miss clicking on something, you just keep whatever you had selected before, otherwise the selection becomes whatever the new selected element related to the curve is.

- Path need not be a standalone menu: these can all be progressively disclosed contextually when they are applicable

- Insert need not be a standalone menu: this is just a toolbar item that can nest all possible insertions (note that equation insertion is missing from the toolbar)

- Help menu not needed

- Edit menu items can all be made contextual: long-press for copying and pasting (likely parallel pattern for computers would be right-clicking). Context menu for selected item can include duplicating, repeating, etc, much like noteful or goodnotes diagram handling. Similarly for align, distribute, transform, reorder: all can appear in the relevant contexts (e.g. having multiple items selected)

- Remaining top menus should be redeveloped for touch-first interfaces, e.g. like on ipad. Typically menu *buttons* which spawn popup context menus with various buttons, input fields, etc suitable for a tablet screen

- View menu can be consolidated: likely to just clicking on the zoom percentage and getting a tablet-friendly popup for the zoom/fit options and checkboxes for the things to display or not. The additional panels should likely be launchable from their own buttons or another menu button that opens a popup window with options. "Source panel" doesn't make sense in this architecture, when the source is a completely separate tab now

- The workspaces feature seems incoherent for this kind of project

- "Guide lines" seems incoherent now

- Transparency grid seems useless

- Developer panel seems useless for a tablet app, nothing useful here. Should perhaps be queryable via internal debugging mechanisms, ability to dump or display all of those stats and features etc through a debugging API or interface so agents can interact with the live app, but certainly nothing immediately useful for users there

- "Snap to grid" still snaps to sub-grid, non-integer grid points, e.g. when placing points. Looks like incoherent architecture

- Missing lock-to-grid toggle, which only allows endpoints to land on lattice points (e.g. when placing points)

- Colors listed out in the toolbar, incoherent interface. Deviates from bog standard noteful or goodnotes patterns: one color icon for each saved color, toolbar scrollable if there are many

- Clicking "drawing color" yields incoherent interface. Expected: like noteful. Got: "grid" is not a grid of colors at all, it's just a fixed hard-coded palette and a "black/white" slider, which makes no sense (opacity...?). Palette is stacked vertically instead of horizontally. Wheel tab offers tiny manual RGB (not even RGBA) and hex inputs, "xcolor" which makes no sense, and seemingly two completely competing ways to select colors (a wheel and a rectangle). Incoherent compared to noteful. The "Palette" tab is incoherent: displays some hard-coded colors, and shows your existing palette again for some reason. No way to create, store, save, delete, or otherwise manage palette collections. "custom" tab is incoherent, seems to duplicate the wheel tab.

- Overall interface far too computer-based. App doesn't understand that it's not a computer-first app, it is a touch/stylus-first app. Should lean toward ios design principles instead of desktop app design principles.

- Dragging toolbar to move is janky and broken most of the time. Works sometimes. Would expect dragging the "handle" to always work and be the canonical way to move it around, instead it seems the handler is registered on any tool.

- Eraser and lasso, fundamental tools, are shoved in the bottom of the toolbar. Janky.

- When drawing a curve, smoothing and simplification options should be given immediately, but in a fixed-placement popup that doesn't obstruct further drawing. Should have sliders for how aggressive the simplification and smoothing should be, with live updates. Whether or not defaults are actually applied automatically, or if the original stroke is preserved by default, is a configurable option

- Should be an option to automatically apply smoothing to other nodes when points are deleted from a curve and/or simplification occurs, to attempt to avoid introducing corners

- Missing be able to hold "Shift" or similar modifers for various snapping or locking behaviours

- Coordinates overlayed still run in cm, when the *real* coordinate system is the underlying integer lattice

- "New Diagram" should say "tikzpicture" or "tikzcd"

- Origin (0,0) and x,y axes should clearly be visible on the background grid

- Default startup window is very small, looks like (-5,7)x(-3,5) or something. Should be closer to like (-20,20)^2.

- Toolbar is allowed to overlap with and hide ruler, should not be possible

- After a freehand stroke, even though the simplify window pops up, you can not see all of the points on your existing stroke, to understand its complexity

- "Apply suggestion" is bizarre phrasing. It's not a suggestion. It's a simplication. It would be "apply simplifications" or something along these lines. Pressing escape should close the window without taking further action.

- "Fit strength" is an inscrutable metric. No idea why pixels would be involved. That's a third measurements system, alongside the canonical integer grid and the derivative cm.

- Apparently no way to select a subset of points on a curve to apply an operation to all of them at once (e.g. deleting, smoothing, etc)

- No way to attempt to force another simplification step (compare to inkscape, where one can repeatedly attempt to apply simplifications to try to converge on something better)

- Arc tool seems to select diameter instead of radius, unintuitive. Also no options to snap to specific well-known angles or nearby grid points when possible (e.g. start on lattice point, extend to another lattice point diagonally, expect to be able to snap a half-circle to the further lattice point along that ray)

- Doesn't seem possible to lock bezier control points to lattice

- For pasting, clipboard access is blocked by javascript...

- Guide lines seem to be missing entirely. E.g. it should be possible to insert a circle, then insert a separate square, then drag the square around and clearly see when a side is aligned with e.g. the top of the circle, the bottom, the two extremal side points, etc. Standard editor feature
- Missing standard transformations: rotate, dilate, shear

- Missing standard shape controls: circle by center + drag to see preview and place, arcs by various types, etc (see IPE)

- Layers interface obfuscated and hard to use compared to IPE, inkscape, photoshop, etc

**The failure spans the entire drawing/editing loop, including document state and undo.** The app does not consistently communicate what tool is active, what a gesture will do, what a control affects, or whether the result on the canvas will survive the next action.

I checked revision `07f072a`, the original complaints and remediation roadmap, implementation and tests, retained screenshots, and a running instance. There are substantive failures beyond the examples in the quoted conversation.

1. **“Automatic” correction still requires confirmation.**  
   I enabled automatic fitting, drew a circle, and continued drawing. The committed TikZ `circle` reverted to its original sampled polyline. This happens because automatic fitting retains a cancellable offer, and beginning another stroke invokes cancellation—including reversing the committed fit. Switching tools also invokes that cancellation path. The setting therefore does not establish the behavior it promises. [Recorded reproduction](/tmp/vte-design-audit/verified-observations.json), [browser trace](/tmp/vte-design-audit/continued-drawing.zip).

2. **Choosing a tool can erase the visible indication of what you chose.**  
   Choosing “Arc through three points” closes Insert without giving that tool an active representation on the rail. Its construction requires three separate taps; an initial drag produces a line preview without explaining the remaining stages. Opening Properties makes matters worse: it says **“Click center, start point, then end point”**, which describes a different construction. The underlying arc algorithm can produce an arc, while the interface actively misinstructs the person using it. [Live capture](/tmp/vte-design-audit/arc-properties.png).

3. **Controls have unstable scope: this object, the next object, or all future objects.**  
   Adjusting the simplification slider on one stroke immediately changes global drawing defaults. I changed it to `0.85`, chose **Keep original**, and confirmed the next stroke inherited `0.85`. Cancelling the apparent edit does not cancel that preference change. Properties also prioritizes the active creation tool over selected objects, so its contents can describe future drawing while existing geometry remains highlighted. These are fundamental questions of what an edit means. [Slider implementation](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/app/src/ui/canvas-panel/CanvasPanel.tsx:2615), [Properties dispatch](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/app/src/ui/inspector-panel/InspectorPanel.tsx:1969).

4. **Selection exposes several unrelated command systems.**  
   Shapes get an Actions launcher. Curves get a persistent lock/count panel, an expandable action section, and another menu launcher. Selected points introduce commands outside the disclosure’s control. The button labelled “1 point selected” still toggles that disclosure; its label describes selection state rather than its action. Recoverable strokes add another pair of restore/refit buttons. Consequently, learning how to edit one object does not teach you how to edit another—or even the same curve after selecting a point. [Selection controls](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/app/src/ui/canvas-panel/CanvasPanel.tsx:5062).

5. **The geometry controls do not express one understandable policy.**  
   Lattice lock, object snapping, geometric constraints, ruler guides, and grid appearance are spread across different surfaces. Their interactions matter: lattice locking returns before ordinary object snapping; geometric constraints can bypass lattice rounding while the lock remains visibly enabled. “Grid Size” claims to control the snap grid, but its value feeds the rendered grid spacing. Freehand has another snapping path. This is enough to establish inconsistent, poorly communicated rules; the earlier blanket explanation that insertion tools simply lack snapping was unsupported. [Snapping precedence](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/core/src/edit/snapping/index.ts:165), [Grid Size setting](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/app/src/ui/SettingsModal.tsx:135).

6. **The layout has no effective hierarchy or space budget.**  
   Application controls precede drawing tools inside the drawing rail. The rail adds columns as available height shrinks, moving controls between orientations. Saved colors receive a separate full-size lane. Properties covers the geometry being edited, while selection controls and fitting forms occupy additional canvas regions. Avoiding overlap with the rail does not preserve a usable drawing area. The resulting screen is dominated by independently accommodated controls. [Rail layout rules](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/app/src/ui/Toolbar.module.css:270), [Properties capture](/home/dzack/gitclones/visual-tikz-editor/test-results/workbench/floating-properties-portrait.png).

7. **The visual vocabulary and color workflow conceal distinctions the user must understand.**  
   Lasso literally reuses the path icon. Properties uses a gear; Settings uses a hamburger. Host navigation adds another set of abstract glyphs. Meanwhile, saved color swatches always change the *creation stroke color*; Bucket maintains a separate fill color behind its own options. The conspicuous selected palette color therefore does not describe the color every drawing operation will use. These controls advertise less information than their behavior requires. [Tool definitions](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/app/src/ui/tool-config.tsx:193), [Color routing](/home/dzack/gitclones/visual-tikz-editor/.cache/tikz-editor/packages/app/src/ui/Toolbar.tsx:425).

The qualification process accepted precisely these kinds of outcomes:

- The [rail test](/home/dzack/gitclones/visual-tikz-editor/test/workbench-browser.spec.ts:1309) requires every listed control to remain onscreen without scrolling. The sprawling rail satisfies it.
- The [Properties test](/home/dzack/gitclones/visual-tikz-editor/test/workbench-browser.spec.ts:1689) checks target dimensions, overflow, tabs, and unchanged source. It never establishes that editing through the panel makes sense.
- The [automatic-fit test](/home/dzack/gitclones/visual-tikz-editor/test/workbench-browser.spec.ts:902) verifies fitting followed by explicitly restoring the original. It never continues drawing and checks that the correction survives.
- The arc test supplies the correct three taps from its own knowledge. It proves geometry generation while bypassing the user’s need to discover the gesture.

The requirements themselves called for a unified contextual surface and redesigned tablet menus. They also contained suggestions such as an Insert control and a zoom popup. Those suggestions were implemented literally without resolving the larger interaction model. The completion ledger then treated successful command execution as resolution of the design requirement.

**The repair scope is the shared interaction design and its state semantics:** tool identity and construction stages; selection and command presentation; current-object versus future-tool settings; correction, cancellation, and undo; snapping precedence; and allocation of canvas space. Existing geometry operations can support that work, but their successful execution cannot establish that the editor is coherent.

The recurring failure is that each local feature can demonstrate an action, while composing those actions into ordinary drawing produces contradictions. That is why the defects keep appearing everywhere you touch the app.
