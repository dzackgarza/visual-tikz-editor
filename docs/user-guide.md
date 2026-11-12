# User guide

This guide describes the standalone editor's controls. The [interaction model](interaction-model.md) states the rules behind them.

## Documents

The **File** menu holds New tikzpicture, New tikzcd, Open, Save, Save As, and Document Properties. A launch without a file opens an untitled tikzpicture. Each kind opens its own view:

| Item | View that opens |
| --- | --- |
| New tikzpicture | The drawing canvas |
| New tikzcd | Quiver, the commutative-diagram editor |

Each accepted edit to a saved file writes the file. An untitled diagram keeps a recovery draft until **Save** or Ctrl+S opens the native Save As dialog. If the file changes on disk, the editor stops saving, keeps your edits as a recovery draft, and reports the conflict. After a restart the editor restores the last diagram.

**Document Properties** (Ctrl+Shift+D) sets the X and Y scale and the bounds of a tikzpicture. It opens the drawing canvas if that view is closed; Escape closes the dialog.

**Copy source** copies the TikZ source to the clipboard without saving the file. The editor follows the light or dark appearance of the system.

## Views

Four views show the same source: Code, the drawing canvas, Quiver, and TeX render. Their icons sit on two sidebars. Click an icon to open its view, and click the active icon to close it. Drag an icon to the other sidebar to move the view. One open view fills the window; two open views share it with a movable divider. A view switch keeps the canvas selection, viewport, tool, and undo history.

**TeX render** compiles the source with the local TeX tools that the [README](../README.md#tex-render-and-export) lists.

## Drawing dock

The dock holds these controls in this order: Select, Lasso, Pen, Eraser, Geometry, Label, Bucket, Color with saved swatches, Undo, Redo, Layers, Properties, and Settings. Drag the dock from its edge to move it: drop it on a screen edge to dock it there, or anywhere else to let it float.

| Control | Action |
| --- | --- |
| Geometry | Opens a picker of illustrated constructions in five families: lines and arrows, curves, circles and arcs, shapes, and diagrams (grids, matrices, images). The control then shows the chosen construction's icon and name, and the next step to take. |
| Label | Places Text or an Equation. |
| Bucket | Fills the region under the pen. |
| Color | Sets the colour of its named target: new strokes, the selected stroke, the selected fill, or the bucket fill. |
| Properties | Opens the fields of the selected object, or of the active tool when nothing is selected. A side panel in landscape; a bottom sheet in portrait. |

The zoom readout opens Fit diagram, zoom presets, and the grid, ruler, guide, and output-bounds settings. The rulers measure whole centimetres from the figure's origin, and their label step and ticks follow the zoom as Inkscape's rulers do.

## Touch and pen

| Contact | Result |
| --- | --- |
| One finger drag | Pans the canvas. |
| Two fingers | Zoom. |
| Hold a finger on an element | Opens the element's actions. |
| Hold a finger on empty canvas | Opens selection, paste, and canvas aids. |
| Double-tap a curve | Adds a point. |
| Pen on an existing point | Draws at once. With the Objects snapping rule on, the stroke starts on that point and attaches to it. |
| Pen held still on a point for 450 ms, or with a finger of the other hand down | Moves the point. Settings → **Hold to move a point** sets the delay. |

A palm on the screen while the pen draws makes no second stroke.

## Selection

The selection strip names the selected object and offers only the actions that apply to it, for example Edit points, Simplify, Style, and Duplicate for a curve. Its **Lock** control keeps the selection while you work: a tap that misses keeps a locked selection. Selection locks last only for the open session. Double-click or double-tap an equation to edit it.

**Style** saves the selected object's appearance as a named TikZ style in the figure, and applies an existing style to the selection.

## Eraser

The eraser removes the part of each path that a sweep crosses and keeps the remaining pieces as separate paths, as one undo step. It cuts lines, curves, recorded strokes, circles, ellipses, arcs, rectangles, grids, and `to` paths. A `plot` path and a path that holds a node are erased whole.

## Snapping

Tap **Snap** on the dock to turn all snapping off or on; on a keyboard, press %. Snapping comes back on with the rules it had. The arrow beside it opens the four rules, which you can change while snapping is on:

| Rule | Effect |
| --- | --- |
| Lattice | Puts points on the lattice. On by default. |
| Objects | Attaches line and arrow ends to nodes and to the ends of open paths, places a label on a line or arrow as a node that follows it, and starts a pen stroke on an existing point. |
| Alignment | Lines up edges, centres, and equal gaps with other objects and with ruler guides. |
| Angle | Lines use 15-degree steps, rectangles become squares, and moves stay on their main axis. |

An endpoint, corner, centre, or crossing within reach wins over an alignment guide, which wins over the lattice; the angle rule then turns the point. Before a point is placed, a cross with a label names the target, for example "Centre", "Aligned with bottom", "Lattice", "Angle", "Square", or "Axis". On a desktop, hold Ctrl or Cmd to place one point without snapping.

Attachments are TikZ references in the source. Moving a node, a line, or a point moves everything attached to it as one undo step, and the attachments reopen with the file.

A circle or arc drawn from its centre takes the second point as its radius. An arc's end keeps the radius and lands on a lattice point of its ray when one is within reach, otherwise on a nearby multiple of 45 or 15 degrees.

Coordinate fields, figure bounds, Repeat, and the readout while you draw show figure coordinates: the numbers the source holds, with no unit word. A line, arrow, or curve readout shows the coordinates of the point you place; a shape readout shows its width and height. On a figure whose axes are not at right angles, Repeat steps read in pt. File > Document Properties… shows the size of one lattice step along x and y in centimetres, from the figure's `x`, `y`, or `scale` options.

## Freehand strokes

After a pen stroke, the editor offers a fitted curve; the canvas shows the recorded samples and the fitted points. Keep the original stroke to restore it later, including after reopening the file. **Simplify again** is available until no simpler fit remains. Clear **Interpret geometry** in the Freehand properties to keep handwriting as ink.

## Layers

A layer is a named top-level TikZ `scope`. In **Layers**, you can create and rename layers, move selected objects into a layer, hide and show layers, change their order, and delete a layer with its contents after a confirmation. The editor refuses a move that puts a named coordinate after a path that uses it. Names, contents, order, and visibility are saved in the source. Layer locks last only for the open session; a reopened file starts with every layer unlocked.

## Settings and shortcuts

Settings has three categories: canvas settings, named colour collections, and keyboard shortcuts. **Keyboard shortcuts** lists every command under its menu ("Align: Left", "View: Grid") with its keys. Type in **Find command** to filter by name or key, or turn on **Record keys** and press keys to find the command that has them. Press a row and then the new shortcut; the row shows "Press the new shortcut" while it records, and Escape cancels. When another command has the keys, an alert names it, and Enter moves the keys to this command and removes them from that one. Right-click or hold a row for **Remove Shortcut** and, on a changed row, **Reset Shortcut**; **Reset all shortcuts** restores the whole set. Settings and shortcuts persist across restarts.
## Export

**Export** compiles each figure in the source with TeX:

| Format | Output |
| --- | --- |
| PDF | One page per figure |
| SVG | One numbered file per figure |
| PNG | One numbered file per figure, at 300 dpi |

Export reads the current source and does not change it. Image paths resolve from the diagram's directory.
