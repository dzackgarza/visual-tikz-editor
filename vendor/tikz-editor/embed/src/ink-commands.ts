import { useEditorStore } from '@tikz-editor/app/store';
import { interpretFreehandToolSource } from '@tikz-editor/app/freehand';
import { pt, worldPoint } from 'tikz-editor/coords/index';
import type { CommandFailure } from './events';
import type { HostCommand } from './commands';
import { originalStrokes, strokeEnvelope, originalDrawingSource, tikzStrokeColor } from './original-ink';

export function executeInkCommand(command: Extract<HostCommand, { action: 'import-ink' | 'interpret-ink' | 'restore-ink' }>): CommandFailure | undefined {
  const state = useEditorStore.getState();
  if (command.source !== state.source) return 'source-changed';
  const originals = originalStrokes(state.source);
  let next: string;
  if (command.action === 'import-ink') {
    const keys = new Set(originals.map(entry => entry.stroke.key));
    for (const stroke of command.strokes) {
      if (keys.has(stroke.key)) return 'duplicate-stroke-key';
      keys.add(stroke.key);
    }
    const end = state.source.lastIndexOf('\\end{tikzpicture}');
    if (end < 0) return 'unsupported-source';
    next = state.source.slice(0, end) + command.strokes.map(stroke => strokeEnvelope(stroke, originalDrawingSource(stroke))).join('') + state.source.slice(end);
  } else {
    const entry = originals.find(entry => entry.stroke.key === command.key);
    if (entry === undefined) return 'missing-stroke';
    let drawing = originalDrawingSource(entry.stroke);
    if (command.action === 'interpret-ink') {
      if (entry.stroke.intent !== 'geometry') return 'ink-is-not-geometry';
      const fit = interpretFreehandToolSource({
        points: entry.stroke.samples.map(sample => worldPoint(pt(sample.x), pt(sample.y))),
        minSampleDistanceWorld: 0,
      }, 1, command.tolerance, { strokeColor: tikzStrokeColor(entry.stroke) });
      if (fit === null || fit.kind === 'raw') return 'no-fit';
      drawing = fit.source;
    }
    next = state.source.slice(0, entry.drawingFrom) + drawing + state.source.slice(entry.drawingTo);
  }
  if (next === state.source) return;
  state.dispatch({ type: 'REPLACE_FREEHAND_RESULT', from: 0, before: state.source, after: next,
    expectedSourceRevision: state.sourceRevision });
  if (useEditorStore.getState().source !== next) return 'edit-rejected';
}
