import { z } from "zod";
import { requestEditor } from "./editor-request";

const sourceReply = z.object({
  event: z.literal("reply"), action: z.literal("source"),
  sessionId: z.string().uuid(), revision: z.number().int().nonnegative(), requestId: z.string(),
}).and(z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), source: z.string() }),
  z.object({ status: z.literal("failed"), error: z.enum(["stale-target", "cancelled", "timeout"]) }),
]));

export async function requestEditorSource(
  frame: HTMLIFrameElement,
  target: { sessionId: string; revision: number },
  signal: AbortSignal,
): Promise<string> {
  const result = await requestEditor(frame, { action: "source", ...target }, sourceReply, signal,
    (requestId, error) => ({ event: "reply", action: "source", status: "failed", ...target, requestId, error } as const));
  if (result.status === "failed") throw new Error(`Could not read editor source: ${result.error}`);
  return result.source;
}
