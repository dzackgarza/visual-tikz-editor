import { originalStrokes } from "../vendor/tikz-editor/embed/src/original-ink";

/** TikZ for external figure work, without the workbench's round-trip ink records. */
export function paperSource(source: string): string {
  const records = originalStrokes(source);
  let projected = "";
  let cursor = 0;
  for (const record of records) {
    projected += source.slice(cursor, record.from);
    const envelope = source.slice(record.from, record.to);
    const opening = /^[ \t]*% workbench-ink:[^\r\n]*\r?\n/.exec(envelope)![0];
    const closing = `% workbench-ink-end:${record.stroke.key}`;
    projected += envelope.slice(opening.length, -closing.length);
    cursor = record.to;
    if (source.startsWith("\r\n", cursor)) cursor += 2;
    else if (source[cursor] === "\n") cursor++;
  }
  return projected + source.slice(cursor);
}
