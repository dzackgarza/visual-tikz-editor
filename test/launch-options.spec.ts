import { strict as assert } from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkbench } from "./tablet";

/**
 * A host application starts the editor on a diagram that it took out of a larger
 * document. The diagram file is then not beside the document's images, and the
 * document's macros are not standard KaTeX. The launch options carry both.
 */
describe("launch options of a host application", function () {
  let server: ChildProcess;
  let url: string;
  const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>';

  before(async function () {
    await buildWorkbench();
    const home = await mkdtemp(join(tmpdir(), "workbench-launch-home-"));
    await mkdir(join(home, ".pandoc"), { recursive: true });
    await cp("test/fixtures/tikz-data/templates", join(home, ".pandoc", "templates"), {
      recursive: true,
    });
    const session = await mkdtemp(join(tmpdir(), "workbench-launch-session-"));
    const diagram = join(session, "diagram.tikzcd");
    await writeFile(diagram, "\\begin{tikzcd}\nA \\arrow[r] & B\n\\end{tikzcd}\n", "utf8");
    const resources = await mkdtemp(join(tmpdir(), "workbench-launch-document-"));
    await writeFile(join(resources, "picture.svg"), picture, "utf8");
    const macros = join(session, "mathjax-macros.json");
    await writeFile(
      macros,
      JSON.stringify({
        fiberprod: ["{#1 \\times_{#2} #3}", 3],
        RR: "\\mathbb{R}",
        withDefault: ["#1", 1, "x"],
      }),
      "utf8",
    );
    server = spawn(
      "bun",
      ["run", "standalone/server.ts", "--macros", macros, "--resources", resources, diagram],
      {
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: session, XDG_STATE_HOME: session },
        stdio: ["ignore", "pipe", "inherit"],
        detached: true,
      },
    );
    url = await new Promise<string>((resolve, reject) => {
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`Standalone server exited: ${code}`)));
      server.stdout!.on("data", (chunk) => {
        const match = /TikZ workbench: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(chunk));
        if (match !== null) resolve(match[1]);
      });
    });
    server.removeAllListeners("exit");
  });

  after(async function () {
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      process.kill(-server.pid!, "SIGTERM");
    });
  });

  it("projects the macro file of the host into Quiver", async function () {
    const projection = await (await fetch(`${url}api/quiver-macros`)).json();
    assert.deepEqual(projection, {
      macros: { "\\RR": "\\mathbb{R}", "\\fiberprod": "{#1 \\times_{#2} #3}" },
      unsupported: ["\\withDefault"],
    });
  });

  it("serves a figure image from the directory of the host document", async function () {
    const response = await fetch(`${url}tikz-image/picture.svg`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), picture);
  });
});
