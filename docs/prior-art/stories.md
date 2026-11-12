# Stories that assert replaced rules

The browser stories below assert, or reach their subject through, a behaviour that a specification in this directory replaces ([#25](https://github.com/dzackgarza/visual-tikz-editor/issues/25)). Each implementation issue rewrites its stories in the same change that replaces the behaviour, after its own acceptance story is committed red. A story is named by its title, which is stable; `WB` is `test/workbench-browser.spec.ts` and `WF` is `test/workbench-files.spec.ts`, with the line of the `story(` call at commit `f507c1f`. `test/hosted-browser.spec.ts` and `test/launch-options.spec.ts` assert no replaced behaviour.

## Shared helpers

A helper change rewrites every story that calls it.

| Helper | Replaced behaviour | Issue |
| --- | --- | --- |
| `fitDiagram` (`test/tablet.ts:149-159`) | Fit diagram in the "Zoom and display" popover, which stays open after a choice; about 60 stories call it | [#65](https://github.com/dzackgarza/visual-tikz-editor/issues/65), [#59](https://github.com/dzackgarza/visual-tikz-editor/issues/59) |
| `freehandTool` (WB:37) | The "Freehand" button; the tool is Pen | [#28](https://github.com/dzackgarza/visual-tikz-editor/issues/28) |
| `authorAndRender` (WB:9566-9570) | "Preview: right sidebar" and "Canvas: right sidebar" view names | [#44](https://github.com/dzackgarza/visual-tikz-editor/issues/44) |
| `beforeEach` (WB:144) and most stories | "Code: left sidebar" | [#44](https://github.com/dzackgarza/visual-tikz-editor/issues/44) |
| The panel locator `complementary "Properties"` | One shared panel; Properties and Layers are separate panels | [#34](https://github.com/dzackgarza/visual-tikz-editor/issues/34) |

## By issue

### #27 One press rule and tool options

The first press on Geometry or Label opens the picker; under the press rule it activates the tool with its last options.

WB 237 `lands drawn points on the lattice by default, under a lock toggle on the rail`; WB 332 `shows one snapping toggle, with lattice, object, alignment and angle rules behind it`; WB 448 `names the snap target it chooses, object points before alignment before the lattice, at two zooms and on a scaled lattice`; WB 598 `constrains an arrow's angle, a square, and an axis move, …`; WB 822 `commits the locked curve its preview shows, with lattice control points`; WB 1153 `keeps the rail and its popups off the rulers, and the popups off the rail, …`; WB 1232 `snaps a free arc's end to the nearby common angle by pen`; WB 1301 `sweeps an arc the way the pen went round, past a half circle`; WB 1372 `builds circles on a diameter and through three points, and an arc through three points, by pen`; WB 1461 `names the chosen construction and its next step until it finishes or is cancelled`; WB 1544 `finishes every geometry construction by reading only the picker and the stage instruction`; WB 2072 `reads a drawn line's end in lattice units when the figure scales its lattice`; WB 2236 `names the selected object and new-stroke scope in Properties after placing a line`; WB 2283 `states the freehand tool's properties without pixels` (Pen options in Properties instead of tool options); WB 2405 `carries one offline pen session through a fitted stroke, …`; WB 2620 `carries one session through a recolored shape, a moved point, a bucket fill, a label, …`; WB 2766 `carries one two-figure document through edits in each figure, …`; WB 3122 `attaches an arrow end to a node, a label to a line, and a stroke to a point, …`; WB 4092 `applies one color control to selected stroke, selected fill, bucket, and new strokes`; WB 4156 `writes a colour picked at full opacity as an xcolor value`; WB 5089 `constrains pen drawing and moving through a touch toggle`; WB 5287 `lands a placed line's ends and a dragged Bézier control point on whole lattice points`; WB 5498 `inserts, deletes, and opens layers through touch routes`.

### #28 Dock contents as icons

Undo, Redo, Layers, Properties, Settings, and zoom in the dock; the names Freehand and Label; word labels; tooltips without shortcuts.

WB 237, 332, 448, 598 (Undo); WB 904 `shows an alignment guide when a dragged square meets a circle's top, locked and free` (Undo); WB 1153 (Label); WB 1461 (Properties); WB 1544 (Label, Undo); WB 1740 `undoes a handle rotation, then a quarter-turn and a flip, and keeps transforming`; WB 1794 `scales a lasso-selected pair by 2 from a corner of their frame`; WB 1912 `shears a square from its right edge after a second tap with the pen`; WB 2236, 2283 (Freehand, Properties); WB 2405 (Freehand, Undo, Redo); WB 2528 `carries one session through a saved style, a second line given the style, a new layer, …` (Layers, Undo, Redo); WB 2620, 2766 (Undo, Redo); WB 3017 `draws from an existing point with the pen, and moves it under a held finger or a held pen` (Settings, Freehand, Undo); WB 3122 (Label, Freehand, Undo); WB 3526 `keeps the freehand result clear of its stroke, the rail, and Properties in every dock`; WB 4034 `fills a closed shape with one pen tap of the bucket, as one undo step`; WB 4262 `creates, renames, switches and deletes colour collections in Settings`; WB 4335 `scrolls 24 saved colours in their own strip, marks the active one, and keeps the tools in view`; WB 4463 `states geometry in lattice units, never cm or px, in Properties and Repeat`; WB 4538 `shows every drawing-rail control without scrolling`; WB 4592 `orders and labels the dock over a dark canvas`; WB 4674 `offers only settings that act in the embedded editor`; WB 4754 `sets, persists, removes and resets command shortcuts in Settings`; WB `lists each command under its menu and moves a shortcut to another command with a warning` (added after `f507c1f`); WB 4819 `persists canvas aids and grid controls after reload`; WB 4878 `keeps typing native when Settings has a single-letter shortcut`; WB 4925 `runs a configured canvas-owned simplification command`; WB 5001 `uses configured Undo, Delete and previously unassigned Layers shortcuts`; WB 5089 (Undo); WB 5183 `edits figure bounds in scaled lattice units`; WB 5395 `offers touch-sized floating Properties controls and only mounted tabs`; WB 5498 (Layers); WB 5568 `names the layers panel Layers on the rail, its tab, and its header`; WB 5598 `creates, renames, fills, hides, locks, orders and deletes TikZ scope layers by touch`; WB 5761 `reopens named layers and visibility with session-local locks`; WB 5826 `keeps selection actions usable beside Layers when the selection fills the canvas`; WB 5901 `refuses to move a coordinate into a layer drawn after the line that uses it`; WB 5946 `keeps panels and the freehand result clear of the drawing rail`; WB 5981 `opens Properties as a side panel in landscape and a bottom sheet in portrait, clear of the selected object`; WB 6071 `keeps the selected object and Properties above the on-screen keyboard`; WB 6174 `moves the drawing rail by its grip only and never over the rulers`; WB 6321 `names no key in the tooltips a hovering pen shows on the drawing rail` (the tooltip now names the shortcut, [instructional text](instructional-text.md) item 4); WB 6376 `erases only the swept part of each stroke a pen sweep crosses, as one undo step`; WB 6487 `erases only the swept part of a circle, an ellipse, an arc path, and a rectangle, …`; WB 7241 `moves the touched point with a pen drag in point editing, as one undo step`; WB 7342 `edits a locked curve point and subset, misses, undoes, and keeps editing`; WB 7403 `aligns and distributes three selected objects as separate undo steps`; WB 8190 `keeps authored source when a notification names a load operation`; WB 8262 `opens a tablet canvas and independently toggles source and properties before copying`; WB 8930 `lets the author keep handwritten ink outside geometric interpretation`; WB 9259 `carries one hosted drawing through drawing, a stale load, undo, redo, …` (embedded Undo and Redo move into More); WB 9594 `retains authored source and its drawing tool through rendered-view switches by pen`; WF 397 `carries one authored file through drawing, undo, redo, a view switch, copy, export, a restart, and further editing`; WF 513 `reopens layered source from disk with its names, order, visibility, and references`; and every story that calls `freehandTool`.

### #29 Unlabelled colour well

The colour control names its target ("Color: New strokes: green", "Selected fill").

WB 1153, 2236, 4092, 4156; WB 4205 `picks a drawing colour from saved swatches, one spectrum, and opacity only`; WB 4335, 4538, 4592.

### #31 Step text to the status line

WB 1461, 1544 (the dock's "Current step" lane).

### #32 Drag from the edge

WB 1153, 3526, 6174 (the "Move toolbar" grip).

### #34 Separate panels

The tab strip of the shared panel: WB 2528, 5001, 5395, 5498, 5568, 5598, 5761, 5901; WF 513.

### #35 Portrait sheet

WB 5981 ("Expand properties", ⌃/⌄, sheet heights).

### #37 Properties with nothing selected

WB 1461 (the stage repeated in Properties); WB 2283 (the tool-name header "Freehand"); WB 5183 (Figure Bounds in Properties, with #50); WB 8930 ("Interpret geometry" in Properties).

### #40 Layers rows

The per-row Rename, Raise, "Move selection to …", and Delete buttons: WB 2528, 5598, 5761, 5901.

### #42 Menu bar

"Copy source", the Export group, and the File `summary` in the bar: WB 2405, 2528; WB 6284 `starts a new tikzpicture or tikzcd by touch`; WB 7773 `copies the final drawing immediately after switching to rendered view`; WB 7803 `copies the completed Quiver edit immediately after switching to rendered view`; WB 8099 `rejects a source notification from the right frame but the wrong session`; WB 8148 `starts cold and edits math-labelled geometry without external assets`; WB 8262, 8930; WB 9192 `keeps file ownership in the standalone host`; WB 9449 `copies a just-finished canvas edit before the throttled source notification`; WF 130 `saves through the native chooser and reopens exact authored bytes after restarting`; WF 208 `saves completed canvas and Quiver edits after an immediate rendered-view switch`; WF 290 `keeps both sources intact when an existing file changes on disk before the source editor Save shortcut`; WF 326 `autosaves an existing file and reopens its source and picture after interruption`; WF 355 `exports every authored figure as PDF, SVG, and PNG while preserving editable source`; WF 397, 513.

### #44 Views by document kind; one name per view

WB 176 `keeps authored source through a render error and recovers in the dark tablet workspace`; WB 2620, 2766, 7773, 7803; WB 7887 `matches compiled geometry for filled primitives and transformed curves`; WB 9468 `edits a Quiver diagram and retains source and selection across views at ${width}px`; WB 9507 `carries one Quiver diagram through two relabelled vertices, a TeX compile, view switches, and the whole history`; WB 9573 `retains authored source and its drawing tool through rendered-view switches with a desktop mouse`; WB 9594; WF 130, 208, 397; and every story that uses "Code: left sidebar" or `authorAndRender`.

### #47, #48 Banners for persistent states

WF 290 (the conflict as status text "The file changed on disk").

### #52 Status line

The selection name and the hints in the strip, Properties, and the canvas overlay: WB 1461; WB 3709 `smooths only the neighbours of a deleted curve point`; WB 5287; WB 6859 `highlights, locks, and keeps a curve selected by ${contact}`; WB 6953 `edits a point on a styled curve from its control`; WB 7029 `shows one selection strip whose actions follow the selection: …`; WB 7204 `leaves point editing with Escape and keeps the curve ready to edit`; WB 7241, 7342; WB 7467 `deletes a chosen subset of a curve's points by ${contact}`; WB 7571 `edits a curve point from the curve's own control by ${contact}`; WB 7652 `adds a curve point with a finger double tap, as its hint says`; WB 7684 `keeps an original stroke as an editable curve whose points are counted`.

### #54 Units

WB 2072 ("2 units"); WB 4463 ("units", no cm); WB `shows only labels, values, and button names on option surfaces` (added after `f507c1f`; "Center X (units)" and "lattice units").

### #55 One selection menu

Commands reached through the selection strip: WB 1740, 2405, 2528, 2620, 2766, 3709; WB 3766 `selects a fitted stroke itself, not the envelope that keeps its original`; WB 3810; WB 3950 `saves and applies an authored style by name after reopening`; WB 4003 `lists named styles from the preamble, figure, and picture body`; WB 4637 `names no key in the context menu a long press opens` (the menu now shows shortcuts); WB 4925, 5598, 5826, 6071; WB 6735 `keeps the selection strip off a neighbouring line when no place holds all its actions`; WB 6798 `places a selected curve's control outside the curve and clear of the rail`; WB 6859, 6953; WB 6999 `gives a selected rectangle the shape control, not the curve control`; WB 7029, 7204, 7241, 7342, 7403, 7467, 7571; WB 7734 `reaches edit commands by pen from the selection control`; WB 8555 `interprets the newly drawn stroke instead of identical drawing text in a later figure` (Restore original stroke, with #57).

### #56 Lock and point editing

The selection pin, the lock toggle, and Done: WB 2620, 3766, 3810, 4925, 5598, 6735, 6859, 7029, 7204, 7241, 7342, 7467.

### #57 Freehand options before drawing

The Freehand result popover: WB `shows only labels, values, and button names on option surfaces` (added after `f507c1f`); WB 2312 `keeps the original stroke after an automatic fit`; WB 2405; WB 2871 `fits a stroke with anchors a pen can pick apart, also at its slow and hooked ends`; WB 2958 `keeps automatic fits when drawing continues and the tool changes, and one Undo restores the last original`; WB 3017, 3122 (Escape closes the result); WB 3335 `refines one stroke from one surface, with new-stroke scope behind Defaults`; WB 3457 `places the freehand result clear of the stroke wherever it is drawn, and Escape keeps the stroke`; WB 3526, 3658, 3766, 3810, 4925, 5946, 7684, 8555, 8930, 9084 `keeps palm contact out of pen drawing and supports finger pan and pinch afterward`, 9259, 9594; WF 397. WB 2367 `keeps every stroke drawn and erased in quick succession` and WB 2922 `starts a new stroke near a raw stroke's end and leaves that stroke unchanged` press Escape after a stroke, which closes the result today.

### #58 Shapes on a hold

WB 2922 relies on a stroke staying raw. WB 7992 `preserves representative trace geometry through fitting and original restoration` expects primitives from strokes without a hold, through the embedding test page's "Interpret stroke" button.

### #59 One placement and closing rule for popovers

WB 208 `reaches zoom and canvas aids by touch` (Rulers, then 200 %, in one open popover); `fitDiagram`; `setSnapRule`, where a rule toggle is a choice that closes the popover.

### #63 100 % is printed size

WB 1101 `starts on at least (-20,20) on both axes at a preset zoom` (28.45 px per unit); WB 4674 (the Settings › Canvas list gains "Display calibration").

### #64 Opening and returning view

WB 1101 (the opening range); WB 7536 `starts with the origin visible and clear of the rail, before and after the code pane opens`.

### #65 Zoom readout and menu

The dock's zoom button and the "Zoom and display" popover: WB 208, 237, 332, 448, 1101, 1153; WB 1994 `creates, hides, and deletes a ruler guide by finger from one Ruler guides control`; WB 4538, 4819, 5826; and every story that calls `fitDiagram`.

### #66 Rulers in centimetres

WB 1009 `labels the rulers in lattice steps when the figure scales its lattice`.

No story asserts the behaviour that #38, #39, #43, or #60 replace; their acceptance stories are new. The storage-status stories (WB 3438, WB 9622, and the "Saved" checks in WF) assert a rule the [interaction model](../interaction-model.md) keeps.
