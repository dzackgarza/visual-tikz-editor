**The ideal GUI is a spacious mathematical sketchbook: a quiet canvas, a small pencil palette, and precise editing controls that appear when they become useful.** At rest, almost the entire screen belongs to the diagram. You should immediately understand where to draw, which tool is active, and whether your work is saved.

I would give it the following concrete form.

**The canvas is the main surface.** Imagine warm white paper extending across the screen, with a faint square lattice. The origin and axes are slightly stronger than the grid. Mathematical objects appear crisp and dark; labels use proper mathematical typography. One restrained accent color identifies selections and active tools.

Grid density adapts to zoom while the underlying coordinates stay fixed. Rulers are optional. Export bounds appear only when requested, as a subtle frame around the figure. Dark mode uses a coordinated dark drawing surface with readable geometry, labels, and guides.

**A single compact bar runs across the top.** On the left: Back, the diagram’s name, and a small, readable save state such as “Saved locally.” Tapping the name opens rename, duplicate, location, and document settings. Undo and Redo occupy stable, prominent positions. On the right: Layers, View, and Export.

The drawing screen uses a compact title so it preserves space. Less frequent document commands live in a conventional menu. This follows Apple’s guidance to select toolbar commands deliberately and avoid overcrowding. [Apple toolbar guidance](https://developer.apple.com/design/human-interface-guidelines/toolbars)

**The drawing palette is a small, movable dock.** Its default position is near the lower edge, within comfortable reach. A visible grip lets you dock it along either side or move it to the opposite hand.

Its primary tools are:

- **Pen**, with a visible stroke-width sample.
- **Eraser**, with clear stroke-erasing and partial-erasing choices.
- **Select**, including tap selection and lasso.
- **Geometry**, opening illustrated construction tools.
- **Label**, for mathematical and ordinary text.
- **Color**, followed by a short strip of saved swatches.

The selected tool has an unmistakable active state. Tapping it again opens its options. Choosing a geometry variant changes the dock’s geometry icon to that tool and displays its name: “Circle: center and radius,” for example.

The palette keeps its order when moved or when the tablet rotates. Saved colors scroll within their allotted space.

**Geometry opens as an illustrated tool picker.** Each choice shows a small drawing of what it creates. Families group related constructions: lines and arrows, circles and arcs, curves, shapes, and diagrams. Choosing Circle reveals variants such as center–radius and three points.

Once a tool is selected, a short instruction appears beside the palette:

> **Arc through three points — place the second point**

The canvas shows the construction in progress, including provisional geometry and the next placement target. Cancel and Finish appear where applicable. These instructions change with the actual construction stage.

A small control near the canvas edge reads something understandable, such as **Snap: lattice**. Opening it exposes lattice, angle, alignment, and object snapping together. During placement, a guide identifies the actual target: an intersection, center, endpoint, or alignment. Zoom has its own separate control.

**Selection changes the available controls without overwhelming the drawing.** A selected object receives a clear outline. A compact action strip appears beside its bounds, positioned away from the object and the user’s hand. Its placement remains stable while you work.

| Selection | Immediately available controls |
|---|---|
| Curve | Edit points, Simplify, Style, Duplicate |
| Arrow | Endpoints, Arrowheads, Label, Style |
| Shape | Geometry, Fill and stroke, Transform, Duplicate |
| Several objects | Group, Align, Distribute, Transform |
| Curve points | Smooth, Corner, Delete, Position |

A consistent More menu contains secondary actions. Selection lock is available in the same place for every relevant object.

Selecting a curve initially exposes its outline and whole-object controls. Choosing **Edit points** reveals nodes; selecting a node reveals its handles. This progressive disclosure keeps a complicated curve legible. An explicit “3 points selected” indicator makes the scope of an operation clear.

**Detailed editing uses one predictable panel.** In landscape, it opens along the side. In portrait, it becomes a shallow bottom sheet that can expand when necessary. The canvas adjusts so the selected subject remains visible.

The panel starts with a meaningful title—“Arrow,” “Circle,” or “3 selected objects”—and presents the relevant fields. For a circle, that means center and radius. For an arrow, endpoints, curvature, heads, and label placement.

Controls distinguish their scope explicitly:

- **Selected curve** changes the existing curve.
- **New strokes** changes what the pen draws next.
- **Save as default** makes an intentional lasting preference.

Numerical fields support direct entry and convenient adjustment. Sliders always have understandable labels and an exact-value alternative.

**Stroke refinement is a small, deliberate interaction.** After drawing, an unobtrusive **Refine** action is available near the palette. Opening it shows the whole stroke with live controls for smoothing and simplification, plus “Show points” and “Restore original.”

The adjustment surface occupies a reserved edge area so it cannot cover the curve. Moving a slider updates the preview continuously. Accept and Cancel have clear meanings. If automatic refinement is enabled, drawing another stroke simply continues the drawing session.

**Color has one coherent interface.** Its popup begins by identifying the target: **Pen**, **Selected stroke**, or **Selected fill**. It contains saved palettes, a spectrum, opacity, and optional exact color entry. Palette creation, naming, and rearrangement happen there.

Stroke and fill have separate, recognizable previews. “No fill” is a visible choice. Changing a color immediately shows which part of the selected object will change.

**Labels are edited beside their mathematical context.** Tapping a label opens a compact editor with its rendered result visible nearby. A small accessory row provides common symbols, subscripts, superscripts, and recently used macros. The keyboard moves the canvas enough to keep both the label and its object visible.

For an arrow label, dragging changes its position along the arrow. Simple controls change its side, offset, and orientation.

**Layers and source are secondary work surfaces.** Layers opens a familiar list with thumbnails, names, visibility, locks, and drag handles. The current drawing layer is unmistakable.

View offers **Canvas, Source, and Publication preview**. Wide windows can show source beside the canvas. Narrow windows switch between them while preserving selection and viewport. Selecting geometry highlights its source when that view is open.

Export presents a clean figure preview, output bounds, format, and size. Construction aids and selection handles disappear from that preview.

**The layout adapts by changing composition.** Portrait uses bottom sheets; landscape can support a side inspector; a narrow split-screen window gives the canvas priority. Tool order and essential actions stay predictable. Controls remain usable with either hand and with the pencil itself, consistent with Apple’s guidance for adaptable layouts and Pencil interaction. [Layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout), [Pencil guidance](https://developer.apple.com/design/human-interface-guidelines/apple-pencil-and-scribble)

Rotating the tablet while editing a curve should leave that curve selected, its adjustment visible, and enough drawing area to judge the result.

<oai-mem-citation>
<citation_entries>
MEMORY.md:23-23|note=[Used prior tablet complaint context alongside the requirements already inspected in this conversation]
</citation_entries>
<rollout_ids>
01a135cd-06b8-7d22-9ea7-96b1b13ffd96
</rollout_ids>
</oai-mem-citation>
