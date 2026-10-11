import { svgToTikz } from 'svg2tikz';
import { z } from 'zod';

const coordinate = z.number().finite();
export const originalStrokeSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]+$/),
  intent: z.enum(['geometry', 'ink']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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
}).strict();

export type OriginalStroke = z.infer<typeof originalStrokeSchema>;
export function tikzStrokeColor(stroke: OriginalStroke): string {
  const rgb = [1, 3, 5].map(offset => parseInt(stroke.color.slice(offset, offset + 2), 16));
  return `{rgb,255:red,${rgb[0]};green,${rgb[1]};blue,${rgb[2]}}`;
}

export function originalDrawingSource(stroke: OriginalStroke): string {
  if (stroke.outline !== undefined) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // The converter uses downward SVG coordinates and centimetres. The ink
    // contract uses the same upward point coordinates as its sensor samples.
    svg.setAttribute('viewBox', '0 -1 1 1');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', stroke.outline.path);
    path.setAttribute('fill', stroke.outline.fill);
    svg.append(path);
    return svgToTikz(svg, { scale: 1 / 28.4528, precision: 8 })
      .replace('\\begin{tikzpicture}', '\\begin{scope}[yscale=-1]')
      .replace('\\end{tikzpicture}', '\\end{scope}');
  }
  return `\\draw[draw=${tikzStrokeColor(stroke)}] ${stroke.samples.map(sample => `(${sample.x}pt,${sample.y}pt)`).join(' -- ')};`;
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
