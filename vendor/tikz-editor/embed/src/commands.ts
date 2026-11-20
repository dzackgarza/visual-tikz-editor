import { z } from 'zod';
import { editorStateSchema } from './editor-state';
import { snapshotRequestSchema } from './snapshot-protocol';

export const commandIdentitySchema = z.object({
  sessionId: z.string().uuid(),
  revision: z.number().int().positive(),
  requestId: z.string().min(1),
});
const identity = commandIdentitySchema.shape;
export const panelSchema = z.enum(['layers', 'properties']).nullable();
export type Panel = z.infer<typeof panelSchema>;
/** A range of the new source that a change wrote; an empty range marks a deletion. */
export const changedRangeSchema = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() })
  .refine(range => range.from <= range.to, 'A changed range ends before it starts');
export type ChangedRange = z.infer<typeof changedRangeSchema>;

export const hostCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...identity, action: z.literal('load'), source: z.string(), fileName: z.string(),
    imageBaseUrl: z.string().optional(), nativeClipboard: z.boolean().optional(), state: editorStateSchema.optional(), autosave: z.literal(0).optional() }),
  // The source that Undo, Redo, or another view wrote, and the ranges of it that the change
  // wrote; the viewport and the tool stay.
  z.object({ ...identity, action: z.literal('replace-source'), source: z.string(), changed: z.array(changedRangeSchema).nullable() }),
  z.object({ ...identity, action: z.literal('display'), fullscreen: z.boolean() }),
  z.object({ ...identity, action: z.literal('panel'), panel: panelSchema }),
  // The shell opened a popover of its own, so the canvas closes its open one.
  z.object({ ...identity, action: z.literal('dismiss-popover') }),
  // A menu of the shell opened or closed. While one is open, the next press in the canvas closes it.
  z.object({ ...identity, action: z.literal('host-popover'), open: z.boolean() }),
  // The shell's Undo while a construction is in progress: the canvas takes back its last placed point.
  z.object({ ...identity, action: z.literal('undo-construction') }),
  z.object({ ...identity, action: z.literal('source') }),
  // A zoom command names one of: a direction; a scale, where 1 is printed size; or a factor of the
  // present scale with the point of the frame, in CSS pixels, that stays in its place.
  z.object({ ...identity, action: z.literal('zoom'),
    direction: z.enum(['in', 'out', 'fit', 'selection', 'normal']).optional(), scale: z.number().positive().optional(),
    factor: z.number().positive().optional(), at: z.object({ x: z.number(), y: z.number() }).optional() })
    .refine(command => [command.direction, command.scale, command.factor].filter(value => value !== undefined).length === 1
      && (command.factor === undefined) === (command.at === undefined)),
  // How far the host's on-screen keyboard reaches up from the bottom of this frame.
  z.object({ ...identity, action: z.literal('keyboard'), bottom: z.number().nonnegative() }),
  z.object({ ...identity, action: z.literal('clipboard-result'), targetRequestId: z.string().min(1), text: z.string().optional(), error: z.string().optional() }),
  z.object({ ...identity, action: z.literal('cancel'), targetRequestId: z.string().min(1) }),
  snapshotRequestSchema,
]);

export type HostCommand = z.infer<typeof hostCommandSchema>;
