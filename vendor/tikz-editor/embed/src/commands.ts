import { z } from 'zod';
import { snapshotRequestSchema, editorStateSchema } from './snapshot-protocol';
import { originalStrokeSchema } from './original-ink';

export const commandIdentitySchema = z.object({
  sessionId: z.string().uuid(),
  revision: z.number().int().positive(),
  requestId: z.string().min(1),
});
const identity = commandIdentitySchema.shape;
const settings = z.object({ general: z.object({
  colorScheme: z.enum(['system', 'light', 'dark']).optional(),
  canvasInvert: z.boolean().optional(),
}).optional() });
export const toolModeSchema = z.enum([
  'select', 'magnify', 'addFreehand', 'addLine', 'addArrow', 'addNode', 'addPoint',
  'addImage', 'addCircle', 'addRect', 'addEllipse', 'addArc', 'addPath', 'addBezier',
  'addShape', 'addMatrix', 'addGrid', 'addBucket',
]);

export const hostCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...identity, action: z.literal('load'), source: z.string(), fileName: z.string(),
    imageBaseUrl: z.string().optional(), settings: settings.optional(), state: editorStateSchema.optional(), autosave: z.literal(0).optional() }),
  z.object({ ...identity, action: z.literal('settings'), settings }),
  z.object({ ...identity, action: z.literal('display'), fullscreen: z.boolean() }),
  z.object({ ...identity, action: z.literal('workspace'), workspace: z.enum(['default', 'canvasOnly']) }),
  z.object({ ...identity, action: z.literal('inspector'), inspector: z.boolean() }),
  z.object({ ...identity, action: z.literal('tool'), tool: toolModeSchema }),
  z.object({ ...identity, action: z.literal('tool-option'), option: z.enum(['smoothing', 'strokeColor', 'fillColor', 'shape', 'matrix']),
    value: z.union([z.string(), z.number()]).optional(), rows: z.number().int().positive().optional(), columns: z.number().int().positive().optional() }),
  z.object({ ...identity, action: z.literal('source') }),
  z.object({ ...identity, action: z.literal('import-ink'), source: z.string(), strokes: z.array(originalStrokeSchema).min(1) }),
  z.object({ ...identity, action: z.enum(['interpret-ink', 'restore-ink']), source: z.string(), key: z.string(), tolerance: z.number().min(4).max(32) }),
  z.object({ ...identity, action: z.literal('cancel'), targetRequestId: z.string().min(1) }),
  snapshotRequestSchema,
]);

export type HostCommand = z.infer<typeof hostCommandSchema>;
