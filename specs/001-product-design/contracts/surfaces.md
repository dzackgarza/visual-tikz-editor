# Contract: surfaces

This contract states what each surface holds, in order, with the accessible name that a browser
story finds it by. A control on a surface that this contract does not list is a defect (SC-002).
Each symbol is from the sets of [research](../research.md) R7; each control has a hit region of at
least 44 × 44 pt (Principle II).

## Document bar

| Group | Control | Accessible name | Symbol | Press |
| --- | --- | --- | --- | --- |
| Leading | Title | the file name | text | Opens the title menu: New tikzpicture, New tikzcd, Open…, Save, Save As… |
| Leading | Save state | "Saved", "Not saved", "Saving", "Changed on disk" | text, beside the title | None |
| Centre | Undo | "Undo" | `RiArrowGoBackLine` | Undoes the last edit of the document, in every view (FR-012b); dimmed when nothing to undo |
| Centre | Redo | "Redo" | `RiArrowGoForwardLine` | Redoes the last undone edit, in every view; dimmed when nothing to redo |
| Trailing | View | "View" | `RiLayoutColumnLine` | Opens View: the document's editor, Render; then Grid, Rulers, Guides, Output Bounds |
| Trailing | Code | "Code" | `RiCodeLine` | Opens or closes the Code panel (FR-015) |
| Trailing | Layers | "Layers" | `RiStackLine` | Opens or closes the Layers panel |
| Trailing | Properties | "Properties" | `RiEqualizerLine` | Opens or closes Properties: the selection, or the figure with nothing selected (FR-060a) |
| Trailing | Share and Export | "Share and Export" | `RiShareBoxLine` | Opens Copy TikZ, then PDF…, SVG…, PNG… |
| Trailing | More | "More" | `RiMoreLine` | Opens Settings… |

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

## Status line

Under the canvas. It holds one text, accessible name "Pointer position", that reads the pointer's
*x* and *y* in figure coordinates, as the source writes them (FR-044, research R10). It holds no
control and no other text.

## Panels

Code, Layers, and Properties: one open at a time (FR-060); a side pane in landscape, a sheet with medium and large
detents in portrait; each has its title and a close button.

## Text

No surface shows a sentence (FR-070). A tooltip shows on pointer hover only and holds the
control's name and shortcut (research R11).

## Roles, states, and focus

Constitution Principle IX and FR-080 to FR-092. A story finds each control by its role and its
accessible name together, and reads its state from the attribute below.

| Surface or control | Role | State that assistive technology reads |
| --- | --- | --- |
| Document bar | `toolbar`, name "Document" | — |
| Title | `button` | expanded while the title menu is open |
| Save state | `status` | its text; a change is a status message (FR-087) |
| Undo, Redo | `button` | disabled when the history has no step |
| View, Share and Export, More | `button` | expanded while its menu is open |
| Code, Layers, Properties | `button` | pressed while its panel is open |
| Title menu, View, Share and Export, More, object menu More | `menu` with `menuitem`; `menuitemradio` for the views, `menuitemcheckbox` for Grid, Rulers, Guides, Output Bounds | checked |
| Drawing toolbar | `toolbar`, name "Drawing" | orientation of its edge |
| Lasso, Pen, Eraser, Shapes, Text, Fill | `radio` in one `radiogroup`, name "Tool" | checked for the active tool; expanded while its Active Tool Menu is open |
| Preset *n* | `radio` in one `radiogroup`, name "Colour" | checked for the active preset |
| Active Tool Menu, colour options, zoom menu, snap rules | `dialog`, not modal, named by its tool or control | — |
| Object menu | `toolbar`, name "Selection" | — |
| Snap | `button` | pressed |
| Lattice, Objects, Alignment, Angle | `switch` | checked |
| Zoom readout | `button` | expanded while its menu is open |
| Canvas | `application`, name "Canvas" | — |
| Status line | plain text, name "Pointer position"; not a live region, because the position changes at each pointer move | — |
| Code, Layers, Properties, Figures | `region` with the panel's title as its name; a sheet in portrait is a `dialog` | — |
| Figure thumbnail | `option` in a `listbox`, name "Figures"; each named "Figure *n*" | selected |
| Layer row | `option` in a `listbox`, name "Layers" | selected; its visibility and lock buttons pressed |
| Settings, the unsaved-changes dialog | `dialog`, modal, named by its title | — |
| Render progress and result, export result, conflict | `status`; a Render error and a conflict are `alert` | its text (FR-087) |

The role names are those of [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/); the toolbar,
menu, radio group, listbox, switch, and modal dialog follow the keyboard rules of the
[WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/).

**Focus** (FR-085). Tab moves through the surfaces in this order: document bar, drawing toolbar,
canvas, canvas controls, the open panel. Inside a toolbar, a menu, a radio group, and a listbox,
the arrow keys move the focus and Tab leaves, as the Authoring Practices state for each. A menu,
a popover, a sheet, and a dialog take the focus when they open; Escape closes them and returns
the focus to the control that opened them. The focus indicator is an outline of at least 2 CSS px
with a contrast of 3:1, the same on every surface. No open surface fully covers the control with
the focus.

**Keyboard on the canvas** (FR-084, research R18). Tab and Shift+Tab select the next and the
previous object; after the last object Tab moves the focus on. The arrow keys move the selection.
Escape clears the selection.

**Taps for each drag** (FR-086): research R18 lists each function and its alternative.

**Motion** (FR-089). While the system asks for reduced motion, a surface opens and closes with no
movement, and the Render progress mark does not turn.
