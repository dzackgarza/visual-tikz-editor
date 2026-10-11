import { z } from 'zod';
import { originalAssociationSchema } from './original-ink';

const identity = {
  sessionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  requestId: z.string().min(1),
};

export const editorStateSchema = z.object({
  selection: z.array(z.string()),
  tool: z.enum(['select', 'magnify', 'addBucket', 'addNode', 'addPoint', 'addImage', 'addMatrix',
    'addShape', 'addPath', 'addFreehand', 'addLine', 'addGrid', 'addRect', 'addEllipse',
    'addCircle', 'addArc', 'addArrow', 'addBezier']),
  viewport: z.object({ scale: z.number().positive(), translateX: z.number(), translateY: z.number() }),
  fitToContent: z.boolean(),
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
    viewBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    state: editorStateSchema,
  }),
  z.object({
    event: z.literal('snapshot'),
    ...identity,
    status: z.literal('failed'),
    error: z.enum(['stale-target', 'source-changed', 'render-failed', 'resource-unavailable', 'invalid-original-ink', 'cancelled', 'timeout', 'busy']),
  }),
]);

export type EditorSnapshotResult = z.infer<typeof snapshotResultSchema>;
export type EditorSnapshot = Extract<EditorSnapshotResult, { status: 'ready' }>;
export type SnapshotFailure = Extract<EditorSnapshotResult, { status: 'failed' }>['error'];
