# Feature Specification: Product design of the Visual TikZ Editor

**Feature Branch**: `main`

**Created**: 2026-11-13

**Status**: Draft. The user has decided FR-005, FR-006a, FR-012a, FR-012b, FR-015, FR-017 (the Figures panel), FR-034, FR-041, FR-044, FR-054, FR-060a, FR-063, FR-064 (the editor is standalone), and FR-065 (2026-11-13), and FR-062 (2026-11-14). The user decided the input setup on 2026-11-20 (Clarifications). Every other requirement is the
maintainer's proposal from the cited prior art and waits for the user's review.

**Input**: The user's usability report of 2026-11-12 and the direction to audit what it implies
about the app's design and to write a design specification. The audit is
[audit.md](audit.md). This specification states the editor's users, workflows, and information
architecture. It follows the [constitution](../../.specify/memory/constitution.md), version 3.0.0.

## Users and purpose

The user is a research mathematician who draws diagrams for papers and notes on a tablet with a
pen and fingers, and sometimes at a desktop with a mouse and keyboard. A diagram is one
`tikzpicture` or one `tikzcd` figure in a `.tikz` or `.tikzcd` file that a LaTeX document
includes. The user knows iPad notebook applications (GoodNotes, Notability, Noteful, Apple Notes) and
figure editors (Ipe, Inkscape, Quiver), and expects the editor to behave like them. The editor
is a standalone application: a desktop window or a local page. No other application embeds it.

## Information architecture

The editor has these surfaces. Each control appears on exactly one of them.

| Surface | Holds | Prior art |
| --- | --- | --- |
| Document bar (top) | Leading: document title with its save state; a tap on the title opens the document commands (New, Open, Save, Save As). Centre: Undo, Redo. Trailing: View, Code, Layers, Properties, Share and Export, More (⋯) | GoodNotes navigation bar (left, middle, right sections; Share and Export and More at the right; Undo and Redo in the bar); HIG The menu bar (File menu contents, recorded in docs/prior-art/shell.md); the 2026-10-16 mockups |
| Drawing toolbar (movable, docks to a screen edge) | Lasso first, then Pen, Eraser, Shapes and constructions, Text and Equation, Fill; then the active tool's colour presets and a + slot | GoodNotes toolbar (Lasso first and fixed; tools; floating menus dock to any edge); GoodNotes colour presets per tool |
| Active tool menu (beside the toolbar) | The options of the active tool: width, style, smoothing, the construction variant | GoodNotes Active Tool Menu |
| Object menu (above the selection) | Only the commands that apply to the selection | GoodNotes Universal Object Menu; HIG context menus |
| Canvas controls (canvas corners) | Zoom readout with zoom in and out; Snap with its rules | 2026-10-16 mockups; Inkscape status-bar zoom field; Ipe Snap toolbar |
| Status line (under the canvas) | The pointer position in figure coordinates | Inkscape status bar (cursor coordinates); Ipe mouse coordinates at the bottom right |
| Panels (side panel in landscape, sheet in portrait) | Code; Layers; Properties; one at a time | GoodNotes Layers panel; Inkscape XML Editor, a docked dialog beside the canvas; HIG sheets and popovers |
| More (⋯) menu | Settings (appearance, canvas, colour collections, keyboard shortcuts) | GoodNotes More menu (Document Editing, toolbar customization) |

## Clarifications

### Session 2026-11-13

- Q: Is the Lasso the only selection tool? → A: There is one selection tool. Its Active Tool Menu offers the selection shapes Freehand, Rectangle, and Oval. A tap selects one object, a drag from empty canvas draws the shape, and a drag on the selection moves it.
- Q: Does the editor show the same document bar inside Zettlr or Math Notes? → A: No application embeds the editor. It is standalone and XDG-compliant.
- Q: Which history does Undo act on? → A: All views show the same document, so there is one document history; a history per view is incoherent.
- Q: Does the editor have a status line, and what does it show? → A: A status line shows the pointer position in figure coordinates only.
- Q: In a wide window, are two views shown side by side? → A: No. Code is a panel beside the canvas or Quiver, like Layers and Properties; Render stays a full view.
- Q: What does Properties show when nothing is selected? → A: The figure's properties; Properties is the one place for them.
- Q: During a construction in progress, what does Undo do? → A: Undo removes the last placed point; with no point left, the construction ends. Undo acts on the document history only when no construction is in progress.
- Q: When does the editor write a file to disk? → A: Each accepted edit writes a named file at once, as GoodNotes and Notability do. An Untitled document keeps a draft in the XDG state directory until Save As gives it a path. Save writes at once.
- Q: How does the editor treat a file with more than one figure? → A: It edits one figure at a time; a Figures panel with thumbnails picks the figure, and the other figures stay byte for byte.
- Q: Where does Render get the LaTeX preamble and macros? → A: From the pandoc template `~/.pandoc/templates/standalone-tikz.tex`, the one source of packages and macros; a missing template is an error that names the path.
- Q: After Undo or Redo, what is selected on the canvas? → A: The objects that the step changed; nothing when the step removed them.

### Session 2026-11-14

- Q: Which Settings window does More › Settings… open? → A: The canvas editor's Settings window, extended with Appearance. For a tikzcd document it opens over Quiver. Its Canvas, Colours, and Keyboard shortcuts pages apply to tikzpicture documents only.

### Session 2026-11-20

- Q: Which setup does the editor serve? → A: A touch screen with a pen, as in a notebook application. A mouse or touchpad and a keyboard are optional: each command has its route by pen and touch (constitution Principle II, SC-004), and a requirement is stated for the person who works that way.

## User Scenarios & Testing *(mandatory)*

Each priority follows from the dependencies between the stories and from the user's reports (constitution, Development Workflow); each story states its evidence. A story needs only the stories of higher priority.

### User Story 1 - Draw a figure by pen (Priority: P1)

The user opens the editor, draws strokes with the pen, erases by sweeping, lassoes and moves
marks, and undoes mistakes, without reading any text.

**Why this priority**: Every other canvas story uses its toolbar, Lasso, Active Tool Menu, and
Undo, and it needs no other story. The eraser is the first item of COMPLAINTS.md, the toolbar
items follow it, and four rows of the [audit](audit.md) are about the drawing dock. The pen makes
its mark at once (Principle II).

**Independent Test**: A story with pen events draws three strokes, erases one by sweeping,
lassoes the other two, moves them, and undoes the move.

**Acceptance Scenarios**:

1. **Given** a new `tikzpicture`, **When** the pen touches the canvas, **Then** a mark appears at once and the source gains a path.
2. **Given** the Eraser, **When** the pen sweeps across two strokes, **Then** both lose the crossed parts in one undo step.
3. **Given** the drawing toolbar, **When** the user looks at it, **Then** it shows only Lasso, the drawing tools, and the active tool's colours, all as symbols.
4. **Given** the Pen's Active Tool Menu is open, **When** the user taps the Pen again, **Then** it closes; **When** it is open and the user taps View, **Then** it closes and View opens (FR-003, FR-004).

---

### User Story 2 - Open, save, and reopen a TikZ file (Priority: P5)

The user opens a `.tikz` file, edits it, and finds the file on disk changed only where edited.

**Why this priority**: Authored TikZ is the document (Principle I), and Layers (layer state on
reopen) and Export (an unchanged source) need this story. Its test needs an edit from User Story 1
or 3. The user's reports about files are few, and the file round trip already holds except the
save conflict ([HANDOFF](../../HANDOFF.md), item A).

**Independent Test**: A story opens a file with unsupported constructs, moves one point, and
compares the file byte for byte outside the edited statement.

**Acceptance Scenarios**:

1. **Given** a saved file, **When** an edit is accepted, **Then** the file is written and the title shows the saved state (FR-006a).
2. **Given** an Untitled document, **When** an edit is accepted, **Then** no file outside `$XDG_STATE_HOME/visual-tikz-editor/` is written, and after Save As the chosen path holds the source.
3. **Given** a file changed on disk, **When** the editor next saves, **Then** it stops, keeps the edit as a recovery draft, and shows the conflict in the document bar.

---

### User Story 3 - Edit a selected object (Priority: P2)

The user taps or lassoes an object; the object is highlighted and its object menu appears above
it with only the commands that apply. The user edits points, changes colour, locks the
selection, duplicates, and transforms.

**Why this priority**: It needs the objects and the Lasso of User Story 1, and a figure file opens
as the quickstart runs it. The selection and point-editing items are the longest and earliest
group in COMPLAINTS.md.

**Independent Test**: A story selects a curve, a circle, and two objects in turn and compares
each object menu with the commands that apply to that selection.

**Acceptance Scenarios**:

1. **Given** a selected curve, **When** the object menu appears, **Then** it holds no unavailable command.
2. **Given** a selection, **When** the user taps a colour preset, **Then** the selection takes the colour and no word names the target.

---

### User Story 4 - Construct exact geometry (Priority: P3)

The user chooses a construction (for example an arc through three points), places its points
with snapping, and sees the stage of the construction by its preview and markers.

**Why this priority**: It needs the Shapes tool and the Active Tool Menu of User Story 1 and the
Snap controls, not a selection. COMPLAINTS.md has six items on construction and snapping, and the
audit row "The app teaches at every step" is about it. It follows User Story 3 because the
selection items come first and are more in the user's reports.

**Independent Test**: A story chooses each construction, places its points on lattice points,
and checks the emitted TikZ; at no stage does a sentence appear.

**Acceptance Scenarios**:

1. **Given** the arc-through-three-points construction, **When** two points are placed, **Then** the canvas shows the placed points, the provisional arc through the pen position, and the snap marker, and no instruction text.
2. **Given** a construction in progress, **When** the user chooses another tool, **Then** only the provisional construction is discarded.
3. **Given** the arc-through-three-points construction with two points placed, **When** the user taps Undo, **Then** only the second point is removed, the source does not change, and a second Undo ends the construction (FR-034).

---

### User Story 5 - See the source and the compiled figure (Priority: P6)

The user opens the Code panel beside the editor that the document kind uses, or the TeX render
instead of it.

**Why this priority**: The Code panel highlights the source of the selection, so it needs User
Story 3. The user's reports include the source view and Quiver offered for a `tikzpicture`.

**Independent Test**: A story opens Code beside the canvas, selects an object, and checks that
its source is highlighted without taking focus.

**Acceptance Scenarios**:

1. **Given** a `tikzpicture`, **When** the user opens View, **Then** it offers Canvas and Render, and not Quiver.
2. **Given** a `tikzcd`, **When** the user opens View, **Then** it offers Quiver and Render.
3. **Given** the canvas or Quiver, **When** the user taps Code, **Then** the Code panel opens beside it and an edit in either shows at once in the other; a second tap closes it.

---

### User Story 6 - Organize with layers and properties (Priority: P7)

The user opens Layers from the document bar, adds a layer, moves objects into it, hides it, and
opens Properties for a selection.

**Why this priority**: It needs a selection (User Story 3) and a reopen that keeps layer
visibility and lock (User Story 2). The report that Layers and Properties share one popup is
about it.

**Independent Test**: A story opens Layers, adds a layer, moves an object into it, hides and
locks it, reopens the file, and finds the layer hidden and locked with only its `scope` in the
source; it then opens Properties with and without a selection.

**Acceptance Scenarios**:

1. **Given** Layers is open, **When** the user taps Properties, **Then** Layers closes and Properties opens; each is its own panel.
2. **Given** Layers is open, **When** the user taps the Layers button again, **Then** Layers closes.
3. **Given** nothing is selected, **When** the user opens Properties, **Then** it shows the figure's properties; **When** the user then selects an object, **Then** it shows the object's properties.

---

### User Story 7 - Export and reuse (Priority: P8)

The user exports PDF, SVG, or PNG, or copies the TikZ into a paper.

**Why this priority**: It needs a saved source (User Story 2) and the compile path. No item of
COMPLAINTS.md is about export; the audit's only export row is the unattached Export menu.

**Independent Test**: A story exports a PDF, copies the TikZ, and compares the source and the
clipboard with the authored file byte for byte.

**Acceptance Scenarios**:

1. **Given** a figure, **When** the user chooses Share and Export › PDF, **Then** a compiled PDF is written and the source is unchanged.
2. **Given** a figure, **When** the user chooses Share and Export › Copy TikZ, **Then** the clipboard holds the source as authored.

---

### User Story 8 - Navigate the figure (Priority: P4)

The user opens a figure and sees all of it, zooms by pinch or by the zoom readout, sees the origin
and the axes on the grid, and reads the pen position in figure coordinates.

**Why this priority**: It needs only the canvas of User Story 1. The user's reports include the
15 % default zoom (audit), the small startup window, centimetre coordinates, and the missing
origin and axes (COMPLAINTS.md). It precedes User Story 2 because those reports are more.

**Independent Test**: A story opens a figure with content and checks that all of it is visible
with the fit margin, chooses Normal Size and checks that 1 cm of the figure is 1 cm at the CSS
reference, and holds the pen over a lattice point and reads the status line.

**Acceptance Scenarios**:

1. **Given** a figure with content, **When** it opens, **Then** all its content is visible, fitted (FR-040).
2. **Given** an empty figure, **When** it opens, **Then** it is at 100 % with the origin centred and the axes visible (FR-041, FR-042).
3. **Given** the pen over the lattice point (1, 2), **When** the user looks at the status line, **Then** it reads 1 and 2 (FR-044).

### Edge Cases

- A colour of the figure is close to the canvas colour: the figure's colours are the author's, and the contrast rules cover the interface only (FR-082).
- An empty untitled figure has no content to fit (see FR-041).
- A file holds a `tikzpicture` and a `tikzcd`: each figure opens in the editor of its own kind (FR-013, FR-017).
- The system appearance changes while the editor runs: with the default appearance, the editor follows it (FR-005).

## Requirements *(mandatory)*

### Functional Requirements

**Document bar** (prior art: GoodNotes navigation bar; HIG popovers, toolbars, dark mode)

- **FR-001**: The document bar MUST hold, in this order, the title with save state and title menu; Undo and Redo; View, Code, Layers, Properties, Share and Export, and More, as symbols. HIG Toolbars puts "buttons that open nearby inspectors" at the trailing edge.
- **FR-002**: Every menu or popover MUST open anchored to the button that opened it.
- **FR-003**: A second tap on the button of an open menu, popover, or panel MUST close it; a tap on another button MUST close the open one and open its own.
- **FR-004**: At most one popover MUST be open at a time.
- **FR-005**: The appearance MUST NOT be a control of the document bar or the drawing toolbar. Settings › Appearance MUST hold Match System Appearance, on by default, and a Light or Dark choice for when it is off, as Notability Settings does ([research](research.md) R17).
- **FR-006**: The save state MUST be a short status beside the title ("Saved", "Not saved", a conflict) and MUST agree with the disk.
- **FR-006a**: Each accepted edit MUST write a named file at once. An Untitled document MUST keep its source as a draft in `$XDG_STATE_HOME/visual-tikz-editor/` (FR-063) until Save As gives it a path. Save MUST write at once (user decision, 2026-11-13; GoodNotes and Notability autosave).

**Drawing toolbar and tool menus** (prior art: GoodNotes toolbar, Active Tool Menu, colour presets; HIG toolbars, buttons)

- **FR-007**: The drawing toolbar MUST hold Lasso first, then the drawing tools, then the active tool's colour presets with a + slot, and nothing else.
- **FR-008**: Each toolbar item MUST be a recognizable symbol with a 44 × 44 pt hit region; the lasso symbol MUST be a freeform loop, as Lucide `lasso` in the Lucide icon theme of Xournal++.
- **FR-009**: A second tap on the active tool MUST open its Active Tool Menu; a further tap MUST close it.
- **FR-010**: The toolbar MUST move only by its grip and MUST dock to any screen edge.
- **FR-011**: Layers, Properties, and Settings MUST NOT appear on the drawing toolbar.
- **FR-012**: Undo and Redo MUST appear only in the document bar and as keyboard shortcuts.
- **FR-012b**: Undo and Redo MUST act on the one history of the document, whichever view made the edit and whichever view has the focus; after Undo, every view MUST show the restored source (user decision, 2026-11-13; Emacs buffer undo, Inkscape document undo).
- **FR-012a**: The Lasso MUST be the one selection tool. A tap MUST select the object under it; a drag from empty canvas MUST draw the selection shape that the Active Tool Menu sets: Freehand (the default), Rectangle, or Oval; a drag on the selection MUST move it (user decision, 2026-11-13).

**Views and document kinds** (prior art: Quiver fork boundary; Inkscape XML Editor)

- **FR-013**: The document kind MUST decide the editor: a `tikzpicture` opens in the canvas, a `tikzcd` in Quiver.
- **FR-014**: View MUST offer the document's editor and Render, and MUST NOT offer the other kind's editor.
- **FR-015**: Code MUST be a panel, opened by Code in the document bar, beside the canvas or Quiver; an edit in either MUST show at once in the other. Render MUST replace the editor in the window. Switching between the editor and Render MUST keep selection, viewport, and tool (user decision, 2026-11-13; Inkscape XML Editor).
- **FR-016**: No view MUST show an explanation of why another view is unavailable.
- **FR-017**: A file with more than one figure MUST open one figure at a time. A Figures panel MUST show a thumbnail of each figure and MUST open the figure the user taps; View MUST offer Figures for such a file. An edit MUST change only the source of the open figure, and the other figures MUST stay byte for byte (user decision, 2026-11-13; GoodNotes page thumbnails).

**Colour, snapping, and tool options** (prior art: GoodNotes colour presets; Ipe snapping; HIG colour wells)

- **FR-020**: Each drawing tool MUST keep its own colour presets, up to 12, shown in the toolbar.
- **FR-021**: A tap on a preset MUST set the active tool's colour and, when a selection exists, the selection's colour; no word names the target.
- **FR-022**: A second tap on the active preset MUST open its colour options: the palette, a colour wheel, a hex code, opacity (opacity from COMPLAINTS.md, the colour item), and the exact `xcolor` expression, which keeps an authored colour such as `red!50!blue` editable (Principle I); editing, adding, removing, and reordering presets happen there.
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
- **FR-034**: While a construction is in progress, Undo MUST remove only its last placed point, and the construction MUST end when no point remains; Undo MUST act on the document history (FR-012b) only when no construction is in progress (user decision, 2026-11-13; Inkscape Pen tool Backspace, Ipe path drawing).

**Zoom and coordinates** (prior art: Inkscape zoom field and rulers; constitution Principle VI)

- **FR-040**: A figure with content MUST open fitted to its content and reopen at its last view.
- **FR-041**: 100 % MUST be printed size, as Inkscape "Zoom to 1:1" and Xournal++ "Normal Size". An empty figure MUST open at 100 % with the origin centred (user decision, 2026-11-13).
- **FR-042**: Rulers, readouts, and fields MUST show figure coordinates; the origin and axes MUST be visible on the grid.
- **FR-043**: Zooming MUST NOT change the source or the selection.
- **FR-044**: A status line under the canvas MUST show the position of the pen, finger, or mouse cursor in figure coordinates, and nothing else (user decision, 2026-11-13; Inkscape status bar, Ipe mouse coordinates).

**Selection and objects** (prior art: GoodNotes object menu, lock objects; HIG context menus)

- **FR-050**: A selection MUST be highlighted and MUST show the object menu above it at once.
- **FR-051**: The object menu MUST hold only commands that apply to the selection, with a More item for secondary commands.
- **FR-052**: A locked selection MUST survive a tap that misses.
- **FR-053**: Edit Points MUST show the curve's points with the rest of the figure dimmed and locked. (interaction model, Editing points)
- **FR-054**: After Undo or Redo, the selection MUST be the objects that the step changed; a step that leaves none of them in the figure MUST leave nothing selected (user decision, 2026-11-13; Keynote and Pages for iPad).

**Panels and settings** (prior art: GoodNotes Layers panel and More menu; HIG sheets, settings)

- **FR-060**: Code, Layers, Properties, and Figures MUST be separate panels, one open at a time, each opened by its own document-level control.
- **FR-060a**: Properties MUST show the attributes of the selection and, with nothing selected, the attributes of the figure; no other surface MUST hold the figure's attributes (user decision, 2026-11-13; Keynote for iPad Format and Layout).
- **FR-061**: A panel MUST open at the side in landscape and as a sheet in portrait, and MUST leave the selected object visible.
- **FR-062**: Settings MUST open from More and MUST hold appearance, canvas settings, colour collections, and keyboard shortcuts; a changed setting shows its own reset. Settings is the canvas editor's Settings window with an Appearance page added; for a tikzcd document it opens over Quiver. The Canvas, Colours, and Keyboard shortcuts pages apply to tikzpicture documents only (user decision, 2026-11-14).
- **FR-063**: The editor MUST keep its files in the XDG base directories: preferences in `$XDG_CONFIG_HOME`, recovery drafts and per-file view state in `$XDG_STATE_HOME`, and the render cache in `$XDG_CACHE_HOME`, each under `visual-tikz-editor/` ([XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/); user decision, 2026-11-13).
- **FR-064**: The editor MUST be a standalone application, and no other application MUST embed it (user decision, 2026-11-13).
- **FR-065**: Render MUST compile each figure through the pandoc template `~/.pandoc/templates/standalone-tikz.tex`, the one source of packages and macros, and Quiver MUST take its macros from the same template. When the template is missing, Render MUST show an error that names its path (user decision, 2026-11-13).
- **FR-066**: Each launch of the desktop app MUST write one log in `$XDG_STATE_HOME/visual-tikz-editor/logs/` and keep the ten newest logs. The log MUST hold the output of the app, its file host, and WebKit's processes; each uncaught error, rejected promise, `console.error`, and `console.warn` of every page frame, with the frame; and each end of the web process, with WebKit's reason (#71; the XDG Base Directory Specification places logs in `$XDG_STATE_HOME`; Visual Studio Code keeps one log folder per session).

**Text in the interface** (prior art: HIG offering help)

- **FR-070**: No surface MUST show persistent instructional text or a tooltip that explains a standard control.

**Legibility and pointer input** ([research](research.md) R18)

- **FR-082**: In the light and in the dark appearance, interface text MUST have a contrast ratio of at least 4.5:1 against its background, or 3:1 for text of at least 24 CSS px, or 18.66 CSS px in bold. A symbol, the boundary that identifies a field, the mark of a state, the selection highlight, and the snap marker MUST have at least 3:1 against the colours beside them. A dimmed control that is not available is outside this rule, and so are the colours of the figure, which are the author's (the ratios of WCAG 2.2, 1.4.3 and 1.4.11, which the HIG takes for its own contrast rule).
- **FR-088**: A field that refuses its value (a number, a hex code, an `xcolor` expression, a file name) MUST show, in text beside it, what is wrong (WCAG 2.2, 3.3.1 and 3.3.3). FR-065 already states this for the missing template.
- **FR-092**: A button, a menu item, and a preset MUST act on the release of the pointer, so that a release off the control does nothing. A drawing tool acts on the press, because the stroke starts there, and Undo reverses it (WCAG 2.2, 2.5.2).

### Key Entities

- **Document**: one TikZ file; its kind is `tikzpicture` or `tikzcd`; its source is the only document state.
- **Figure**: the drawing that the source describes; its coordinates are TikZ coordinates.
- **View**: a presentation of the document that fills the window: the editor or Render; the Code panel shows the source beside the editor; not document state.
- **Tool**: the active drawing tool with its options and colour presets.
- **Selection**: the selected objects, with a lock state; session state.
- **Layer**: a named top-level TikZ `scope`; saved in the source.
- **Preference**: a lasting setting in `$XDG_CONFIG_HOME`, outside the document.

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
- The editor has no document library, so the document bar has no Back control.
- The per-surface specifications under [docs/prior-art](../../docs/prior-art/) and the
  interaction model remain the detailed rules where they agree with this specification and the
  constitution; where they disagree, they are corrected.
- The renderer failure on zoom is defect work outside this specification.
