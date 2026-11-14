/**
 * The boundary between the TikZ workbench and the standalone shell.
 * The shell owns the file that stores the TikZ source, every URL, TeX
 * rendering and Quiver, through the standalone server's HTTP endpoints.
 * The workbench owns drawing and visual feedback.
 */

import type { TikzRenderSuccess } from "./live-preview";
import type { QuiverMacroProjection } from "./quiver-macros";
import type { TikzRenderRequest, TikzRenderResult } from "./tikz-render";
import type { EditorState } from "../vendor/tikz-editor/embed/src/editor-state";
import type { ChangedRange } from "../vendor/tikz-editor/embed/src/commands";

export type { ChangedRange, HostCommand } from "../vendor/tikz-editor/embed/src/commands";
export type {
  CommandFailure,
  CommandReply,
  EditorEvent,
  EditorNotification,
} from "../vendor/tikz-editor/embed/src/events";
export { editorStateSchema } from "../vendor/tikz-editor/embed/src/editor-state";
export {
  commandReplySchema,
  editorEventSchema,
  editorNotificationSchema,
} from "../vendor/tikz-editor/embed/src/events";
export type { EditorState } from "../vendor/tikz-editor/embed/src/editor-state";
export type { OriginalStroke } from "../vendor/tikz-editor/embed/src/original-ink";
export type {
  EditorSnapshot,
  EditorSnapshotResult,
} from "../vendor/tikz-editor/embed/src/snapshot-protocol";
export { requestEditorSnapshot } from "./editor-snapshot";
export { requestEditorSource } from "./editor-source";

export type TikzWorkbenchTheme = "light" | "dark";

/** One replacement of [from, to) of the source document by `insert`. */
export interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}

export interface TikzWorkbenchRendering {
  render: (request: TikzRenderRequest) => Promise<TikzRenderResult>;
  figureUrl: (figure: TikzRenderSuccess) => string;
}

export interface TikzWorkbenchQuiver {
  macros: () => Promise<QuiverMacroProjection>;
  url: string;
}

export interface TikzWorkbenchHost {
  /** The authored bytes that the source document stores in [from, to). */
  readSource: (from: number, to: number) => string;
  /**
   * Apply `edits`, each in the coordinates of the document before the write, as one change of
   * the source document. The host then passes the workbench a target that describes the changed
   * document. Consecutive writes with one `step` are one step of the document history.
   */
  writeSource: (edits: readonly SourceEdit[], step: string) => void;
  /**
   * The ranges of the current source that the document's changes wrote since the last call, in
   * source order; an empty range marks a deletion. Null when no Undo or Redo made any of the
   * changes. A call forgets the changes it reports.
   */
  takeChangedRanges: () => ChangedRange[] | null;
  /** The compiled TeX view. */
  rendering: TikzWorkbenchRendering;
  /** The tikzcd editor. */
  quiver: TikzWorkbenchQuiver;
  /** The URL against which the visual editor resolves image paths in a document. */
  imageBaseUrl: (docPath: string) => string;
  /** The page of the pinned visual editor (vendor/tikz-editor/src/index.html). */
  editorUrl: string;
  /** Navigate the source editor without taking focus from the canvas. */
  selectSource: (from: number, to: number) => void;
  /** Native clipboard services when the host runs in a desktop window. */
  clipboard?: { readText: () => Promise<string>; writeText: (text: string) => Promise<void> };
  /** The view at which the canvas last showed the open file; none for a file never shown (FR-040). */
  viewState: () => EditorState | undefined;
  /** Keep the view at which the canvas shows the open file, outside its source (FR-040). */
  saveViewState: (state: EditorState) => Promise<void>;
  /** Persist editor preferences independently of the source document. */
  savePreference?: (key: string, value: string) => Promise<void>;
  /** Explicit Save gesture from the editor; only the document owner persists it. */
  requestSave?: () => void;
  reportError: (message: string, error: unknown) => void;
}
