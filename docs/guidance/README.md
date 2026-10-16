# Product and interface guidance

Read these documents when designing or implementing the mathematical drawing experience:

- [Product vision and tablet-first requirements](product-vision.md)
- [Ideal GUI](ideal-gui.md)
- [Warnings against following the mockups too literally](mockup-interpretation-warnings.md)

These documents reproduce the complete assistant responses from the 2026-10-16
conversation verbatim, including their tables, links, and citation blocks. Their
contents describe the intended product and interface; they are design guidance,
not evidence that those capabilities have been implemented or validated. Original
absolute file links are retained to preserve the requested verbatim record.

Source conversation: `01a144e2-ecd8-7bb2-a391-d9c4d2d05906`.

The prompts and user-visible commentary below preserve the context in conversation
order. The full responses are linked at their original positions.

## Request 1

Give a description of what this app is supposed to do and what a AAA tablet-first interface might look like or require, surpassing similar apps like IPE, QTikz, Inkscape, and so on, essentially working like a familiar ipad note-taking app that is specifically geared toward drawing research mathematics diagrams

### Commentary

I’ll inspect the app and its existing requirements, then describe the intended product and what a polished, tablet-first mathematics diagramming interface would require. I’ll also check the comparison apps so the distinctions are grounded in their actual capabilities.

### Commentary

I’m using the design and writing skills to frame this as a product vision. I’ll distinguish the app’s documented purpose from the additional capabilities needed to meet the tablet experience you’re describing.

### Commentary

The repository defines this as a focused editor for one diagram and its TikZ source; notebook organization belongs to the surrounding app. The existing complaints also make the central design requirement clear: drawing, selection, correction, and saving must behave coherently across a whole session. That gives the product a strong direction—a familiar pen-and-paper workflow with precise mathematical editing available as needed.

### Complete response

[Verbatim response](product-vision.md)

## Request 2

Describe the ideal GUI

### Commentary

I’ll describe a concrete tablet screen and how its controls change as you draw, select, and refine a diagram.

### Complete response

[Verbatim response](ideal-gui.md)

## Request 3

Check to see if the newly uploaded mockups have any clear or significant deviations from these guiding principles. Do not nit, they are obviously only rough draft mockups, one only needs to understand where they may significantly cause architectural drift

### Commentary

I’ll compare the new mockups with the recorded guidance, focusing on choices that could materially change the interaction model or architecture.

### Commentary

I’ve inspected all nine images. They broadly follow the guidance. I’m checking three consequential ambiguities: how drawing and selection modes interact, whether the geometry picker stays open during construction, and how editable TikZ is delivered from the export screen.

### Complete response

[Verbatim warnings against following the mockups too literally](mockup-interpretation-warnings.md)
