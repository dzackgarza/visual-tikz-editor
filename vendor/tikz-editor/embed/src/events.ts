import { z } from 'zod';
import { commandIdentitySchema, panelSchema } from './commands';
import { snapshotResultSchema } from './snapshot-protocol';

// A change to any message of commands.ts or events.ts raises this version. The shell
// refuses an editor that reports another one.
export const FRAME_PROTOCOL_VERSION = '2';

export const commandFailureSchema = z.enum(['invalid-command', 'stale-target', 'cancelled', 'timeout', 'busy']);
export type CommandFailure = z.infer<typeof commandFailureSchema>;

const action = z.enum(['load', 'replace-source', 'settings', 'display', 'panel', 'document-properties',
  'dismiss-popover', 'source', 'zoom', 'keyboard', 'clipboard-result', 'cancel']);
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
  z.object({ ...notificationIdentity, event: z.literal('change'), source: z.string(), sourceRevision: z.number().int().nonnegative(), step: z.number().int().nonnegative() }),
  z.object({ ...notificationIdentity, event: z.literal('rendered'), sourceRevision: z.number().int().nonnegative() }),
  z.object({ ...notificationIdentity, event: z.literal('save'), source: z.string(), fileName: z.string() }),
  // The Undo or Redo gesture inside the canvas; the shell owns the document history.
  z.object({ ...notificationIdentity, event: z.literal('undo-request') }),
  z.object({ ...notificationIdentity, event: z.literal('redo-request') }),
  z.object({ ...notificationIdentity, event: z.literal('selection'), empty: z.boolean() }),
  // The panel that is open after any change, including its own close button.
  z.object({ ...notificationIdentity, event: z.literal('panel'), panel: panelSchema }),
  z.object({ ...notificationIdentity, event: z.literal('popover-opened') }),
  z.object({ ...notificationIdentity, event: z.literal('status'), modified: z.boolean() }),
  z.object({ ...notificationIdentity, event: z.literal('persistence-save'), key: z.string(), value: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('message'), title: z.string(), message: z.string(), kind: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('error'), message: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('close-request') }),
  z.object({ ...notificationIdentity, event: z.literal('document-properties-closed') }),
  z.object({ ...notificationIdentity, event: z.literal('source-selection'), source: z.string(), from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  z.object({ ...notificationIdentity, event: z.literal('clipboard-read'), requestId: z.string().min(1) }),
  z.object({ ...notificationIdentity, event: z.literal('clipboard-write'), requestId: z.string().min(1), text: z.string() }),
  z.object({ ...notificationIdentity, event: z.literal('export'), format: z.string(), source: z.string(),
    svg: z.string(), data: z.unknown(), error: z.string().optional() }),
]);
export const editorEventSchema = z.union([editorNotificationSchema, commandReplySchema, snapshotResultSchema]);
export type EditorEvent = z.infer<typeof editorEventSchema>;
export type EditorNotification = z.infer<typeof editorNotificationSchema>;
