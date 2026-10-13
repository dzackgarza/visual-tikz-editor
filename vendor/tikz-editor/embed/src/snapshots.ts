import { useEditorStore } from '@tikz-editor/app/store';
import { worldToSvgBounds } from 'tikz-editor/coords/index';
import { exportSvg } from './export-svg';
import { originalStrokes } from './original-ink';
import type { EditorSnapshotResult, SnapshotFailure, SnapshotRequest } from './snapshot-protocol';

/** Wait on the editor's own scheduler; never pair source with its previous SVG. */
export function createSnapshotRequests(send: (reply: EditorSnapshotResult) => void, imageBaseUrl: () => string) {
  type Pending = { request: SnapshotRequest; sourceRevision: number; activeFigureId: string | null; timer: number; abort: AbortController; exporting: boolean };
  const pending = new Map<string, Pending>();
  const completed = new Map<string, { request: SnapshotRequest; reply: EditorSnapshotResult }>();
  const sameRequest = (a: SnapshotRequest, b: SnapshotRequest) =>
    a.sessionId === b.sessionId && a.revision === b.revision && a.source === b.source;

  function finish(requestId: string, reply: EditorSnapshotResult): void {
    const entry = pending.get(requestId);
    if (entry === undefined) return;
    window.clearTimeout(entry.timer);
    entry.abort.abort();
    pending.delete(requestId);
    completed.set(requestId, { request: entry.request, reply });
    if (completed.size > 32) completed.delete(completed.keys().next().value!);
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
      if (entry.activeFigureId !== null && state.activeFigureId !== entry.activeFigureId) { fail(requestId, 'stale-target'); continue; }
      if (entry.exporting || state.pendingViewportRestore !== null) continue;
      if (state.pendingRequestId !== null || state.snapshot.source !== request.source) continue;
      if (state.snapshot.activeFigureId !== state.activeFigureId) continue;
      const drawing = state.snapshot.svg;
      if (drawing === null) {
        fail(requestId, 'render-failed');
        continue;
      }
      let originals;
      try { originals = originalStrokes(request.source); }
      catch { fail(requestId, 'invalid-original-ink'); continue; }
      const activeFigure = state.snapshot.figures.find(figure => figure.id === state.activeFigureId);
      if (activeFigure === undefined) { fail(requestId, 'render-failed'); continue; }
      originals = originals.filter(original => original.from >= activeFigure.span.from && original.to <= activeFigure.span.to);
      entry.exporting = true;
      const result = {
        event: 'snapshot', status: 'ready',
        sessionId: request.sessionId, revision: request.revision, requestId,
        sourceRevision, source: request.source,
        originalInk: originals.map(entry => ({
          stroke: entry.stroke,
          sourceIds: (state.snapshot.scene?.elements ?? [])
            .filter(element => element.sourceRef.sourceSpan.from >= entry.drawingFrom && element.sourceRef.sourceSpan.to <= entry.drawingTo)
            .map(element => element.sourceRef.sourceId),
        })),
        localBounds: state.snapshot.scene?.bounds ? worldToSvgBounds(state.snapshot.scene.bounds, drawing.viewBox) : null,
        viewBox: drawing.viewBox,
        state: {
          activeFigureId: activeFigure.id,
          selection: [...state.selectedElementIds], tool: state.toolMode,
          viewport: { ...state.canvasTransform },
          interpretGeometry: state.freehandInterpretGeometry,
        },
      } as const;
      void exportSvg(drawing.svg, `figure-${request.sessionId}-${request.revision}-${sourceRevision}`, imageBaseUrl(), entry.abort.signal)
        .then(svg => finish(requestId, { ...result, svg }), () => fail(requestId, 'resource-unavailable'));
    }
  }

  const unsubscribe = useEditorStore.subscribe(advance);
  return {
    request(request: SnapshotRequest, sessionId: string, revision: number): void {
      const previous = completed.get(request.requestId);
      if (previous) {
        send(sameRequest(previous.request, request) ? previous.reply :
          { ...request, event: 'snapshot', status: 'failed', error: 'request-id-reused' });
        return;
      }
      const active = pending.get(request.requestId);
      if (active) {
        if (!sameRequest(active.request, request)) fail(request.requestId, 'request-id-reused');
        return;
      }
      if (pending.size >= 32) {
        send({ ...request, event: 'snapshot', status: 'failed', error: 'busy' });
        return;
      }
      const state = useEditorStore.getState();
      pending.set(request.requestId, {
        request, sourceRevision: state.sourceRevision,
        activeFigureId: state.snapshot.source === request.source ? state.activeFigureId : null,
        abort: new AbortController(), exporting: false,
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
      for (const entry of pending.values()) { window.clearTimeout(entry.timer); entry.abort.abort(); }
      pending.clear();
      completed.clear();
    },
  };
}
