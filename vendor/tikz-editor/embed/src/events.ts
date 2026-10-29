import { z } from 'zod';
import { commandIdentitySchema } from './commands';
import { snapshotResultSchema } from './snapshot-protocol';

export const commandFailureSchema = z.enum([
  'invalid-command', 'stale-target', 'source-changed', 'duplicate-stroke-key',
  'unsupported-source', 'missing-stroke', 'ink-is-not-geometry', 'no-fit',
  'edit-rejected', 'invalid-original-ink', 'cancelled', 'timeout', 'busy',
]);
export type CommandFailure = z.infer<typeof commandFailureSchema>;

const action = z.enum(['load', 'settings', 'display', 'inspector', 'source',
  'zoom', 'keyboard', 'clipboard-result', 'import-ink', 'interpret-ink', 'restore-ink', 'cancel']);
const identity = commandIdentitySchema.shape;
export const commandReplySchema = z.discriminatedUnion('status', [
  z.object({ ...identity, event: z.literal('reply'), status: z.literal('ok'), action,
    source: z.string().optional(), sourceRevision: z.number().int().nonnegative().optional() }),
  z.object({ ...identity, event: z.literal('reply'), status: z.literal('failed'), action: action.optional(), error: commandFailureSchema }),
]);
export type CommandReply = z.infer<typeof commandReplySchema>;

export const sourceReplySchema = z.object({ ...identity, event: z.literal('reply'), action: z.literal('source') }).and(
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), source: z.string() }),
    z.object({ status: z.literal('failed'), error: commandFailureSchema }),
  ]),
);

// Bootstrap platform notifications can precede the first source load.
const notificationIdentity = { sessionId: z.string(), revision: z.number().int().nonnegative() };
export const editorNotificationSchema = z.discriminatedUnion('event', [
  z.object({ ...notificationIdentity, event: z.literal('init'), version: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('loaded') }),
  z.object({ ...notificationIdentity, event: z.literal('change'), source: z.string(), sourceRevision: z.number().int().nonnegative() }),
  z.object({ ...notificationIdentity, event: z.literal('rendered'), sourceRevision: z.number().int().nonnegative() }),
  z.object({ ...notificationIdentity, event: z.literal('save'), source: z.string(), fileName: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('status'), modified: z.boolean() }),
  z.object({ ...notificationIdentity, event: z.literal('persistence-save'), key: z.string(), value: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('message'), title: z.string(), message: z.string(), kind: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('error'), message: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('close-request') }),
  z.object({ ...notificationIdentity, event: z.literal('inspector-closed') }),
  z.object({ ...notificationIdentity, event: z.literal('source-selection'), source: z.string(), from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  z.object({ ...notificationIdentity, event: z.literal('clipboard-read'), requestId: z.string().min(1) }),
  z.object({ ...notificationIdentity, event: z.literal('clipboard-write'), requestId: z.string().min(1), text: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('export'), format: z.string(), source: z.string(),
    svg: z.string(), data: z.unknown(), error: z.string().optional() }),
]);
export const editorEventSchema = z.union([editorNotificationSchema, commandReplySchema, snapshotResultSchema]);
export type EditorEvent = z.infer<typeof editorEventSchema>;
export type EditorNotification = z.infer<typeof editorNotificationSchema>;
