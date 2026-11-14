import { strict as assert } from "node:assert";
import { tikzEditorReplacement, tikzEditorSessionForBlock } from "../src/editor-bridge";
import type { TikzLivePreviewTarget } from "../src/live-preview";
import { contiguousSourceLineRanges } from "../src/source-block";

describe("tikz-editor source bridge", function () {
  const source = String.raw`\begin{tikzpicture}
\begin{scope}[shift={(2,1)}, rotate=30]
  \node (A) at (0,0) {A};
\end{scope}
\foreach \i in {1,...,3} { \draw (\i,0) circle (2pt); }
\draw (0,0) .. controls (1,2) and (2,2) .. (3,0);
\end{tikzpicture}`;

  function target(text = source): TikzLivePreviewTarget {
    return {
      from: 40,
      to: 40 + text.length,
      sourceFrom: 40,
      sourceTo: 40 + text.length,
      source: text,
      authoredSource: text,
      sourceLineRanges: contiguousSourceLineRanges(text, 40),
      kind: "raw",
      language: "tikz",
      docPath: "/notes/diagram.md",
    };
  }

  it("hands arbitrary authored TikZ to the embedded editor byte-for-byte", function () {
    assert.strictEqual(tikzEditorSessionForBlock(target()).source, source);
  });

  it("accepts complete edited source without interpreting unsupported constructs", function () {
    const session = tikzEditorSessionForBlock(target());
    const edited = source.replace("{A};", "{B};") + "\n% arbitrary hand-authored tail";
    const replacement = tikzEditorReplacement(session, edited);
    const document = " ".repeat(40) + source;
    const applied = replacement.edits.reduceRight(
      (text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
      document,
    );

    assert.strictEqual(applied.slice(40), edited);
    assert.strictEqual(replacement.next.source, edited);
    assert.strictEqual(replacement.next.sourceTo, 40 + edited.length);
  });

  it("writes only the changed spans, so a step of the history names what it changed (FR-054)", function () {
    const session = tikzEditorSessionForBlock(target());
    const edited = source.replace("(1,2) and (2,2)", "(1,3) and (2,3)");
    const replacement = tikzEditorReplacement(session, edited);
    const curve = 40 + source.indexOf(String.raw`\draw (0,0)`);

    assert.ok(replacement.edits.length > 0);
    for (const edit of replacement.edits) {
      assert.ok(edit.from >= curve && edit.to <= 40 + source.length, `${JSON.stringify(edit)} lies outside the edited curve`);
    }
  });

  it("rejects tikzcd at the bridge boundary", function () {
    const block = target(String.raw`\begin{tikzcd}A & B\end{tikzcd}`);
    block.language = "tikzcd";
    assert.throws(() => tikzEditorSessionForBlock(block), /ordinary TikZ/u);
  });

  it("refuses source replacement across Markdown container-marker gaps", function () {
    const block = target();
    block.sourceLineRanges = block.sourceLineRanges.map((range, index) =>
      index === 0 ? range : { from: range.from + 2, to: range.to + 2 },
    );
    assert.throws(() => tikzEditorSessionForBlock(block), /nested inside another Markdown block/u);
  });
});
