/**
 * The document's one source and its one history (FR-012b). Every view edits this state, and
 * Undo and Redo act on it, whichever view made the edit. The arrangement is CodeMirror's split
 * view (https://codemirror.net/examples/split/): one state holds the history, and each view
 * forwards its changes to it and shows the changes made elsewhere.
 */

import { history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import {
  Annotation,
  type ChangeSet,
  type ChangeSpec,
  EditorState,
  Transaction,
} from "@codemirror/state";

/** The step of the source editor: its keystrokes join as CodeMirror joins typing. */
export const CODE_STEP = "code";

/** One change of the document and the source after it. */
export interface DocumentChange {
  changes: ChangeSet;
  source: string;
}

const step = Annotation.define<string>();

export class DocumentHistory {
  private state: EditorState;
  // The step of the last edit, and the time it began; the edits of one step join into one Undo step.
  private lastStep: string | null = null;
  private lastStepTime = 0;
  private readonly listeners = new Set<(change: DocumentChange) => void>();

  constructor(source: string) {
    this.state = this.create(source);
  }

  private create(source: string): EditorState {
    return EditorState.create({
      doc: source,
      extensions: history({
        // data-model.md History: "typing in the Code panel groups changes no more than 500 ms apart".
        newGroupDelay: 500,
        joinToEvent: (tr, adjacent) => {
          const edit = tr.annotation(step);
          return edit === this.lastStep && (edit !== CODE_STEP || adjacent);
        },
      }),
    });
  }

  get source(): string {
    return this.state.doc.toString();
  }

  get canUndo(): boolean {
    return undoDepth(this.state) > 0;
  }

  get canRedo(): boolean {
    return redoDepth(this.state) > 0;
  }

  /** Calls `listener` after each change of the source; the result removes it. */
  subscribe(listener: (change: DocumentChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * One edit of the source. Consecutive edits of one `editStep` are one Undo step: a canvas
   * gesture names its frame step, and the source editor names `CODE_STEP` with the CodeMirror
   * `userEvent` of its transaction.
   */
  edit(changes: ChangeSpec, editStep: string, userEvent?: string): void {
    const continues = editStep === this.lastStep && editStep !== CODE_STEP;
    const time = continues ? this.lastStepTime : Date.now();
    const tr = this.state.update({
      changes,
      annotations: [
        step.of(editStep),
        // A canvas gesture joins however long it lasts; typing joins only within 500 ms.
        Transaction.time.of(time),
        ...(userEvent === undefined ? [] : [Transaction.userEvent.of(userEvent)]),
      ],
    });
    // A transaction computes its state, and so asks `joinToEvent`, when `state` is first read.
    void tr.state;
    if (editStep !== this.lastStep) this.lastStepTime = time;
    this.lastStep = editStep;
    this.apply(tr);
  }

  undo(): boolean {
    return this.step(undo);
  }

  redo(): boolean {
    return this.step(redo);
  }

  /** Another document: its source with an empty history. */
  reset(source: string): void {
    const changes = this.state.changes({ from: 0, to: this.state.doc.length, insert: source });
    this.state = this.create(source);
    this.lastStep = null;
    this.notify(changes);
  }

  private step(command: typeof undo): boolean {
    const result: { tr?: Transaction } = {};
    command({ state: this.state, dispatch: (tr) => { result.tr = tr; } });
    if (result.tr === undefined) return false;
    // The next edit starts a new step, even one that continues the step undone.
    this.lastStep = null;
    this.apply(result.tr);
    return true;
  }

  private apply(tr: Transaction): void {
    this.state = tr.state;
    if (!tr.changes.empty) this.notify(tr.changes);
  }

  private notify(changes: ChangeSet): void {
    const change = { changes, source: this.source };
    for (const listener of this.listeners) listener(change);
  }
}
