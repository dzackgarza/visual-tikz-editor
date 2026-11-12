# Feature Specification: Product design of the Visual TikZ Editor

**Feature Branch**: `main`

**Created**: 2026-11-13

**Status**: Draft

**Input**: The user's usability report of 2026-11-12 and the direction to audit what it implies
about the app's design and to write a design specification. The audit is
[audit.md](audit.md). This specification states the editor's users, workflows, and information
architecture. It follows the [constitution](../../.specify/memory/constitution.md), version 2.0.0.

## Users and purpose

The user is a research mathematician who draws diagrams for papers and notes on a tablet with a
pen and fingers, and sometimes at a desktop with a mouse and keyboard. A diagram is one
`tikzpicture` or one `tikzcd` figure in a `.tikz` or `.tikzcd` file that a LaTeX document
includes. The user knows iPad notebook applications (GoodNotes, Noteful, Apple Notes) and
figure editors (Ipe, Inkscape, Quiver), and expects the editor to behave like them. The editor
runs alone (desktop window or local page) or inside a host (Zettlr, Math Notes) through the
typed host interface.

## Information architecture

The editor has these surfaces. Each control appears on exactly one of them.

| Surface | Holds | Prior art |
| --- | --- | --- |
| Document bar (top) | Leading: document title with its save state; a tap on the title opens the document commands (New, Open, Save, Save As, Document Properties). Centre: Undo, Redo. Trailing: View, Layers, Share and Export, More (⋯) | GoodNotes navigation bar (left, middle, right sections; Share and Export and More at the right; Undo and Redo in the bar); HIG The menu bar (File menu contents, recorded in docs/prior-art/shell.md); the 2026-10-16 mockups |
| Drawing toolbar (movable, docks to a screen edge) | Lasso first, then Pen, Eraser, Shapes and constructions, Text and Equation, Fill; then the active tool's colour presets and a + slot | GoodNotes toolbar (Lasso first and fixed; tools; floating menus dock to any edge); GoodNotes colour presets per tool |
| Active tool menu (beside the toolbar) | The options of the active tool: width, style, smoothing, the construction variant | GoodNotes Active Tool Menu |
| Object menu (above the selection) | Only the commands that apply to the selection | GoodNotes Universal Object Menu; HIG context menus |
| Canvas controls (canvas corners) | Zoom readout with zoom in and out; Snap with its rules | 2026-10-16 mockups; Inkscape status-bar zoom field; Ipe Snap toolbar |
| Panels (side panel in landscape, sheet in portrait) | Layers; Properties; one at a time per side | GoodNotes Layers panel; HIG sheets and popovers |
| More (⋯) menu | Settings (canvas, colour collections, keyboard shortcuts), Copy TikZ | GoodNotes More menu (Document Editing, toolbar customization) |

## User Scenarios & Testing *(mandatory)*

The user sets the priority of each story; the stories are listed in workflow order.

### User Story 1 - Draw a figure by pen (Priority: set by the user)

The user opens the editor, draws strokes with the pen, erases by sweeping, lassoes and moves
marks, and undoes mistakes, without reading any text.

**Why this matters**: Drawing is the first thing a notebook-app user does; the reports show that
the drawing surface carries controls and text of other scopes.

**Independent Test**: A story with pen events draws three strokes, erases one by sweeping,
lassoes the other two, moves them, and undoes the move.

**Acceptance Scenarios**:

1. **Given** a new `tikzpicture`, **When** the pen touches the canvas, **Then** a mark appears at once and the source gains a path.
2. **Given** the Eraser, **When** the pen sweeps across two strokes, **Then** both lose the crossed parts in one undo step.
3. **Given** the drawing toolbar, **When** the user looks at it, **Then** it shows only Lasso, the drawing tools, and the active tool's colours, all as symbols.

---

### User Story 2 - Open, save, and reopen a TikZ file (Priority: set by the user)

The user opens a `.tikz` file, edits it, and finds the file on disk changed only where edited.

**Why this matters**: Authored TikZ is the document (constitution, Principle I).

**Independent Test**: A story opens a file with unsupported constructs, moves one point, and
compares the file byte for byte outside the edited statement.

**Acceptance Scenarios**:

1. **Given** a saved file, **When** an edit is accepted, **Then** the file is written and the title shows the saved state.
2. **Given** a file changed on disk, **When** the editor next saves, **Then** it stops, keeps the edit as a recovery draft, and shows the conflict in the document bar.

---

### User Story 3 - Edit a selected object (Priority: set by the user)

The user taps or lassoes an object; the object is highlighted and its object menu appears above
it with only the commands that apply. The user edits points, changes colour, locks the
selection, duplicates, and transforms.

**Independent Test**: A story selects a curve, a circle, and two objects in turn and compares
each object menu with the commands that apply to that selection.

**Acceptance Scenarios**:

1. **Given** a selected curve, **When** the object menu appears, **Then** it holds no unavailable command.
2. **Given** a selection, **When** the user taps a colour preset, **Then** the selection takes the colour and no word names the target.

---

### User Story 4 - Construct exact geometry (Priority: set by the user)

The user chooses a construction (for example an arc through three points), places its points
with snapping, and sees the stage of the construction by its preview and markers.

**Independent Test**: A story chooses each construction, places its points on lattice points,
and checks the emitted TikZ; at no stage does a sentence appear.

**Acceptance Scenarios**:

1. **Given** the arc-through-three-points construction, **When** two points are placed, **Then** the canvas shows the placed points, the provisional arc through the pen position, and the snap marker, and no instruction text.
2. **Given** a construction in progress, **When** the user chooses another tool, **Then** only the provisional construction is discarded.

---

### User Story 5 - See the source and the compiled figure (Priority: set by the user)

The user opens the Code view or the TeX render beside or instead of the editor that the document
kind uses.

**Independent Test**: A story opens Code beside the canvas, selects an object, and checks that
its source is highlighted without taking focus.

**Acceptance Scenarios**:

1. **Given** a `tikzpicture`, **When** the user opens View, **Then** it offers Canvas, Code, and Render, and not Quiver.
2. **Given** a `tikzcd`, **When** the user opens View, **Then** it offers Quiver, Code, and Render.

---

### User Story 6 - Organize with layers and properties (Priority: set by the user)

The user opens Layers from the document bar, adds a layer, moves objects into it, hides it, and
opens Properties for a selection.

**Acceptance Scenarios**:

1. **Given** Layers is open, **When** the user taps Properties, **Then** Layers closes and Properties opens; each is its own panel.
2. **Given** Layers is open, **When** the user taps the Layers button again, **Then** Layers closes.

---

### User Story 7 - Export and reuse (Priority: set by the user)

The user exports PDF, SVG, or PNG, or copies the TikZ into a paper.

**Acceptance Scenarios**:

1. **Given** a figure, **When** the user chooses Share and Export › PDF, **Then** a compiled PDF is written and the source is unchanged.

### Edge Cases

- An empty untitled figure has no content to fit (see FR-041).
- The system appearance changes while the editor runs: the editor follows it.

## Requirements *(mandatory)*

### Functional Requirements

**Document bar** (prior art: GoodNotes navigation bar; HIG popovers, toolbars, dark mode)

- **FR-001**: The document bar MUST hold, in this order, the title with save state and title menu; Undo and Redo; View, Layers, Share and Export, and More, as symbols.
- **FR-002**: Every menu or popover MUST open anchored to the button that opened it.
- **FR-003**: A second tap on the button of an open menu, popover, or panel MUST close it; a tap on another button MUST close the open one and open its own.
- **FR-004**: At most one popover MUST be open at a time.
- **FR-005**: The editor MUST follow the system light or dark appearance and MUST NOT offer its own appearance control.
- **FR-006**: The save state MUST be a short status beside the title ("Saved", "Not saved", a conflict) and MUST agree with the disk.

**Drawing toolbar and tool menus** (prior art: GoodNotes toolbar, Active Tool Menu, colour presets; HIG toolbars, buttons)

- **FR-007**: The drawing toolbar MUST hold Lasso first, then the drawing tools, then the active tool's colour presets with a + slot, and nothing else.
- **FR-008**: Each toolbar item MUST be a recognizable symbol with a 44 × 44 pt hit region; the lasso symbol MUST be a freeform loop, as Lucide `lasso` in the Lucide icon theme of Xournal++.
- **FR-009**: A second tap on the active tool MUST open its Active Tool Menu; a further tap MUST close it.
- **FR-010**: The toolbar MUST move only by its grip and MUST dock to any screen edge.
- **FR-011**: Layers, Properties, and Settings MUST NOT appear on the drawing toolbar.
- **FR-012**: Undo and Redo MUST appear only in the document bar and as keyboard shortcuts.

**Views and document kinds** (prior art: Quiver fork boundary; HIG split views)

- **FR-013**: The document kind MUST decide the editor: a `tikzpicture` opens in the canvas, a `tikzcd` in Quiver.
- **FR-014**: View MUST offer the document's editor, Code, and Render, and MUST NOT offer the other kind's editor.
- **FR-015**: In a wide window View MUST allow two views side by side; in a narrow window one view at a time, keeping selection, viewport, tool, and undo history.
- **FR-016**: No view MUST show an explanation of why another view is unavailable.

**Colour, snapping, and tool options** (prior art: GoodNotes colour presets; Ipe snapping; HIG colour wells)

- **FR-020**: Each drawing tool MUST keep its own colour presets, up to 12, shown in the toolbar.
- **FR-021**: A tap on a preset MUST set the active tool's colour and, when a selection exists, the selection's colour; no word names the target.
- **FR-022**: A second tap on the active preset MUST open its colour options: the palette, a colour wheel, a hex code, and opacity (opacity from COMPLAINTS.md, the colour item); editing, adding, removing, and reordering presets happen there.
- **FR-023**: Snap MUST be a canvas control that turns snapping off and on and opens its rules: lattice, objects, alignment, angle.
- **FR-024**: Before a point is placed, a marker MUST show the snap target.
- **FR-025**: Tool options (width, style, smoothing) MUST live in the Active Tool Menu and apply to strokes as they are drawn.
- **FR-026**: A stroke held still at its end MUST become a line, rectangle, circle, or ellipse; Undo MUST return the stroke.
- **FR-027**: Simplify and Restore Original Stroke MUST be object-menu commands on a selected curve.

**Construction** (prior art: Ipe preview and secondary cursor)

- **FR-030**: A construction MUST show its stage by the placed points, the provisional geometry through the pen position, and the snap marker.
- **FR-031**: No construction MUST show an instruction sentence.
- **FR-032**: Cancel and Finish MUST appear in the Active Tool Menu while a construction is in progress.
- **FR-033**: Choosing another tool MUST discard only the provisional construction.

**Zoom and coordinates** (prior art: Inkscape zoom field and rulers; constitution Principle VI)

- **FR-040**: A figure with content MUST open fitted to its content and reopen at its last view.
- **FR-041**: An empty figure MUST open at [NEEDS CLARIFICATION: the launch view of an empty figure and the meaning of the zoom percentage — see Question 1].
- **FR-042**: Rulers, readouts, and fields MUST show figure coordinates; the origin and axes MUST be visible on the grid.
- **FR-043**: Zooming MUST NOT change the source or the selection.

**Selection and objects** (prior art: GoodNotes object menu, lock objects; HIG context menus)

- **FR-050**: A selection MUST be highlighted and MUST show the object menu above it at once.
- **FR-051**: The object menu MUST hold only commands that apply to the selection, with a More item for secondary commands.
- **FR-052**: A locked selection MUST survive a tap that misses.
- **FR-053**: Edit Points MUST show the curve's points with the rest of the figure dimmed and locked. (interaction model, Editing points)

**Panels and settings** (prior art: GoodNotes Layers panel and More menu; HIG sheets, settings)

- **FR-060**: Layers and Properties MUST be separate panels, each opened by its own document-level control.
- **FR-061**: A panel MUST open at the side in landscape and as a sheet in portrait, and MUST leave the selected object visible.
- **FR-062**: Settings MUST open from More and MUST hold canvas settings, colour collections, and keyboard shortcuts; a changed setting shows its own reset.

**Text in the interface** (prior art: HIG offering help)

- **FR-070**: No surface MUST show persistent instructional text or a tooltip that explains a standard control.

### Key Entities

- **Document**: one TikZ file; its kind is `tikzpicture` or `tikzcd`; its source is the only document state.
- **Figure**: the drawing that the source describes; its coordinates are TikZ coordinates.
- **View**: a presentation of the document (editor, Code, Render); not document state.
- **Tool**: the active drawing tool with its options and colour presets.
- **Selection**: the selected objects, with a lock state; session state.
- **Layer**: a named top-level TikZ `scope`; saved in the source.
- **Preference**: a lasting setting in the user's configuration, outside the document.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the running app, none of the twelve observations in the [audit](audit.md) occurs.
- **SC-002**: Each control appears on exactly one surface of the information architecture; a check of every surface finds zero controls of another scope.
- **SC-003**: In every state reached by the browser stories, zero instruction sentences are visible.
- **SC-004**: Every command can be reached with the pen alone, with no hover, right-click, or modifier key.
- **SC-005**: A figure with content opens with all its content visible, filling the canvas up to the fit margin in the dimension that limits it.
- **SC-006**: Each rule in the specifications under `specs/` cites a source; a review finds zero rules without one.

## Assumptions

- A `tikzcd` document keeps Quiver's own controls inside the Quiver view; the drawing toolbar
  applies to the canvas only (Quiver fork boundary, `vendor/quiver/README-ZETTLR.md`).
- The standalone app has no document library, so the document bar has no Back control; a host
  that has a library supplies its own.
- The per-surface specifications under [docs/prior-art](../../docs/prior-art/) and the
  interaction model remain the detailed rules where they agree with this specification and the
  constitution; where they disagree, they are corrected.
- The renderer failure on zoom (#18) is defect work outside this specification.
