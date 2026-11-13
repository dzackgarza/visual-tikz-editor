# Research: Product design of the Visual TikZ Editor

Each entry is the maintainer's proposal for a question that the [specification](spec.md) leaves
open, with the prior art behind it. The user decides each proposal. An entry the user has decided
says so, with the date; no other entry binds the plan.

## R1. Which code owns each surface

**Proposal**: The shell owns the document bar, the views, and the More menu. The TikZ Editor fork
owns every surface inside the canvas: the drawing toolbar, the Active Tool Menu, the colour
options, the object menu, the canvas controls, and the Layers and Properties panels. The Quiver
fork owns the inside of the Quiver view.

**Rationale**: The document bar acts on the document and on every view (Code, Render, the
editor), so it cannot live inside one view. The shell owns the file, the save state, and the
views; each fork owns the interaction inside it (constitution, Architecture and Boundaries). The
shell reaches the fork's panels and commands through the typed host protocol.

**Alternatives considered**: All surfaces in the fork. Rejected: the fork does not see Code,
Render, or Quiver, and the document bar would exist once per editor.

## R2. The document bar in a host

**Proposal**: The document bar is part of the workbench component, so every host gets the same
bar. Its centre (Undo, Redo) and trailing (View, Layers, Properties, Share and Export, More) groups
are always present. The leading group (title, save state, title menu) is a slot that the document
owner fills: the standalone app with the file and its commands, a hosted page with the host's file
name and sync state. A host that shows the document name itself leaves the slot empty.

**Rationale**: draw.io's embed mode keeps the editor's own menus and toolbar inside the host and
lets the host set the title and the Save and Exit buttons
([draw.io embed mode](https://www.drawio.com/doc/faq/embed-mode)). The host owns the document and
its name; the editor owns its commands.

**Alternatives considered**: A More button at the end of the drawing toolbar in a host. Rejected:
it puts document-scope controls on the drawing toolbar (FR-011, Principle V).

## R3. Undo and Redo in every view

**Proposal**: The document bar's Undo and Redo act on the history of the view that last took
input: the canvas, the Code view, or Quiver. Each editor keeps its own history and reports whether
Undo and Redo are available, so the bar dims them. In the Quiver view, Quiver's own toolbar does
not show Undo and Redo, as Quiver in host mode does not show its Save, autosave, theme, and About
actions.

**Rationale**: FR-012 puts Undo and Redo only in the document bar; GoodNotes keeps them in its
navigation bar
([Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface)).
Quiver owns its history (`vendor/quiver/README-ZETTLR.md`); the bar only calls it.

**Alternatives considered**: Quiver's toolbar keeps Undo, and the bar hides its Undo in the Quiver
view. Rejected: the bar would change by view, and Undo would sit on two surfaces.

## R4. Selection with the Lasso

**Proposal**: The Lasso is the selection tool, and there is no separate Select tool. A tap with
the Lasso selects the object under the tap. A drag from empty canvas draws the selection loop
(Freehand, the default) or frame (Rectangle), chosen in the Lasso's Active Tool Menu. A drag that
starts on the selection moves it.

**Rationale**: GoodNotes has no Select tool; its Lasso selects all content, uses freehand
selection by default, and offers a rectangular lasso as a Lasso Type
([Select, Move, and Edit Content With the Lasso Tool](https://support.goodnotes.com/hc/en-us/articles/7353695644175)).
Inkscape's Selector selects an object by a click and draws a selection box by a drag from empty
canvas ([Inkscape manual, Selector tool](https://inkscape-manuals.readthedocs.io/en/latest/selector-tool.html)).
FR-007 starts the toolbar with the Lasso.

**Alternatives considered**: A Select tool beside the Lasso. Rejected: two tools with one scope.

## R5. Tool options

**Proposal**: Each drawing tool keeps its own options and colour presets as preferences (see the
[data model](data-model.md), Tool). The Active Tool Menu opens beside the toolbar on a second tap
on the active tool and holds that tool's options; numeric entry of a circle or arc is a Shapes
option. Cancel and Finish appear in it while a construction runs.

**Rationale**: GoodNotes gives each tool an Active Tool Menu and its own presets
([Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface),
[colour presets](https://support.goodnotes.com/hc/en-us/articles/7353743265039-Add-and-manage-writing-tool-color-presets));
Apple Markup changes the line weight by a tap on the selected tool
([Draw with Markup](https://support.apple.com/guide/ipad/draw-and-handwrite-with-markup-ipad6350b8dc/ipados)).

**Alternatives considered**: One set of options for all tools. Rejected: GoodNotes palettes and
options "do not sync across tools".

## R6. Colour presets and colour options

**Proposal**: Presets are per tool, three by default, at most 12, with a + slot (FR-020). The
colour options open on a second tap on the active preset. They hold the colour collections of
Settings as the palette, a colour wheel, opacity, a hex field, and the exact `xcolor` field. The
wheel, the opacity slider, and the hex field are `@uiw/react-color-wheel`,
`@uiw/react-color-alpha`, and `@uiw/react-color-editable-input` 2.10.3 (MIT).

**Rationale**: GoodNotes: "Each tool shows three color presets by default and supports up to 12
preset slots"; "Select a preset color in the toolbar, then select it again to open its options";
"Choose an existing color, or select Custom to use the palette, color wheel, or a HEX code"
([colour presets](https://support.goodnotes.com/hc/en-us/articles/7353743265039-Add-and-manage-writing-tool-color-presets)).
The `xcolor` field keeps an authored expression such as `red!50!blue` editable, which no picker
shows; without it a colour edit would replace authored TikZ (Principle I).

**Alternatives considered**: `react-colorful`, which has a saturation square and a hue strip but
no wheel; the native colour input, whose picker differs by browser and has no wheel in Chromium.

## R7. Icons

**Proposal**: The fork and the shell use one icon set, Remix Icon 4.9 (`@remixicon/react` in the
fork, `@remixicon/vue` in the shell). The Lasso and Snap symbols are Lucide `lasso` and `magnet`
from `lucide-react` 1.64.0 (ISC). The symbol of each control is in the
[surfaces contract](contracts/surfaces.md).

**Rationale**: FR-008 names Lucide `lasso`; HIG Toolbars: "Prefer simple, recognizable symbols for
items instead of text" ([Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars));
the Inkscape and Xournal++ snap toggles are magnets
([dock specification](../../docs/prior-art/drawing-dock.md), Snapping control).

**Alternatives considered**: Lucide for every control. Rejected: the fork's tool icons are Remix
Icon, and the report gives no reason to change them.

## R8. Zoom, launch view, and the zoom readout

**Proposal**: 100 % is printed size at 96 CSS px per inch. A figure with content opens in Zoom to
Fit with a margin of 44 px; an empty figure opens at 100 % with the origin centred (FR-041). The
zoom readout is a canvas control in the lower trailing corner: zoom out, the percentage, zoom in.
A tap on the percentage opens Zoom to Fit, Zoom to Selection, Normal Size, and 10, 20, 50, 100,
200, 500, and 1000 %. The canvas aids (Grid, Rulers, Guides, Output Bounds) are in View.

**Rationale**: Inkscape "Zoom to 1:1" and Xournal++ "Normal Size" make 100 % the printed size,
and both open a document with its page fitted; Inkscape's zoom menu gives the preset list
([zoom specification](../../docs/prior-art/zoom-and-view.md), items 1, 2, and 4). The 44 px margin
is upstream TikZ Editor's fit margin. The specification puts the readout in a canvas corner and
View in the document bar.

**Alternatives considered**: The readout at the right end of a status line. Rejected: the design
has no status line (R10).

## R9. Rulers in figure coordinates

**Proposal**: Ruler labels are figure coordinates, in the figure's `x` and `y` units. The label
step follows Inkscape's rule for its rulers (`Ruler::draw_scale`), applied to coordinate units.
The axes through the origin are drawn on the grid.

**Rationale**: Principle VI. Inkscape labels its rulers in the document's display unit, and the
document unit of a TikZ figure is its coordinate unit. Centimetre labels differ from the
coordinates whenever `x` or `y` is not 1 cm.

**Alternatives considered**: Centimetre labels. Rejected by Principle VI.

## R10. No status line

**Proposal**: The editor has no status line. A construction shows its stage by the placed points,
the provisional geometry, and the snap marker (FR-030); Cancel and Finish are in the Active Tool
Menu (FR-032). No surface shows a step instruction, a tool hint, or a selection hint.

**Rationale**: Ipe shows a construction's progress by its preview and the secondary cursor
([Ipe manual, Snapping](https://github.com/otfried/ipe/blob/f4a918b12e68f1f244dd3c7d0e30ecf78ea13a01/manual/40_snapping.rst));
HIG Offering help: "If you need a lot of text to describe a control, consider simplifying your
interface design"
([Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)).
The information architecture has no status-line surface (Principle VII).

**Alternatives considered**: A status line under the canvas with the next step. Rejected: its
content is the instruction text that FR-031 and FR-070 forbid.

## R11. Tooltips

**Proposal**: A tooltip shows on pointer hover only and holds the control's name and its
shortcut, such as "Eraser (E)".

**Rationale**: HIG Offering help: "Avoid bloating your help content by explaining how standard
components or patterns work"
([Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)).

## R12. Views by document kind

**Proposal**: View in the document bar lists the document's editor (Canvas for a `tikzpicture`,
Quiver for a `tikzcd`), Code, and Render. In a regular-width window two views can be shown side by
side; in a compact window, one. No view explains why another is unavailable.

**Rationale**: HIG Split views: "Prefer using a split view in a regular — not a compact —
environment"; "In iPadOS, a split view can include either two vertical panes, like Mail, or three
vertical panes"
([Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)). The
specification ties the editor to the document kind (FR-013–FR-016).

**Alternatives considered**: List all four views and dim the unsupported ones, as a menu-bar menu
does. Rejected: FR-014 forbids the other kind's editor.

## R13. Panels

**Proposal**: Layers and Properties are separate panels, each with its own button in the document
bar. In landscape an open panel is a pane at the trailing edge; in portrait it is a nonmodal sheet
with medium and large detents. One panel is open at a time: opening the other replaces it.
Properties is the inspector of the selection; with nothing selected its button is dimmed, because
the next object's attributes are the active tool's options (R5) and the figure's attributes are in
Document Properties.

**Rationale**: GoodNotes opens its Layers panel from the document controls, not from the writing
tools ([Organize content with layers](https://support.goodnotes.com/hc/en-us/articles/16536297803535-Organize-content-with-layers));
HIG Panels: "An inspector displays the details of the currently selected item"
([Panels](https://developer.apple.com/design/human-interface-guidelines/panels)); HIG Toolbars puts
"buttons that open nearby inspectors" at the trailing edge; User Story 6. The dimmed button
follows the rule for an unavailable menu-bar item (Principle IV), because the document bar takes
the menu bar's place.

**Alternatives considered**: Both panels open in one column. Rejected by User Story 6.

## R14. The object menu

**Proposal**: The object menu appears above the selection at once (FR-050). It holds only the
commands that apply, as symbols with names, and More for the secondary commands (FR-051); Lock is
one of its commands. Simplify and Restore Original Stroke are commands on a selected curve
(FR-027). A finished stroke opens no menu: Pen options apply as the stroke is drawn (FR-025).

**Rationale**: GoodNotes: "Selecting content opens the Object Menu. Select More (…) for additional
actions"; the available actions depend on the selected content
([Lasso Tool](https://support.goodnotes.com/hc/en-us/articles/7353695644175)). HIG Context menus:
"Hide unavailable menu items, don't dim them"
([Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus)).

## R15. Settings and More

**Proposal**: More (⋯) at the end of the document bar holds Settings and Copy TikZ. Settings has
the categories Canvas, Colours (the colour collections), and Keyboard shortcuts; each changed
setting shows its own reset (FR-062).

**Rationale**: GoodNotes keeps its document settings and toolbar customization in More
([Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface));
HIG Settings: "Avoid adding settings buttons to a window's toolbar"
([Settings](https://developer.apple.com/design/human-interface-guidelines/settings)).

## R16. Popovers

**Proposal**: One popover is open in the whole window, across the shell and the fork. A popover
is anchored to the button that opened it; a second tap on that button closes it; a tap on another
button closes it and opens its own; Escape and a tap outside close it. The shell and the fork tell
each other when one opens a popover, so the other closes its own.

**Rationale**: HIG Popovers: "Show one popover at a time"; one tap closes one popover and opens
another ([Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)).

## R17. Appearance

**Decided by the user, 2026-11-13**: the appearance follows the iPad notebook apps, GoodNotes and
Notability. Neither puts an appearance control in the document view. An embedded editor takes its
host's appearance.

**Design**: Settings › Appearance holds Match System Appearance, on by default. When it is off, the
author chooses Light or Dark.

**Rationale**:

- Notability: "Enable **Match Theme to iOS Appearance** to match your device's system settings",
  with Light and Dark among the themes, in the Settings menu of the Library
  ([Settings: Appearances, Tools, & Gestures](https://support.gingerlabs.com/en-us/articles/16300218-settings-appearances-tools-gestures)).
- GoodNotes on iPad has "a dark mode, which tracks the iOS system setting", with no in-app
  override
  ([MacStories](https://www.macstories.net/reviews/goodnotes-adds-superior-multiwindowing-dark-mode-and-ocr-scanning/)).
  This is the behaviour of the default above.
- The agent audit [tablet-diagram-workflow.md](../../docs/audits/tablet-diagram-workflow.md) found
  that the author could not choose a light surface while the system is dark; the Light choice
  covers that.
