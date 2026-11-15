/**
 * Stories of the built desktop package: the Tauri shell, its file host, and the page in
 * WebKitGTK. Run them with `just test-desktop`, which builds the package first. The
 * Chromium stories of `test/workbench-browser.spec.ts` hold the same behaviour for pen
 * and finger; `package.ts` gives the limits of the driver.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { z } from "zod";
import { DesktopApp, KEY, type Offset } from "./package";

describe("desktop package", function () {
  let app: DesktopApp;

  afterEach(async function () {
    const name = this.currentTest!.title.replace(/[^a-z0-9]+/gi, "-");
    await app.enterWindow();
    await app.screenshot(`test-results/desktop/${name}.png`);
    await app.stop();
  });

  const debugSchema = z.object({ source: z.string(), tool: z.string(), selection: z.array(z.string()) });
  const debug = () =>
    app.script(
      debugSchema,
      "const d = window.visualTikzEditorDebug(); return { source: d.source, tool: String(d.tool), selection: [...d.selection] };",
    );
  const source = async () => (await debug()).source;
  const strokeRecords = async () => ((await source()).match(/% workbench-ink:/g) ?? []).length;
  /** The window boxes of the drawn paths, in document order. */
  const pathBoxes = () =>
    app.script(
      z.array(z.object({ id: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() })),
      `return [...document.querySelectorAll('svg path[data-source-id]')].map((path) => {
         const box = path.getBoundingClientRect();
         return { id: path.getAttribute('data-source-id'), x: box.x, y: box.y, width: box.width, height: box.height };
       });`,
    );
  const rendersCanvas = () =>
    app.script(z.boolean(), "return !document.body.innerText.includes('Error rendering component');");
  const zoomReadout = () =>
    app.script(z.string(), "return document.querySelector('button[aria-label=\"Zoom and display\"]').textContent.trim();");
  const toolOptions = () =>
    app.script(z.number(), "return document.querySelectorAll('[role=\"dialog\"][aria-label=\"Active Tool Menu\"]').length;");
  const wave = (x: number, y: number): Offset[] =>
    Array.from({ length: 16 }, (_, i) => ({ x: x + i * 12, y: y + 25 * Math.sin(i / 2.5) }));

  async function editorReady(): Promise<void> {
    await app.enterWindow();
    await expect
      .poll(
        () =>
          app.script(
            z.string().nullable(),
            "return document.querySelector('[data-editor-state]')?.getAttribute('data-editor-state') ?? null;",
          ),
        { message: "the window did not show the editor", timeout: 60_000 },
      )
      .toBe("ready");
    await app.enterEditor();
    await expect
      .poll(() => app.script(z.string(), "return typeof window.visualTikzEditorDebug;"), { timeout: 30_000 })
      .toBe("function");
  }

  it("holds the drawing loop: strokes, a move, a colour, Delete and Undo, a menu, text, and zoom", async function () {
    app = await DesktopApp.start();
    await editorReady();
    assert.equal(await strokeRecords(), 0);

    // Three strokes, one after another: each is in the source and on the canvas with no step between them.
    await app.press("Pen");
    const starts = [
      { x: -380, y: -250 },
      { x: -380, y: -120 },
      { x: 60, y: -200 },
    ];
    for (const [index, start] of starts.entries()) {
      await app.contact(wave(start.x, start.y));
      await expect.poll(strokeRecords, { message: `stroke ${index + 1} is not in the source` }).toBe(index + 1);
    }
    await expect
      .poll(async () => (await pathBoxes()).filter((box) => box.width > 150).length, {
        message: "the canvas does not show the three strokes",
      })
      .toBe(3);

    // Lasso: a tap on a stroke selects it, and a drag on its ink moves it whole.
    await app.press("Lasso");
    const onInk = wave(-380, -250)[5];
    await app.contact([onInk]);
    await expect.poll(async () => (await debug()).selection.length, { message: "the tap selected no stroke" }).toBe(1);
    const [selected] = (await debug()).selection;
    const box = async () => (await pathBoxes()).find((path) => path.id === selected)!;
    const before = await box();
    await app.contact([onInk, { x: onInk.x + 20, y: onInk.y + 30 }, { x: onInk.x + 60, y: onInk.y + 90 }]);
    await expect.poll(async () => (await box()).y - before.y, { message: "the drag did not move the stroke" }).toBeGreaterThan(40);
    const moved = await box();
    assert.ok(
      Math.abs(moved.width - before.width) <= 2 && Math.abs(moved.height - before.height) <= 2,
      `the drag changed the extent of the stroke: ${JSON.stringify(before)} -> ${JSON.stringify(moved)}`,
    );

    // A colour tap colours the selected stroke, and no other.
    await app.press("Colour 2");
    await expect
      .poll(async () => ((await source()).match(/\\draw\[blue\]/g) ?? []).length, {
        message: "the colour tap did not colour the selected stroke",
      })
      .toBe(1);

    // Delete removes the stroke with its record, and Undo returns both.
    await app.keys([KEY.delete]);
    await expect.poll(strokeRecords, { message: "Delete did not remove the stroke" }).toBe(2);
    assert.equal((await pathBoxes()).length, 2);
    await app.keys(["z"], KEY.control);
    await expect.poll(strokeRecords, { message: "Undo did not return the stroke" }).toBe(3);
    await expect.poll(async () => (await pathBoxes()).length).toBe(3);

    // The press that closes the Shapes menu places nothing.
    await app.press("Shapes");
    await app.press("Shapes");
    await expect.poll(toolOptions, { message: "the Shapes menu did not open" }).toBe(1);
    const withMenu = await source();
    await app.contact([{ x: 250, y: 150 }]);
    await expect.poll(toolOptions, { message: "the press on the canvas did not close the Shapes menu" }).toBe(0);
    assert.equal(await source(), withMenu, "the press that closed the Shapes menu changed the diagram");

    // Text: a tap places a text in edit, the typed keys are its text, and Escape ends the edit.
    await app.press("Text");
    await app.contact([{ x: 250, y: 200 }]);
    await expect
      .poll(() => app.script(z.string().nullable(), "return document.activeElement?.getAttribute('data-testid') ?? null;"), {
        message: "the text is not in edit after the tap",
      })
      .toBe("canvas-text-edit-textarea");
    await app.keys(["x", "+", "y"]);
    await app.keys([KEY.escape]);
    await expect
      .poll(async () => (await source()).split("\n").filter((line) => line.includes("\\node")), {
        message: "the typed keys are not the text of one plain node",
      })
      .toEqual([expect.stringMatching(/^\s*\\node at \([^)]*\) \{x\+y\};$/)]);
    const drawn = await source();

    // Zoom by the control and by the wheel with Ctrl, to both limits: the canvas renders and keeps the diagram.
    const zoomTo = async (level: string): Promise<void> => {
      await app.press("Zoom and display");
      await app.press(level);
      await app.script(
        z.null(),
        "const zoom = document.querySelector('button[aria-label=\"Zoom and display\"]'); if (zoom.getAttribute('aria-expanded') === 'true') zoom.click(); return null;",
      );
    };
    // The driver's wheel does not reach the page, so the page makes the events that the canvas's handler takes.
    const wheel = (deltaY: number, count: number) =>
      app.script(
        z.null(),
        `const viewport = document.querySelector('[data-canvas-viewport="true"]');
         const box = viewport.getBoundingClientRect();
         for (let i = 0; i < arguments[1]; i += 1) {
           viewport.dispatchEvent(new WheelEvent('wheel', {
             deltaY: arguments[0], ctrlKey: true, bubbles: true, cancelable: true,
             clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
           }));
         }
         return null;`,
        [deltaY, count],
      );
    assert.equal(await zoomReadout(), "100%");
    await zoomTo("500%");
    await expect.poll(zoomReadout).toBe("500%");
    await zoomTo("20%");
    await expect.poll(zoomReadout).toBe("20%");
    await wheel(-120, 60);
    await expect.poll(async () => Number.parseInt(await zoomReadout(), 10), { message: "the wheel did not zoom in" }).toBeGreaterThan(1000);
    assert.ok(await rendersCanvas(), "the canvas failed at the largest zoom");
    await wheel(120, 120);
    await expect.poll(async () => Number.parseInt(await zoomReadout(), 10), { message: "the wheel did not zoom out" }).toBeLessThan(10);
    assert.ok(await rendersCanvas(), "the canvas failed at the smallest zoom");
    await zoomTo("100%");
    await expect.poll(zoomReadout).toBe("100%");
    assert.equal(await source(), drawn, "the zoom changed the diagram");
    await expect.poll(async () => (await pathBoxes()).filter((path) => path.width > 150).length).toBe(3);

    // A stroke after the zoom is recorded as the first strokes were.
    await app.press("Pen");
    await app.contact(wave(-100, 260));
    await expect.poll(strokeRecords, { message: "the stroke after the zoom is not in the source" }).toBe(4);
    await expect
      .poll(async () => (await pathBoxes()).filter((path) => path.width > 150).length, {
        message: "the canvas does not show the stroke after the zoom",
      })
      .toBe(4);
  });

  it("zooms the figure by a touchpad pinch, about the place of the pinch, and keeps the window at its size", async function () {
    // WebKitGTK answers a touchpad pinch itself: it magnifies the page, up to three times, and the page
    // gets no event of it (ViewGestureController::setMagnification; issue #18).
    const file = join(await mkdtemp(join(tmpdir(), "desktop-pinch-")), "figure.tikz");
    await writeFile(file, "\\begin{tikzpicture}\n\\draw (0,0) circle (1);\n\\draw (3,0) circle (1);\n\\end{tikzpicture}\n");
    app = await DesktopApp.start({ args: [file] });
    await editorReady();
    const magnification = async (): Promise<number> => {
      await app.enterWindow();
      const scale = await app.script(z.number(), "return window.visualViewport.scale;");
      await app.enterEditor();
      return scale;
    };
    const canvasScale = () =>
      app.script(z.number(), "return Number(document.querySelector('[data-testid=\"canvas-world-stage\"]').dataset.canvasScale);");
    /** The first circle in the window: its centre as an offset from the centre of the canvas, and its width. */
    const circle = () =>
      app.script(
        z.object({ x: z.number(), y: z.number(), width: z.number() }),
        `const canvas = document.querySelector('[data-canvas-viewport="true"]').getBoundingClientRect();
         const box = document.querySelector('svg [data-source-id]').getBoundingClientRect();
         return { x: box.x + box.width / 2 - (canvas.x + canvas.width / 2), y: box.y + box.height / 2 - (canvas.y + canvas.height / 2), width: box.width };`,
      );
    await expect.poll(async () => (await circle()).width, { message: "the canvas does not show the figure" }).toBeGreaterThan(100);
    const opened = { scale: await canvasScale(), circle: await circle() };

    // The fingers move apart to twice their distance, with the pointer on the centre of the first circle.
    await app.pinch(opened.circle, [1.1, 1.25, 1.5, 1.75, 2]);
    assert.equal(await magnification(), 1, "the pinch magnified the window");
    await expect
      .poll(async () => (await canvasScale()) / opened.scale, { message: "the pinch did not zoom the figure to twice its size" })
      .toBeCloseTo(2, 1);
    const zoomed = await circle();
    assert.ok(Math.abs(zoomed.width / opened.circle.width - 2) < 0.1, `the circle is ${zoomed.width} px wide after the pinch, from ${opened.circle.width} px`);
    assert.ok(
      Math.hypot(zoomed.x - opened.circle.x, zoomed.y - opened.circle.y) < 3,
      `the place under the pinch moved from (${opened.circle.x}, ${opened.circle.y}) to (${zoomed.x}, ${zoomed.y})`,
    );

    // The fingers move together to half their distance: the figure is at its first size again.
    await app.pinch(zoomed, [0.9, 0.75, 0.6, 0.5]);
    assert.equal(await magnification(), 1, "the pinch magnified the window");
    await expect
      .poll(async () => (await canvasScale()) / opened.scale, { message: "the pinch did not zoom the figure back" })
      .toBeCloseTo(1, 1);
    assert.ok(await rendersCanvas(), "the canvas failed after the pinches");
  });

  it("shows the file and the reason in the window at a start on a view-state file of an older build", async function () {
    // An entry of an older build has no `locked` and no `hidden` (issue #80).
    const seed = await mkdtemp(join(tmpdir(), "desktop-seed-"));
    const older = JSON.stringify({
      "untitled:41fd0c84-39a0-4f5d-9942-33af148f9ed6": {
        activeFigureId: "figure-1",
        selection: [],
        tool: "addFreehand",
        viewport: { scale: 1.4, centerX: 12, centerY: -30 },
        fitToContent: false,
      },
    });
    await writeFile(join(seed, "view-state.json"), older);
    app = await DesktopApp.start({ seedState: seed });
    const viewStateFile = join(app.stateDirectory, "view-state.json");
    const message = () => app.script(z.string(), "return document.querySelector('[role=\"alert\"]')?.innerText ?? '';");
    await expect
      .poll(message, { message: "the window does not name the file that cannot be read", timeout: 60_000 })
      .toContain(viewStateFile);
    assert.ok((await message()).includes("locked"), "the window does not name the field that the file lacks");
    assert.equal(await app.script(z.number(), "return document.querySelectorAll('iframe').length;"), 0);
    assert.equal(await readFile(viewStateFile, "utf8"), older, "the start changed the file that it cannot read");
  });
});

describe("desktop package, when the file host stops before the window opens", function () {
  // A start that opens no window gets no session; the harness then ends its own processes, and no application is left to stop.
  let app: DesktopApp | undefined;

  afterEach(async function () {
    await app?.screenshot("test-results/desktop/host-stopped-before-the-window.png");
    await app?.stop();
  });

  it("shows in a window why the file host stopped, for a command line that names no file", async function () {
    // The host cannot open a diagram that is not there, and stops before it serves a page (issue #80).
    const absent = join(await mkdtemp(join(tmpdir(), "desktop-absent-")), "absent.tikz");
    const started = await DesktopApp.start({ args: [absent] });
    app = started;
    const message = () =>
      started.script(z.string(), "return document.querySelector('[role=\"alert\"]')?.innerText ?? '';");
    await expect.poll(message, { message: "the window does not show why the file host stopped" }).toContain(absent);
  });
});

describe("desktop package, the launch log", function () {
  let app: DesktopApp;

  // The web process has ended when this story ends, so the window has no page to picture.
  afterEach(async function () {
    await app.stop();
  });

  it("holds an error thrown in the editor frame, with the frame and the stack, and the end of the web process, with WebKit's reason", async function () {
    // FR-066 and the "Done when" of issue #71: the log is the evidence of a failure on a person's machine.
    app = await DesktopApp.start();
    await app.enterWindow();
    await expect
      .poll(() => app.script(z.number(), "return document.querySelectorAll('iframe[title=\"TikZ visual editor\"]').length;"), {
        message: "the window did not show the editor",
        timeout: 60_000,
      })
      .toBe(1);
    await app.enterEditor();
    await app.script(
      z.null(),
      "setTimeout(function thrownInTheEditorFrame() { throw new Error('a story threw this error in the editor frame'); }, 0); return null;",
    );
    const entry = /page error (\S+): Error: a story threw this error in the editor frame\n(.*)/;
    await expect.poll(() => app.launchLog(), { message: "the log does not hold the error" }).toMatch(entry);
    const [, frame, stack] = entry.exec(await app.launchLog())!;
    assert.ok(frame!.includes("tikz-editor"), `the log names the frame ${frame}, not the editor frame`);
    assert.ok(stack!.includes("thrownInTheEditorFrame"), `the log gives "${stack}" as the stack`);

    // The web process is the child of the shell that renders the page. SIGKILL ends it as the kernel does when memory
    // runs out; WebKit's own handler takes a SIGSEGV that another process sends, and the process goes on.
    const webProcess = spawnSync("pgrep", ["-P", String(app.pid), "-f", "WebKitWebProcess"], { encoding: "utf8" }).stdout.trim();
    assert.match(webProcess, /^\d+$/, "the shell has not exactly one web process");
    process.kill(Number(webProcess), "SIGKILL");
    await expect
      .poll(() => app.launchLog(), { message: "the log does not hold the end of the web process" })
      .toContain("WebKit web process terminated: Crashed");
  });
});

describe("desktop package, when the application gets a signal", function () {
  let app: DesktopApp;

  afterEach(async function () {
    await app.stop();
  });

  // SIGTERM is the signal of a session logout and of `kill`; SIGKILL gives the application no step of its own (issue #81).
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    it(`leaves no file host after ${signal}`, async function () {
      app = await DesktopApp.start();
      // The file host is the child process of the shell that serves the window's page.
      const hostOfShell = () => {
        const found = spawnSync("pgrep", ["-P", String(app.pid), "-x", "workbench-host"], { encoding: "utf8" });
        return found.stdout.trim();
      };
      await expect.poll(hostOfShell, { message: "the shell started no file host", timeout: 30_000 }).toMatch(/^\d+$/);
      const host = hostOfShell();
      process.kill(app.pid, signal);
      await expect
        .poll(() => existsSync(`/proc/${app.pid}`), { message: `the application did not end at ${signal}` })
        .toBe(false);
      await expect
        .poll(() => existsSync(`/proc/${host}`), { message: `the file host still runs after ${signal}` })
        .toBe(false);
    });
  }
});
