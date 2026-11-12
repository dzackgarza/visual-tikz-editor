import { strict as assert } from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

describe("vendored tikz-editor build", function () {
  const root = path.join(__dirname, "..", "vendor", "tikz-editor", "src");

  it("names the panel Properties in every string it ships", async function () {
    const assets = (await readdir(path.join(root, "assets"))).filter((name) => name.endsWith(".js"));
    const files = ["index.html", ...assets.map((name) => path.join("assets", name))];
    const found: string[] = [];
    for (const file of files) {
      const text = await readFile(path.join(root, file), "utf8");
      // The word on its own: identifiers such as showInspectorPanel join it to other words.
      for (const match of text.matchAll(/\bInspector\b/gu)) {
        found.push(`${file}: ${text.slice(Math.max(0, match.index - 40), match.index + 50)}`);
      }
    }
    assert.deepEqual(found, [], "The build ships the panel name Inspector");
  });
});
