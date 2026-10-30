import {
  type EditorSnapshotResult,
  type SnapshotRequest,
  snapshotResultSchema,
} from "../vendor/tikz-editor/embed/src/snapshot-protocol";
import { requestEditor } from "./editor-request";

export { snapshotResultSchema };

/** One request against the exact loaded source; abort also removes its listener. */
export function requestEditorSnapshot(
  frame: HTMLIFrameElement,
  target: Pick<SnapshotRequest, "sessionId" | "revision" | "source">,
  signal: AbortSignal,
): Promise<EditorSnapshotResult> {
  return requestEditor(
    frame,
    { action: "snapshot", ...target },
    snapshotResultSchema,
    signal,
    (requestId, error) => ({ event: "snapshot", status: "failed", ...target, requestId, error }),
  );
}
