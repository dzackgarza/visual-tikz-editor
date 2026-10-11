import { useEditorStore } from '@tikz-editor/app/store';
import type { EditorSnapshotResult, SnapshotFailure, SnapshotRequest } from './snapshot-protocol';

/** Wait on the editor's own scheduler; never pair source with its previous SVG. */
export function createSnapshotRequests(send: (reply: EditorSnapshotResult) => void) {
  type Pending = { request: SnapshotRequest; sourceRevision: number; timer: number };
  const pending = new Map<string, Pending>();
  const completed = new Set<string>();

  function finish(requestId: string, reply: EditorSnapshotResult): void {
    const entry = pending.get(requestId);
    if (entry === undefined) return;
    window.clearTimeout(entry.timer);
    pending.delete(requestId);
    completed.add(requestId);
    send(reply);
  }

  function fail(requestId: string, error: SnapshotFailure): void {
    const entry = pending.get(requestId);
    if (entry === undefined) return;
    const { sessionId, revision } = entry.request;
    finish(requestId, { event: 'snapshot', status: 'failed', sessionId, revision, requestId, error });
  }

  function advance(): void {
    const state = useEditorStore.getState();
    for (const [requestId, entry] of pending) {
      const { request, sourceRevision } = entry;
      if (state.sourceRevision !== sourceRevision || state.source !== request.source) {
        fail(requestId, 'source-changed');
        continue;
      }
      if (state.pendingRequestId !== null || state.snapshot.source !== request.source) continue;
      if (state.snapshot.activeFigureId !== state.activeFigureId) continue;
      const drawing = state.snapshot.svg;
      if (drawing === null) {
        fail(requestId, 'render-failed');
        continue;
      }
      finish(requestId, {
        event: 'snapshot', status: 'ready',
        sessionId: request.sessionId, revision: request.revision, requestId,
        sourceRevision, source: request.source, svg: drawing.svg, viewBox: drawing.viewBox,
        state: {
          selection: [...state.selectedElementIds], tool: state.toolMode,
          viewport: { ...state.canvasTransform },
        },
      });
    }
  }

  const unsubscribe = useEditorStore.subscribe(advance);
  return {
    request(request: SnapshotRequest, sessionId: string, revision: number): void {
      if (completed.has(request.requestId) || pending.has(request.requestId)) return;
      if (pending.size >= 32) {
        send({ ...request, event: 'snapshot', status: 'failed', error: 'busy' });
        return;
      }
      pending.set(request.requestId, {
        request, sourceRevision: useEditorStore.getState().sourceRevision,
        timer: window.setTimeout(() => fail(request.requestId, 'timeout'), 10000),
      });
      if (request.sessionId !== sessionId || request.revision !== revision) {
        fail(request.requestId, 'stale-target');
        return;
      }
      advance();
    },
    cancel(requestId: string): void { fail(requestId, 'cancelled'); },
    replace(): void {
      for (const requestId of pending.keys()) fail(requestId, 'stale-target');
      completed.clear();
    },
    dispose(): void {
      unsubscribe();
      for (const entry of pending.values()) window.clearTimeout(entry.timer);
      pending.clear();
      completed.clear();
    },
  };
}
