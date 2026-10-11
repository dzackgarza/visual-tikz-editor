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
});
