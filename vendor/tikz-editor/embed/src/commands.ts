import { z } from 'zod';
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

export const hostCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...identity, action: z.literal('load'), source: z.string(), fileName: z.string(),
    imageBaseUrl: z.string().optional(), settings: settings.optional(), autosave: z.literal(0).optional() }),
  z.object({ ...identity, action: z.literal('settings'), settings }),
  z.object({ ...identity, action: z.literal('display'), fullscreen: z.boolean() }),
  z.object({ ...identity, action: z.literal('workspace'), workspace: z.enum(['default', 'canvasOnly']) }),
  z.object({ ...identity, action: z.literal('inspector'), inspector: z.boolean() }),
  z.object({ ...identity, action: z.literal('source') }),
  z.object({ ...identity, action: z.literal('cancel'), targetRequestId: z.string().min(1) }),
  snapshotRequestSchema,
]);

export type HostCommand = z.infer<typeof hostCommandSchema>;
