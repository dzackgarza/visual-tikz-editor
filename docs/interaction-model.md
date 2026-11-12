# Interaction model

This document defines the one interaction model of the editor. Each interface rule follows a specification under [prior art](prior-art/), which records the applications, documentation, and screenshots behind it, or follows from TikZ itself. Authored TikZ stays the only document state; every rule here describes editor session state around it. A rule and its specification agree; where they differ, the specification is correct and this document is the defect. The [user guide](user-guide.md) describes the controls as they are built.

| Specification | Surface |
| --- | --- |
| [Drawing dock](prior-art/drawing-dock.md) | Tools, colour, snapping, and the dock's press rules |
| [Panels](prior-art/panels.md) | Properties and Layers |
| [Shell](prior-art/shell.md) | Menu bar, views, theme, title, messages, dialogs |
| [Instructional text](prior-art/instructional-text.md) | Status line, tooltips, option labels, units |
| [Selection and settings](prior-art/selection-and-settings.md) | Selection menu, lock, point editing, freehand options, popovers, settings, shortcuts |
| [Zoom and view](prior-art/zoom-and-view.md) | Meaning of 100 %, launch view, zoom readout, View menu, rulers, Magnifier |

## Session state

At any moment the editor is in exactly one session state. Each state names what the next pen contact does. One [XState](https://stately.ai/docs/xstate) statechart in the fork owns these states; no component keeps a mode of its own.

| State | Entered by | Next pen contact | Leaves by |
| --- | --- | --- | --- |
| Drawing | Choosing Pen, Eraser, or Bucket | Makes a mark at once. A stroke that starts on an existing point attaches to it ([pen policy](research/pen-input-on-existing-points.md)). Pen strokes take the Pen options as they are drawn; a stroke that ends with the pen held still becomes a line, rectangle, circle, or ellipse ([selection specification](prior-art/selection-and-settings.md) items 6–7). | Choosing another tool |
| Constructing | Choosing a construction in the Geometry tool options, or Text | Places the next construction point. The status line states the next step, with the variant name first ([instructional text](prior-art/instructional-text.md) items 2–3). Finish and Cancel stay in the dock ([dock](prior-art/drawing-dock.md) item 10). | Another tool. Cancel removes only the provisional construction; Cancel and the last point keep the tool at its first stage. Finish ends an open path. |
| Selecting | Choosing Select or Lasso | Selects, lassoes, or moves the selection. A tap on a selected object, a long press on the selection, a barrel-button tap, a right-click, or Shift+F10 opens the selection menu ([selection specification](prior-art/selection-and-settings.md) items 1–2). | Choosing a drawing or construction tool |
| Editing points | A double-click or double-tap on a path, or Edit Points | Moves the touched node or handle. The other objects are dimmed and locked; the status line names the point selection ("2 points selected"). | Escape, or a double-tap outside the path ([selection specification](prior-art/selection-and-settings.md) item 5) |

The Magnifier is a view aid, not a state: while View › Show Magnifier is on, a press and drag shows the loupe ([zoom specification](prior-art/zoom-and-view.md) item 5).

A finger held by the other hand is the move modifier in every state: while it is down, a pen drag on a point moves that point. A pen held still on a point past a configurable delay does the same. Fingers otherwise pan and zoom ([pen policy](research/pen-input-on-existing-points.md)).

## Target of a change

A change of colour or another attribute applies to the selection when one exists, and otherwise to the objects drawn next, as in Ipe ([dock](prior-art/drawing-dock.md) item 6, [panels](prior-art/panels.md) items 5–6). With nothing selected, Properties shows the attributes the next object gets. A setting in Settings is a lasting preference; a changed setting shows its own reset control ([selection specification](prior-art/selection-and-settings.md) item 9).

## Commit, cancel, and undo

- One gesture is one undo step: a stroke with its attachments, a point move with every attached object it updates, a finished construction.
- A stroke that became a shape on a hold is one more undo step: Undo returns the freehand stroke, as in Apple Markup.
- Simplify (Ctrl+L) on a selected curve is one undo step and simplifies further on each use. Restore Original Stroke returns a curve to its kept original, which survives reopen.
- Leaving Constructing by another tool discards only the provisional construction; finished geometry is already committed.

## Snapping

Object features win over alignment guides, which win over the lattice: endpoints, corners, intersections, and centres first, as in [Ipe](https://ipe.otfried.org/). Alignment guides come from an object's top, bottom, left, right, and centre. Angle snapping then constrains direction: a line or arrow takes a 15-degree step ("Angle"), a rectangle becomes a square ("Square"), and a move stays on its dominant axis ("Axis"). The same order holds for tool placement, handle drags, and selection moves. A move is written from the source the gesture started from by its whole offset, so a snapped move lands on the snapped coordinate exactly instead of on the sum of rounded steps. A circle or arc by centre takes the radius from the second point. An arc's end keeps the radius: it lands on a lattice point of its ray within reach ("Lattice"), otherwise on the nearest common angle within 8 degrees of a multiple of 45 or 3 degrees of a multiple of 15 ("Angle"), otherwise where the pen is. Reach is a fixed screen distance, so zooming in narrows the world distance a target can pull from, and a target just outside reach yields no target. Before commit, a cross with a label names the chosen target: an object feature by its kind or by the node name and anchor it attaches to, an alignment by its edge, a line or arrow that will carry a label ("On line"), and otherwise "Lattice".

The snap icon in the dock turns snapping on or off; its rules popover lists Lattice, Objects, Alignment, and Angle as named toggles ([dock](prior-art/drawing-dock.md) item 7). The lattice controls geometry; grid appearance is a View menu item. The lattice step is a value in Document Properties. Coordinate fields state TikZ coordinates with no unit word; rulers and other physical lengths are in centimetres ([instructional text](prior-art/instructional-text.md) items 6–7, [zoom specification](prior-art/zoom-and-view.md) item 7).

## Attached relationships

An attachment is an authored TikZ reference, never editor state. A line or arrow end placed on a node is written against the node's name, so the node carries that end when it moves. A label placed on a line or arrow is a node on that segment with its position preset (`midway`, `near start`, `at end`, or `pos=`) and its side (`auto` or `auto=right`), so it follows the path. A stroke that starts or ends on a point is written against the point's name; an unnamed point gains a `coordinate (pN)` or node name first. A named reference follows the point it names, so the pen never moves the reference itself: it lands on the defining point. Moving a node, a path, or a point therefore updates every attached object as one undo step, and the relationships reopen with the file.

## Space

- The window holds the document bar with its menu bar, the canvas with the dock, and the status line under the canvas ([shell](prior-art/shell.md) item 1, [instructional text](prior-art/instructional-text.md) item 2). The document bar has a fixed height; persistent states are banners and single events are toasts ([shell](prior-art/shell.md) item 10).
- The dock sits at the lower edge by default and moves by a drag from its edge to any screen edge ([dock](prior-art/drawing-dock.md) item 9).
- In landscape, Properties and Layers are docked panes at the trailing edge, and the canvas ends where a pane begins. In portrait, each is a nonmodal sheet above the dock with medium and large detents ([panels](prior-art/panels.md) items 2–3). When a pane, sheet, or keyboard opens, the canvas moves so the selected subject stays visible ([complaints](../COMPLAINTS.md), screenshot review items 1–2).
- One anchored popover is open at a time. It sits above or below its anchor, inside the canvas, and closes on a choice, Escape, or a press outside ([selection specification](prior-art/selection-and-settings.md) item 8).
- The document bar keeps the file name and the storage status ("Saved", "Unsaved changes") at every width ([complaints](../COMPLAINTS.md), screenshot review item 4). The window title names the file and marks unsaved changes ([shell](prior-art/shell.md) item 9).
- A figure opens fitted to its drawing; the zoom readout is at the right end of the status line ([zoom specification](prior-art/zoom-and-view.md) items 2–4).

## Decisions

A row without a named owner is a user decision of 2026-10-29.

| Topic | Decision |
| --- | --- |
| Release scope | Partial erasing, autosave with interruption recovery, PDF/SVG/PNG export, attached relationships (arrows and labels follow the nodes and objects they attach to), reusable styles, and Pencil hardware gestures are release requirements. iPadOS Safari delivers no Pencil double tap or squeeze to a web page, so that requirement is a recorded platform limit ([research](research/pencil-hardware-gestures.md)). |
| Snapping precedence | Object features first, as in [Ipe](https://ipe.otfried.org/): endpoints, intersections, and centres beat alignment guides, which beat the lattice. The guide names the chosen target. Angle snapping constrains direction after the point target. |
| Eraser scope (maintainer, 2026-11-12, [dock](prior-art/drawing-dock.md) item 5) | The Eraser options are Partial and Whole stroke, and the size. Partial erasing cuts every drawn path. |
| Hold-to-move delay (maintainer, 2026-11-12) | 450 ms is the default of "Hold to move a point", between the platform long-press defaults of 400 ms (Android `ViewConfiguration.getLongPressTimeout`) and 500 ms (iOS `UILongPressGestureRecognizer.minimumPressDuration`). The setting stays configurable. |
| Session state architecture | One XState statechart in the fork owns the session states above and replaces the independent mode states of the canvas component. |
| Pen input on existing points | The policy follows iPadOS-native interaction patterns that [research](research/pen-input-on-existing-points.md) establishes: a pen stroke that starts on a point draws at once and attaches to it; a held finger modifier or a pen hold past the delay moves the point; a double tap never moves points. |
