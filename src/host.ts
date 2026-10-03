/**
 * The boundary between the TikZ workbench and the application that embeds it.
 * The host owns the document that stores the TikZ source and every URL.
 * It may supply TeX rendering and Quiver for additional views. The workbench
 * owns drawing and visual feedback. Zettlr supplies a CodeMirror range and
 * its IPC services; the standalone server supplies a file and HTTP endpoints.
 */

import type { TikzRenderSuccess } from "./live-preview";
import type { QuiverMacroProjection } from "./quiver-macros";
import type { TikzRenderRequest, TikzRenderResult } from "./tikz-render";

export type TikzWorkbenchTheme = "light" | "dark";

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
   * Replace [from, to) of the source document. The host then passes the
   * workbench a target that describes the changed document.
   */
  writeSource: (from: number, to: number, insert: string) => void;
  /** Present only when the host supplies a compiled TeX view. */
  rendering?: TikzWorkbenchRendering;
  /** Present only when the host supplies a tikzcd editor. */
  quiver?: TikzWorkbenchQuiver;
  /** The URL against which the visual editor resolves image paths in a document. */
  imageBaseUrl: (docPath: string) => string;
  /** The page of the pinned visual editor (vendor/tikz-editor/src/index.html). */
  editorUrl: string;
  reportError: (message: string, error: unknown) => void;
}
