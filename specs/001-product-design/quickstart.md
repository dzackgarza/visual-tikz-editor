# Quickstart: validate the product design

Each user story of the [specification](spec.md) is accepted by browser stories that drive the
running page (constitution, Principle VIII). This guide states how to run the editor and the
stories, and what each story proves.

## Run

```bash
just build                 # the standalone page in standalone/dist
just run figure.tikz       # serve the editor on 127.0.0.1 with one file
just run diagram.tikzcd    # a tikzcd file opens in Quiver
```

## Prove

```bash
bun run test:browser --grep '<story>'   # matching stories, in portrait and landscape
bun run test:logic                      # the fork's specs, in .cache/tikz-editor
```

A failed story keeps its Playwright trace in `test-results/workbench/`
([development guide](../../docs/development.md)).

## What the stories assert

| Scenario | Expected outcome | Owner |
| --- | --- | --- |
| Each surface | It holds exactly the controls of [surfaces](contracts/surfaces.md), in order, found by accessible name (SC-002) | User Stories 1–8 |
| Any reached state | No instruction sentence is visible (SC-003) | FR-070 |
| Every command | Reached by pen taps alone, with no hover, right-click, or modifier key (SC-004) | Principle II |
| Any reached state, light and dark | The axe-core scan for WCAG 2.2 Levels A and AA finds zero violations (SC-007) | FR-080 to FR-083 |
| One edit on each surface with no pointer | The keyboard does it; the focus indicator shows at each step; Escape closes each menu, sheet, and dialog and returns the focus to its button (SC-008) | FR-084, FR-085 |
| Zoom, toolbar edge, selection position and size, layer order, panel width, with taps only | Each is done with no drag (SC-008) | FR-086 |
| Save, a change on disk, a Render compile, a Render error, an export | Each text arrives in a `status` or `alert` region while the focus stays | FR-087 |
| A field with a refused value | The field is marked invalid and the text beside it says what is wrong | FR-088 |
| The system asks for reduced motion | No surface moves when it opens, and the Render progress mark does not turn | FR-089 |
| Text at 200 % and with the WCAG text spacing | No text of the bar, menus, panels, Settings, and dialogs is cut or overlaps | FR-090 |
| Popovers | A second tap on a button closes its popover; a tap on another button closes it and opens its own, across the document bar and the canvas | FR-003, FR-004 |
| Open a figure with content | All content visible, fitted with the margin (SC-005); reopen restores the last view | FR-040 |
| Open an empty figure | 100 % is printed size; the origin is centred | FR-041 |
| A `tikzpicture` | View offers Canvas and Render, and no Quiver | FR-014 |
| A `tikzcd` | View offers Quiver and Render | FR-014 |
| Tap Code, then edit on the canvas, then type in the panel | The Code panel opens beside the canvas; each edit shows at once in the other; opening Layers closes Code | FR-015, FR-060 |
| Edit in Code, then on the canvas (or in Quiver), then Undo twice | The first Undo removes the canvas edit and the second the Code edit; after each, every view shows the same source | FR-012b |
| Layers, then Properties | One panel open at a time; with nothing selected Properties shows the figure, and with a selection the selection | User Story 6, FR-060a |
| Settings › Appearance | Match System Appearance on follows the system; off with Light shows a light surface under a dark system | FR-005 |
| Every edit | Leaves untouched constructs as authored; session state never enters the source | Principle I |
| Change a preference, then reopen a figure | The preference is in `$XDG_CONFIG_HOME/visual-tikz-editor/`, the figure's view state in `$XDG_STATE_HOME/visual-tikz-editor/`; nothing is written beside the figure but the figure | FR-063 |
| Pen over the point (1, 2) of the grid | The status line reads 1 and 2, and no other text | FR-044 |
| Lasso with Oval | A drag from empty canvas selects the objects inside the oval | FR-012a |

Data shapes: [data model](data-model.md). Messages between the workbench and the editors:
[frame protocol](contracts/frame-protocol.md).
