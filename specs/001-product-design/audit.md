# Design audit of the 2026-11-12 usability report

This audit answers what the user's report of 2026-11-12 implies about the design of the editor:
which design process produced the reported defects, which other surfaces share that cause, and
what in the design must change. The [product design specification](spec.md) carries the
changes. The [constitution](../../.specify/memory/constitution.md) states the principles they
follow.

## The report

The user reported these observations of the running standalone app:

| Observation | Surface |
| --- | --- |
| The drawing toolbar holds a Layers button | Dock |
| Settings is a word, not an icon; the lasso icon is a rectangle | Dock |
| Properties and Layers open in one popup | Panels |
| Buttons open a popup but a second press does not close it | Dock, panels |
| File, Export, and other menus are not attached to their buttons | Document bar |
| A Dark Theme button | Document bar |
| A `tikzpicture` document can switch to Quiver, and long text explains why Quiver is unavailable | Views |
| The app teaches at every step; the eraser has help text | Status line, tooltips |
| "New strokes" beside a colour selector that is not a standard one | Dock |
| The default zoom is 15 % | Canvas view |
| Zooming in or out makes the renderer fail | Canvas view |
| The interface departs from the patterns of standard notebook applications | Whole app |

The captures [dock-current.png](../../docs/prior-art/images/dock-current.png),
[text-step-circle.png](../../docs/prior-art/images/text-step-circle.png), and
[shell-quiver-error.png](../../docs/prior-art/images/shell-quiver-error.png) show the surfaces as
built.

## Findings

### A1. The product had no design specification

Before this specification, the repository held no document that stated the editor's users,
workflows, and information architecture. The documents that described the interface were:

- three assistant responses from 2026-10-16, kept verbatim under
  [docs/guidance](../../docs/guidance/), and nine generated mockups;
- the complaint record [COMPLAINTS.md](../../COMPLAINTS.md) and the agent audits appended to it;
- per-surface specifications under [docs/prior-art](../../docs/prior-art/), written after the
  complaints, one surface at a time.

Each surface was therefore designed alone, from the request or complaint that named it. No
document assigned a control to a surface, so nothing decided that Layers, Properties, Settings,
Undo, Redo, Snap, and the zoom readout do not belong in the drawing dock. The dock as built
holds 16 controls and 8 colour swatches of five scopes
([dock-current.png](../../docs/prior-art/images/dock-current.png)): drawing tools, colour,
history, view, and application settings. GoodNotes, the reference application the complaints
name, splits these scopes across the three sections of its navigation bar and its More menu
([Improved User Interface](https://support.goodnotes.com/hc/en-us/articles/13682253498767-Improved-User-Interface)).

Reports explained: the Layers button in the dock; Properties and Layers in one popup; the
Settings word; menus not attached to their buttons; the departure from notebook-app patterns.

### A2. Phrases from ideation became controls

The assistant responses under [docs/guidance](../../docs/guidance/) are ideation: they describe
an imagined screen in prose. Several of their phrases were built as literal controls and labels:

| Phrase in the guidance | Built as |
| --- | --- |
| "**New strokes** changes what the pen draws next" ([ideal-gui.md](../../docs/guidance/ideal-gui.md), line 59) | The label "New strokes" beside the colour well |
| "a short instruction appears beside the palette: Arc through three points — place the second point", with Cancel and Finish ([ideal-gui.md](../../docs/guidance/ideal-gui.md), lines 30–34) | The step prompt "Circle: drag from the centre to the edge" with Cancel beside the dock |
| "A small control near the canvas edge reads … **Snap: lattice**" ([ideal-gui.md](../../docs/guidance/ideal-gui.md), line 36) | The dock button "Snap / lattice" |
| "Its popup begins by identifying the target: Pen, Selected stroke, or Selected fill" ([ideal-gui.md](../../docs/guidance/ideal-gui.md), line 68) | A colour control that names its target in words |
| "an unobtrusive Refine action … live controls for smoothing and simplification" ([ideal-gui.md](../../docs/guidance/ideal-gui.md), line 64) | The Freehand result popover after each stroke |

The agent audit [docs/audits/tablet-diagram-workflow.md](../../docs/audits/tablet-diagram-workflow.md)
found that the author could not choose a light surface when the system is dark; the shell then
carried a Dark theme button. The Apple HIG says to avoid an app-specific appearance setting
([Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)).

None of these phrases had a source in a shipped application. GoodNotes names no colour target in
words: presets belong to the active tool, and a second tap on the active colour opens its
options ([colour presets](https://support.goodnotes.com/hc/en-us/articles/7353743265039-Add-and-manage-writing-tool-color-presets)).

Reports explained: "New strokes" and the colour selector; the instruction at each step; the Dark
Theme button.

### A3. Complaints were implemented as literal local rules

Each complaint in [COMPLAINTS.md](../../COMPLAINTS.md) was repaired at the control it named,
with its wording taken as the specification:

| Complaint | Built as | Consequence |
| --- | --- | --- |
| The startup window shows too little; it should show about (-20,20)² | The launch view picks the largest zoom preset that holds a 40-unit square, whatever the figure's size (fork `useCanvasViewportPersistence.ts`, `centerOnPage`) | With 100 % defined as printed size ([zoom-and-view.md](../../docs/prior-art/zoom-and-view.md), item 1; [#63](https://github.com/dzackgarza/visual-tikz-editor/issues/63)), 40 cm on a tablet screen reads 8–15 %. A figure of a few units opens as a speck until [#64](https://github.com/dzackgarza/visual-tikz-editor/issues/64) opens it fitted. |
| The View menu can become a popup on the zoom percentage | The zoom readout sits in the dock and opens Fit, presets, grid, rulers, guides, and output bounds | View settings live in the drawing dock |
| Panels can open from their own buttons | Layers, Properties, and Settings are text buttons in the dock | Panels and settings live in the drawing dock |
| Selecting a curve can spawn a floating button with its options | The selection strip | Kept: GoodNotes has the same Universal Object Menu |

Two rules made separately, each with a source, combined into a result neither source supports:
no reference application opens an empty figure at 8 %. A design that states the launch view as
a user outcome ("the figure, or the working area of an empty figure, fills the canvas") would
have exposed the conflict.

Reports explained: the 15 % default zoom; the dock contents.

### A4. Views are named by implementation, not by document

The shell offers four peer views on two sidebars: Code, the TikZ Editor canvas, Quiver, and the
TeX render. The tablet audit found that "mode labels describe implementations instead of the
author's task". The canvas and Quiver are two editors for two document kinds, not two views of
one document, but the view switcher offers both for every document. Opening Quiver on a
`tikzpicture` shows an error with a file path and an explanation
([shell-quiver-error.png](../../docs/prior-art/images/shell-quiver-error.png)). The explanation
text exists because the design offers a view that cannot work.

Reports explained: switching to Quiver in a `tikzpicture`; the long text on why Quiver is
unavailable.

### A5. A desktop shell carries a tablet canvas

The document bar holds text buttons File, Export, and Copy source that open desktop-style menus;
the views sit on two IDE-style sidebars whose icons move by drag. The tablet controls were added
inside this shell. The shell's own specification audits it "against established desktop
document-editor conventions" — Inkscape, Ipe, Xournal++, VS Code, and the W3C menubar pattern
([shell.md](../../docs/prior-art/shell.md), lines 3 and 36–63) — and names no tablet
application, so its repairs moved the shell further toward a desktop editor. The HIG asks iPad apps to elevate content and minimize modal interfaces
([Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)),
to anchor a popover to the control that opened it and show one at a time
([Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)), and to use
symbols in toolbars ([Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)).

Reports explained: menus not attached to their buttons; buttons that do not close their popup;
the Settings word; the rectangle lasso icon (chosen without a reference icon).

### A6. Text compensates for missing affordances

Where a control or state is not clear from its form, the build adds a sentence: the step prompt
of each construction, the eraser tooltip, the Quiver explanation, the target word beside the
colour well, "units" in the readout ([text-step-circle.png](../../docs/prior-art/images/text-step-circle.png)).
The HIG treats a control that needs much text as a sign to simplify the design
([Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)).
Ipe shows a construction's progress by its preview and the snap marker, with no prompt
([Ipe manual, Snapping](https://github.com/otfried/ipe/blob/f4a918b12e68f1f244dd3c7d0e30ecf78ea13a01/manual/40_snapping.rst)).

Reports explained: the app teaches at every step; the eraser help text.

### A7. The zoom failure is a defect, not a design finding

The renderer failure on zoom ([#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18))
is not reproduced. Its reproduction is ordinary defect work and does not depend on this
specification.

## What must change in the design

| Change | Specification |
| --- | --- |
| One information architecture assigns every control to one surface | [spec.md](spec.md), Information architecture, FR-001–FR-012 |
| Views follow the document kind; the editor for a kind is not a view choice | FR-013–FR-016 |
| Colour, tool options, and snapping follow notebook-app patterns, with no target words | FR-020–FR-027 |
| Constructions show their stage by preview and markers, not by text | FR-030–FR-033 |
| The launch view and the meaning of zoom are stated as user outcomes | FR-040–FR-043 |
| Guidance phrases and complaint wording are evidence; each rule has a source | Constitution, Principles III and VII |

The surfaces that share these causes and that the report does not name: the Freehand result
popover (A2), the selection strip's labels (A2, A6), the zoom popover's view settings (A3), the
Document Properties dialog (A5), and the rulers' centimetre labels (A3; constitution
Principle VI).
