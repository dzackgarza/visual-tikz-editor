import { z } from 'zod';

export const toolModeSchema = z.enum([
  'select', 'lasso', 'erase', 'magnify', 'addFreehand', 'addLine', 'addArrow', 'addNode', 'addPoint',
  'addImage', 'addCircle', 'addRect', 'addEllipse', 'addArc', 'addPath', 'addBezier',
  'addShape', 'addMatrix', 'addGrid', 'addBucket',
]);

/** A locked or hidden statement: its span and its text in the source, which must still hold that text there. */
const statementMarkSchema = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string().min(1) });

/** The view of one file that the canvas shows: a snapshot reports it, and a reopened file restores it (FR-040). */
export const editorStateSchema = z.object({
  activeFigureId: z.string().min(1),
  selection: z.array(z.string()),
  tool: toolModeSchema,
  /** The scale and the figure point, in TikZ points, at the centre of the canvas. */
  viewport: z.object({ scale: z.number().positive(), centerX: z.number(), centerY: z.number() }),
  fitToContent: z.boolean(),
  /** Layer lock and visibility: view state beside the source, never in it, so a hidden layer still prints (data-model Layer). */
  locked: z.array(statementMarkSchema),
  hidden: z.array(statementMarkSchema),
});

export type EditorState = z.infer<typeof editorStateSchema>;
