# Freehand geometry study

The current freehand tool keeps points at roughly 12 px spacing, filters them again by distance, then emits one cubic Bézier segment per retained interval. A browser stroke around a rough, nearly closed ellipse produced 23 `controls` clauses and 1,310 source characters. The end points stayed separate. The drawing was still a path rather than an editable TikZ ellipse. This is the baseline for [issue #5](https://github.com/dzackgarza/visual-tikz-editor/issues/5).

## Curve fitting

[Paper.js `Path.simplify(tolerance)`](https://paperjs.org/reference/path/) fits a short sequence of Bézier curves to stroke points with an allowed error. Its documented use includes mouse and touch strokes after release. A local spike used Paper.js 0.12.18 and four deterministic synthetic strokes. The [overlay](freehand-fitting.svg) draws input samples in gray and the fitted path in red at 8 px tolerance.

| Stroke | Samples | Curves at 2.5 px | Curves at 5 px | Curves at 8 px |
| --- | ---: | ---: | ---: | ---: |
| Nearly closed ellipse | 64 | 11 | 7 | 4 |
| Slightly noisy line | 40 | 22 | 2 | 2 |
| Sharp corner | 40 | 8 | 5 | 4 |
| Smooth irregular curve | 60 | 20 | 8 | 3 |

The figures show compact source is plausible, but a curve count is not a quality score. The overlay exposes where each fit moves the outline. The sharp corner remains close in this sample; a larger and varied corpus must check corner loss and overshoot. The ellipse fit remains open. `Path.toShape()` matches a path already equivalent to a known shape; it did not classify the sampled rough ellipse. These are separate operations.

The synthetic ellipse uses 64 samples of an axis-aligned 72 × 44 px ellipse, stopping slightly before one full turn, with sinusoidal offsets below 2 px. The line and corner have 40 samples each with small sinusoidal noise. The smooth curve has 60 samples. The overlay is evidence for the fitter's behavior on these inputs, not for pen accuracy or recognition rates.

## Dependency boundary

| Candidate | What it owns | Gap for editable TikZ |
| --- | --- | --- |
| [Paper.js](https://paperjs.org/reference/path/) | Error-bounded fitting to a small number of curves | It does not infer a rough ellipse, closure intent, or TikZ primitives. |
| [Simplify.js](https://github.com/mourner/simplify-js) | Polyline vertex reduction | It returns a polyline, not a few smooth curves or semantic shapes. |
| [Shapeit](https://github.com/Appfairy/shapeit/) | Rough polygon and circle classification | Its documented shape set has no ellipse. The current `shapeit` registry package exports an unrelated validation API, so its documented example is not a usable dependency contract. |
| [Interactive Shape Recognition](https://www.npmjs.com/package/interactive-shape-recognition) | Line, circle, and rectangle classification | Its documented output has no ellipse or editable geometry parameters. |
| [Desert Ant Shapes](https://www.npmjs.com/package/@desert-ant-labs/shapes) | Classification and geometric fitting of line, rectangle, triangle, ellipse, and star | Its source-available license needs a separate compatibility decision for this GPL repository and later hosts. |

**Recommended division:** use Paper.js for generic curve fitting. Treat geometric recognition as a separate candidate fit with measured residuals and closure checks. Keep a stroke as a path when no candidate meets its acceptance gate. A classifier name alone is not enough to place a TikZ primitive.

## Current editor transaction

On release, the editor keeps sampled points while the result control is open. It checks straight lines and axis-aligned circle or ellipse candidates, then uses Paper.js to fit remaining strokes to a shorter curve path. The original path enters source history first; the fit is a second edit. Undo restores the original path in one step. The anchored control offers **Restore stroke**, **Reapply fit**, and a fit-strength setting. The fitted source uses a TikZ line, circle, ellipse, or curve path.

Rectangle recognition, a representative-error check, corner preservation, and a selected-path command for later manual simplification remain open in [issue #5](https://github.com/dzackgarza/visual-tikz-editor/issues/5). A later command can resample a source path; it cannot recover stroke samples that were not saved.

Fit and snap parameters after recognition. Snapping each sampled point first does not create a concise geometric object. The shape candidate must be checked on real sketches and deliberate near misses before it becomes automatic.
