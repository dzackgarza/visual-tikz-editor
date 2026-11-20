# Visual TikZ Editor Constitution

Each principle states its rules, then its prior art: the platform guidelines and the comparable
applications it follows, and the repository records that make it a requirement of this product.
A rule that its prior art does not support is a defect in this document.

## The User and the Devices

The editor is bespoke software. It is built for one person, its owner: a research mathematician
who draws diagrams for papers and notes. It is built for that person's devices: a touch screen
with a pen, on Linux now and on an iPad as planned. A mouse or touchpad and a keyboard are
optional; no command depends on them. The design of iOS and iPadOS drives the interface.

- A requirement MUST serve this person on these devices. A requirement whose subject is another
  kind of user, another ability, another input method, or another platform MUST NOT enter a
  specification.
- "Accessible" means easy to reach and to use for this person in this setup. It names no
  conformance to a standard for a range of users.
- A requirement MUST rest on a report by the user or on a failure shown in the running app. A
  standard or a checklist MAY give the measure that makes such a report testable. A criterion of
  a standard is not a reason for a requirement.

Requirement: the user's statements of 2026-11-20, recorded in the Clarifications of the
[product design specification](../../specs/001-product-design/spec.md).

## Core Principles

### I. Authored TikZ Is the Document

The file on disk is the only document state. It MUST hold plain TikZ that compiles with LaTeX
and stays editable in a text editor. The canvas, the Code view, Quiver, and the TeX render are
views of that one source, and every view MUST show the same document. The document has one
history: Undo and Redo act on it whichever view made the edit, and no view keeps a history of its
own. An edit MUST leave every construct it does not touch as authored. Session state (selection,
locks, view, tool) MUST NOT write itself into the source.

Prior art: Quiver's fork keeps the `tikzcd` environment as the source of truth
(`vendor/quiver/README-ZETTLR.md`). Emacs keeps the undo history by buffer, not by window
([GNU Emacs manual, Undo](https://www.gnu.org/software/emacs/manual/html_node/emacs/Undo.html));
Inkscape's XML Editor and canvas record their edits in the document's one undo history
(`src/ui/dialog/xml-tree.cpp` at
[`70feba2`](https://gitlab.com/inkscape/inkscape/-/tree/70feba21364ccbe2d2d2fab397228bc2e0d41b5a)).
Requirement: [README](../../README.md), first paragraph; [HANDOFF](../../HANDOFF.md), item A;
the user's statement of 2026-11-13 that all views show the same document and that a history per
view is incoherent.

### II. Pen and Touch First

The editor is a tablet application. The pen MUST make a mark the moment it touches the canvas
when a drawing tool is active, with no button or mode first. Every control MUST respond to the
pen as well as to a finger, and MUST have a hit region of at least 44 × 44 pt. Every command
MUST be reachable without hover, right-click, or a modifier key; a keyboard and a mouse or touchpad are optional and
reach the same commands. Where iPadOS and desktop conventions differ, the iPadOS convention applies.

Prior art: Apple HIG,
[Apple Pencil and Scribble](https://developer.apple.com/design/human-interface-guidelines/apple-pencil-and-scribble)
("Let people make a mark the moment Apple Pencil touches the screen"; controls respond to
Apple Pencil; "Avoid using hover to initiate an action");
[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) (hit region
of at least 44 × 44 pt);
[Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)
(Multi-Touch, keyboard, trackpad, and Apple Pencil, often combined). Requirement:
[README](../../README.md), second paragraph; [COMPLAINTS.md](../../COMPLAINTS.md), the items
on a computer-first interface, on touch-first top menus, and on modifier keys.

### III. Established Conventions, Cited

Every user-visible behaviour MUST follow a named application that users of this kind of editor
already know, or the platform guidelines: the Apple Human Interface Guidelines for iPadOS;
iPad notebook applications (GoodNotes, Noteful, Apple Notes) for pen, eraser, lasso, colour,
objects, and layers; Ipe, Inkscape, and Xournal++ for construction, snapping, and figure
geometry; TikZ for coordinates and source. Each rule in a specification MUST cite its source:
a document, a screenshot, or source code at a pinned revision. A departure from the cited
convention MUST state its reason in the same place. A behaviour that has neither a source nor a
stated reason MUST NOT be built.

Prior art: the comparable applications named in
[docs/guidance/product-vision.md](../../docs/guidance/product-vision.md) and in
[COMPLAINTS.md](../../COMPLAINTS.md); the captures and sources under
[docs/prior-art](../../docs/prior-art/). Requirement: the user's corrections that every issue
and every rule rest on researched prior art, recorded in the issue template's Prior art
section.

### IV. The Canvas Has the Attention

The diagram MUST stay visible in every layout and every state; a panel or sheet MUST leave the
edited object in view. The interface MUST NOT carry persistent instructional text, MUST NOT
explain a standard control or gesture, and MUST NOT explain why an unavailable view or command
is unavailable. A control that needs a sentence to be understood is a design defect, repaired
in the design. A transient tip is allowed only for a nonstandard feature, only once, and only
to a person who has not used that feature. Commands appear where they apply: an object's menu
holds only the commands that apply to the selection and hides the others; a menu-bar menu keeps
its items and dims the unavailable ones.

Prior art: Apple HIG,
[Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)
("elevate the content people care about, minimizing modal interfaces");
[Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)
("Avoid bloating your help content by explaining how standard components or patterns work";
"If you need a lot of text to describe a control, consider simplifying your interface
design"; tips are short and shown only to people who might benefit);
[Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus)
("Hide unavailable menu items, don't dim them");
[The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)
(disable, do not hide, an unavailable menu-bar item);
[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) (progressive
disclosure). GoodNotes,
[Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface)
(the Universal Object Menu appears above a selection and shows options for what is
selected). Requirement: [COMPLAINTS.md](../../COMPLAINTS.md), the items on contextual
disclosure, dimmed options, and the Help, Path, Insert, and Edit menus; the user's report of
2026-11-12 on instructional text.

### V. One Scope per Surface

The editor has three kinds of surface, each with one scope: the document bar holds document
navigation, views, and Share and Export; the drawing toolbar holds the lasso, the drawing tools,
and the active tool's colours; panels such as Layers and Properties each hold one subject and
open from document-level controls. A control MUST appear on one surface only, with one meaning.
A tool's options open by a second tap on the active tool or colour. A button that opens a menu,
popover, or panel MUST anchor it to itself, and a second tap on the same button MUST close it.
One popover MUST be open at a time, and a tap on another button MUST close the open popover and
open its own. A toolbar item MUST use a recognizable symbol instead of a word, except for an
action that no symbol represents.

Prior art: GoodNotes,
[Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface)
(the navigation bar has a left section for the sidebar, search, and view modes, a middle
section for the Lasso and the tools, and a right section for Add Page, Share and Export, and
More; each tool has an Active Tool Menu);
[Customize the toolbar](https://support.goodnotes.com/hc/en-us/articles/8900755183631-Customize-the-toolbar)
(tap Writing Tools to hide its menu, tap again to show it);
[Add and manage writing-tool color presets](https://support.goodnotes.com/hc/en-us/articles/7353743265039-Add-and-manage-writing-tool-color-presets)
(presets belong to a tool; select the active colour again to open its options);
[Organize content with layers](https://support.goodnotes.com/hc/en-us/articles/16536297803535-Organize-content-with-layers)
(the Layers panel opens from More, not from the writing tools). Apple HIG,
[Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers) ("Show one
popover at a time"; close one popover and open another with a single tap);
[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) ("Prefer
simple, recognizable symbols for items instead of text"; keep text-labelled actions separate
from symbols). Requirement: the user's report of 2026-11-12 (Layers in the drawing toolbar,
Properties and Layers in one popup, menus not attached to their buttons, buttons that open but
do not close, Settings as a word); [COMPLAINTS.md](../../COMPLAINTS.md), the colour and
toolbar items.

### VI. One Coordinate System

Positions, snapping, tolerances, rulers, and every displayed coordinate MUST be in the figure's
TikZ coordinates: the numbers that appear in the source, on the lattice that the grid shows.
The origin and the axes MUST be visible on the grid. A physical unit MUST appear only where a
physical size is the subject: the printed size of the figure or of one lattice step. Screen
pixels MUST NOT appear in the interface. Snapping shows the point it will use before the point
is placed.

Prior art: Inkscape labels its rulers in the document's display unit
([docs/prior-art/zoom-and-view.md](../../docs/prior-art/zoom-and-view.md), Inkscape rows); the
document unit of a TikZ figure is its coordinate unit. Ipe,
manual, [Snapping](https://github.com/otfried/ipe/blob/f4a918b12e68f1f244dd3c7d0e30ecf78ea13a01/manual/40_snapping.rst)
(the secondary cursor marks the position the input snaps to). Requirement: [COMPLAINTS.md](../../COMPLAINTS.md), the items on centimetre
overlays, on pixels in "Fit strength", on sub-grid snapping, on the lock-to-grid toggle, and on
the origin and axes; issue [#54](https://github.com/dzackgarza/visual-tikz-editor/issues/54).

### VII. Design Before Implementation

The product design specification under `specs/` owns the editor's users, workflows, and
information architecture. A new surface, control, or behaviour MUST first have a place in it. A
defect report is evidence about the design: its repair MUST first state which design decision
produced it and which other surfaces share that decision. The assistant responses under
[docs/guidance](../../docs/guidance/) and the generated mockups under `visual-mockup-examples/`
are evidence about intent. Their phrases MUST NOT become controls, labels, or rules without a
place in the specification and a source under Principle III.

Prior art: Spec Kit's spec-driven development, in which the specification is the source from
which the plan, tasks, and code follow ([github/spec-kit](https://github.com/github/spec-kit)).
Requirement: the user's direction of 2026-11-12 and 2026-11-13 that the reports call for an
audit of the design and for a design specification made with Spec Kit;
[docs/guidance/README.md](../../docs/guidance/README.md) (the documents are verbatim assistant
responses); [COMPLAINTS.md](../../COMPLAINTS.md) (the audit that found suggestions implemented
literally without one interaction model).

### VIII. Behaviour Is Proven on the Real Page

A user-visible behaviour is accepted only by a browser story that drives the running page with
pen, touch, and mouse events, in portrait and in landscape, and asserts what the user sees or
what the source holds. A defect MUST get a failing story through the reported workflow,
committed before its repair. A story that asserts a replaced rule MUST be rewritten in the
change that replaces the rule.

Requirement: [docs/development.md](../../docs/development.md), Writing a browser story;
[HANDOFF](../../HANDOFF.md), Next work, item 1.

## Architecture and Boundaries

- The `tikzpicture` canvas is the pinned TikZ Editor fork; `tikzcd` diagrams use the pinned
  Quiver fork. Each fork owns the interaction inside it. Fork changes MUST be made in the fork
  checkout and carried by the maintained patch (`just tikz-editor-patch`,
  `just update-tikz-editor-vendor`). Code under `vendor/` MUST NOT be edited in place.
- A document kind opens only in the editor that can hold it. A `tikzpicture` MUST NOT offer
  Quiver.
- The editor is a standalone application, and no other application embeds it. It keeps its
  files in the XDG base directories
  ([XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/)).
  The shell reaches the canvas and Quiver frames only through the typed and versioned frame
  protocol (`vendor/tikz-editor/embed/src/`). Requirement: the user's statement of 2026-11-13.
- The editor serves its page on `127.0.0.1` and makes no requests to other hosts.
- No fallbacks, compatibility shims, or migrations. An unsupported state MUST fail loudly.
- Tooling uses Bun and uv.

## Development Workflow

- Work follows Spec Kit: specify, clarify, plan, tasks, implement. Each plan MUST pass the
  Constitution Check against Principles I–VIII before research and again after design.
- An interface issue MUST carry its Prior art section and name the specification items it
  implements.
- The user reports needs and defects as an end user. The maintainer MUST derive the order of the
  work from the dependencies between stories and from the user's reports, MUST record the
  evidence with each priority, and MUST NOT ask the user to rank the work. Requirement: the
  user's statement of 2026-11-13 that the story order is an analysis for the maintainer.
- The commit hooks run the syntax checks. The Development diagnostics workflow
  (`.github/workflows/development.yml`) is the qualification record of a revision. Each green
  head that changes the product gets a release.

## Governance

This constitution takes precedence over the interaction model, the prior-art specifications,
the user guide, and the product guidance. Where one of them disagrees with a principle, that
document is the defect and MUST be corrected.

An amendment MUST cite its prior art and its requirement: a user statement recorded in the
repository or an issue, or a repository fact. Versions follow semantic versioning: MAJOR for a
removed or redefined principle, MINOR for a new principle or section, PATCH for wording. Each
specification and plan MUST record its compliance with the version in force.

**Version**: 3.1.0 | **Ratified**: 2026-11-13 (principles I–VIII accepted by the user) | **Last Amended**: 2026-11-20
