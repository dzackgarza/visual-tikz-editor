**Visual TikZ Editor should let a mathematician think with a pencil, refine a drawing into precise mathematical objects, and carry the same editable figure into a paper.** Opening it should feel as familiar as opening a page in an iPad note-taking app. Its distinguishing capability would be the continuous path from an exploratory sketch to a publication-quality mathematical diagram.

The repository already establishes the foundation: one diagram and its TikZ source, direct visual editing, `tikzpicture` and `tikzcd` support, and drawing that does not require running TeX. It can operate independently or inside a larger application that owns notebooks and documents. [Current product description](/home/dzack/gitclones/visual-tikz-editor/README.md:3)

The following describes the target experience I would design toward.

**The central workflow should be “sketch, understand, refine, publish.”** A researcher could sketch a configuration during a conversation, move its pieces while thinking, make selected geometry exact, add mathematical labels, and export the result without reconstructing it in another application. Rough handwriting, precise curves, attached arrows, shaded regions, and typeset mathematics should coexist naturally.

That serves several related kinds of work:

- Geometric configurations: points, lines, circles, arcs, intersections, constructions, and annotations.
- Graphs, trees, posets, and lattice diagrams with editable vertices and edges.
- Commutative and pasting diagrams with mathematical labels and rich arrow conventions.
- Topological illustrations: deformations, crossings, surfaces, identifications, and regions.
- Coordinate pictures: axes, grids, curves, marked points, and shaded domains.
- Exploratory sketches whose meaning is still developing.

The breadth matters because research drawings frequently mix these families. A commutative diagram may need an informal annotation; a geometric construction may need a small graph beside it.

The comparison apps establish several standards worth meeting. The last column below is my proposed direction for this app.

| Reference | Established strength | What this app should add |
|---|---|---|
| [Ipe](https://ipe.otfried.org/) | Mathematical text, geometric snapping, and PDF figures | Make comparable precision comfortable with a stylus and touch throughout the drawing session. |
| [QTikZ/KTikZ](https://github.com/fhackenberger/ktikz) | TikZ source editing with an automatically generated preview | Let direct drawing and source editing participate in the same document without making code entry the starting point. |
| [Inkscape](https://inkscape-manuals.readthedocs.io/en/latest/) | General vector editing | Organize vector operations around mathematical drawing tasks and tablet interaction. |
| [Quiver](https://q.uiver.app/) | Specialized commutative and pasting diagrams, including LaTeX export | Bring that specialization into a coherent environment for broader mathematical illustrations. |
| [Noteful](https://www.getnoteful.com/) | Pencil writing, lasso editing, layers, and a compact interface | Preserve that familiar drawing experience while adding exact geometry and editable mathematical source. |

Surpassing these applications should mean **making the complete research-diagram workflow faster, clearer, and more dependable**, measured through actual use.

Picture the app opening onto a generous sheet of paper. The background is warm white or a carefully designed dark surface. A quiet grid is available, with distinguishable axes and origin when relevant. The figure has the strongest visual emphasis. Selection, handles, guides, and controls each have a recognizable visual role.

The surrounding interface would have a small number of stable surfaces:

- **A compact document bar:** document name, understandable save status, Undo, Redo, and export.
- **A movable drawing dock:** pen, eraser, lasso/select, geometry, mathematical labels, and color. Its handle reliably moves it; its tools remain in a predictable order.
- **One contextual editing surface:** selecting a curve, arrow, label, or group reveals the relevant operations in a consistent place.
- **Occasional panels:** layers, detailed properties, and source open deliberately and receive enough space to be useful.

Portrait orientation, landscape orientation, split-screen use, and the onscreen keyboard need deliberate layouts. Opening Properties should preserve a usable view of the selected object. Opening source in a narrow window should produce an intentional alternate view or split arrangement. Every panel participates in a shared space budget.

Visually, this calls for restrained color, readable typography, recognizable icons, clear selected states, and large touch targets. Small symbols inside large empty buttons still need to communicate their meaning. Common tools should be identifiable without hovering or memorizing a legend.

**The pencil interaction is the product’s foundation.** Ink should follow the tip immediately, palms should be ignored, fingers should navigate predictably, and the eraser should erase continuously as it crosses strokes. Lasso selection should work with the same fluency people expect from their notes app.

Pencil double-tap, squeeze, and hover can provide convenient shortcuts on supported hardware, with the same commands available visibly. Apple exposes these interactions separately, so their availability needs to follow the actual device. [Apple Pencil interactions](https://developer.apple.com/documentation/uikit/apple-pencil-interactions)

Geometry assistance should preserve the pace of drawing. A person might draw a rough circle and hold briefly to make it exact, or select an existing stroke and choose a fitted curve. Handwriting must be able to remain handwriting. Automatic treatment should be explicit and predictable.

Three properties are essential:

1. The original stroke remains recoverable.
2. Continuing to draw preserves an accepted correction.
3. Adjusting one stroke changes that stroke; changing future defaults is a separate, explicit action.

Smoothing should preview live while the whole curve remains visible. Repeated simplification, corner preservation, and local editing should be understandable controls. A researcher should be able to improve a shape without losing an intentional kink or changing a crossing.

**Precision needs to feel like direct manipulation.** The interface should let you draw a circle from its center and radius, choose an illustrated alternative construction, attach an arrow to a node, drag a label along an edge, or rotate a selection around a chosen point.

Construction tools need visible stages. For an arc through three points, the interface should communicate which point comes next and preview the resulting arc. The selected construction remains identifiable after its picker closes.

Snapping needs one coherent policy covering lattice points, angles, intersections, alignment, and attachments. As the pencil approaches a target, the interface should show what will snap and why. If constraints conflict, it should communicate that conflict. Displaying a grid, snapping to a grid, and requiring integer coordinates are distinct choices.

Coordinates should use the mathematical coordinate system of the figure. Physical export size belongs in a separate, clearly related control. Zooming should leave the meaning of coordinates and constraints unchanged.

**Selection should reveal structure progressively.** Selecting a curve first highlights the whole curve and offers whole-curve operations. Entering point editing then reveals its nodes and relevant handles. Selecting several points makes operations on that subset available. A selection lock allows careful work without an accidental tap discarding the editing context.

The same interaction grammar should apply across objects:

- Tap or lasso to select.
- See exactly what is selected.
- Drag to manipulate it.
- Open its contextual controls for precision.
- Undo the operation as one understandable action.

Selecting an object while source is visible should identify its corresponding source without taking input focus away from the drawing.

The mathematical specialization should appear in the behavior of objects. Moving a graph vertex should carry its attached edges. Moving a label should preserve its association with an arrow. A crossing should remain distinguishable from a junction. A geometric constraint should remain meaningful after moving another object.

Useful mathematical controls would include arrowheads and tails, parallel arrows, loops, braces, angle marks, dashed auxiliary lines, region fills, and consistent label placement. Reusable styles and small construction libraries would let a researcher maintain the visual language of a paper.

These relationships must be authored intentionally. A visual crossing alone does not establish incidence, and arranging arrows in a square does not establish commutativity.

**Mathematical labels and TikZ fidelity need equal care.** Labels should support LaTeX, document macros, baseline alignment, and convenient positioning. Handwritten annotations should remain available throughout. Recognition could be an optional aid, but reliable drawing and label entry must stand on their own.

The source should remain readable and useful outside the app. Supported visual edits should make targeted changes, preserve unrelated authored material, and retain editable structure across saving and reopening. Constructs outside the visual editor’s capabilities need an explicit handling policy that preserves the source.

The fast canvas and the final TeX rendering also need a clear relationship. Drawing should stay responsive while publication preview checks the actual output, including macros, fonts, bounds, and line weights. Export should offer useful TikZ source and vector output, with clear treatment of dependencies and embedded images.

A representative session would look like this:

> You sketch a triangle and a curved path across it, then write several provisional labels. You make the triangle’s vertices exact while retaining the path’s hand-drawn character. You attach arrows and replace two labels with LaTeX. Moving a vertex updates its incident edges. You duplicate the configuration to illustrate a second case, export both figures, close the app, and reopen them later with their geometry and editable relationships intact.

The researcher’s attention stays on the mathematical picture throughout that sequence.

Finally, **“AAA” should describe a demonstrable quality bar.** I would require sustained drawing sessions on physical tablets to establish that:

- Drawing, panning, and object manipulation remain responsive on realistically complex figures.
- Every essential workflow is discoverable and completable with touch and pencil.
- Tool identity, construction stage, selection scope, and edit scope remain clear.
- Rotation, resizing, and keyboard appearance preserve the work and a usable canvas.
- Undo and Redo behave consistently across drawing, fitting, transformations, labels, and source edits.
- Autosave, interruption recovery, offline operation, and reopening preserve the authored document; save status says what is actually stored.
- Left-handed use, accessible contrast, readable labels, and alternative input methods receive deliberate support.
- Exported figures survive real paper workflows and can return for further editing.

The decisive acceptance exercise would be to give mathematicians unfamiliar research diagrams and observe them creating, revising, exporting, and reopening those figures without coaching. Measure time, errors, lost work, and requests for help. That would establish whether the interface delivers the familiarity and precision the product promises.

<oai-mem-citation>
<citation_entries>
MEMORY.md:497-498|note=[Located editor and notebook ownership boundaries, then checked current repository sources]
MEMORY.md:18-23|note=[Located prior complaint context for the tablet interaction requirements]
rollout_summaries/2026-10-13T15-06-31-fB3M-fix_all_complaints_visual_tikz_editor.md:9-21|note=[Used complaint history to locate requirements, without relying on prior completion claims]
</citation_entries>
<rollout_ids>
01a12b01-36c2-7a52-ab6c-f24563f3e6d4
01a135cd-06b8-7d22-9ea7-96b1b13ffd96
</rollout_ids>
</oai-mem-citation>
