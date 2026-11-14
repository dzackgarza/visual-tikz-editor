/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        tikz-editor iframe source bridge domain
 * CVM-Role:        Utility
 * License:         GNU GPL v3
 *
 * Description:     Owns the exact source/range contract between one authored
 *                  ordinary TikZ block and the vendored tikz-editor iframe.
 *                  The workbench does not parse or canonicalize the TikZ here: the
 *                  complete current bytes are handed to tikz-editor and its
 *                  complete edited bytes replace only the active block, as
 *                  the edits of CodeMirror's diff between the two, so that
 *                  the document history records only the changed spans.
 *
 * END HEADER
 */

import { presentableDiff } from "@codemirror/merge";
import type { SourceEdit } from "./host";
import { type TikzSourceBlock, tikzBlockHasContiguousSource } from "./source-block";

export interface TikzEditorSourceSession {
  kind: "raw" | "fence";
  blockFrom: number;
  blockTo: number;
  sourceFrom: number;
  sourceTo: number;
  /** Exact source bytes currently stored in [sourceFrom, sourceTo). */
  source: string;
}

export function tikzEditorSessionForBlock(block: TikzSourceBlock): TikzEditorSourceSession {
  if (block.language !== "tikz") {
    throw new Error(
      `tikz-editor sessions require ordinary TikZ source, received ${block.language}`,
    );
  }
  if (!tikzBlockHasContiguousSource(block)) {
    throw new Error(
      "The visual editor cannot edit this diagram while it is nested inside another Markdown block",
    );
  }
  return {
    kind: block.kind,
    blockFrom: block.from,
    blockTo: block.to,
    sourceFrom: block.sourceFrom,
    sourceTo: block.sourceTo,
    source: block.source,
  };
}

export interface TikzEditorReplacement {
  /** The edits, in document coordinates, that turn the block's bytes into tikz-editor's source. */
  edits: SourceEdit[];
  next: TikzEditorSourceSession;
}

/**
 * Replace the exact CodeMirror-owned TikZ bytes with tikz-editor's source.
 * No trimming, wrapping, parsing, or normalization occurs at this boundary.
 */
export function tikzEditorReplacement(
  session: TikzEditorSourceSession,
  source: string,
): TikzEditorReplacement {
  const delta = source.length - session.source.length;
  return {
    edits: presentableDiff(session.source, source).map((change) => ({
      from: session.sourceFrom + change.fromA,
      to: session.sourceFrom + change.toA,
      insert: source.slice(change.fromB, change.toB),
    })),
    next: {
      ...session,
      blockTo: session.blockTo + delta,
      sourceTo: session.sourceTo + delta,
      source,
    },
  };
}
