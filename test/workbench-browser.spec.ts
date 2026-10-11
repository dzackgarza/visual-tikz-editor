import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

describe("standalone workbench host boundary", function () {
  let server: ChildProcess;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let url: string;

  before(async function () {
    server = spawn("just", ["run"], { stdio: ["ignore", "pipe", "inherit"], detached: true });
    url = await new Promise<string>((resolve, reject) => {
      server.once("error", reject);
      server.once("exit", code => reject(new Error(`Standalone server exited: ${code}`)));
      server.stdout!.on("data", chunk => {
        const match = /TikZ workbench: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(chunk));
        if (match !== null) resolve(match[1]);
      });
    });
    browser = await chromium.launch();
    await mkdir("test-results/workbench", { recursive: true });
  });

  beforeEach(async function () {
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    await page.goto(url);
    await expect(page.getByText("Synced", { exact: true })).toBeVisible();
  });

  afterEach(async function () {
    const name = this.currentTest!.title.replace(/[^a-z0-9]+/gi, "-");
    await page.screenshot({ path: `test-results/workbench/${name}.png` });
    await context.tracing.stop({ path: `test-results/workbench/${name}.zip` });
    await context.close();
  });

  after(async function () {
    await browser?.close();
    if (server?.pid !== undefined) process.kill(-server.pid, "SIGTERM");
  });

  it("keeps authored source when a notification names a load operation", async function () {
    const sourcePane = page.locator(".cm-content");
    await sourcePane.fill(String.raw`\begin{tikzpicture}
\draw (0,0) circle (1cm);
\end{tikzpicture}`);
    await expect(page.getByText("Synced", { exact: true })).toBeVisible();
    const authored = await sourcePane.innerText();
    await page.evaluate(() => {
      const editor = document.querySelector<HTMLIFrameElement>("iframe")!;
      editor.contentWindow!.postMessage({
        event: "load",
        revision: 2,
        source: String.raw`\begin{tikzpicture}\draw (0,0) rectangle (2,1);\end{tikzpicture}`,
      }, location.origin);
    });
    // The old bridge throttles source notifications by 250 ms. Observe beyond
    // that delivery window, then use the canvas again to catch hidden mutation.
    await page.waitForTimeout(600);
    assert.equal(await sourcePane.innerText(), authored);
    await page.getByRole("button", { name: "Properties", exact: true }).click();
    await page.getByRole("button", { name: "Hide properties", exact: true }).click();
    assert.equal(await sourcePane.innerText(), authored);
  });

  it("keeps the drawing when another frame sends an explicit load command", async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator("#status")).toHaveText("Loaded");
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const accepted = JSON.parse(await page.locator("#result").innerText());
    await page.evaluate(async () => {
      const sibling = document.createElement("iframe");
      sibling.id = "unrelated-frame";
      sibling.src = "about:blank";
      const loaded = new Promise(resolve => sibling.addEventListener("load", resolve, { once: true }));
      document.body.append(sibling);
      await loaded;
    });
    const sibling = page.frames().find(frame => frame.url() === "about:blank")!;
    await sibling.evaluate(({ sessionId, revision }) => {
      parent.frames[0].postMessage({
        action: "load", sessionId, revision: revision + 1,
        requestId: crypto.randomUUID(), fileName: "fixture.tikz", autosave: 0,
        source: String.raw`\begin{tikzpicture}\draw (0,0) rectangle (2,1);\end{tikzpicture}`,
      }, parent.location.origin);
    }, accepted);
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const retained = JSON.parse(await page.locator("#result").innerText());
    assert.equal(retained.source, accepted.source);
    assert.equal(retained.svg, accepted.svg);
  });

  it("opens a tablet canvas and independently toggles source and properties before copying", async function () {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await expect(page.getByText("Synced", { exact: true })).toBeVisible();
    const sourcePane = page.locator(".cm-content");
    await expect(sourcePane).toBeHidden();
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const source = String.raw`\begin{tikzpicture}
% Keep this authored comment.
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;
    await sourcePane.fill(source);
    await page.getByRole("button", { name: "Hide source", exact: true }).click();
    await page.getByRole("button", { name: "Properties", exact: true }).click();
    await page.screenshot({ path: "test-results/workbench/tablet-properties.png" });
    await expect(sourcePane).toBeHidden();
    await page.getByRole("button", { name: "Source", exact: true }).click();
    assert.equal(await sourcePane.innerText(), source);
    await page.screenshot({ path: "test-results/workbench/tablet-both-panels.png" });
    await page.getByRole("button", { name: "Hide properties", exact: true }).click();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const writes: string[] = [];
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    await page.getByRole("button", { name: "Copy source", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
    assert.deepEqual(writes, []);
    await sourcePane.press("Control+z");
    await expect(sourcePane).not.toHaveText(source);
  });

  it("returns a revision-matched drawing through the mounted embedding surface", async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator("#status")).toHaveText("Loaded");
    const source = String.raw`\begin{tikzpicture}
% preserve authored bytes
\draw[red] (0,0) rectangle (3,2);
\end{tikzpicture}`;
    await page.getByLabel("Authored source").fill(source);
    await page.getByRole("button", { name: "Load source", exact: true }).click();
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const result = JSON.parse(await page.locator("#result").innerText());
    assert.equal(result.source, source);
    assert.equal(result.revision, 2);
    const drawing = await page.evaluate(svg => {
      const document = new DOMParser().parseFromString(svg, "image/svg+xml");
      return { paths: [...document.querySelectorAll("path")].map(path => path.getAttribute("d")), errors: document.querySelectorAll("parsererror").length };
    }, result.svg);
    assert.equal(drawing.errors, 0);
    assert.ok(drawing.paths.some(path => path?.includes("85.358")), "The exported view must contain the authored 3cm rectangle");
    await page.screenshot({ path: "test-results/workbench/embedding-snapshot.png" });
    await page.getByRole("button", { name: "Dispose", exact: true }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  it("retains the current drawing when an older load arrives from its host", async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator("#status")).toHaveText("Loaded");
    await page.getByLabel("Authored source").fill(String.raw`\begin{tikzpicture}
\draw[red] (0,0) rectangle (3,2);
\end{tikzpicture}`);
    await page.getByRole("button", { name: "Load source", exact: true }).click();
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const accepted = JSON.parse(await page.locator("#result").innerText());
    await page.evaluate(({ sessionId }) => {
      document.querySelector<HTMLIFrameElement>("iframe")!.contentWindow!.postMessage({
        action: "load", sessionId, revision: 1, requestId: crypto.randomUUID(),
        fileName: "fixture.tikz", autosave: 0,
        source: String.raw`\begin{tikzpicture}\draw (0,0) circle (1cm);\end{tikzpicture}`,
      }, location.origin);
    }, accepted);
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const retained = JSON.parse(await page.locator("#result").innerText());
    assert.equal(retained.source, accepted.source);
    assert.equal(retained.svg, accepted.svg);
  });

  it("keeps exported clipping local to each independently edited diagram", async function () {
    const exports: string[] = [];
    for (const source of [
      String.raw`\begin{tikzpicture}\clip (0,0) circle (.5);\fill[red] (-1,-1) rectangle (1,1);\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}\clip (0,0) rectangle (1,1);\fill[blue] (-1,-1) rectangle (1,1);\end{tikzpicture}`,
    ]) {
      await page.goto(`${url}embedding.html`);
      await expect(page.locator("#status")).toHaveText("Loaded");
      await page.getByLabel("Authored source").fill(source);
      await page.getByRole("button", { name: "Load source", exact: true }).click();
      await page.getByRole("button", { name: "Snapshot", exact: true }).click();
      await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
      exports.push(JSON.parse(await page.locator("#result").innerText()).svg);
    }
    await page.goto(`${url}svg-viewer.html`);
    for (const svg of exports) {
      await page.getByLabel("Exported SVG").fill(svg);
      await page.getByRole("button", { name: "Append diagram" }).click();
    }
    const owners = await page.locator("figure").evaluateAll(figures => figures.map(figure => {
      const clipped = figure.querySelector("[clip-path]")!;
      const reference = /^url\(#(.+)\)$/.exec(clipped.getAttribute("clip-path")!)![1];
      return document.getElementById(reference)!.closest("figure") === figure;
    }));
    assert.deepEqual(owners, [true, true]);
  });
});
