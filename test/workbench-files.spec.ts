import { strict as assert } from "node:assert";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import {
  buildWorkbench,
  editorReady,
  startPageCoverage,
  startWorkbench,
  stopPageCoverage,
  TABLET_VIEWPORTS,
  type Workbench,
} from "./tablet";

const execute = promisify(execFile);

describe("standalone native file workflow", function () {
  let displayServer: ChildProcess;
  let sessionBus: ChildProcess;
  let workbench: Workbench;
  let browser: Browser;
  let page: Page;
  let desktopEnv: Record<string, string>;
  let persistentHome: string;
  let diagramPath: string;
  let url: string;

  async function startServer(): Promise<void> {
    workbench = await startWorkbench(desktopEnv, persistentHome);
    url = workbench.url;
  }

  const fileMenu = () => page.getByRole("group", { name: "File" }).locator("summary");

  async function chooseFile(name: string): Promise<void> {
    const { stdout } = await execute(
      "xdotool",
      ["search", "--sync", "--onlyvisible", "--class", "zenity"],
      { env: desktopEnv, timeout: 10000 },
    );
    const id = stdout.trim().split("\n").at(-1)!;
    await execute("xdotool", ["windowfocus", "--sync", id], { env: desktopEnv });
    await execute(
      "import",
      ["-window", "root", `test-results/workbench/native-${name}-dialog.png`],
      { env: desktopEnv },
    );
    await execute("xdotool", ["key", "--clearmodifiers", "ctrl+l"], { env: desktopEnv });
    await execute("xdotool", ["key", "--clearmodifiers", "ctrl+a"], { env: desktopEnv });
    await execute("xdotool", ["type", "--clearmodifiers", "--delay", "1", diagramPath], {
      env: desktopEnv,
    });
    // GTK's location entry may insert an asynchronous inline completion after the caret; Shift+End, Delete drops it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await execute("xdotool", ["key", "--clearmodifiers", "shift+End", "Delete"], {
      env: desktopEnv,
    });
    await execute(
      "import",
      ["-window", "root", `test-results/workbench/native-${name}-typed.png`],
      { env: desktopEnv },
    );
    await execute("xdotool", ["key", "--clearmodifiers", "Return"], { env: desktopEnv });
    if (name === "open") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await execute("xdotool", ["key", "--clearmodifiers", "Return"], { env: desktopEnv });
    }
  }

  before(async function () {
    displayServer = spawn(
      "Xvfb",
      ["-displayfd", "1", "-screen", "0", "1280x1024x24", "-nolisten", "tcp", "-ac"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const display = await new Promise<string>((resolve, reject) => {
      displayServer.once("error", reject);
      displayServer.once("exit", (code) => reject(new Error(`Display exited: ${code}`)));
      displayServer.stdout!.once("data", (data) => resolve(`:${String(data).trim()}`));
    });
    // Chromium and zenity share the virtual X display only when no Wayland session is inherited.
    desktopEnv = Object.fromEntries(
      Object.entries({
        ...process.env,
        DISPLAY: display,
        WAYLAND_DISPLAY: undefined,
        XDG_SESSION_TYPE: "x11",
        GDK_BACKEND: "x11",
        GSK_RENDERER: "cairo",
        GDK_DEBUG: "no-portals",
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    sessionBus = spawn("dbus-daemon", ["--session", "--nofork", "--print-address=1"], {
      env: desktopEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    desktopEnv.DBUS_SESSION_BUS_ADDRESS = await new Promise<string>((resolve, reject) => {
      sessionBus.once("error", reject);
      sessionBus.stdout!.once("data", (data) => resolve(String(data).trim()));
    });
    diagramPath = join(await mkdtemp(join(tmpdir(), "workbench-native-")), "authored.tikz");
    persistentHome = await mkdtemp(join(tmpdir(), "workbench-native-state-"));
    await mkdir("test-results/workbench", { recursive: true });
    await buildWorkbench();
    await startServer();
    browser = await chromium.launch({ headless: false, env: desktopEnv });
    page = await browser.newPage();
    await startPageCoverage(page);
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  });

  after(async function () {
    if (page !== undefined) {
      await execute("import", ["-window", "root", "test-results/workbench/native-final.png"], {
        env: desktopEnv,
      });
      await page.context().tracing.stop({ path: "test-results/workbench/native-files.zip" });
      await stopPageCoverage(page);
    }
    await browser?.close();
    await workbench?.stop();
    sessionBus?.kill("SIGTERM");
    displayServer?.kill("SIGTERM");
  });

  it("saves through the native chooser and reopens exact authored bytes after restarting", async function () {
    const authored = String.raw`\begin{tikzpicture}
% source survives a real native save and process restart
\draw[blue] (0,0) rectangle (3,2);
\end{tikzpicture}`;
    await page.goto(url);
    await page.getByRole("button", { name: "tikzpicture", exact: true }).click();
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await expect(page.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
    await page.locator(".cm-content").fill(authored);
    await fileMenu().click();
    await page.getByRole("button", { name: "Save As…", exact: true }).click();
    await chooseFile("save");
    await expect.poll(() => existsSync(diagramPath)).toBe(true);
    assert.equal(await readFile(diagramPath, "utf8"), authored);
    await expect(page.locator(".tikz-standalone-status")).toContainText("Saved");
    await page.goto("about:blank");
    await workbench.stop();
    await startServer();
    await page.goto(url);
    await expect(page.locator(".document-bar strong")).toHaveText("authored.tikz");
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    assert.equal(
      await page
        .locator(".cm-line")
        .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")),
      authored,
    );
    await expect(
      page.frameLocator('iframe[title="TikZ visual editor"]').locator("path[data-source-id]"),
    ).toHaveCount(1);
    await editorReady(page);
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.35 + 100,
      bounds.y + bounds.height * 0.65 + 30,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.keyboard.press("Control+s");
    await expect.poll(() => readFile(diagramPath, "utf8")).toContain("workbench-ink:");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy source", exact: true }).click();
    const edited = await readFile(diagramPath, "utf8");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(edited);
    await expect(page.locator(".tikz-standalone-status")).toContainText("Saved");
    await fileMenu().click();
    await page.getByRole("button", { name: "Open…", exact: true }).click();
    const dialog = await execute(
      "xdotool",
      ["search", "--sync", "--onlyvisible", "--class", "zenity"],
      { env: desktopEnv, timeout: 10000 },
    );
    await execute("xdotool", ["windowfocus", "--sync", dialog.stdout.trim().split("\n").at(-1)!], {
      env: desktopEnv,
    });
    const cancelled = page.waitForResponse((response) => response.url().endsWith("/api/open"));
    await execute("xdotool", ["key", "--clearmodifiers", "Escape"], { env: desktopEnv });
    assert.equal((await cancelled).status(), 204);
    await expect(page.locator(".tikz-standalone-status")).toContainText("Saved");
    assert.equal(await readFile(diagramPath, "utf8"), edited);
    await page
      .locator(".cm-content")
      .fill(String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`);
    await page.getByRole("button", { name: "Quiver: right sidebar", exact: true }).click();
    const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]');
    await quiver.locator(".vertex").nth(1).click();
    await quiver.locator(".label-input").fill("C");
    await quiver.locator(".label-input").press("Control+s");
    await expect.poll(() => readFile(diagramPath, "utf8")).toMatch(/\\begin\{tikzcd\}[\s\S]*\bC\b/);
    await page.getByRole("button", { name: "Copy source", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(await readFile(diagramPath, "utf8"));
  });
  it("saves completed canvas and Quiver edits after an immediate rendered-view switch", async function () {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    for (const provider of ["visual", "quiver"]) {
      await page.request.post(`${url}api/new`, {
        data: provider === "visual" ? "tikzpicture" : "tikzcd",
      });
      await page.goto(url);
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      const authored =
        provider === "visual"
          ? String.raw`\begin{tikzpicture}\draw (0,0) -- (2,1);\end{tikzpicture}`
          : String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`;
      await page.locator(".cm-content").fill(authored);
      const frame = page.frameLocator(
        provider === "visual"
          ? 'iframe[title="TikZ visual editor"]'
          : 'iframe[title="Quiver diagram editor"]',
      );
      await editorReady(page);
      diagramPath = join(
        await mkdtemp(join(tmpdir(), "workbench-render-save-")),
        `${provider}.tikz`,
      );
      if (provider === "visual") {
        const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          bounds.x + bounds.width * 0.35 + 100,
          bounds.y + bounds.height / 2 + 25,
          { steps: 12 },
        );
        await page.mouse.up();
        await page.evaluate(() => {
          const buttons = [...document.querySelectorAll("button")];
          buttons
            .find((button) => button.getAttribute("aria-label") === "Preview: right sidebar")!
            .click();
          document.querySelector<HTMLElement>(".file-menu summary")!.click();
        });
      } else {
        await frame.locator(".vertex").nth(1).click();
        await frame.locator(".label-input").evaluate((input: HTMLInputElement) => {
          input.value = "Completed";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const buttons = [...window.parent.document.querySelectorAll("button")];
          buttons
            .find((button) => button.getAttribute("aria-label") === "Preview: right sidebar")!
            .click();
          window.parent.document.querySelector<HTMLElement>(".file-menu summary")!.click();
        });
      }
      await page.getByRole("button", { name: "Save As…", exact: true }).click();
      await chooseFile("save");
      await expect.poll(() => existsSync(diagramPath)).toBe(true);
      const browserWindow = await execute(
        "xdotool",
        ["search", "--onlyvisible", "--class", "chromium"],
        { env: desktopEnv },
      );
      await execute(
        "xdotool",
        ["windowfocus", "--sync", browserWindow.stdout.trim().split("\n")[0]],
        { env: desktopEnv },
      );
      await page.bringToFront();
      await page.locator(".document-bar strong").click();
      const saved = await readFile(diagramPath, "utf8");
      assert.match(saved, provider === "visual" ? /workbench-ink:/ : /Completed/);

      const later = authored.replace(
        provider === "visual" ? "(2,1)" : "B",
        provider === "visual" ? "(8,6)" : "HostAuthored",
      );
      await page.locator(".cm-content").fill(later);
      await page.getByRole("button", { name: "Copy source", exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(later);
      await page.keyboard.press("Control+s");
      await expect.poll(() => readFile(diagramPath, "utf8")).toBe(later);
    }
  });

  it("keeps both sources intact when an existing file changes on disk before the source editor Save shortcut", async function () {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    diagramPath = join(await mkdtemp(join(tmpdir(), "workbench-save-conflict-")), "conflict.tikz");
    await page.request.post(`${url}api/new`, { data: "tikzpicture" });
    await page.goto(url);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    const original = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
    await page.locator(".cm-content").fill(original);
    await fileMenu().click();
    await page.getByRole("button", { name: "Save As…", exact: true }).click();
    await chooseFile("save");
    await expect.poll(() => existsSync(diagramPath)).toBe(true);
    await expect.poll(() => readFile(diagramPath, "utf8")).toBe(original);
    await expect(page.locator(".tikz-standalone-status")).toContainText("Saved");

    const external = original.replace("(1,1)", "(2,2)");
    const edited = original.replace("(1,1)", "(3,3)");
    await writeFile(diagramPath, external, "utf8");
    await page.locator(".cm-content").fill(edited);
    await page.keyboard.press("Control+s");
    await expect(page.locator(".tikz-standalone-status")).toContainText("The file changed on disk");
    assert.equal(await readFile(diagramPath, "utf8"), external);
    await page.getByRole("button", { name: "Copy source", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(edited);
    await expect(page.locator(".tikz-standalone-status")).toContainText("The file changed on disk");
    await page.goto("about:blank");
    await workbench.stop();
    await startServer();
    await page.goto(url);
    await expect(page.locator(".document-bar strong")).toHaveText("conflict.tikz");
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await expect.poll(() => page.locator(".cm-line").evaluateAll((lines) => lines.map((line) => line.textContent).join("\n"))).toBe(edited);
    await expect(page.locator(".tikz-standalone-status")).toContainText("The file changed on disk");
    assert.equal(await readFile(diagramPath, "utf8"), external);
  });

  it("autosaves an existing file and reopens its source and picture after interruption", async function () {
    diagramPath = join(await mkdtemp(join(tmpdir(), "workbench-autosave-")), "autosaved.tikz");
    await page.request.post(`${url}api/new`, { data: "tikzpicture" });
    await page.goto(url);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    const original = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
    const edited = original.replace("(1,1)", "(4,5)");
    await page.locator(".cm-content").fill(original);
    await fileMenu().click();
    await page.getByRole("button", { name: "Save As…", exact: true }).click();
    await chooseFile("save");
    await expect.poll(() => existsSync(diagramPath)).toBe(true);
    await expect.poll(() => readFile(diagramPath, "utf8")).toBe(original);
    await expect(page.locator(".tikz-standalone-status")).toContainText("Saved");
    await page.locator(".cm-content").fill(edited);
    await expect.poll(() => readFile(diagramPath, "utf8")).toBe(edited);
    await expect(page.locator(".tikz-standalone-status")).toHaveText("Saved");

    await page.goto("about:blank");
    await workbench.stop();
    await startServer();
    await page.goto(url);
    await expect(page.locator(".document-bar strong")).toHaveText("autosaved.tikz");
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await expect.poll(() => page.locator(".cm-line").evaluateAll((lines) => lines.map((line) => line.textContent).join("\n"))).toBe(edited);
    await expect(page.frameLocator('iframe[title="TikZ visual editor"]').locator("path[data-source-id]")).toHaveCount(1);
    await expect(page.locator(".tikz-standalone-status")).toHaveText("Saved");
  });

  it("exports every authored figure as PDF, SVG, and PNG while preserving editable source", async function () {
    const directory = await mkdtemp(join(tmpdir(), "workbench-export-"));
    const authored = String.raw`\begin{tikzpicture}
\draw (0,0) -- (3,2);
\end{tikzpicture}

\begin{tikzpicture}
\draw (0,0) circle (1cm);
\end{tikzpicture}`;
    await page.request.post(`${url}api/new`, { data: "tikzpicture" });
    await page.goto(url);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await page.locator(".cm-content").fill(authored);
    await expect(page.locator(".tikz-standalone-status")).toContainText("Recovery saved");
    for (const format of ["PDF", "SVG", "PNG"] as const) {
      diagramPath = join(directory, `figures.${format.toLowerCase()}`);
      await page.getByRole("group", { name: "Export" }).locator("summary").click();
      await page.getByRole("button", { name: format, exact: true }).click();
      await chooseFile(`export-${format.toLowerCase()}`);
      const outputs = format === "PDF"
        ? [diagramPath]
        : [join(directory, `figures-1.${format.toLowerCase()}`), join(directory, `figures-2.${format.toLowerCase()}`)];
      await expect.poll(() => outputs.every((output) => existsSync(output))).toBe(true);
      for (const output of outputs) {
        const bytes = await readFile(output);
        assert.ok(bytes.length > 100, `${output} is empty`);
        if (format === "PDF") assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
        if (format === "SVG") assert.match(bytes.toString(), /<svg[\s\S]*<\/svg>/);
        if (format === "PNG") assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      }
      if (format === "PDF") {
        const { stdout } = await execute("pdfinfo", [diagramPath]);
        assert.match(stdout, /^Pages:\s+2$/m);
      } else {
        assert.notDeepEqual(await readFile(outputs[0]), await readFile(outputs[1]));
      }
    }
    assert.equal(await page.locator(".cm-line").evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")), authored);
    await page.locator(".cm-content").fill(authored.replace("(3,2)", "(4,2)"));
    await expect(page.locator(".tikz-standalone-status")).toContainText("Recovery saved");
  });

  for (const tablet of TABLET_VIEWPORTS) {
  it(`reopens layered source from disk with its names, order, visibility, and references in ${tablet.name}`, async function () {
    await page.setViewportSize(tablet);
    const authored = String.raw`\begin{tikzpicture}
\coordinate (anchor) at (0,0);
\begin{scope}[name=Rear, transparent]
\draw (anchor) -- (4,0);
\end{scope}
\begin{scope}[name=Front]
\draw (0,2) -- (4,2);
\end{scope}
\end{tikzpicture}`;
    diagramPath = join(await mkdtemp(join(tmpdir(), "workbench-layer-reopen-")), "layered.tikz");
    await page.request.post(`${url}api/new`, { data: "tikzpicture" });
    await page.goto(url);
    await editorReady(page);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await page.locator(".cm-content").fill(authored);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    await frame.getByRole("button", { name: "Layers", exact: true }).click();
    await frame.getByRole("button", { name: "Lock Front", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Unlock Front", exact: true })).toHaveAttribute("aria-pressed", "true");
    await fileMenu().click();
    await page.getByRole("button", { name: "Save As…", exact: true }).click();
    await chooseFile("save");
    await expect.poll(() => existsSync(diagramPath)).toBe(true);
    await expect.poll(() => readFile(diagramPath, "utf8")).toBe(authored);
    await page.goto("about:blank");
    await workbench.stop();
    await startServer();
    await page.goto(url);
    await expect(page.locator(".document-bar strong")).toHaveText("layered.tikz");
    await editorReady(page);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await expect.poll(() => page.locator(".cm-line").evaluateAll((lines) => lines.map((line) => line.textContent).join("\n"))).toBe(authored);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    const reopened = page.frameLocator('iframe[title="TikZ visual editor"]');
    await reopened.getByRole("button", { name: "Layers", exact: true }).click();
    const panel = reopened.getByRole("complementary", { name: "Diagram properties" }).getByRole("tabpanel");
    await expect.poll(() => panel.getByRole("group", { name: / layer$/ }).evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")))).toEqual(["Front layer", "Rear layer"]);
    await expect(panel.getByRole("button", { name: "Show Rear", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Lock Front", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(reopened.locator('svg [data-source-id^="path:"]')).toHaveCount(2);
    await expect(page.locator(".tikz-standalone-status")).toContainText("Saved");
  });
  }
});
