import { z } from 'zod';
import { editorStateSchema } from './editor-state';
import { snapshotRequestSchema } from './snapshot-protocol';

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
export const panelSchema = z.enum(['layers', 'properties']).nullable();
export type Panel = z.infer<typeof panelSchema>;

export const hostCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...identity, action: z.literal('load'), source: z.string(), fileName: z.string(),
    imageBaseUrl: z.string().optional(), nativeClipboard: z.boolean().optional(), settings: settings.optional(), state: editorStateSchema.optional(), autosave: z.literal(0).optional() }),
  // The source that the shell's document history restored; the viewport and the tool stay.
  z.object({ ...identity, action: z.literal('replace-source'), source: z.string() }),
  z.object({ ...identity, action: z.literal('settings'), settings }),
  z.object({ ...identity, action: z.literal('display'), fullscreen: z.boolean() }),
  z.object({ ...identity, action: z.literal('panel'), panel: panelSchema }),
  z.object({ ...identity, action: z.literal('document-properties') }),
  // The shell opened a popover of its own, so the canvas closes its open one.
  z.object({ ...identity, action: z.literal('dismiss-popover') }),
  z.object({ ...identity, action: z.literal('source') }),
  // A zoom command names a direction or a scale, where 1 is printed size.
  z.object({ ...identity, action: z.literal('zoom'),
    direction: z.enum(['in', 'out', 'fit', 'selection', 'normal']).optional(), scale: z.number().positive().optional() })
    .refine(command => (command.direction === undefined) !== (command.scale === undefined)),
  // How far the host's on-screen keyboard reaches up from the bottom of this frame.
  z.object({ ...identity, action: z.literal('keyboard'), bottom: z.number().nonnegative() }),
  z.object({ ...identity, action: z.literal('clipboard-result'), targetRequestId: z.string().min(1), text: z.string().optional(), error: z.string().optional() }),
  z.object({ ...identity, action: z.literal('cancel'), targetRequestId: z.string().min(1) }),
  snapshotRequestSchema,
]);

export type HostCommand = z.infer<typeof hostCommandSchema>;
