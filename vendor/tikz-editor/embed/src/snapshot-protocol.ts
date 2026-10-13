import { z } from 'zod';
import { originalAssociationSchema } from './original-ink';

const identity = {
  sessionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  requestId: z.string().min(1),
};

export const toolModeSchema = z.enum([
  'select', 'lasso', 'erase', 'magnify', 'addFreehand', 'addLine', 'addArrow', 'addNode', 'addPoint',
  'addImage', 'addCircle', 'addRect', 'addEllipse', 'addArc', 'addPath', 'addBezier',
  'addShape', 'addMatrix', 'addGrid', 'addBucket',
]);

export const editorStateSchema = z.object({
  activeFigureId: z.string().min(1),
  selection: z.array(z.string()),
  tool: toolModeSchema,
  viewport: z.object({ scale: z.number().positive(), translateX: z.number(), translateY: z.number() }),
  fitToContent: z.boolean(),
  interpretGeometry: z.boolean(),
});

export const snapshotRequestSchema = z.object({
  action: z.literal('snapshot'),
  ...identity,
  source: z.string(),
});

export type SnapshotRequest = z.infer<typeof snapshotRequestSchema>;

export const snapshotResultSchema = z.discriminatedUnion('status', [
  z.object({
    event: z.literal('snapshot'),
    ...identity,
    status: z.literal('ready'),
    sourceRevision: z.number().int().nonnegative(),
    source: z.string(),
    svg: z.string(),
    originalInk: z.array(originalAssociationSchema),
    localBounds: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }).nullable(),
    viewBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    state: editorStateSchema,
  }),
  z.object({
    event: z.literal('snapshot'),
    ...identity,
    status: z.literal('failed'),
    error: z.enum(['stale-target', 'source-changed', 'render-failed', 'resource-unavailable', 'invalid-original-ink', 'request-id-reused', 'cancelled', 'timeout', 'busy']),
  }),
]);

export type EditorSnapshotResult = z.infer<typeof snapshotResultSchema>;
export type EditorSnapshot = Extract<EditorSnapshotResult, { status: 'ready' }>;
export type SnapshotFailure = Extract<EditorSnapshotResult, { status: 'failed' }>['error'];
