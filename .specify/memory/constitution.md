# Visual TikZ Editor Constitution

## Core Principles

### I. Authored TikZ Is the Document

The file on disk is the only document state. It MUST hold plain TikZ that compiles with LaTeX
and stays editable in a text editor. The canvas, the Code view, Quiver, and the TeX render are
views of that one source. An edit MUST leave every construct it does not touch byte for byte as
authored. Session state (selection, locks, view, tool) MUST NOT write itself into the source
unless the user saves it as TikZ.

Sources: [README](../../README.md) (first paragraph); `vendor/quiver/README-ZETTLR.md` (the
`tikzcd` environment is the source of truth); [HANDOFF](../../HANDOFF.md) item A.

### II. Pen and Touch First

The editor is a tablet application for a pen and fingers. Mouse and keyboard are secondary
inputs that MUST reach the same commands. Each control MUST meet the platform's minimum touch-target size.
Each command MUST be reachable by pen or touch alone, without a hover, a right-click, or a
modifier key. Where iPadOS and desktop conventions differ, the iPadOS convention applies.

Sources: [README](../../README.md) (second paragraph); [COMPLAINTS.md](../../COMPLAINTS.md)
(the items on a computer-first interface, on top menus for touch, and on modifier keys).

### III. Established Conventions, Cited

Every user-visible behaviour MUST follow a named application that users of this kind of
editor already know: iPad notebook applications (GoodNotes, Noteful, Apple Notes and Markup)
for pen, colour, selection, and document controls; vector and diagram editors (Ipe, Inkscape)
for construction, snapping, layers, and transforms; TikZ itself for coordinates and source.
Each rule MUST cite its source: a document, a screenshot, or source code at a pinned revision.
A rule with no source is a defect. A departure from the cited convention MUST state its reason
in the same place. A behaviour that no source and no reason supports MUST NOT be built.

Sources: [COMPLAINTS.md](../../COMPLAINTS.md) (the items that compare the editor with
GoodNotes, Noteful, Ipe, Inkscape, and Photoshop); the user's corrections that every issue
and every rule rest on researched prior art, recorded in the issue template's Prior art
section and in [docs/prior-art](../../docs/prior-art/).

### IV. The Canvas Has the Attention

The diagram MUST stay visible and unobstructed in every layout and every state. The interface
MUST NOT teach: no instructional sentences, no help text beside controls, no explanation of
why a control is unavailable. A control that does not apply to the present state MUST be
absent, not dimmed. Commands MUST appear in the context they apply to (the selection, the
active tool, the document) and not in a permanent menu of their own.

Sources: [COMPLAINTS.md](../../COMPLAINTS.md) (the items on contextual disclosure, on dimmed
options as noise, on the Help menu, on the Path, Insert, and Edit menus); the user's report
of 2026-11-12 (instructional text at each step, help text on the eraser, a long explanation
of why Quiver is unavailable).

### V. One Scope per Surface

Each surface MUST hold controls of one scope only: the drawing dock holds drawing tools,
colour, and snapping; a panel holds one subject; the menu bar holds document commands. Each
control MUST have one meaning, and each meaning MUST have one control. A button that opens a
menu, popover, or panel MUST anchor it to itself and MUST close it on a second press. One
popover MUST be open at a time. Icons MUST replace words where the convention of Principle III
uses an icon.

Sources: the user's report of 2026-11-12 (a Layers button in the drawing toolbar, Properties
and Layers in one popup, menus that are not attached to their buttons, buttons that open but
do not close, Settings as a word, a rectangle as the lasso icon);
[COMPLAINTS.md](../../COMPLAINTS.md) (the colour and toolbar items).

### VI. One Coordinate System

Positions, snapping, tolerances, and every displayed coordinate MUST be in the figure's TikZ
coordinates: the numbers that appear in the source, on the integer lattice that the grid shows.
The origin and the axes MUST be visible on the grid. A physical unit MUST appear only where a
physical size is the subject, such as the printed size of the figure or of one lattice step.
Screen pixels MUST NOT appear in the interface.

Sources: [COMPLAINTS.md](../../COMPLAINTS.md) (the items on centimetre overlays, on pixels in
"Fit strength", on sub-grid snapping, on the lock-to-grid toggle, and on the origin and axes);
issue [#54](https://github.com/dzackgarza/visual-tikz-editor/issues/54).

### VII. Design Before Implementation

The product design specification under `specs/` owns the editor's users, workflows, and
information architecture. Interface work MUST start from it: a new surface, control, or
behaviour MUST first have a place in that specification. A defect report is evidence about the
design. Its repair MUST first state which design decision produced it and which other
surfaces share that decision. Ideation, the assistant responses under
[docs/guidance](../../docs/guidance/), and generated mockups under `visual-mockup-examples/`
are evidence about intent. Their phrases MUST NOT become controls, labels, or rules without a
place in the specification and a source under Principle III.

Sources: the user's direction of 2026-11-12 and 2026-11-13 that the reports call for an audit
of the design and a design specification made with Spec Kit;
[docs/guidance/README.md](../../docs/guidance/README.md) (the documents are verbatim
assistant responses); [COMPLAINTS.md](../../COMPLAINTS.md) (the audit that found suggestions
implemented literally without one interaction model).

### VIII. Behaviour Is Proven on the Real Page

A user-visible behaviour is accepted only by a browser story that drives the running page with
pen, touch, and mouse events, in portrait and in landscape, and asserts what the user sees or
what the source holds. A defect MUST get a failing story through the reported workflow,
committed before its repair. A story that asserts a replaced rule MUST be rewritten in the
change that replaces the rule.

Sources: [docs/development.md](../../docs/development.md) (Writing a browser story);
[HANDOFF](../../HANDOFF.md) (Next work, item 1).

## Architecture and Boundaries

- The `tikzpicture` canvas is the pinned TikZ Editor fork; `tikzcd` diagrams use the pinned
  Quiver fork. Each fork owns the interaction inside it. Fork changes MUST be made in the fork
  checkout and carried by the maintained patch (`just tikz-editor-patch`,
  `just update-tikz-editor-vendor`). Code under `vendor/` MUST NOT be edited in place.
- A document kind opens only in the editor that can hold it. A `tikzpicture` MUST NOT offer
  Quiver.
- The host interface (`src/host.ts`, [docs/embedding.md](../../docs/embedding.md)) is typed
  and versioned. Embedding hosts reach the editor only through it.
- The editor serves its page on `127.0.0.1` and makes no requests to other hosts.
- No fallbacks, compatibility shims, or migrations. An unsupported state MUST fail loudly.
- Tooling uses Bun and uv.

## Development Workflow

- Work follows Spec Kit: specify, clarify, plan, tasks, implement. Each plan MUST pass the
  Constitution Check against Principles I–VIII before research and again after design.
- An interface issue MUST carry its Prior art section and name the specification items it
  implements.
- The user reports needs and defects as an end user and sets the priority of repairs. The
  maintainer MUST NOT rank repairs for the user.
- The commit hooks run the syntax checks. The Development diagnostics workflow
  (`.github/workflows/development.yml`) is the qualification record of a revision. Each green
  head that changes the product gets a release.

## Governance

This constitution takes precedence over the interaction model, the prior-art specifications,
the user guide, and the product guidance. Where one of them disagrees with a principle, that
document is the defect and MUST be corrected.

An amendment MUST cite its source: a user statement recorded in the repository or an issue, or
a repository fact. Versions follow semantic versioning: MAJOR for a removed or redefined
principle, MINOR for a new principle or section, PATCH for wording. Each specification and
plan MUST record its compliance with the version in force.

**Version**: 1.0.0 | **Ratified**: 2026-11-13 | **Last Amended**: 2026-11-13
