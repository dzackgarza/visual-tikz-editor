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
shell reaches the fork's panels and commands through the typed frame protocol.

**Alternatives considered**: All surfaces in the fork. Rejected: the fork does not see Code,
Render, or Quiver, and the document bar would exist once per editor.

## R2. A standalone application

**Decided by the user, 2026-11-13**: the editor is a standalone application, and no other
application embeds it. It keeps its files in the XDG base directories (FR-063). The document bar
has one form: the file's title, save state, and title menu; Undo and Redo; View, Layers,
Properties, Share and Export, and More.

**Rationale**: The XDG Base Directory Specification puts configuration in `$XDG_CONFIG_HOME`,
non-essential cached data in `$XDG_CACHE_HOME`, and "current state of the application that can be
reused on a restart (view, layout, open files, undo history, …)" in `$XDG_STATE_HOME`
([XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/)).

## R3. One document history

**Decision** (the user, 2026-11-13): Undo and Redo act on the one history of the document. Every
view shows the same document, so the history belongs to the document and not to a view (FR-012b).
A step is one edit of the source, made in any view: a canvas gesture, a Quiver edit, or a burst of
typing in the Code panel. Undo restores the source before the last step, and every view then shows
that source. A new edit after Undo discards the steps that Redo would restore. The canvas and
Quiver keep no history of their own: their Undo and Redo shortcuts ask the shell, and Quiver's
toolbar shows no Undo or Redo.

**Rationale**: The canvas, the Code view, Quiver, and the TeX render are views of one source
(Principle I). A history that belongs to a view holds states of that one source, so it is either
the document history or wrong: after a Code edit and then a canvas edit, the Code view's Undo
would remove the first edit under the second, which gives a source that the user never saw. Emacs
shows one buffer in several windows and keeps the history by buffer: "Each buffer records changes
individually, and the undo command always applies to the current buffer"
([GNU Emacs manual, Undo](https://www.gnu.org/software/emacs/manual/html_node/emacs/Undo.html)).
Inkscape's XML Editor and canvas edit one document and record each change in the document's one
undo history (`DocumentUndo::done(document, …)`, `src/ui/dialog/xml-tree.cpp:584-753` at
[`70feba2`](https://gitlab.com/inkscape/inkscape/-/tree/70feba21364ccbe2d2d2fab397228bc2e0d41b5a)).
Typing is grouped as CodeMirror groups it: adjacent changes no more than 500 ms apart are one step
(`newGroupDelay`, [CodeMirror reference](https://codemirror.net/docs/ref/#commands.history)).
GoodNotes keeps Undo and Redo in its navigation bar
([Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface)).

## R4. Selection with the Lasso

**Decided by the user, 2026-11-13**: one selection tool, the Lasso, with the selection shape as
its option. A tap with the Lasso selects the object under the tap. A drag from empty canvas draws
the selection shape that the Active Tool Menu sets: Freehand (the default), Rectangle, or Oval. A
drag that starts on the selection moves it (FR-012a).

**Rationale**: Notebook apps have one selection tool, a lasso with shape options. GoodNotes: its Lasso selects all content, uses freehand
selection by default, and offers a rectangular lasso as a Lasso Type
([Select, Move, and Edit Content With the Lasso Tool](https://support.goodnotes.com/hc/en-us/articles/7353695644175)).
Inkscape's Selector selects an object by a click and draws a selection box by a drag from empty
canvas ([Inkscape manual, Selector tool](https://inkscape-manuals.readthedocs.io/en/latest/selector-tool.html)).
FR-007 starts the toolbar with the Lasso.

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

**Alternatives considered**: The readout at the right end of the status line, as Inkscape.
Rejected: the status line shows the pointer position only (R10).

## R9. Rulers in figure coordinates

**Proposal**: Ruler labels are figure coordinates, in the figure's `x` and `y` units. The label
step follows Inkscape's rule for its rulers (`Ruler::draw_scale`), applied to coordinate units.
The axes through the origin are drawn on the grid.

**Rationale**: Principle VI. Inkscape labels its rulers in the document's display unit, and the
document unit of a TikZ figure is its coordinate unit. Centimetre labels differ from the
coordinates whenever `x` or `y` is not 1 cm.

**Alternatives considered**: Centimetre labels. Rejected by Principle VI.

## R10. A status line with the pointer position only

**Decision** (the user, 2026-11-13): A status line under the canvas shows the pointer position in
figure coordinates, and nothing else (FR-044). The pointer is the pen, the finger, or the mouse
cursor. A construction shows its stage by the placed points, the provisional geometry, and the
snap marker (FR-030); Cancel and Finish are in the Active Tool Menu (FR-032). No surface shows a
step instruction, a tool hint, or a selection hint.

**Rationale**: The Inkscape status bar "provides information such as the colors of the selected
object, layers, cursor coordinates, zoom level and page rotation"
([Inkscape manual, Interface](https://inkscape-manuals.readthedocs.io/en/latest/interface.html));
in Inkscape 1.4.4 the pointer position "X: Y:" is in the status bar
([zoom specification](../../docs/prior-art/zoom-and-view.md)). Ipe shows "the mouse coordinates"
at the bottom right (Ipe manual, `manual/20_concepts.rst:278-279`). The coordinates are the
numbers of the source (Principle VI). Ipe shows a construction's progress by its preview and
the secondary cursor
([Ipe manual, Snapping](https://github.com/otfried/ipe/blob/f4a918b12e68f1f244dd3c7d0e30ecf78ea13a01/manual/40_snapping.rst));
HIG Offering help: "If you need a lot of text to describe a control, consider simplifying your
interface design"
([Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)).

## R11. Tooltips

**Proposal**: A tooltip shows on pointer hover only and holds the control's name and its
shortcut, such as "Eraser (E)".

**Rationale**: HIG Offering help: "Avoid bloating your help content by explaining how standard
components or patterns work"
([Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)).

## R12. Views by document kind, and the Code panel

**Decision** (the user, 2026-11-13): View in the document bar lists the document's editor (Canvas
for a `tikzpicture`, Quiver for a `tikzcd`) and Render; one of them fills the window. Code is a
panel beside the editor, opened by Code in the document bar, like Layers and Properties (FR-015,
FR-060). An edit in the canvas or Quiver shows at once in the Code panel, and an edit in the panel
shows at once in the editor. No view explains why another is unavailable.

**Rationale**: Inkscape's XML Editor, the source of the document, is a dialog of the same kind as
Layers and Objects and Object Properties (`src/ui/dialog/dialog-data.cpp:30,33,61`), and a dialog
opens docked beside the canvas by default (`DialogContainer::new_dialog`,
`src/ui/dialog/dialog-container.cpp:168-177`, at
[`70feba2`](https://gitlab.com/inkscape/inkscape/-/tree/70feba21364ccbe2d2d2fab397228bc2e0d41b5a)).
The specification ties the editor to the document kind (FR-013–FR-016).

## R13. Panels

**Proposal**: Code (R12), Layers, and Properties are separate panels, each with its own button in
the document bar. In landscape an open panel is a pane at the trailing edge; in portrait it is a
nonmodal sheet with medium and large detents. One panel is open at a time: opening another
replaces it.

**Decision** (the user, 2026-11-13): Properties is the inspector of the selection, and with
nothing selected it is the inspector of the figure: its scale, its bounds, and the options of the
`tikzpicture` (FR-060a). The figure's attributes have this one place. The next object's
attributes are the active tool's options (R5).

Keynote for iPad shows the slide's Layout in Format only with nothing selected: "If you don't see
Layout, make sure nothing is selected on the slide"
([Keynote User Guide for iPad](https://support.apple.com/guide/keynote-ipad/tan584189747/ipados)).
The fork's inspector has this figure mode (`InspectorPanel figure`).

**Rationale**: GoodNotes opens its Layers panel from the document controls, not from the writing
tools ([Organize content with layers](https://support.goodnotes.com/hc/en-us/articles/16536297803535-Organize-content-with-layers));
HIG Panels: "An inspector displays the details of the currently selected item"
([Panels](https://developer.apple.com/design/human-interface-guidelines/panels)); HIG Toolbars puts
"buttons that open nearby inspectors" at the trailing edge; User Story 6.

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

**Decided by the user, 2026-11-14**: Settings is the canvas editor's Settings window, extended with
Appearance; for a tikzcd document it opens over Quiver, and its Canvas, Colours, and Keyboard
shortcuts pages apply to tikzpicture documents only.

**Proposal**: More (⋯) at the end of the document bar holds Settings. Settings has the categories
Appearance (R17), Canvas, Colours (the colour collections), and Keyboard shortcuts; each changed
setting shows its own reset (FR-062). Copy TikZ is the first item of Share and Export, before
PDF, SVG, and PNG: each of them gives the figure to another program (User Story 7).

**Rationale**: GoodNotes keeps its document settings and toolbar customization in More
([Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface));
HIG Settings: "Avoid adding settings buttons to a window's toolbar"
([Settings](https://developer.apple.com/design/human-interface-guidelines/settings)). HIG Activity
views: "Activity views present sharing activities like messaging and actions like Copy and
Print"; "Photos provides app-specific actions like Copy Photo"
([Activity views](https://developer.apple.com/design/human-interface-guidelines/activity-views)).

## R16. Popovers

**Proposal**: One popover is open in the whole window, across the shell and the fork. A popover
is anchored to the button that opened it; a second tap on that button closes it; a tap on another
button closes it and opens its own; Escape and a tap outside close it. The shell and the fork tell
each other when one opens a popover, so the other closes its own.

**Rationale**: HIG Popovers: "Show one popover at a time"; one tap closes one popover and opens
another ([Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)).

## R17. Appearance

**Decided by the user, 2026-11-13**: the appearance follows the iPad notebook apps, GoodNotes and
Notability. Neither puts an appearance control in the document view.

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

## R18. Accessibility: the WCAG 2.2 criteria and their subjects in the editor

**Proposal** (the user directed on 2026-11-20 that the WCAG 2.2 rules enter the specification; the
level and the mechanisms below are the maintainer's and wait for the user's review): the measure
is the success criteria of
[WCAG 2.2](https://www.w3.org/TR/2024/REC-WCAG22-20241212/) (W3C Recommendation, 2024-12-12) at
Levels A and AA. Two measures come from Level AAA, each as the testable form of a rule that
Level AA or the HIG states without a number: 2.4.13 Focus Appearance (the size and contrast of
the focus indicator, for 2.4.7) and 2.3.3 Animation from Interactions (for the HIG's Reduce
Motion). The requirements are FR-080 to FR-092 and constitution Principle IX.

**Rationale**:

- The editor's page is web content, in a browser and in the web view of the desktop window, so the
  criteria apply to it as written and each has a published test.
- Apple's [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
  guidance, the platform source of Principle II, takes its contrast numbers "from WCAG Level AA"
  and states the same rules in prose: "Convey information with more than color alone", "Offer
  alternatives to gestures", "Let people use the keyboard alone to navigate and interact with your
  app", and, for Reduce Motion, "ensure your app or game responds by reducing automatic and
  repetitive animations".
- The checklist that started this entry is the accessibility rows of `ux-guidelines.csv` in
  [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) at `2de1134`
  (MIT licence). It paraphrases WCAG and the HIG and is not cited as a source of any rule; each
  rule here cites the criterion.

**Each Level A and AA criterion** (55 criteria; 4.1.1 is removed from WCAG 2.2):

| Criterion | Level | Subject in the editor | Requirement |
| --- | --- | --- | --- |
| 1.1.1 Non-text Content | A | Every symbol button; the figure thumbnails of the Figures panel | FR-080 |
| 1.2.1 to 1.2.5 (audio and video) | A, AA | None: the editor plays no audio and no video | — |
| 1.3.1 Info and Relationships | A | Roles of toolbars, menus, panels, dialogs; labels of fields | FR-080, FR-081 |
| 1.3.2 Meaningful Sequence | A | The order of controls in the page is the order of each surface | FR-085 |
| 1.3.3 Sensory Characteristics | A | None: FR-070 allows no instruction that could name a shape or a place | — |
| 1.3.4 Orientation | AA | Landscape and portrait | FR-061 |
| 1.3.5 Identify Input Purpose | AA | None: no field collects information about the user | — |
| 1.4.1 Use of Color | A | Active tool, active preset, toggles, save state, conflict, error | FR-083 |
| 1.4.2 Audio Control | A | None: no audio | — |
| 1.4.3 Contrast (Minimum) | AA | All interface text, light and dark | FR-082 |
| 1.4.4 Resize Text | AA | Document bar, menus, panels, Settings, dialogs | FR-090 |
| 1.4.5 Images of Text | AA | None: interface text is text; the figure's text is the author's content | — |
| 1.4.10 Reflow | AA | Settings and dialogs reflow; the canvas and toolbars use the exception for content that needs two dimensions | FR-090 |
| 1.4.11 Non-text Contrast | AA | Symbols, field boundaries, state marks, selection highlight, snap marker, focus indicator | FR-082 |
| 1.4.12 Text Spacing | AA | The same text as 1.4.4 | FR-090 |
| 1.4.13 Content on Hover or Focus | AA | Tooltips | FR-091 |
| 2.1.1 Keyboard | A | Every command; exception for path input (pen stroke, eraser sweep, freehand lasso) | FR-084 |
| 2.1.2 No Keyboard Trap | A | The canvas, the Code panel (CodeMirror takes Tab), sheets, dialogs | FR-085 |
| 2.1.4 Character Key Shortcuts | A | The one-key tool shortcuts | FR-084, FR-062 |
| 2.2.1 Timing Adjustable | A | None: no time limit. The hold of FR-026 is a gesture, and the stroke stays when the hold is missed | — |
| 2.2.2 Pause, Stop, Hide | A | The progress mark of Render moves only while a compile runs | FR-089 |
| 2.3.1 Three Flashes | A | None: nothing flashes | — |
| 2.4.1 Bypass Blocks | A | None: one page with no repeated blocks before content; the roles of FR-080 give the landmarks | — |
| 2.4.2 Page Titled | A | The window title is the file name (`standalone/StandaloneApp.vue`) | Met in the source |
| 2.4.3 Focus Order | A | Every surface | FR-085 |
| 2.4.4 Link Purpose | A | None: the interface has no links | — |
| 2.4.5 Multiple Ways | AA | None: one page, not a set of pages | — |
| 2.4.6 Headings and Labels | AA | Settings pages, panel titles, field labels | FR-081 |
| 2.4.7 Focus Visible | AA | Every focusable control | FR-085 |
| 2.4.11 Focus Not Obscured (Minimum) | AA | Panels, sheets, popovers over the bars and the canvas | FR-085 |
| 2.5.1 Pointer Gestures | A | Pinch to zoom, two-finger pan | FR-086 |
| 2.5.2 Pointer Cancellation | A | Buttons, menu items, presets; drawing on the press is essential | FR-092 |
| 2.5.3 Label in Name | A | Controls with visible text (menu items, Settings fields, dialog buttons) | FR-080, FR-081 |
| 2.5.4 Motion Actuation | A | None: no command reads device motion | — |
| 2.5.7 Dragging Movements | AA | The drags of the table below | FR-086 |
| 2.5.8 Target Size (Minimum) | AA | 24 × 24 CSS px; Principle II and FR-008 set 44 × 44 pt, which is larger | Principle II |
| 3.1.1 Language of Page | A | `lang="en"` in `standalone/index.html`; the canvas and Quiver frames need the same | FR-080 story checks each frame |
| 3.1.2 Language of Parts | AA | None: the interface is in one language | — |
| 3.2.1 On Focus, 3.2.2 On Input | A | Focus alone opens and changes nothing; a Settings field changes only its own setting | FR-085 |
| 3.2.3 Consistent Navigation, 3.2.4 Consistent Identification | AA | One document bar in every view; one name per command | FR-001, SC-002 |
| 3.2.6 Consistent Help | A | None: the editor has no help mechanism | — |
| 3.3.1 Error Identification, 3.3.3 Error Suggestion | A, AA | Number, hex, `xcolor`, and file-name fields; the Render template error | FR-088, FR-065 |
| 3.3.2 Labels or Instructions | A | Fields of Properties, Settings, colour options | FR-081 |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | None: no legal or financial transaction; Undo reverses each edit | — |
| 3.3.7 Redundant Entry | A | None: no process of more than one step asks for information | — |
| 3.3.8 Accessible Authentication | AA | None: no sign-in | — |
| 4.1.2 Name, Role, Value | A | Every control | FR-080 |
| 4.1.3 Status Messages | AA | Save state, conflict, Render compile and error, export result | FR-087 |

**Functions that a drag or a two-finger gesture operates** (FR-086), read from the source at
`e88486c` with the fork checkout of that revision:

| Function | Gesture | Alternative by taps | State in the source |
| --- | --- | --- | --- |
| Zoom | Pinch | Zoom readout and its menu (FR-040, FR-041) | Present |
| Pan | Two-finger drag | Open: no mechanism is chosen | To check by the story |
| Toolbar edge | Drag by the grip (FR-010) | Settings, Toolbar Position (`SettingsModal.tsx`, `setting-toolbar-position`) | Present; FR-062 does not list it yet |
| Position and size of a selection | Drag the selection or a handle | X, Y, Width, Height fields of Properties (`InspectorPanel.tsx`) | Fields present; the story checks that they act on every selection |
| Point of a curve in Edit Points | Drag the point | Open: no mechanism is chosen | To check by the story |
| Order of colour presets | — | Move buttons in the colour options (`Toolbar.tsx`, `movePreset`) | Present |
| Order of layers and objects | Drag a row | Open: no mechanism is chosen | To check by the story |
| Width of a panel | Drag the divider | The divider takes the arrow keys (`StandaloneApp.vue`, `resizeWithKeyboard`); for taps, open: no mechanism is chosen | Keyboard present; taps absent |
| Side of a view button in the shell rails | Drag between rails | None | The rails are in the source and not in the surfaces contract, which gives views and panels to the document bar (FR-001, FR-060) |

A function marked open has no mechanism yet. Principle III needs the documented behaviour of a
named application before a mechanism is built; the task of that function starts with that
citation in this entry.

**Gaps found in the source at `e88486c`** (each becomes a red story before its repair, tasks
Phase 15):

- The shell styles `:focus-visible` on dialog buttons, rail buttons, and the pane divider only,
  and by a background tint, not by an indicator of 2 CSS px.
- The shell has no `prefers-reduced-motion` rule; the progress mark of Render turns
  (`src/ui/TikzWorkbench.vue`) and the preview fades (`src/ui/TikzCompilerPreview.vue`). The fork
  has the rule in `canvas-panel/` only, against 22 transition and animation declarations.
- The fork has a live region in four components (Properties, keyboard shortcuts, numeric entry,
  Code). The shell marks its status text and the preview states with `role="status"` and its
  errors with `role="alert"`; no story checks the five messages of FR-087.
- No story scans a state with axe-core; `@axe-core/playwright` is not a dependency.

**Keyboard selection of objects** (FR-084): Inkscape selects the next object with Tab and the
previous with Shift+Tab. In a page, Tab must also be able to leave the canvas (WCAG 2.1.2). The
proposal: with the focus on the canvas, Tab and Shift+Tab select the next and the previous object
in source order; after the last object, Tab moves the focus to the next surface; Escape clears
the selection. The arrow keys already move the selection (`useCanvasKeyboardClipboard.ts`).

**Automated scan** (SC-007): [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
4.14 with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`
([axe-core API](https://github.com/dequelabs/axe-core/blob/v4.14.0/doc/API.md)). axe-core finds
names, roles, states, labels, and text contrast. It does not find focus order, focus return,
keyboard operation, drag alternatives, status messages, or reduced motion; a story asserts each
of those by the user's actions.

**Alternatives considered**:

- Level A only: it leaves out contrast (1.4.3, 1.4.11), the visible focus (2.4.7), drag
  alternatives (2.5.7), and status messages (4.1.3), which are the rules the HIG also states.
- All of Level AAA: 1.4.6 asks for 7:1 text contrast and 2.5.5 is already below Principle II;
  W3C does not recommend Level AAA as a general policy "because it is not possible to satisfy all
  Level AAA Success Criteria for some content" (WCAG 2.2, Conformance).
- The skill's checklist as the rule: it has no pinned text for each rule and no test, so
  Principle III does not accept it as a source.
- Manual review only: SC-007 needs a scan of every state that the stories reach, which a person
  cannot repeat at each change.
