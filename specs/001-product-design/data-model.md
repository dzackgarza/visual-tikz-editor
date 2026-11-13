# Data model: Product design of the Visual TikZ Editor

The document state is the TikZ source alone (Principle I). Every entity below except Document and
Layer is session state or a preference, and none of them writes itself into the source.

## Document

| Field | Type | Rule |
| --- | --- | --- |
| `source` | string | The authored bytes; the only document state |
| `kind` | `tikzpicture` \| `tikzcd` | From the file extension `.tikzcd` or the outer environment; decides the editor (FR-013) |
| `fileName` | string | Shown in the title; "Untitled" for a new document |
| `saveState` | `saved` \| `unsaved` \| `saving` \| `conflict` | Agrees with the disk (FR-006) |

Transitions of `saveState`: `saved` → `unsaved` on an edit; `unsaved` → `saving` on Save or
autosave; `saving` → `saved` when the disk holds the bytes; `saving` → `conflict` when the disk
changed since the last read, and the edit is kept as a recovery draft; `conflict` → `saved` after
the user chooses a version.

## View

| Field | Type | Rule |
| --- | --- | --- |
| `id` | `editor` \| `code` \| `render` | `editor` is Canvas for a `tikzpicture` and Quiver for a `tikzcd` (FR-014) |
| `shown` | one or two views | Two only in a regular-width window (FR-015) |
| `inputView` | `editor` \| `code` | The view that last took input; Undo and Redo act on its history |

Switching views keeps selection, viewport, tool, and history (FR-015).

## Tool

| Field | Type | Rule |
| --- | --- | --- |
| `active` | `lasso` \| `pen` \| `eraser` \| `shapes` \| `text` \| `fill` | Lasso first in the toolbar (FR-007) |
| `options[tool]` | per tool, below | Shown in the Active Tool Menu (FR-009, FR-025) |
| `presets[tool]` | `Colour[]`, 1–12 | Per tool, three by default (FR-020) |
| `activePreset[tool]` | index | A tap sets it; a second tap opens the colour options (FR-022) |

| Tool | Options |
| --- | --- |
| Lasso | Freehand or Rectangle |
| Pen | width, line style, smoothing, opacity |
| Eraser | Partial or Whole stroke, size |
| Shapes and constructions | the shape or construction variant; numeric entry of a circle or arc |
| Text and Equation | Text or Equation |
| Fill | colour only |

Tool options and presets are preferences: they survive reopen and never enter the source.

## Colour

| Field | Type | Rule |
| --- | --- | --- |
| `value` | `xcolor` expression | Written to the source as authored, such as `red!50!blue` (FR-022) |
| `opacity` | 0–1 | Written as TikZ `opacity` only when below 1 |

## Construction

| Field | Type | Rule |
| --- | --- | --- |
| `variant` | a construction variant | From the Shapes tool options |
| `placed` | figure points | Shown on the canvas (FR-030) |
| `provisional` | geometry through the pen position | Shown on the canvas; never in the source |
| `snapTarget` | point and kind | Shown by the marker before placement (FR-024) |

A construction becomes source at Finish or at its last point. Cancel and a change of tool remove
only the provisional part (FR-032, FR-033).

## Selection

| Field | Type | Rule |
| --- | --- | --- |
| `objects` | source objects | Highlighted; the object menu appears above them (FR-050) |
| `locked` | boolean | A locked selection survives a tap that misses (FR-052) |
| `editingPoints` | boolean | The rest of the figure is dimmed and locked (FR-053) |

## Viewport

| Field | Type | Rule |
| --- | --- | --- |
| `scale` | number | 1 is printed size at 96 CSS px per inch (FR-041) |
| `fit` | boolean | On at open for a figure with content (FR-040); a zoom, pan, or pinch turns it off |
| `centre` | figure point | The origin for an empty figure (FR-041) |

The viewport is kept per file, so a figure reopens at its last view (FR-040). Zooming changes
neither the source nor the selection (FR-043).

## Panel

| Field | Type | Rule |
| --- | --- | --- |
| `open` | none, `layers`, or `properties` | One at a time (User Story 6) |
| `placement` | `side` \| `sheet` | `side` in landscape, `sheet` in portrait (FR-061) |

## Popover

| Field | Type | Rule |
| --- | --- | --- |
| `open` | none or one popover | One at a time across the whole window (FR-004) |
| `anchor` | the button that opened it | A second tap on it closes the popover (FR-003) |

## Layer

A layer is a top-level TikZ `scope` with a `name=` option, as an Inkscape layer is an SVG group
marked as a layer. Its name and order are source. Its visibility and lock are view state, kept per
file like the viewport; they never enter the source, so a hidden layer still prints.

## Preference

A lasting setting in the user's configuration, outside the document: canvas settings, colour
collections, keyboard shortcuts, tool options, and presets. A changed preference shows its own
reset (FR-062).
