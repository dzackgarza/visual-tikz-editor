/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        TikZ preview-mode capability model
 * CVM-Role:        Domain
 * License:         GNU GPL v3
 *
 * Description:     Declares the preview/editor modes which may host one active
 *                  TikZ source block. The kind of the source decides its
 *                  editor: Quiver edits a tikzcd, and the vendored tikz-editor
 *                  edits every other TikZ source. A mode can also fail on a
 *                  source of its kind, and it then gives its own reason. The
 *                  renderer shell consumes these descriptors instead of
 *                  hard-coding mode branches.
 *
 * END HEADER
 */

import type { TikzLivePreviewTarget } from "./live-preview";
import { quiverSourceError } from "./quiver-bridge";
import { tikzBlockHasContiguousSource } from "./source-block";

export type TikzPreviewModeId = "tikz" | "quiver" | "visual";

export interface TikzPreviewModeDescriptor {
  id: TikzPreviewModeId;
  label: string;
  refreshable: boolean;
  /** Whether the mode shows a source of this kind. */
  supports: (target: TikzLivePreviewTarget) => boolean;
  /** Why the mode cannot show `target`, a source of its kind, or null when it can. */
  sourceError: (target: TikzLivePreviewTarget) => string | null;
}

// tikz-editor edits a whole TikZ file: setup before the environment and
// comments after it are part of the source it round-trips.
const TIKZPICTURE_RE = /\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}/u;

/** The mode that edits the diagram of `target`. */
export function tikzEditorMode(target: TikzLivePreviewTarget): "quiver" | "visual" {
  return target.language === "tikzcd" ? "quiver" : "visual";
}

export const TIKZ_PREVIEW_MODES: readonly TikzPreviewModeDescriptor[] = [
  {
    id: "tikz",
    label: "TeX render",
    refreshable: true,
    supports: () => true,
    sourceError: () => null,
  },
  {
    id: "quiver",
    label: "Quiver canvas",
    refreshable: false,
    supports: (target) => tikzEditorMode(target) === "quiver",
    sourceError: quiverSourceError,
  },
  {
    id: "visual",
    label: "Drawing canvas",
    refreshable: false,
    supports: (target) => tikzEditorMode(target) === "visual",
    sourceError: (target) =>
      !tikzBlockHasContiguousSource(target)
        ? "Move this diagram out of the surrounding Markdown block to use the visual editor"
        : !TIKZPICTURE_RE.test(target.source)
          ? "The visual editor requires a \\begin{tikzpicture} ... \\end{tikzpicture} environment"
          : null,
  },
];

export function defaultTikzPreviewMode(target: TikzLivePreviewTarget): TikzPreviewModeId {
  return target.language === "tikzcd" ? "quiver" : "tikz";
}
