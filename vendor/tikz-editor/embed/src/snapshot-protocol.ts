import { z } from 'zod';

const identity = {
  sessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  requestId: z.string().min(1),
};

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
    viewBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    state: z.object({
      selection: z.array(z.string()),
      tool: z.string(),
      viewport: z.object({ scale: z.number(), translateX: z.number(), translateY: z.number() }),
    }),
  }),
  z.object({
    event: z.literal('snapshot'),
    ...identity,
    status: z.literal('failed'),
    error: z.enum(['stale-target', 'source-changed', 'render-failed', 'cancelled', 'timeout', 'busy']),
  }),
]);

export type EditorSnapshotResult = z.infer<typeof snapshotResultSchema>;
export type EditorSnapshot = Extract<EditorSnapshotResult, { status: 'ready' }>;
export type SnapshotFailure = Extract<EditorSnapshotResult, { status: 'failed' }>['error'];
