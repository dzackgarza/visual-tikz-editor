import { z } from 'zod';

export const toolModeSchema = z.enum([
  'select', 'lasso', 'erase', 'magnify', 'addFreehand', 'addLine', 'addArrow', 'addNode', 'addPoint',
  'addImage', 'addCircle', 'addRect', 'addEllipse', 'addArc', 'addPath', 'addBezier',
  'addShape', 'addMatrix', 'addGrid', 'addBucket',
]);

/** The view of one file that the canvas shows: a snapshot reports it, and a reopened file restores it (FR-040). */
export const editorStateSchema = z.object({
  activeFigureId: z.string().min(1),
  selection: z.array(z.string()),
  tool: toolModeSchema,
  /** The scale and the figure point, in TikZ points, at the centre of the canvas. */
  viewport: z.object({ scale: z.number().positive(), centerX: z.number(), centerY: z.number() }),
  fitToContent: z.boolean(),
  interpretGeometry: z.boolean(),
});

export type EditorState = z.infer<typeof editorStateSchema>;
