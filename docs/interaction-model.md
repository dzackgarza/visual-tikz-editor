# Interaction model

This document defines the single interaction model that slices 1–4 of [HANDOFF.md](../HANDOFF.md) implement. The [ideal GUI](guidance/ideal-gui.md), the [mockup warnings](guidance/mockup-interpretation-warnings.md), and the user decisions recorded in HANDOFF.md settle each rule below. Authored TikZ stays the only document state; every rule here describes editor session state around it.

## Session state

At any moment the editor is in exactly one session state. Each state names what the next pen contact does.

| State | Entered by | Next pen contact | Leaves by |
| --- | --- | --- | --- |
| Drawing | Choosing Pen, Eraser, or Label | Makes a mark at once. A stroke that starts on an existing point attaches to it ([pen policy](research/pen-input-on-existing-points.md)). | Choosing another tool |
| Constructing | Choosing a geometry variant | Places the next construction point. The picker closes; the dock shows the variant name and the instruction for the current stage, for example "Arc through three points — place the second point". | Finish, Cancel, the last point, or another tool. Cancel removes only the provisional construction. |
| Selecting | Choosing Select | Selects, lassoes, or moves the selection | Choosing a drawing or construction tool |
| Editing points | Edit points on a selected curve | Moves the touched node or handle. "N points selected" shows the scope. | Done, Escape, or selecting another object |
| Refining | Refine after a stroke, or Simplify on a selected curve | Ignored on the canvas outside the refinement surface | Accept, Cancel, or Restore original |

A finger held by the other hand is the move modifier in every state: while it is down, a pen drag on a point moves that point. A pen held still on a point past a configurable delay does the same. Fingers otherwise pan and zoom.

## Scope of a change

Every control that changes appearance or geometry names one scope:

- **Selected curve** (or the object type) changes the existing object only.
- **New strokes** changes what the active tool draws next, for this session.
- **Save as default** stores a lasting preference.

A slider in a refinement or properties surface never writes new-stroke settings or defaults.

## Commit, cancel, and undo

- One gesture is one undo step: a stroke with its attachments, a point move with every attached object it updates, a finished construction.
- An automatic fit is its own undo step after the recorded stroke. One Undo returns to the original stroke.
- Drawing again, changing tools, and Undo keep an accepted result. Only Restore original or Cancel inside an open refinement reverts it.
- Leaving Constructing by another tool discards only the provisional construction; finished geometry is already committed.

## Snapping

Object features win over alignment guides, which win over the lattice: endpoints, intersections, and centers first. Angle snapping then constrains direction. The guide names the chosen target before commit. The lattice controls geometry; grid appearance is a separate view setting.

## Space

- The canvas owns the screen. At rest only the top bar, the dock, and the snap control are visible.
- The dock sits at the lower edge by default and docks to either side; its order is fixed.
- Landscape opens detailed editing in a side panel. Portrait opens a shallow bottom sheet that can expand.
- Refinement uses a reserved edge area that never covers the curve being refined.
- When a panel, sheet, or keyboard opens, the canvas moves so the selected subject stays visible.
- The storage status ("Saved", "Unsaved changes") is always visible in the top bar.

## Release scope

Partial erasing, autosave with interruption recovery, PDF/SVG/PNG export, attached relationships (arrows and labels follow their targets), reusable styles, and Pencil hardware gestures are release requirements.
