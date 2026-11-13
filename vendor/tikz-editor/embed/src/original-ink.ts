import { svgToTikz } from 'svg2tikz';
import { z } from 'zod';

const coordinate = z.number();
function strokeColorComponents(color: string): { rgb: number[]; alpha: number } | null {
  if (/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(color)) {
    return { rgb: [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)),
      alpha: color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1 };
  }
  const match = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0|1)(?:\.\d+)?|\.\d+)\s*\)$/.exec(color);
  if (match === null) return null;
  const rgb = match.slice(1, 4).map(Number);
  const alpha = Number(match[4]);
  return rgb.every(value => value <= 255) && alpha >= 0 && alpha <= 1 ? { rgb, alpha } : null;
}
export const originalStrokeSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]+$/),
  intent: z.enum(['geometry', 'ink']),
  color: z.string().refine(color => strokeColorComponents(color) !== null, 'Expected hex RGB, hex RGBA or rgba() color'),
  /** The pen's line width in points, present only when it differs from TikZ's default. */
  lineWidth: z.number().positive().optional(),
  /** The pen's TikZ dash style, present only when the line is not solid. */
  lineStyle: z.enum(['dashed', 'dotted']).optional(),
  /** The pen's smoothing in centimetres, present only when positive; the drawing smooths the samples by it. */
  smoothing: z.number().positive().optional(),
  samples: z.array(z.object({
    x: coordinate, y: coordinate, time: coordinate,
    pressure: coordinate.optional(), altitude: coordinate.optional(),
    azimuth: coordinate.optional(), roll: coordinate.optional(),
    hoverHeight: coordinate.optional(), tiltX: coordinate.optional(), tiltY: coordinate.optional(),
    buttons: z.number().int().nonnegative().optional(),
    capabilities: z.number().int().nonnegative().optional(),
    id: z.number().int().nonnegative().optional(),
    tool: z.number().int().nonnegative().optional(),
    phase: z.number().int().nonnegative().optional(), predicted: z.boolean().optional(),
  }).strict()).min(2),
  outline: z.object({ path: z.string(), fill: z.string() }).strict().optional(),
  /** Named points the first and last samples are attached to, written as TikZ references so the stroke follows them. */
  ends: z.object({ start: z.string().optional(), end: z.string().optional() }).strict().optional(),
}).strict();

export type OriginalStroke = z.infer<typeof originalStrokeSchema>;
export function tikzStrokeColor(stroke: OriginalStroke): string {
  const components = strokeColorComponents(stroke.color);
  if (components === null) throw new Error('Invalid original ink color');
  const { rgb } = components;
  return `{rgb,255:red,${rgb[0]};green,${rgb[1]};blue,${rgb[2]}}`;
}

export function tikzStrokeOpacity(stroke: OriginalStroke): number {
  const components = strokeColorComponents(stroke.color);
  if (components === null) throw new Error('Invalid original ink color');
  return components.alpha;
}

/** A stroke colour with its alpha multiplied by an opacity, as rgba() so the opacity is written exactly. */
export function strokeColorWithOpacity(color: string, opacity: number): string {
  const components = strokeColorComponents(color);
  if (components === null) throw new Error('Invalid original ink color');
  return opacity === 1 ? color : `rgba(${components.rgb.join(',')},${components.alpha * opacity})`;
}

/** TeX's point: 72.27 pt to the inch, 2.54 cm to the inch (The TeXbook, ch. 10). */
const PT_PER_CM = 72.27 / 2.54;

/**
 * One capped Laplacian step: each interior point moves toward the midpoint of its neighbours
 * by at most `centimetres`; the ends stay where the pen put them. The step is at most half the
 * way, the binomial [1 2 1]/4 filter: a full step maps a sample-to-sample zigzag onto its mirror
 * image instead of flattening it (G. Taubin, "A signal processing approach to fair surface
 * design", SIGGRAPH 1995, Laplacian smoothing with 0 < λ ≤ 1/2).
 */
export function smoothPolyline<Point extends { x: number; y: number }>(points: readonly Point[], centimetres: number): (Omit<Point, 'x' | 'y'> & { x: number; y: number })[] {
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const dx = (points[index - 1].x + points[index + 1].x) / 2 - point.x;
    const dy = (points[index - 1].y + points[index + 1].y) / 2 - point.y;
    const displacement = Math.hypot(dx, dy);
    const amount = displacement === 0 ? 0 : Math.min(0.5, centimetres * PT_PER_CM / displacement);
    return { ...point, x: point.x + dx * amount, y: point.y + dy * amount };
  });
}

/** The TikZ options a stroke's drawing carries beyond its colour: opacity below 1, width, and dash style. */
export function inkStyleOptions(stroke: OriginalStroke): string[] {
  const opacity = tikzStrokeOpacity(stroke);
  return [
    ...(opacity === 1 ? [] : [`draw opacity=${opacity}`]),
    ...(stroke.lineWidth === undefined ? [] : [`line width=${stroke.lineWidth}pt`]),
    ...(stroke.lineStyle === undefined ? [] : [stroke.lineStyle]),
  ];
}

export function originalDrawingSource(stroke: OriginalStroke): string {
  if (stroke.outline !== undefined) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // The converter uses downward SVG coordinates and centimetres. The ink
    // contract uses the same upward point coordinates as its sensor samples.
    svg.setAttribute('viewBox', '0 -1 1 1');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', stroke.outline.path);
    const fill = strokeColorComponents(stroke.outline.fill);
    path.setAttribute('fill', fill === null ? stroke.outline.fill : `rgb(${fill.rgb.join(',')})`);
    if (fill !== null && fill.alpha < 1) path.setAttribute('fill-opacity', String(fill.alpha));
    svg.append(path);
    return svgToTikz(svg, { scale: 1 / 28.4528, precision: 8 })
      .replace('\\begin{tikzpicture}', '\\begin{scope}[yscale=-1]')
      .replace('\\end{tikzpicture}', '\\end{scope}');
  }
  const samples = stroke.smoothing === undefined ? stroke.samples : smoothPolyline(stroke.samples, stroke.smoothing);
  const last = samples.length - 1;
  const point = (index: number) => {
    const name = index === 0 ? stroke.ends?.start : index === last ? stroke.ends?.end : undefined;
    return name === undefined ? `(${samples[index].x}pt,${samples[index].y}pt)` : `(${name})`;
  };
  const options = [`draw=${tikzStrokeColor(stroke)}`, ...inkStyleOptions(stroke)].join(',');
  return `\\draw[${options}] ${samples.map((_sample, index) => point(index)).join(' -- ')};`;
}
export const originalAssociationSchema = z.object({
  stroke: originalStrokeSchema,
  sourceIds: z.array(z.string()),
});

/** Source comments travel through the existing source history and file storage. */
export function strokeEnvelope(stroke: OriginalStroke, source: string): string {
  return `% workbench-ink:${encodeURIComponent(JSON.stringify(stroke))}\n\\begin{scope}\n${source}\n\\end{scope}\n% workbench-ink-end:${stroke.key}\n`;
}

export function originalStrokes(source: string) {
  const entries: { stroke: OriginalStroke; from: number; to: number; drawingFrom: number; drawingTo: number }[] = [];
  const keys = new Set<string>();
  for (const match of source.matchAll(/^[ \t]*% workbench-ink:([^\r\n]+)\r?\n/gm)) {
    const stroke = originalStrokeSchema.parse(JSON.parse(decodeURIComponent(match[1])));
    if (keys.has(stroke.key)) throw new Error(`Duplicate original stroke key: ${stroke.key}`);
    keys.add(stroke.key);
    const scopeFrom = match.index + match[0].length;
    const scope = /^\\begin\{scope\}\r?\n/.exec(source.slice(scopeFrom));
    if (scope === null) throw new Error(`Missing original stroke scope: ${stroke.key}`);
    const drawingFrom = scopeFrom + scope[0].length;
    const end = new RegExp(`\\r?\\n\\\\end\\{scope\\}\\r?\\n% workbench-ink-end:${stroke.key}(?=\\r?\\n|$)`).exec(source.slice(drawingFrom));
    if (end === null) throw new Error(`Missing original stroke boundary: ${stroke.key}`);
    const drawingTo = drawingFrom + end.index;
    entries.push({ stroke, from: match.index, to: drawingTo + end[0].length, drawingFrom, drawingTo });
  }
  return entries;
}
