# Vue presentation handoff

The standalone app uses a PrimeVue document menu and split pane. Vue owns view selection and the floating drawing rail. The pinned editor receives tool and setting commands through the iframe bridge. Its embedded menu, tabs, toolbar, and status bar do not render. The source pane stays on the left.

## Required work

- Move selected-object properties into a Vue inspector. The fork still renders its own inspector over the canvas. Expose selection, property values, and edit commands through the bridge before replacing that inspector.
- Check the final dark source-pane height and popover colors in a rendered browser. The last CSS change followed the dark capture and has a successful build, but no later capture.
- Exercise source edits, drawing edits, view changes, shape and matrix presets, and settings in browser workflows. The current browser interaction confirmed a tool command round trip and an open settings popover.
- Check the shared workbench in its Zettlr host. The standalone host registers the PrimeVue theme; the shared workbench imports PrimeVue controls.

## Evidence and commands

- `just update-tikz-editor-vendor` rebuilt the pinned fork from `vendor/tikz-editor/ZETTLR.patch` and `vendor/tikz-editor/embed/`.
- `just test-commit` and `just build` passed on the current source.
- Current light captures: [tablet](docs/audits/standalone-primevue-768.png) and [desktop](docs/audits/standalone-primevue-1280.png).
- The work remains within [issue #1](https://github.com/dzackgarza/visual-tikz-editor/issues/1) and the [tablet workflow audit](docs/audits/tablet-diagram-workflow.md).
