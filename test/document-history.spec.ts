import { strict as assert } from "node:assert";
import { CODE_STEP, DocumentHistory } from "../src/document-history";

describe("the document history", function () {
  it("makes one Undo step of each canvas gesture, however many changes it posts", function () {
    const document = new DocumentHistory("(0,0) -- (1,0)");
    document.edit({ from: 9, to: 14, insert: "(2,0)" }, "canvas:a:1");
    document.edit({ from: 9, to: 14, insert: "(3,0)" }, "canvas:a:1");
    document.edit({ from: 0, to: 5, insert: "(0,1)" }, "canvas:a:2");
    assert.equal(document.source, "(0,1) -- (3,0)");
    assert.ok(document.undo());
    assert.equal(document.source, "(0,0) -- (3,0)");
    assert.ok(document.undo());
    assert.equal(document.source, "(0,0) -- (1,0)");
    assert.equal(document.canUndo, false);
  });

  it("joins keystrokes in the source editor but not with the canvas step before them", function () {
    const document = new DocumentHistory("ab");
    document.edit({ from: 2, insert: "c" }, "canvas:a:1");
    document.edit({ from: 3, insert: "d" }, CODE_STEP, "input.type");
    document.edit({ from: 4, insert: "e" }, CODE_STEP, "input.type");
    assert.ok(document.undo());
    assert.equal(document.source, "abc");
    assert.ok(document.undo());
    assert.equal(document.source, "ab");
  });

  it("acts on every view's edits and forgets what was undone once a new edit is made", function () {
    const document = new DocumentHistory("A");
    const shown: string[] = [];
    document.subscribe(({ source }) => shown.push(source));
    document.edit({ from: 1, insert: "B" }, "quiver:1");
    document.edit({ from: 2, insert: "C" }, CODE_STEP, "input.type");
    assert.ok(document.undo());
    assert.ok(document.canRedo);
    document.edit({ from: 2, insert: "D" }, "canvas:a:1");
    assert.equal(document.canRedo, false);
    assert.equal(document.redo(), false);
    assert.deepEqual(shown, ["AB", "ABC", "AB", "ABD"]);
  });

  it("starts another document with an empty history", function () {
    const document = new DocumentHistory("A");
    document.edit({ from: 1, insert: "B" }, "canvas:a:1");
    document.reset("X");
    assert.equal(document.source, "X");
    assert.equal(document.canUndo, false);
    assert.equal(document.undo(), false);
  });
});
