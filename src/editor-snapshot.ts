import {
  snapshotResultSchema,
  type EditorSnapshotResult,
  type SnapshotRequest,
} from "../vendor/tikz-editor/embed/src/snapshot-protocol";

export { snapshotResultSchema };

/** One request against the exact loaded source; abort also removes its listener. */
export function requestEditorSnapshot(
  frame: HTMLIFrameElement,
  target: Pick<SnapshotRequest, "sessionId" | "revision" | "source">,
  signal: AbortSignal,
): Promise<EditorSnapshotResult> {
  const requestId = crypto.randomUUID();
  const origin = new URL(frame.src, location.href).origin;
  const peer = frame.contentWindow;
  if (peer === null) throw new Error("The editor iframe is not mounted");

  return new Promise(resolve => {
    const failure = (error: "cancelled" | "timeout"): EditorSnapshotResult => ({
      event: "snapshot", status: "failed", sessionId: target.sessionId,
      revision: target.revision, requestId, error,
    });
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: EditorSnapshotResult): void => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = (): void => {
      // An unmounted consumer removes listeners without creating host traffic.
      if (signal.reason !== "disposed") {
        peer.postMessage({ action: "cancel", ...target, requestId: crypto.randomUUID(), targetRequestId: requestId }, origin);
      }
      finish(failure("cancelled"));
    };
    const receive = (event: MessageEvent): void => {
      if (event.source !== peer || event.origin !== origin) return;
      let data = event.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return; }
      }
      const parsed = snapshotResultSchema.safeParse(data);
      if (!parsed.success) return;
      const reply = parsed.data;
      if (reply.requestId !== requestId || reply.sessionId !== target.sessionId || reply.revision !== target.revision) return;
      finish(reply);
    };
    if (signal.aborted) {
      resolve(failure("cancelled"));
      return;
    }
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(failure("timeout")), 12000);
    peer.postMessage({ action: "snapshot", ...target, requestId }, origin);
  });
}
