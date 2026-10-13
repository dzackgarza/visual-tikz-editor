import { originalStrokes } from '../vendor/tikz-editor/embed/src/original-ink';

/** TikZ for external figure work, without the workbench's round-trip ink records. */
export function paperSource(source: string): string {
  // Parse first so a damaged association is reported instead of silently
  // copying a misleading fragment of a user's diagram.
  originalStrokes(source);
  return source
    .replace(/^[ \t]*% workbench-ink:[^\r\n]*\r?\n/gm, '')
    .replace(/^[ \t]*% workbench-ink-end:[^\r\n]*(?:\r?\n|$)/gm, '');
}
