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
| Each surface | It holds exactly the controls of [surfaces](contracts/surfaces.md), in order, found by accessible name (SC-002) | User Stories 1–7 |
| Any reached state | No instruction sentence is visible (SC-003) | FR-070 |
| Every command | Reached by pen taps alone, with no hover, right-click, or modifier key (SC-004) | Principle II |
| Popovers | A second tap on a button closes its popover; a tap on another button closes it and opens its own, across the document bar and the canvas | FR-003, FR-004 |
| Open a figure with content | All content visible, fitted with the margin (SC-005); reopen restores the last view | FR-040 |
| Open an empty figure | 100 % is printed size; the origin is centred | FR-041 |
| A `tikzpicture` | View offers Canvas, Code, Render, and no Quiver | FR-014 |
| A `tikzcd` | View offers Quiver, Code, Render; Undo in the document bar undoes the Quiver edit | FR-014, research R3 |
| Layers, then Properties | One panel open at a time; Properties dimmed with nothing selected | User Story 6, research R13 |
| Settings › Appearance | Match System Appearance on follows the system; off with Light shows a light surface under a dark system | FR-005 |
| Every edit | Leaves untouched constructs as authored; session state never enters the source | Principle I |

Data shapes: [data model](data-model.md). Messages between the workbench and the editors:
[host protocol](contracts/host-protocol.md).
