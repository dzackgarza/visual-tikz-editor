import { z } from 'zod';

const coordinate = z.number();
export const originalStrokeSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]+$/),
  /** The Pen preset as the toolbar holds it: an xcolor expression such as `red!50!blue`, or a picker colour (data-model Colour). */
  color: z.string().regex(/\S/u, 'Expected a colour'),
  /** The Pen's opacity, present only when below 1; it multiplies any opacity the colour states. */
  opacity: z.number().gt(0).lt(1).optional(),
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

export const originalAssociationSchema = z.object({
  stroke: originalStrokeSchema,
  sourceIds: z.array(z.string()),
});

/** Source comments travel through the existing source history and file storage. */
export function strokeEnvelope(stroke: OriginalStroke, source: string): string {
  return `% workbench-ink:${encodeURIComponent(JSON.stringify(stroke))}\n\\begin{scope}\n${source}\n\\end{scope}\n% workbench-ink-end:${stroke.key}\n`;
}

/**
 * The source without each envelope that holds no drawing. An edit that removes the last statement
 * of a drawing removes the stroke, so the stroke's samples leave the source with it.
 */
export function withoutEmptyEnvelopes(source: string): string {
  return source.replace(/^[ \t]*% workbench-ink:[^\r\n]+\r?\n\\begin\{scope\}\s*\\end\{scope\}\r?\n% workbench-ink-end:[^\r\n]*(?:\r?\n|$)/gm, '');
}

/**
 * The text of a record comment, read as a stroke. The source is text a person can edit and other
 * builds write, so a text that is not a stroke is an issue of the parse, not an exception
 * (Zod, "json(schema)": a JSON.parse failure becomes an issue; https://zod.dev/codecs).
 */
const strokeRecordSchema = z.string().transform((text, context) => {
  try {
    return JSON.parse(decodeURIComponent(text)) as z.core.util.JSONType;
  } catch {
    context.issues.push({ code: 'custom', message: 'The record is not URI-encoded JSON', input: text });
    return z.NEVER;
  }
}).pipe(originalStrokeSchema);

type StrokeRecords = {
  entries: { stroke: OriginalStroke; from: number; to: number; drawingFrom: number; drawingTo: number }[];
  /** The records that are not strokes of this build, each with the offset of its comment and the reason. */
  unreadable: { from: number; reason: string }[];
};

function strokeRecords(source: string): StrokeRecords {
  const records: StrokeRecords = { entries: [], unreadable: [] };
  const keys = new Set<string>();
  for (const match of source.matchAll(/^[ \t]*% workbench-ink:([^\r\n]+)\r?\n/gm)) {
    const read = strokeRecordSchema.safeParse(match[1]);
    if (!read.success) { records.unreadable.push({ from: match.index, reason: read.error.issues[0].message }); continue; }
    const stroke = read.data;
    if (keys.has(stroke.key)) { records.unreadable.push({ from: match.index, reason: `A record before this one has the key ${stroke.key}` }); continue; }
    const scopeFrom = match.index + match[0].length;
    const scope = /^\\begin\{scope\}\r?\n/.exec(source.slice(scopeFrom));
    if (scope === null) { records.unreadable.push({ from: match.index, reason: `No \\begin{scope} follows the record ${stroke.key}` }); continue; }
    const drawingFrom = scopeFrom + scope[0].length;
    // The drawing is empty when `\end{scope}` follows `\begin{scope}` directly.
    const end = new RegExp(`(?:^|\\r?\\n)\\\\end\\{scope\\}\\r?\\n% workbench-ink-end:${stroke.key}(?=\\r?\\n|$)`).exec(source.slice(drawingFrom));
    if (end === null) { records.unreadable.push({ from: match.index, reason: `No "% workbench-ink-end:${stroke.key}" line closes the record` }); continue; }
    keys.add(stroke.key);
    const drawingTo = drawingFrom + end.index;
    records.entries.push({ stroke, from: match.index, to: drawingTo + end[0].length, drawingFrom, drawingTo });
  }
  return records;
}

/** The recorded strokes of the source. A record this build cannot read is not one of them: its drawing is ordinary TikZ. */
export function originalStrokes(source: string) {
  return strokeRecords(source).entries;
}

/** The stroke records of the source that this build cannot read. The source keeps them as they are. */
export function unreadableStrokeRecords(source: string) {
  return strokeRecords(source).unreadable;
}
