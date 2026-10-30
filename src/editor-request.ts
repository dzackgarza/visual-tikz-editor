import type { z } from "zod";

/** Correlate one editor request and release its listener on every completion path. */
export function requestEditor<T extends { sessionId: string; revision: number; requestId: string }>(
  frame: HTMLIFrameElement,
  command: { action: string; sessionId: string; revision: number; [key: string]: unknown },
  schema: z.ZodType<T>,
  signal: AbortSignal,
  failure: (requestId: string, error: "cancelled" | "timeout") => T,
): Promise<T> {
  const requestId = crypto.randomUUID();
  const origin = new URL(frame.src, location.href).origin;
  const peer = frame.contentWindow;
  if (peer === null) throw new Error("The editor iframe is not mounted");
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: T): void => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = (): void => {
      if (signal.reason !== "disposed") {
        peer.postMessage(
          {
            action: "cancel",
            sessionId: command.sessionId,
            revision: command.revision,
            requestId: crypto.randomUUID(),
            targetRequestId: requestId,
          },
          origin,
        );
      }
      finish(failure(requestId, "cancelled"));
    };
    const receive = (event: MessageEvent): void => {
      if (event.source !== peer || event.origin !== origin) return;
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) return;
      const reply = parsed.data;
      if (
        reply.requestId !== requestId ||
        reply.sessionId !== command.sessionId ||
        reply.revision !== command.revision
      )
        return;
      finish(reply);
    };
    if (signal.aborted) {
      resolve(failure(requestId, "cancelled"));
      return;
    }
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(failure(requestId, "timeout")), 12000);
    peer.postMessage({ ...command, requestId }, origin);
  });
}
