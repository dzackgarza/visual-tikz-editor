import { sourceReplySchema } from "../vendor/tikz-editor/embed/src/events";
import { requestEditor } from "./editor-request";

export async function requestEditorSource(
  frame: HTMLIFrameElement,
  target: { sessionId: string; revision: number },
  signal: AbortSignal,
): Promise<string> {
  const result = await requestEditor(
    frame,
    { action: "source", ...target },
    sourceReplySchema,
    signal,
    (requestId, error) =>
      ({
        event: "reply",
        action: "source",
        status: "failed",
        ...target,
        requestId,
        error,
      }) as const,
  );
  if (result.status === "failed") throw new Error(`Could not read editor source: ${result.error}`);
  return result.source;
}
