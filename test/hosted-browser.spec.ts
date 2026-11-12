import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import {
  buildWorkbench,
  stableCenter,
  startPageCoverage,
  startWorkbench,
  stopPageCoverage,
  storyScreenshot,
  TABLET_VIEWPORTS,
  TabletInput,
  type Workbench,
} from "./tablet";

/** Embeds hosted.html in the page and loads `source` as the embedding document does. */
async function openHostedFigure(page: Page, source: string) {
  await page.evaluate(() => {
    document.body.innerHTML =
      '<iframe title="Hosted figure" style="width:100%;height:750px" src="/hosted.html"></iframe>';
    (window as typeof window & { editorMessages: unknown[] }).editorMessages = [];
    window.addEventListener("message", (event: MessageEvent<string>) => {
      if (
        event.source === document.querySelector("iframe")?.contentWindow &&
        event.origin === location.origin
      ) {
        (window as typeof window & { editorMessages: unknown[] }).editorMessages.push(
          JSON.parse(event.data),
        );
      }
    });
  });
  const hosted = page.frameLocator('iframe[title="Hosted figure"]');
  await expect(hosted.getByText("Loading figure…")).toBeVisible();
  const sessionId = crypto.randomUUID();
  // Post to the hosted document as its embedding page does; the page keeps the iframe's window.
  const hostedWindow = await page.evaluateHandle(() => {
    const hostedWindow = document.querySelector("iframe")?.contentWindow;
    if (hostedWindow == null) {
      throw new Error("The hosted figure iframe has no window");
    }
    return hostedWindow;
  });
  await hostedWindow.evaluate(
    (target, { sessionId, source }) => {
      target.postMessage(
        JSON.stringify({
          action: "load",
          sessionId,
          revision: 1,
          requestId: crypto.randomUUID(),
          source,
          fileName: "figure.tikz",
          autosave: 0,
        }),
        location.origin,
      );
    },
    { sessionId, source },
  );
  const canvas = hosted.frameLocator('iframe[title="TikZ visual editor"]');
  await expect(canvas.locator("[data-source-id]").first()).toBeVisible();
  return { hosted, hostedWindow, canvas, sessionId };
}

describe("hosted workbench", function () {
  let workbench: Workbench;
  let browser: Browser;
  let url: string;

  before(async function () {
    await buildWorkbench();
    workbench = await startWorkbench(process.env);
    url = workbench.url;
    browser = await chromium.launch();
  });

  after(async function () {
    await browser?.close();
    await workbench?.stop();
  });

  it("returns a completed drawing to its embedding document", async function () {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await startPageCoverage(page);
    await page.goto(url);
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
    const { hostedWindow, canvas, sessionId } = await openHostedFigure(page, source);
    const box = (await canvas.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 12 });
    await page.mouse.up();
    await hostedWindow.evaluate(
      (target, sessionId) =>
        target.postMessage(
          JSON.stringify({
            action: "source",
            sessionId,
            revision: 1,
            requestId: "completed-drawing",
          }),
          location.origin,
        ),
      sessionId,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as typeof window & { editorMessages: Array<{ requestId?: string }> }
          ).editorMessages.find((message) => message.requestId === "completed-drawing"),
        ),
      )
      .toBeDefined();
    const reply = await page.evaluate(() =>
      (
        window as typeof window & {
          editorMessages: Array<{ requestId?: string; source?: string; paperSource?: string }>;
        }
      ).editorMessages.find((message) => message.requestId === "completed-drawing"),
    );
    assert.match(reply!.source!, /workbench-ink:/);
    assert.doesNotMatch(reply!.paperSource!, /workbench-ink:/);
    assert.match(reply!.paperSource!, /\\draw/);
    await mkdir("test-results/workbench", { recursive: true });
    await page.screenshot({ path: "test-results/workbench/hosted-drawing.png" });
    await stopPageCoverage(page);
    await page.close();
  });

  for (const tablet of TABLET_VIEWPORTS) {
    it(`opens Properties on one host tap after the panel's own close button, in ${tablet.name}`, async function () {
      const page = await browser.newPage({ viewport: { width: tablet.width, height: tablet.height } });
      await startPageCoverage(page);
      await page.goto(url);
      const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
      const { hosted, canvas } = await openHostedFigure(page, source);
      const input = await TabletInput.attach(page);
      const properties = hosted.getByRole("button", { name: /^(Properties|Hide properties)$/ });
      const close = canvas.getByRole("button", { name: "Close properties", exact: true });

      await input.touch([await stableCenter(properties)]);
      await expect(close).toBeVisible();
      await input.touch([await stableCenter(close)]);
      await expect(close).toBeHidden();
      await expect(properties).toHaveAttribute("aria-pressed", "false");
      await input.touch([await stableCenter(properties)]);
      await expect(close).toBeVisible();
      await expect(properties).toHaveAttribute("aria-pressed", "true");
      await storyScreenshot(page, `hosted-properties-reopen-${tablet.name}`);
      await stopPageCoverage(page);
      await page.close();
    });
  }
});
