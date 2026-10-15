import { resolveFigureCoordinateFrame } from 'tikz-editor/edit/coordinate-frame';
import { inverseMatrix } from 'tikz-editor/semantic/transform';
import { parseTikzForEdit } from 'tikz-editor/edit/parse-options';
import { useEditorStore } from '@tikz-editor/app/store';
import { originalInkDrawing, refittedInkDrawing } from '@tikz-editor/app/freehand';
import { getEditorSettings } from '@tikz-editor/app';
import { PT_PER_CM } from 'tikz-editor/edit/format';
import type { CommandFailure } from './events';
import type { HostCommand } from './commands';
import { originalStrokes, strokeEnvelope } from './original-ink';

export function executeInkCommand(command: Extract<HostCommand, { action: 'import-ink' | 'interpret-ink' | 'restore-ink' }>): CommandFailure | undefined {
  const state = useEditorStore.getState();
  if (command.source !== state.source) return 'source-changed';
  const parsed = parseTikzForEdit(state.source, { activeFigureId: state.activeFigureId });
  if (parsed.activeFigureId === null) return 'unsupported-source';
  const figure = parsed.figures.find(item => item.id === parsed.activeFigureId);
  const inverse = inverseMatrix(resolveFigureCoordinateFrame(state.source, { activeFigureId: state.activeFigureId }));
  if (figure === undefined || inverse === null) return 'unsupported-source';
  const authoredOriginal = (stroke: Parameters<typeof originalInkDrawing>[0]) => originalInkDrawing(stroke, inverse);
  const originals = originalStrokes(state.source);
  let next: string;
  if (command.action === 'import-ink') {
    const keys = new Set(originals.map(entry => entry.stroke.key));
    for (const stroke of command.strokes) {
      if (keys.has(stroke.key)) return 'duplicate-stroke-key';
      keys.add(stroke.key);
    }
    const insertion = '\n  ' + command.strokes.map(stroke => strokeEnvelope(stroke, authoredOriginal(stroke))).join('');
    next = state.source.slice(0, figure.endSpan.from) + insertion + state.source.slice(figure.endSpan.from);
  } else {
    const entry = originals.find(entry => entry.stroke.key === command.key);
    if (entry === undefined || entry.from < parsed.figure.span.from || entry.to > parsed.figure.span.to) return 'missing-stroke';
    let drawing = authoredOriginal(entry.stroke);
    if (command.action === 'interpret-ink') {
      if (entry.stroke.intent !== 'geometry') return 'ink-is-not-geometry';
      // The editor's own simplification setting is the one tolerance for every refit, host or canvas.
      const fit = refittedInkDrawing(entry.stroke, inverse, getEditorSettings().canvas.freehandSimplificationUnits * PT_PER_CM);
      if (fit === null) return 'no-fit';
      drawing = fit;
    }
    next = state.source.slice(0, entry.drawingFrom) + drawing + state.source.slice(entry.drawingTo);
  }
  if (next === state.source) return;
  state.dispatch({ type: 'REPLACE_FREEHAND_RESULT', from: 0, before: state.source, after: next,
    expectedSourceRevision: state.sourceRevision });
  if (useEditorStore.getState().source !== next) return 'edit-rejected';
}
