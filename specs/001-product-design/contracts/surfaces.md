# Contract: surfaces

This contract states what each surface holds, in order, with the accessible name that a browser
story finds it by. A control on a surface that this contract does not list is a defect (SC-002).
Each symbol is from the sets of [research](../research.md) R7; each control has a hit region of at
least 44 × 44 pt (Principle II).

## Document bar

| Group | Control | Accessible name | Symbol | Press |
| --- | --- | --- | --- | --- |
| Leading | Title | the file name | text | Opens the title menu: New tikzpicture, New tikzcd, Open…, Save, Save As…, Document Properties… |
| Leading | Save state | "Saved", "Not saved", "Saving", "Changed on disk" | text, beside the title | None |
| Centre | Undo | "Undo" | `RiArrowGoBackLine` | Undoes in the input view (research R3); dimmed when nothing to undo |
| Centre | Redo | "Redo" | `RiArrowGoForwardLine` | Redoes in the input view; dimmed when nothing to redo |
| Trailing | View | "View" | `RiLayoutColumnLine` | Opens View: the document's editor, Code, Render; then Grid, Rulers, Guides, Output Bounds |
| Trailing | Layers | "Layers" | `RiStackLine` | Opens or closes the Layers panel |
| Trailing | Properties | "Properties" | `RiEqualizerLine` | Opens or closes Properties; dimmed with nothing selected (research R13) |
| Trailing | Share and Export | "Share and Export" | `RiShareBoxLine` | Opens PDF…, SVG…, PNG… |
| Trailing | More | "More" | `RiMoreLine` | Opens Settings…, Copy TikZ |

In a host, the leading group is the host's slot (research R2).

## Drawing toolbar

Order: Lasso, Pen, Eraser, Shapes, Text, Fill, a separator, the active tool's presets, the + slot.

| Control | Accessible name | Symbol | First tap | Tap on the active control |
| --- | --- | --- | --- | --- |
| Lasso | "Lasso" | Lucide `lasso` | Activates | Opens or closes its Active Tool Menu |
| Pen | "Pen" | fork's Freehand icon | Activates | Same |
| Eraser | "Eraser" | `RiEraserLine` | Activates | Same |
| Shapes | "Shapes" | fork's Geometry icon | Activates the last variant | Same |
| Text | "Text" | fork's Label icon | Activates the last kind | Same |
| Fill | "Fill" | fork's Bucket icon | Activates | Same |
| Preset *n* | "Colour *n*: *value*" | a swatch | Sets the tool's colour and the selection's colour | Opens or closes the colour options |
| + | "Add colour" | `RiAddLine` | Opens the colour options for a new preset | — |

The toolbar moves by its grip only and docks to any screen edge (FR-010).

## Active Tool Menu

Anchored beside the toolbar at the active tool. Contents per tool: [data model](../data-model.md),
Tool. During a construction it also holds Cancel and, for an open path, Finish (FR-032).

## Colour options

Anchored at the preset. Contents: the palette (the colour collections of Settings), the colour
wheel, Opacity, Hex, the exact `xcolor` field, then Edit (remove and reorder presets).

## Object menu

Anchored above the selection. Only the commands that apply, then More. Per selection:

| Selection | Commands |
| --- | --- |
| One curve | Edit Points, Simplify, Restore Original Stroke (when an original exists), Lock, Duplicate, More |
| One shape | Lock, Duplicate, More |
| Several objects | Align, Distribute, Lock, Duplicate, More |
| Points in Edit Points | Smooth, Corner, Split, Delete, Done |

More holds Cut, Copy, Paste, Delete, Transform, Reorder, Repeat….

## Canvas controls

| Place | Control | Accessible name | Press |
| --- | --- | --- | --- |
| Lower trailing corner | Zoom out, readout, Zoom in | "Zoom out", "Zoom: *n* %", "Zoom in" | The readout opens Zoom to Fit, Zoom to Selection, Normal Size, 10–1000 % |
| Lower leading corner | Snap | "Snap" (pressed state on or off) | Turns snapping on or off |
| Beside Snap | Snap rules | "Snapping rules" | Opens Lattice, Objects, Alignment, Angle as toggles |

## Panels

Layers and Properties: one open at a time; a side pane in landscape, a sheet with medium and large
detents in portrait; each has its title and a close button.

## Text

No surface shows a sentence (FR-070). A tooltip shows on pointer hover only and holds the
control's name and shortcut (research R11).
