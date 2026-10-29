import { strict as assert } from "node:assert";
import { copyFile } from "node:fs/promises";
import { chromium, expect, type Browser, type BrowserContext, type FrameLocator, type Locator, type Page } from "@playwright/test";

import { geometryTraces } from "./geometry-traces";
import { buildWorkbench, editorDebug, editorReady, editorFrame, startWorkbench, settledCenter, stableCenter, storyScreenshot, fitDiagram, emptyCanvasGesture, strokePoint, TABLET_VIEWPORTS, TabletInput, waveAcross, type Workbench } from "./tablet";
import type { EditorSnapshot } from '../src/host';

const freehandTool = (frame: FrameLocator) => frame.getByRole('button', { name: 'Freehand', exact: true });

describe("standalone workbench host boundary", function () {
  let workbench: Workbench;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let url: string;

  type StorySetup = { viewport?: { width: number; height: number }; initialPage?: "blank" };
  const storySetups = new Map<string, StorySetup>();
  function story(setup: StorySetup, title: string, run: Mocha.AsyncFunc): void {
    storySetups.set(title, setup);
    it(title, run);
  }

  async function hostSnapshot(): Promise<EditorSnapshot> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
      await expect(page.locator('#status')).toHaveText(/Snapshot ready|Snapshot failed/, { timeout: 12000 });
      const result = JSON.parse(await page.locator('#result').innerText());
      if (result.status === 'ready') return result as EditorSnapshot;
      if (result.error !== 'source-changed') throw new Error(`Snapshot failed: ${result.error}`);
      await page.getByRole('button', { name: 'Copy current source', exact: true }).click();
    }
    throw new Error('Source changed during three consecutive snapshot requests');
  }

  async function paintedGeometry(svg: string): Promise<string[][]> {
    return page.evaluate(markup => [...new DOMParser().parseFromString(markup, 'image/svg+xml')
      .querySelectorAll('path[data-source-id],circle[data-source-id],ellipse[data-source-id],rect[data-source-id]')]
      .map(element => ['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'stroke', 'fill']
        .map(attribute => element.getAttribute(attribute) ?? '')), svg);
  }

  before(async function () {
    await buildWorkbench();
    browser = await chromium.launch();
  });

  beforeEach(async function () {
    workbench = await startWorkbench(process.env);
    url = workbench.url;
    const setup = storySetups.get(this.currentTest!.title);
    const viewport = setup?.viewport;
    context = await browser.newContext(viewport ? { viewport } : {});
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    await page.request.post(`${url}api/new`, { data: 'tikzpicture' });
    if (setup?.initialPage === 'blank') return;
    await page.goto(url);
    if (!viewport) {
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30_000 });
    }
    await editorReady(page);
  });

  afterEach(async function () {
    const name = this.currentTest!.title.replace(/[^a-z0-9]+/gi, "-");
    try {
      await storyScreenshot(page, name);
      await context.tracing.stop({ path: `test-results/workbench/${name}.zip` });
      // A rerun overwrites the trace above, so a failure also keeps its own copy for intermittent failures.
      if (this.currentTest!.state === 'failed') await copyFile(`test-results/workbench/${name}.zip`, `test-results/workbench/failed-${Date.now()}-${name}.zip`);
    } finally {
      try {
        await context.close();
      } finally {
        await workbench.stop();
      }
    }
  });

  after(async function () {
    await browser?.close();
  });

  story({ viewport: { width: 768, height: 1024 } }, 'keeps authored source through a render error and recovers in the dark tablet workspace', async function () {
    await editorReady(page);
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
    const valid = String.raw`\begin{tikzpicture}\draw[blue] (0,0) circle (1cm);\end{tikzpicture}`;
    await page.locator('.cm-content').fill(valid);
    await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
    await expect(page.locator('.tikz-view-status')).toContainText('Up to date', { timeout: 40000 });
    const invalid = valid.replace('\\draw', '\\thisCommandDoesNotExist\\draw');
    await page.locator('.cm-content').fill(invalid);
    await expect(page.locator('.tikz-compiler-preview-error')).toBeVisible({ timeout: 40000 });
    assert.equal(await page.locator('.cm-content').innerText(), invalid);
    await page.screenshot({ path: 'test-results/workbench/dark-tablet-render-error.png' });
    await page.locator('.cm-content').fill(valid);
    await expect(page.locator('.tikz-view-status')).toContainText('Up to date', { timeout: 40000 });
    await expect(page.locator('.tikz-compiler-preview-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Canvas: right sidebar', exact: true }).click();
    await expect(page.frameLocator('iframe[title="TikZ visual editor"]').locator('circle[data-source-id]')).toBeInViewport();
    assert.equal(await page.locator('.cm-content').innerText(), valid);
  });

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `reaches zoom and canvas aids by touch in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      await expect(frame.locator('[data-canvas-viewport="true"]')).toBeVisible();
      const input = await TabletInput.attach(page);
      const tap = async (locator: ReturnType<typeof frame.getByRole>) => {
        await expect(locator).toBeInViewport({ ratio: 1 });
        const box = (await locator.boundingBox())!;
        await input.touch([{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]);
      };
      const before = await editorDebug(page);
      await tap(frame.getByRole('button', { name: 'Zoom and display', exact: true }));
      await tap(frame.getByRole('button', { name: 'Rulers', exact: true }));
      await tap(frame.getByRole('button', { name: '200%', exact: true }));
      const after = await editorDebug(page);
      assert.equal(after.canvasAids.rulers, !before.canvasAids.rulers);
      assert.notEqual(after.viewport.scale, before.viewport.scale);
      await expect(frame.getByRole('button', { name: '200%', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `lands drawn points on the lattice by default, under a lock toggle on the rail, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const rail = frame.locator('[data-diagram-tools]');
      const drawLine = async () => {
        const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
        // Screen position of lattice coordinates (x, y), from the two reference segments of length 10.
        const at = (x: number, y: number) => ({
          x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
          y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
        });
        await input.touch([await stableCenter(rail.getByRole('button', { name: 'Insert', exact: true }))]);
        await input.touch([await stableCenter(frame.getByRole('button', { name: 'Line', exact: true }))]);
        const [from, to] = [at(3.5, 2.5), at(6.5, 4.5)];
        await input.penStroke([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to]);
        await expect.poll(async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length).toBeGreaterThan(2);
        const lines = (await editorDebug(page)).source.split('\n').map(line => line.trim()).filter(line => line.startsWith('\\draw'));
        const added = lines[lines.length - 1];
        await input.touch([await stableCenter(rail.getByRole('button', { name: 'Undo', exact: true }))]);
        // The next line must not be read back from this one: wait for the undo to land.
        await expect.poll(async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length).toBe(2);
        return [...added.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
      };
      const locked = await drawLine();
      assert.ok(locked.length >= 4 && locked.every(Number.isInteger), `A line drawn with default settings leaves the lattice: ${locked}`);
      const lock = rail.getByRole('button', { name: 'Lock to lattice', exact: true });
      await expect(lock).toHaveAttribute('aria-pressed', 'true');
      await input.touch([await stableCenter(lock)]);
      await expect(lock).toHaveAttribute('aria-pressed', 'false');
      // Zoomed out, a lattice cell is a few pixels wide: points still move freely.
      const zoom = rail.getByRole('button', { name: 'Zoom and display', exact: true });
      await input.touch([await stableCenter(zoom)]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: '5%', exact: true }))]);
      await input.touch([await stableCenter(zoom)]);
      await expect(zoom).toHaveText('5%');
      const free = await drawLine();
      assert.ok(free.some(value => !Number.isInteger(value)), `With the lock off the line still lands on the lattice: ${free}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `commits the locked curve its preview shows, with lattice control points, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      await expect(rail.getByRole('button', { name: 'Lock to lattice', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Insert', exact: true }))]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Curve', exact: true }))]);
      assert.equal((await editorDebug(page)).tool, 'addBezier');
      await input.penStroke([at(2, 1), at(5, 1), at(8, 1)]);
      await input.penDown(at(5, 1));
      // A bend one unit off the chord puts unrounded controls 4/3 of a unit off it.
      await input.penMove(at(5.1, 1.6));
      await input.penMove(at(5.1, 2.1));
      const preview = frame.getByTestId('canvas-tool-preview-bezier');
      await expect(preview).toBeAttached();
      const numbers = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
      const previewed = numbers((await preview.getAttribute('d'))!);
      await input.penUp(at(5.1, 2.1));
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\.\. controls/);
      const curve = (await editorDebug(page)).source.split('\n').map(line => line.trim()).find(line => line.includes('.. controls'))!;
      assert.ok(numbers(curve).every(Number.isInteger), `A locked curve has off-lattice points: ${curve}`);
      const committed = numbers((await frame.locator('svg [data-source-id="path:2"]').first().getAttribute('d'))!);
      assert.equal(committed.length, previewed.length, `preview ${previewed} vs committed ${committed}`);
      assert.ok(committed.every((value, index) => Math.abs(value - previewed[index]) < 0.05), `The preview showed ${previewed}; the editor committed ${committed}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `shows an alignment guide when a dragged square meets a circle's top, locked and free, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (0,0) circle (2);
\draw (4,-6) rectangle (6,-4);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:3"]').first()).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Select', exact: true }))]);
      const guides = frame.locator('[class*="snapOverlay"] [class*="snapLine"]');
      for (const locked of [true, false]) {
        const lock = rail.getByRole('button', { name: 'Lock to lattice', exact: true });
        if ((await lock.getAttribute('aria-pressed')) !== String(locked)) await input.touch([await stableCenter(lock)]);
        await expect(lock).toHaveAttribute('aria-pressed', String(locked));
        // Grab the square's left edge and lift its top edge from y = -4 to the circle's top, y = 2.
        const grab = at(4, -5);
        await input.penDown(grab);
        for (let step = 1; step <= 12; step++) await input.penMove(at(4, -5 + step / 2));
        // The drag is live: the square's top edge is drawn at the circle's top.
        await expect.poll(async () => Math.abs((await frame.locator('svg [data-source-id="path:3"]').first().boundingBox())!.y - at(0, 2).y)).toBeLessThan(3);
        // A horizontal guide has no height, so Playwright's area-based visibility cannot judge it; require a drawn length and stroke.
        await expect.poll(async () => guides.first().evaluate(line => {
          const box = line.getBoundingClientRect();
          const style = getComputedStyle(line);
          return Math.max(box.width, box.height) > 20 && style.visibility === 'visible' && style.stroke !== 'none' && Number(style.opacity) > 0;
        }).catch(() => false)).toBe(true);
        await storyScreenshot(page, `alignment-guide-${locked ? 'locked' : 'free'}-${tablet.name}`);
        await input.penUp(at(4, 1));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/rectangle/);
        await input.touch([await stableCenter(rail.getByRole('button', { name: 'Undo', exact: true }))]);
        await expect.poll(async () => (await editorDebug(page)).source).toContain('(4,-6) rectangle (6,-4)');
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `labels the rulers in lattice steps when the figure scales its lattice in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}[x=2cm,y=2cm]
\draw (0,0) -- (10,0);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const axis = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(axis).toBeAttached();
      // Screen x of lattice x = 10, the segment's far end.
      const tenX = await axis.evaluate((path: SVGGeometryElement) => {
        const p = path.getPointAtLength(path.getTotalLength());
        const m = path.getScreenCTM()!;
        return p.x * m.a + p.y * m.c + m.e;
      });
      const labels = () => frame.getByTestId('canvas-top-ruler').locator('text').evaluateAll(texts =>
        texts.map(text => ({ label: text.textContent?.trim() ?? '', x: text.getBoundingClientRect().x + text.getBoundingClientRect().width / 2 })));
      // The rulers relabel once the startup view has settled on the new source.
      await expect.poll(async () => (await labels()).map(entry => entry.label), 'No ruler label 10').toContain('10');
      const ten = (await labels()).find(entry => entry.label === '10')!;
      assert.ok(Math.abs(ten.x - tenX) < 12, `Ruler label 10 sits at ${ten.x}, lattice x = 10 at ${tenX}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `draws the axes distinct from major grid lines, undimmed, in both themes in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const axis = frame.locator('line[class*="gridAxis"]').first();
      const major = frame.locator('line[class*="gridMajor"]').first();
      await expect(axis).toBeAttached();
      const look = (line: typeof axis) => line.evaluate(element => {
        let opacity = 1;
        for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        const rgb = getComputedStyle(element).stroke.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        return { rgb, opacity, width: Number(element.getAttribute('stroke-width')) };
      });
      for (const theme of ['light', 'dark'] as const) {
        if (theme === 'dark') {
          await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
          await expect(frame.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
        }
        const [a, m] = [await look(axis), await look(major)];
        const distance = Math.hypot(...a.rgb.map((value, index) => value - m.rgb[index]));
        assert.ok(distance > 60, `${theme}: axis ${a.rgb} and major line ${m.rgb} share a colour`);
        assert.ok(a.opacity >= .95, `${theme}: the axis is dimmed to ${a.opacity}`);
        assert.ok(a.width >= m.width + .5, `${theme}: axis width ${a.width}, major ${m.width}`);
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `starts on at least (-20,20) on both axes at a preset zoom in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const zoom = frame.getByRole('button', { name: 'Zoom and display', exact: true });
      await expect(zoom).toBeVisible();
      const readout = (await zoom.innerText()).trim();
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      // Measure the view the author sees once startup layout has settled.
      await settledCenter(frame.locator('text', { hasText: '(0,0)' }).first());
      // Ruler labels are drawn rotated, so read the range from the axes and the scale: one lattice unit is one cm here.
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const [vertical, horizontal] = await frame.locator('line[class*="gridAxis"]').evaluateAll(lines => lines.map(line => line.getBoundingClientRect()));
      const unitPx = (await editorDebug(page)).viewport.scale * 28.4527559055;
      const originX = frameBox.x + vertical.x + vertical.width / 2;
      const originY = frameBox.y + horizontal.y + horizontal.height / 2;
      const x = { min: -(originX - viewport.x) / unitPx, max: (viewport.x + viewport.width - originX) / unitPx };
      const y = { min: -(viewport.y + viewport.height - originY) / unitPx, max: (originY - viewport.y) / unitPx };
      assert.ok(x.min <= -20 && x.max >= 20, `x range ${x.min.toFixed(1)}..${x.max.toFixed(1)}`);
      assert.ok(y.min <= -20 && y.max >= 20, `y range ${y.min.toFixed(1)}..${y.max.toFixed(1)}`);
      const input = await TabletInput.attach(page);
      // The popup lists the current zoom beside its presets, so move away first: the startup zoom must still be offered.
      await input.touch([await stableCenter(zoom)]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: '50%', exact: true }))]);
      await expect(zoom).toHaveText('50%');
      const presets = await frame.getByRole('button', { name: /^\d+%$/ }).allInnerTexts();
      assert.ok(presets.includes(readout), `startup zoom ${readout} is not among the presets ${presets}`);
      await input.touch([await stableCenter(frame.getByRole('button', { name: readout, exact: true }))]);
      await expect(zoom).toHaveText(readout);
      await input.touch([await stableCenter(zoom)]);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps the rail and its popups off the rulers, and the popups off the rail, docked bottom by default, docked left, and floating in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = frame.locator('[data-diagram-tools]');
      await expect(rail).toBeVisible();
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const rulers = await Promise.all(['canvas-top-ruler', 'canvas-left-ruler'].map(async id => ({ id, box: (await frame.getByTestId(id).boundingBox())! })));
      const clear = (what: string, box: { x: number; y: number; width: number; height: number }, others: typeof rulers = []) => {
        for (const ruler of [...rulers, ...others]) {
          const overlapX = Math.min(box.x + box.width, ruler.box.x + ruler.box.width) - Math.max(box.x, ruler.box.x);
          const overlapY = Math.min(box.y + box.height, ruler.box.y + ruler.box.height) - Math.max(box.y, ruler.box.y);
          assert.ok(overlapX <= 0 || overlapY <= 0, `${what} covers ${ruler.id}`);
        }
      };
      const drag = async (to: { x: number; y: number }) => {
        const from = await stableCenter(rail.getByRole('button', { name: 'Move toolbar', exact: true }));
        await input.touch(Array.from({ length: 13 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 })));
      };
      const placements = [
        { dock: 'bottom', to: null },
        { dock: 'left', to: { x: frameBox.x + 20, y: frameBox.y + frameBox.height / 2 } },
        { dock: 'floating', to: { x: frameBox.x + 130, y: frameBox.y + 150 } }
      ] as const;
      for (const placement of placements) {
        if (placement.to) await drag(placement.to);
        await expect(rail).toHaveAttribute('data-dock', placement.dock);
        clear(`the ${placement.dock} rail`, (await rail.boundingBox())!);
        for (const name of ['Insert', /^Drawing color/, 'Zoom and display'] as const) {
          const button = typeof name === 'string' ? rail.getByRole('button', { name, exact: true }) : rail.getByRole('button', { name });
          await input.touch([await stableCenter(button)]);
          const popup = frame.getByRole('dialog', { name: 'Tool options' });
          await expect(popup).toBeVisible();
          // A popup beside the rail never covers its other columns or the saved colours.
          clear(`the ${String(name)} popup of the ${placement.dock} rail`, (await popup.boundingBox())!, [{ id: 'the rail', box: (await rail.boundingBox())! }]);
          await input.touch([await stableCenter(button)]);
          await expect(popup, `the ${String(name)} popup of the ${placement.dock} rail stays open after a second tap`).toHaveCount(0);
        }
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `snaps a free arc's end to the nearby common angle by pen in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\path[use as bounding box] (-10,-10) rectangle (15,15);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      const lock = rail.getByRole('button', { name: 'Lock to lattice', exact: true });
      await input.touch([await stableCenter(lock)]);
      await expect(lock).toHaveAttribute('aria-pressed', 'false');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Insert', exact: true }))]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Arc', exact: true }))]);
      assert.equal((await editorDebug(page)).tool, 'addArc');
      // Centre, radius point, then an end 7 degrees short of the half circle and clear of the lattice pull.
      for (const point of [at(0, 0), at(6, 0), at(-5.955, .731)]) await input.penStroke([point]);
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/arc/);
      const arc = (await editorDebug(page)).source.split('\n').find(line => line.includes('arc'))!;
      // The editor writes angles as numbers or as atan2(y,x) of a lattice direction.
      const angle = (raw: string) => {
        const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
        return pair ? Math.atan2(Number(pair[1]), Number(pair[2])) * 180 / Math.PI + Number(pair[3] ?? 0) : Number(raw.replace(/[{}]/g, ''));
      };
      const end = angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
      assert.ok(Math.abs(end - 180) < 1e-6, `The free arc ends at ${end} degrees, not 180: ${arc}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `sweeps an arc the way the pen went round, past a half circle, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\path[use as bounding box] (-10,-10) rectangle (15,15);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Insert', exact: true }))]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Arc', exact: true }))]);
      await input.penStroke([at(0, 0)]);
      await input.penStroke([at(3, 0)]);
      // Hover counterclockwise through a quarter, a half, and five eighths of the circle, then tap at three quarters.
      for (let degrees = 10; degrees <= 260; degrees += 10) {
        const radians = degrees * Math.PI / 180;
        await input.penHover(at(3 * Math.cos(radians), 3 * Math.sin(radians)));
      }
      await input.penStroke([at(0, -3)]);
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/arc/);
      const arc = (await editorDebug(page)).source.split('\n').find(line => line.includes('arc'))!;
      const angle = (raw: string) => {
        const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
        return pair ? Math.atan2(Number(pair[1]), Number(pair[2])) * 180 / Math.PI + Number(pair[3] ?? 0) : Number(raw.replace(/[{}]/g, ''));
      };
      const start = angle(/start angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
      const end = angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
      assert.ok(Math.abs(end - start - 270) < 1e-6, `The arc sweeps ${end - start} degrees, not 270 counterclockwise: ${arc}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `builds circles on a diameter and through three points, and an arc through three points, by pen in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\path[use as bounding box] (-10,-10) rectangle (15,15);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      const construct = async (choice: string, taps: { x: number; y: number }[]) => {
        await input.touch([await stableCenter(rail.getByRole('button', { name: 'Insert', exact: true }))]);
        await input.touch([await stableCenter(frame.getByRole('dialog', { name: 'Tool options' }).getByRole('button', { name: choice, exact: true }))]);
        const before = ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
        for (const tap of taps) await input.penStroke([tap]);
        await expect.poll(async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length).toBe(before + 1);
        const lines = (await editorDebug(page)).source.split('\n').map(line => line.trim()).filter(line => line.startsWith('\\draw'));
        return lines[lines.length - 1];
      };
      const three = await construct('Circle through three points', [at(0, 3), at(3, 0), at(0, -3)]);
      assert.match(three, /\(0,0\) circle \(\{3cm\}\)/, three);
      const diameter = await construct('Circle on a diameter', [at(-6, -2), at(-2, -2)]);
      assert.match(diameter, /\(-4,-2\) circle \(\{2cm\}\)/, diameter);
      const arc = await construct('Arc through three points', [at(6, 0), at(8, 2), at(10, 0)]);
      const angle = (raw: string) => {
        const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
        return pair ? Math.atan2(Number(pair[1]), Number(pair[2])) * 180 / Math.PI + Number(pair[3] ?? 0) : Number(raw.replace(/[{}]/g, ''));
      };
      assert.match(arc, /\(6,0\) arc\[/, arc);
      assert.match(arc, /radius=\{2cm\}/, arc);
      const sweep = angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]) - angle(/start angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
      assert.ok(Math.abs(sweep + 180) < 1e-6, `The arc through (8,2) sweeps ${sweep} degrees, not -180: ${arc}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `names the chosen construction and its next step until it finishes or is cancelled in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\path[use as bounding box] (-10,-10) rectangle (15,15);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      const draws = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
      const step = rail.getByRole('status', { name: 'Current step', exact: true });
      await tap(rail.getByRole('button', { name: 'Insert', exact: true }));
      await tap(frame.getByRole('dialog', { name: 'Tool options' }).getByRole('button', { name: 'Arc through three points', exact: true }));
      await expect(frame.getByRole('dialog', { name: 'Tool options' })).toHaveCount(0);
      await expect(step).toHaveText('Arc through three points: place the first point');
      await input.penStroke([at(6, 0)]);
      await expect(step).toHaveText('Arc through three points: place the second point');
      await input.penStroke([at(8, 2)]);
      await expect(step).toHaveText('Arc through three points: place the last point');
      // Properties describes the same construction stage as the dock.
      await tap(rail.getByRole('button', { name: 'Properties', exact: true }));
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel).toContainText('Arc through three points: place the last point');
      await tap(panel.getByRole('button', { name: 'Close properties', exact: true }));
      // Cancel removes only the provisional construction; the tool stays chosen.
      await tap(rail.getByRole('button', { name: 'Cancel construction', exact: true }));
      await expect(step).toHaveText('Arc through three points: place the first point');
      assert.equal(await draws(), 2, 'Cancel committed the provisional arc');
      for (const point of [at(6, 0), at(8, 2), at(10, 0)]) await input.penStroke([point]);
      await expect.poll(draws).toBe(3);
      await expect(step).toHaveText('Arc through three points: place the first point');
      // Another tool discards the provisional construction.
      await input.penStroke([at(-6, 0)]);
      await expect(step).toHaveText('Arc through three points: place the second point');
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await expect(step).toHaveCount(0);
      await tap(rail.getByRole('button', { name: 'Insert', exact: true }));
      await tap(frame.getByRole('dialog', { name: 'Tool options' }).getByRole('button', { name: 'Arc through three points', exact: true }));
      await expect(step).toHaveText('Arc through three points: place the first point');
      await storyScreenshot(page, `construction-step-${tablet.name}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `rotates a square 45 degrees by its handle with the pen in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (2,2) rectangle (6,6);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const square = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(square).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.penStroke([await strokePoint(page, square, .1)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
      const handle = await settledCenter(frame.getByTestId('canvas-rotate-handle'));
      const centre = await settledCenter(square);
      // Turn the handle 45 degrees counterclockwise about the square's centre (screen y grows downward).
      const radius = Math.hypot(handle.x - centre.x, handle.y - centre.y);
      const from = Math.atan2(centre.y - handle.y, handle.x - centre.x);
      const path = Array.from({ length: 10 }, (_, i) => {
        const angle = from + (Math.PI / 4) * i / 9;
        return { x: centre.x + radius * Math.cos(angle), y: centre.y - radius * Math.sin(angle) };
      });
      await input.penDown(path[0]);
      for (const point of path.slice(1)) await input.penMove(point);
      await input.penUp(path[path.length - 1]);
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/rotate/);
      const source = (await editorDebug(page)).source;
      assert.match(source, /rotate( around)?=\{?45\b/, `The square did not turn 45 degrees: ${source}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `scales a lasso-selected pair by 2 from a corner of their frame in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,2) circle (1);
\draw (6,2) circle (1);
\path[use as bounding box] (-10,-10) rectangle (15,15);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:3"]').first()).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Lasso', exact: true }))]);
      // A loop round both circles and clear of the axes.
      await input.penStroke([at(.5, .5), at(8, .5), at(8, 3.6), at(.5, 3.6), at(.5, .6)]);
      await expect.poll(async () => [...(await editorDebug(page)).selection].sort()).toEqual(['path:2', 'path:3']);
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Select', exact: true }))]);
      await expect.poll(async () => [...(await editorDebug(page)).selection].sort()).toEqual(['path:2', 'path:3']);
      const corner = at(7, 3);
      const handles = await frame.locator('[data-handle-kind="group-scale"]').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { role: node.getAttribute('data-resize-role'), x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }));
      const nearest = handles.map(entry => ({ ...entry, x: entry.x + frameBox.x, y: entry.y + frameBox.y }))
        .sort((a, b) => Math.hypot(a.x - corner.x, a.y - corner.y) - Math.hypot(b.x - corner.x, b.y - corner.y))[0];
      assert.ok(nearest && Math.hypot(nearest.x - corner.x, nearest.y - corner.y) < 16, `No frame corner handle at (7,3) for the pair: ${JSON.stringify(handles)}`);
      const target = at(13, 5);
      await input.penDown(nearest);
      for (let i = 1; i <= 10; i++) await input.penMove({ x: nearest.x + (target.x - nearest.x) * i / 10, y: nearest.y + (target.y - nearest.y) * i / 10 });
      await input.penUp(target);
      // The rendered circles: centres at (3,3) and (11,3), each 4 units across.
      const unit = Math.hypot(at(1, 0).x - at(0, 0).x, at(1, 0).y - at(0, 0).y);
      const circle = async (id: string) => {
        const box = (await frame.locator(`svg [data-source-id="${id}"]`).first().boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
      };
      for (const [id, x, y] of [['path:2', 3, 3], ['path:3', 11, 3]] as const) {
        await expect.poll(async () => Math.round((await circle(id)).width / unit * 10) / 10, `${id} is not 4 units across`).toBe(4);
        const centre = await circle(id);
        const expected = at(x, y);
        assert.ok(Math.hypot(centre.x - expected.x, centre.y - expected.y) < 4, `${id} centre at ${JSON.stringify(centre)}, expected (${x},${y}) at ${JSON.stringify(expected)}: ${(await editorDebug(page)).source}`);
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `shears a square from its right edge after a second tap with the pen in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,2) rectangle (6,6);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const square = frame.locator('svg [data-source-id="path:2"]').first();
      await expect(square).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const unit = Math.hypot(xTen.x - origin.x, xTen.y - origin.y) / 10;
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.penStroke([at(2, 4)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:2']);
      // A second tap on the selected square switches its frame to rotate-and-shear handles, as in Inkscape.
      await input.penStroke([at(2, 4.2)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:2']);
      // The switch waits out the double-tap window; the author sees the edge handles appear.
      await expect(frame.locator('[data-handle-kind="shear"]').first()).toBeAttached();
      const edge = at(6, 4);
      const handles = await frame.locator('[data-resize-role="right"]').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }));
      // Grab the handle at the right edge's midpoint if the frame shows one there, else the edge itself.
      const grip = [...handles.map(point => ({ x: point.x + frameBox.x, y: point.y + frameBox.y })), edge]
        .filter(point => Math.hypot(point.x - edge.x, point.y - edge.y) < 24)[0];
      const target = { x: grip.x, y: grip.y - 2 * unit };
      await input.penDown(grip);
      for (let i = 1; i <= 10; i++) await input.penMove({ x: grip.x, y: grip.y + (target.y - grip.y) * i / 10 });
      await input.penUp(target);
      // A shear that lifts the right edge by 2 keeps the width at 4 and makes the outline 6 tall.
      // The outline box includes the stroke, so allow a few tenths of a unit.
      await expect.poll(async () => {
        const box = (await square.boundingBox())!;
        return Math.abs(box.width / unit - 4) < .3 && Math.abs(box.height / unit - 6) < .3;
      }, { message: 'The square is not 4 wide and 6 tall after the shear' }).toBe(true);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `creates, hides, and deletes a ruler guide by finger from one Ruler guides control in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const ruler = (await frame.getByTestId('canvas-top-ruler').boundingBox())!;
      const guides = frame.locator('[class*="guideOverlay"] line');
      const guideAtThree = async () => (await guides.evaluateAll(lines => lines.map(line => line.getBoundingClientRect().y)))
        .some(y => Math.abs(frameBox.y + y - at(3, 3).y) < 4);
      // A finger drags a guide down out of the top ruler to y = 3.
      // The ruler's box is already in page coordinates.
      const from = { x: at(3, 3).x, y: ruler.y + ruler.height / 2 };
      const to = at(3, 3);
      await input.touch(Array.from({ length: 13 }, (_, i) => ({ x: from.x, y: from.y + (to.y - from.y) * i / 12 })));
      await expect.poll(guideAtThree, { message: 'No guide at y = 3 after a finger drag from the ruler' }).toBe(true);
      // One control owns ruler guides: turning it off hides them, turning it on restores them.
      const zoom = frame.getByRole('button', { name: 'Zoom and display', exact: true });
      await input.touch([await stableCenter(zoom)]);
      const control = frame.getByRole('button', { name: 'Ruler guides', exact: true });
      await expect(control).toHaveAttribute('aria-pressed', 'true');
      await input.touch([await stableCenter(control)]);
      await expect.poll(guideAtThree).toBe(false);
      await input.touch([await stableCenter(control)]);
      await expect.poll(guideAtThree).toBe(true);
      await input.touch([await stableCenter(zoom)]);
      // Dragging the guide back onto its ruler deletes it.
      await input.touch(Array.from({ length: 13 }, (_, i) => ({ x: to.x + 40, y: to.y + (from.y - to.y) * i / 12 })));
      await expect.poll(guideAtThree, { message: 'The guide survives being dragged onto its ruler' }).toBe(false);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `reads a drawn line's end in lattice units when the figure scales its lattice in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}[x=2cm,y=2cm]
\draw (0,0) -- (5,0);
\draw (0,0) -- (0,5);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xFive], [, yFive]] = [await ends('path:0'), await ends('path:1')];
      // Screen position of lattice (x, y) in the x=2cm, y=2cm frame, from the two segments of length 5.
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xFive.x - origin.x) * x / 5 + (yFive.x - origin.x) * y / 5,
        y: frameBox.y + origin.y + (xFive.y - origin.y) * x / 5 + (yFive.y - origin.y) * y / 5
      });
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Insert', exact: true }))]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Line', exact: true }))]);
      const [from, to] = [at(1, 1), at(3, 2)];
      await input.penDown(from);
      for (let i = 1; i <= 10; i++) await input.penMove({ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 });
      const tooltip = frame.getByTestId('canvas-drag-tooltip');
      await expect(tooltip).toBeVisible();
      const text = await tooltip.innerText();
      await input.penUp(to);
      // From (1,1) to (3,2) the line spans 2 by 1 lattice units; in centimetres it would read 4 by 2.
      assert.match(text, /Width:\s*2 units/, `The drag readout does not state a width of 2 lattice units: ${text}`);
      assert.match(text, /Height:\s*1 units/, `The drag readout does not state a height of 1 lattice unit: ${text}`);
      assert.doesNotMatch(text, /cm|px/, `The drag readout states physical lengths: ${text}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `rotates a lasso-selected pair a quarter turn about their centre in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,2) circle (1);
\draw (6,2) circle (1);
\path[use as bounding box] (-10,-10) rectangle (15,15);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:3"]').first()).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const ends = async (id: string) => frame.locator(`svg [data-source-id="${id}"]`).first().evaluate((path: SVGGeometryElement) => {
        const m = path.getScreenCTM()!;
        return [0, path.getTotalLength()].map(length => {
          const p = path.getPointAtLength(length);
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
      });
      const [[origin, xTen], [, yTen]] = [await ends('path:0'), await ends('path:1')];
      const at = (x: number, y: number) => ({
        x: frameBox.x + origin.x + (xTen.x - origin.x) * x / 10 + (yTen.x - origin.x) * y / 10,
        y: frameBox.y + origin.y + (xTen.y - origin.y) * x / 10 + (yTen.y - origin.y) * y / 10
      });
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Lasso', exact: true }))]);
      await input.penStroke([at(.5, .5), at(8, .5), at(8, 3.6), at(.5, 3.6), at(.5, .6)]);
      await expect.poll(async () => [...(await editorDebug(page)).selection].sort()).toEqual(['path:2', 'path:3']);
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Select', exact: true }))]);
      await expect.poll(async () => [...(await editorDebug(page)).selection].sort()).toEqual(['path:2', 'path:3']);
      // Turn the frame's rotate handle (or, without one, the point above the pair's centre) a quarter turn counterclockwise.
      const centre = at(4, 2);
      const handles = await frame.getByTestId('canvas-rotate-handle').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }));
      const start = handles.length > 0 ? { x: handles[0].x + frameBox.x, y: handles[0].y + frameBox.y } : at(4, 4.5);
      const radius = Math.hypot(start.x - centre.x, start.y - centre.y);
      const from = Math.atan2(centre.y - start.y, start.x - centre.x);
      const path = Array.from({ length: 12 }, (_, i) => {
        const angle = from + (Math.PI / 2) * i / 11;
        return { x: centre.x + radius * Math.cos(angle), y: centre.y - radius * Math.sin(angle) };
      });
      await input.penDown(path[0]);
      for (const point of path.slice(1)) await input.penMove(point);
      await input.penUp(path[path.length - 1]);
      // About (4,2), (2,2) goes to (4,0) and (6,2) to (4,4).
      const centreOf = async (id: string) => {
        const box = (await frame.locator(`svg [data-source-id="${id}"]`).first().boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 6;
      await expect.poll(async () => near(await centreOf('path:2'), at(4, 0)) && near(await centreOf('path:3'), at(4, 4)),
        { message: 'The pair did not turn a quarter about (4,2)' }).toBe(true);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `states the freehand tool's properties without pixels in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Freehand', exact: true }))]);
      assert.equal((await editorDebug(page)).tool, 'addFreehand');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Properties', exact: true }))]);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByText('Freehand', { exact: false }).first()).toBeVisible();
      const text = await panel.innerText();
      assert.doesNotMatch(text, /\d\s*px\b/, `The freehand properties state pixels: ${text.match(/[^\n]*\d\s*px[^\n]*/)?.[0]}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps the original stroke after an automatic fit in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      // The first stroke turns automatic fitting on for the strokes after it.
      await input.penStroke(waveAcross(viewport, .45, .3, 120));
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Defaults', exact: true }))]);
      await input.touch([await stableCenter(result.getByRole('checkbox', { name: 'Refine new strokes automatically', exact: true }))]);
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Cancel', exact: true }))]);
      await expect(result).toHaveCount(0);
      const drawsBefore = ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
      await input.penStroke(waveAcross(viewport, .45, .65, 120));
      await expect(result).toBeVisible();
      await expect.poll(async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length).toBe(drawsBefore + 1);
      const lastDraw = async () => { const draws = (await editorDebug(page)).source.split('\n').filter(line => line.trim().startsWith('\\draw')); return draws[draws.length - 1]; };
      assert.match(await lastDraw(), /\.\. controls/, 'The automatic fit did not apply');
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Cancel', exact: true }))]);
      await expect(result).toHaveCount(0);
      // Cancel brings back the recorded stroke: a polyline of its samples, not the fit.
      await expect.poll(async () => { const draw = await lastDraw(); return !/\.\. controls/.test(draw) && (draw.match(/--/g) ?? []).length > 5; },
        { message: 'Cancel left the automatic fit in place' }).toBe(true);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps every stroke drawn and erased in quick succession in ${tablet.name}`, async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const draws = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
      // No stroke waits for the canvas to finish redrawing the one before it.
      await input.penStroke(waveAcross(viewport, .45, .2, 120));
      await input.penStroke(waveAcross(viewport, .45, .4, 120));
      await page.keyboard.press('Escape');
      await input.penStroke(waveAcross(viewport, .45, .6, 120));
      await expect.poll(draws, { message: 'A stroke drawn while the canvas redrew was lost' }).toBe(3);
      await input.touch([await stableCenter(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Eraser', exact: true }))]);
      await input.penStroke(Array.from({ length: 12 }, (_, i) => ({ x: viewport.x + viewport.width * .52, y: viewport.y + viewport.height * (.15 + i * .05) })));
      // The sweep crosses each wave once and cuts it in two.
      await expect.poll(draws, { message: 'An eraser sweep right after a stroke did not erase' }).toBe(6);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps automatic fits when drawing continues and the tool changes, and one Undo restores the last original, in ${tablet.name}`, async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      const fittedDraws = async () => (await editorDebug(page)).source.split('\n').filter(line => line.trim().startsWith('\\draw') && /\.\. controls/.test(line)).length;
      await input.penStroke(waveAcross(viewport, .45, .2, 120));
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Defaults', exact: true }))]);
      await input.touch([await stableCenter(result.getByRole('checkbox', { name: 'Refine new strokes automatically', exact: true }))]);
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Cancel', exact: true }))]);
      await expect(result).toHaveCount(0);
      await input.penStroke(waveAcross(viewport, .45, .45, 120));
      await expect.poll(fittedDraws, { message: 'The automatic fit did not apply' }).toBe(1);
      // Drawing the next stroke on empty canvas continues the session: the earlier fit stays.
      const wave = waveAcross({ x: 0, y: 0, width: 0, height: 0 }, 0, 0, 120);
      await input.penStroke(await emptyCanvasGesture(frame, wave));
      await expect.poll(fittedDraws, { message: 'Drawing again reverted the earlier automatic fit' }).toBe(2);
      const fitted = (await editorDebug(page)).source;
      await input.touch([await stableCenter(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Select', exact: true }))]);
      await expect.poll(async () => (await editorDebug(page)).tool).toBe('select');
      await expect(result).toHaveCount(0);
      assert.equal((await editorDebug(page)).source, fitted, 'Changing the tool changed the fitted source');
      // The fit is its own history step after the recorded stroke.
      await page.keyboard.press('Control+z');
      await expect.poll(fittedDraws, { message: 'One Undo did not restore the last original' }).toBe(1);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `draws from an existing point with the pen, and moves it under a held finger or a held pen, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      // Neither end is on the lattice, so a stroke that lands on one took the point, not the lattice.
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (0.37,0.61) -- (4.23,2.29);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => { await input.touch([await stableCenter(locator)]); };
      const rail = frame.locator('[data-diagram-tools]');
      const line = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(line).toBeVisible();
      await fitDiagram(frame, input);
      const source = async () => (await editorDebug(page)).source;
      const draws = async () => (await source()).match(/\\draw[^;]*;/g) ?? [];
      const original = String.raw`\draw (0.37,0.61) -- (4.23,2.29);`;
      // The delay that turns a held pen into a move is a setting.
      await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
      const settings = frame.getByTestId('settings-modal');
      await tap(settings.getByTestId('settings-category-canvas'));
      await expect(settings.getByRole('slider', { name: /^Hold to move a point/ })).toHaveValue('450');
      await tap(settings.getByRole('button', { name: 'Close settings' }));
      await tap(rail.getByRole('button', { name: 'Freehand', exact: true }));
      const start = await strokePoint(page, line, 0);
      // Hovering the pen over a point marks it as the stroke's attachment, before any contact.
      await input.penHover(start);
      await expect(frame.locator('[data-point-target="attach"]')).toBeVisible();
      // A stroke that starts on a point draws at once, from exactly that point.
      await input.penStroke(Array.from({ length: 12 }, (_, i) => ({ x: start.x + i * 6, y: start.y + i * 4 + Math.sin(i) * 3 })));
      await expect.poll(async () => (await draws()).length, { message: 'The stroke from the point did not draw' }).toBe(2);
      assert.match((await draws())[1], /^\s*\\draw(?:\[[^\]]*\])?\s*\(0\.37,\s*0\.61\)/, 'The stroke did not start at the point');
      assert.equal((await draws())[0].trim(), original, 'Drawing from the point moved it');
      await page.keyboard.press('Escape');
      const drawn = await source();
      // With a finger of the other hand held down, a pen drag on a point moves the point.
      const clear = (await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0];
      // Closing the result and selecting the moved point can pan the view, so each step measures the point again.
      const endPoint = () => strokePoint(page, line, 1);
      const end = await endPoint();
      await input.fingerDown(clear);
      await input.penDown(end);
      for (let step = 1; step <= 8; step++) await input.penMove({ x: end.x - step * 5, y: end.y + step * 5 });
      await input.penUp({ x: end.x - 40, y: end.y + 40 });
      await input.fingerUp();
      await expect.poll(async () => (await draws()).length, { message: 'The modified pen drag drew a stroke' }).toBe(2);
      await expect.poll(async () => (await draws())[0], { message: 'The held finger did not make the pen move the point' }).not.toContain('(4.23,2.29)');
      assert.match((await draws())[0], /\(0\.37,0\.61\)/, 'Moving the end moved the start');
      // The move is one undo step.
      await tap(rail.getByRole('button', { name: 'Undo', exact: true }));
      await expect.poll(source).toBe(drawn);
      // A pen held still on a point past the delay moves it, and the mark says so before the pen moves.
      const heldEnd = await endPoint();
      await input.penDown(heldEnd);
      await expect(frame.locator('[data-point-target="move"]')).toBeVisible({ timeout: 2000 });
      for (let step = 1; step <= 8; step++) await input.penMove({ x: heldEnd.x + step * 5, y: heldEnd.y - step * 4 });
      await input.penUp({ x: heldEnd.x + 40, y: heldEnd.y - 32 });
      await expect.poll(async () => (await draws())[0], { message: 'The held pen did not move the point' }).not.toContain('(4.23,2.29)');
      assert.equal((await draws()).length, 2, 'The held pen drew a stroke');
      await tap(rail.getByRole('button', { name: 'Undo', exact: true }));
      await expect.poll(source).toBe(drawn);
      // A double tap on a point never moves it.
      await input.doubleTap(await endPoint());
      assert.equal((await draws())[0].trim(), original, 'A double tap moved the point');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `refines one stroke from one surface, with new-stroke scope behind Defaults, in ${tablet.name}`, async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      const simplification = result.getByRole('slider', { name: 'Simplification', exact: true });
      const exact = result.getByRole('spinbutton', { name: 'Simplification value', exact: true });
      const defaults = result.getByRole('button', { name: 'Defaults', exact: true });
      const saved = async () => (await editorDebug(page)).settings.canvas;
      const lastDraw = async () => { const draws = (await editorDebug(page)).source.split('\n').filter(line => line.trim().startsWith('\\draw')); return draws[draws.length - 1]; };
      const fitted = async () => /\.\. controls/.test(await lastDraw());
      const initial = await saved();
      // The adjustment is primary: sliders with exact values, Accept and Cancel. Scope sits behind Defaults.
      await input.penStroke(waveAcross(viewport, .45, .2, 140));
      await expect(result.getByRole('slider', { name: 'Smoothing', exact: true })).toBeVisible();
      await expect(result.getByRole('spinbutton', { name: 'Smoothing value', exact: true })).toBeVisible();
      await expect(defaults).toHaveAttribute('aria-expanded', 'false');
      await expect(result.getByRole('button', { name: 'Use for new strokes', exact: true })).toHaveCount(0);
      // A fresh stroke has nothing to restore beyond what Cancel restores.
      await expect(result.getByRole('button', { name: 'Restore original', exact: true })).toHaveCount(0);
      await exact.fill('1.2');
      await exact.press('Enter');
      await expect(simplification).toHaveValue('1.2');
      assert.deepEqual(await saved(), initial, 'Adjusting one stroke changed a saved default');
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Cancel', exact: true }))]);
      await expect(result).toHaveCount(0);
      assert.equal(await fitted(), false, 'Cancel kept the previewed fit');
      // Use for new strokes holds for this session; it saves nothing.
      await input.penStroke(waveAcross(viewport, .45, .35, 140));
      await expect(simplification).toHaveValue(String(initial.freehandSimplificationUnits));
      await exact.fill('1.2');
      await exact.press('Enter');
      await input.touch([await stableCenter(defaults)]);
      await expect(defaults).toHaveAttribute('aria-expanded', 'true');
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Use for new strokes', exact: true }))]);
      await input.touch([await stableCenter(result.getByRole('checkbox', { name: 'Refine new strokes automatically', exact: true }))]);
      assert.deepEqual(await saved(), initial, 'Use for new strokes saved a default');
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Accept', exact: true }))]);
      await expect(result).toHaveCount(0);
      await expect.poll(fitted, { message: 'Accept did not apply the fit' }).toBe(true);
      // The next stroke takes the session values and is refined automatically; Cancel reverts that fit.
      await input.penStroke(waveAcross(viewport, .45, .5, 140));
      await expect(simplification).toHaveValue('1.2');
      await expect.poll(fitted, { message: 'The session did not refine the new stroke automatically' }).toBe(true);
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Cancel', exact: true }))]);
      await expect(result).toHaveCount(0);
      await expect.poll(fitted, { message: 'Cancel kept the automatic fit' }).toBe(false);
      // Escape closes and keeps what is on the canvas: the automatic fit stays.
      await input.penStroke(waveAcross(viewport, .45, .65, 140));
      await expect.poll(fitted).toBe(true);
      await page.keyboard.press('Escape');
      await expect(result).toHaveCount(0);
      assert.equal(await fitted(), true, 'Escape reverted the automatic fit');
      // Save as default makes the session values lasting.
      await input.penStroke(waveAcross(viewport, .45, .8, 140));
      await input.touch([await stableCenter(defaults)]);
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Save as default', exact: true }))]);
      await expect.poll(async () => { const canvas = await saved(); return [canvas.freehandSimplificationUnits, canvas.freehandAutoApply]; },
        { message: 'Save as default did not save the session values' }).toEqual([1.2, true]);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `shows what is stored, without editor sync state, after a stroke in ${tablet.name}`, async function () {
      const status = page.locator('.tikz-standalone-status');
      await expect(status).toBeInViewport({ ratio: 1 });
      await expect(status).toHaveText('New tikzpicture · not saved');
      const input = await TabletInput.attach(page);
      const viewport = (await editorFrame(page).locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.penStroke(waveAcross(viewport, .45, .4, 120));
      await expect(status).toHaveText('Unsaved changes');
      await expect(status).toBeInViewport({ ratio: 1 });
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `places the freehand result clear of the stroke wherever it is drawn, and Escape keeps the stroke, in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const railBox = (await frame.locator('[data-diagram-tools]').boundingBox())!;
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      const clear = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
        Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) || Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y);
      // The corners of the canvas the docked rail leaves free, in fractions of the viewport.
      const sideRail = railBox.height > railBox.width;
      const left = sideRail ? (railBox.x + railBox.width - viewport.x) / viewport.width + .03 : .12;
      const bottom = sideRail ? .82 : Math.min(.82, (railBox.y - viewport.y) / viewport.height - .12);
      const corners = [[left, .12], [.72, .12], [left, bottom], [.72, bottom]] as const;
      for (const [index, [fx, fy]] of corners.entries()) {
        const before = (await editorDebug(page)).source;
        await input.penStroke(waveAcross(viewport, fx, fy, 110));
        await expect(result, `No freehand result for a stroke at (${fx.toFixed(2)}, ${fy.toFixed(2)})`).toBeVisible();
        // Each kept stroke stays drawn, so this one is the element numbered by its index once it renders.
        const idsNow = () => frame.locator('svg [data-source-id]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-source-id')!))]);
        await expect.poll(async () => (await idsNow()).length).toBe(index + 1);
        const ids = await idsNow();
        const stroke = (await frame.locator(`svg [data-source-id="${ids[ids.length - 1]}"]`).first().boundingBox())!;
        const popup = (await result.boundingBox())!;
        assert.ok(clear(popup, stroke), `The freehand result covers a stroke drawn at (${fx.toFixed(2)}, ${fy.toFixed(2)})`);
        assert.ok(clear(popup, (await frame.locator('[data-diagram-tools]').boundingBox())!), 'The freehand result covers the rail');
        await page.keyboard.press('Escape');
        await expect(result).toHaveCount(0);
        // Escape closes the result without fitting: the recorded stroke stays as drawn.
        const source = (await editorDebug(page)).source;
        assert.notEqual(source, before, 'Escape removed the stroke');
        const draws = source.split('\n').filter(line => line.trim().startsWith('\\draw'));
        assert.doesNotMatch(draws[draws.length - 1], /\.\. controls/, 'Escape applied the fit');
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps the freehand result clear of its stroke, the rail, and Properties in every dock in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const rail = frame.locator('[data-diagram-tools]');
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      type Box = { x: number; y: number; width: number; height: number };
      const clear = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) || Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y);
      // The canvas left after cutting each occupant away from the viewport edge it is nearest.
      const freeArea = (occupants: Box[]): Box => {
        let [left, top, right, bottom] = [viewport.x, viewport.y, viewport.x + viewport.width, viewport.y + viewport.height];
        for (const box of occupants) {
          const gaps = [box.x - left, right - box.x - box.width, box.y - top, bottom - box.y - box.height];
          const nearest = gaps.indexOf(Math.min(...gaps));
          if (nearest === 0) left = box.x + box.width;
          if (nearest === 1) right = box.x;
          if (nearest === 2) top = box.y + box.height;
          if (nearest === 3) bottom = box.y;
        }
        return { x: left, y: top, width: right - left, height: bottom - top };
      };
      const dockTargets = {
        bottom: { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height - 10 },
        right: { x: viewport.x + viewport.width - 10, y: viewport.y + viewport.height / 2 },
        top: { x: viewport.x + viewport.width / 2, y: viewport.y + 10 },
        left: { x: viewport.x + 10, y: viewport.y + viewport.height / 2 }
      };
      for (const [dock, target] of Object.entries(dockTargets)) {
        const from = await stableCenter(rail.getByRole('button', { name: 'Move toolbar', exact: true }));
        await input.touch(Array.from({ length: 13 }, (_, i) => ({ x: from.x + (target.x - from.x) * i / 12, y: from.y + (target.y - from.y) * i / 12 })));
        await expect(rail).toHaveAttribute('data-dock', dock);
        for (const withPanel of [false, true]) {
          if (withPanel) {
            await input.touch([await stableCenter(rail.getByRole('button', { name: 'Properties', exact: true }))]);
            await expect(panel).toBeVisible();
          }
          const occupants = [(await rail.boundingBox())!, ...(withPanel ? [(await panel.boundingBox())!] : [])];
          const free = freeArea(occupants);
          for (const [fx, fy] of [[.06, .08], [.5, .7]] as const) {
            const label = `${dock} dock${withPanel ? ' with Properties' : ''}, stroke at (${fx}, ${fy})`;
            const ids = () => frame.locator('svg [data-source-id]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-source-id')!))]);
            const before = (await ids()).length;
            const points = waveAcross(free, fx, fy, Math.min(110, free.width * .4));
            await input.penStroke(points);
            await expect(result, `${label}: no freehand result`).toBeVisible();
            await expect.poll(async () => (await ids()).length, `${label}: the stroke did not render`).toBe(before + 1);
            // Where the pen went, in page coordinates like every box here.
            const xs = points.map(point => point.x), ys = points.map(point => point.y);
            const stroke = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
            const popup = (await result.boundingBox())!;
            assert.ok(clear(popup, stroke), `${label}: the freehand result covers its stroke`);
            assert.ok(clear(popup, (await rail.boundingBox())!), `${label}: the freehand result covers the rail`);
            if (withPanel) assert.ok(clear(popup, (await panel.boundingBox())!), `${label}: the freehand result covers Properties`);
            await page.keyboard.press('Escape');
            await expect(result).toHaveCount(0);
          }
          if (withPanel) {
            await input.touch([await stableCenter(panel.getByRole('button', { name: 'Close properties', exact: true }))]);
            await expect(panel).toHaveCount(0);
          }
        }
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `shows every recorded sample and every fitted anchor the freehand result counts in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      await input.penStroke(waveAcross(viewport, .45, .4, 160));
      await expect(result).toBeVisible();
      const counts = async () => {
        const text = await result.innerText();
        return {
          samples: Number(/(\d+) raw samples/.exec(text)![1]),
          anchors: Number(/(\d+) fitted anchors/.exec(text)![1]),
          drawnSamples: await frame.getByTestId('freehand-raw-samples').locator('circle').count(),
          drawnAnchors: await frame.getByTestId('freehand-fitted-anchors').locator('circle').count()
        };
      };
      // What the author reads in the result is what the canvas shows, once the fit has rendered.
      await expect.poll(async () => { const c = await counts(); return c.drawnSamples === c.samples && c.drawnAnchors === c.anchors && c.anchors > 1; },
        { message: 'The canvas does not show the samples and anchors the result counts' }).toBe(true);
      await storyScreenshot(page, `freehand-samples-${tablet.name}`);
      // Moving the simplification slider refits; the counts and the canvas still agree.
      const slider = result.getByRole('slider').nth(1);
      await slider.fill('1.2');
      await expect.poll(async () => { const c = await counts(); return c.drawnSamples === c.samples && c.drawnAnchors === c.anchors; },
        { message: 'After refitting, the canvas and the counts disagree' }).toBe(true);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `smooths only the neighbours of a deleted curve point in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (0,0) .. controls (1,2) and (2,2) .. (3,0) .. controls (4,-2) and (5,-2) .. (6,0) .. controls (7,2) and (8,2) .. (9,0) .. controls (10,-2) and (11,-2) .. (12,0);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const curve = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(curve).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.penStroke([await strokePoint(page, curve, .1)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const anchors = await frame.locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }).sort((a, b) => a.x - b.x));
      assert.equal(anchors.length, 5, `anchors: ${anchors.length}`);
      await input.penStroke([{ x: frameBox.x + anchors[2].x, y: frameBox.y + anchors[2].y }]);
      await expect(frame.getByRole('button', { name: '1 point selected', exact: true })).toBeVisible();
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Delete points', exact: true }))]);
      await expect.poll(async () => (await editorDebug(page)).source).not.toMatch(/\(6,0\)/);
      const source = (await editorDebug(page)).source;
      // The segments that did not touch the deleted point keep their outer control points.
      assert.match(source, /\(0,0\) \.\. controls \(1,2\)/, `The first segment's outer control moved: ${source}`);
      assert.match(source, /and \(11,-2\) \.\. \(12,0\)/, `The last segment's outer control moved: ${source}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `selects a fitted stroke itself, not the envelope that keeps its original, in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      await input.penStroke(waveAcross(viewport, .45, .4, 160));
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Accept', exact: true }))]);
      await expect(result).toHaveCount(0);
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Select', exact: true }))]);
      // Start from an empty selection, then tap the fitted path.
      await input.touch([{ x: viewport.x + viewport.width - 12, y: viewport.y + viewport.height - 12 }]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
      const ids = await frame.locator('svg [data-source-id^="path:"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-source-id')!))]);
      const fitted = ids[ids.length - 1];
      await input.touch([await strokePoint(page, frame.locator(`svg [data-source-id="${fitted}"]`).first(), .5)]);
      await expect.poll(async () => (await editorDebug(page)).selection, { message: 'Tapping the fitted stroke selected its recovery envelope' }).toEqual([fitted]);
      await expect(frame.getByRole('button', { name: 'Lock curve', exact: true })).toBeVisible();
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `refines a selected curve with Simplify, Simplify again, Cancel, Accept, and Restore original in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      // A long wavy stroke, so a fit has many anchors to shed.
      const wave = Array.from({ length: 60 }, (_, i) => ({ x: viewport.x + viewport.width * .35 + i * 6, y: viewport.y + viewport.height * .45 + Math.sin(i / 4) * 30 }));
      await input.penStroke(wave);
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Accept', exact: true }))]);
      await expect(result).toHaveCount(0);
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Select', exact: true }))]);
      // The fit is the path inside the stroke's envelope scope.
      const ids = await frame.locator('svg [data-source-id^="path:"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-source-id')!))]);
      const curve = frame.locator(`svg [data-source-id="${ids[ids.length - 1]}"]`).first();
      await input.touch([await strokePoint(page, curve, .3)]);
      await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
      // A tap that lands on an anchor selects that point; the curve's own actions are one tap away.
      const whole = frame.getByRole('button', { name: 'Select entire curve', exact: true });
      if (await whole.isVisible()) await input.touch([await stableCenter(whole)]);
      const anchors = async () => ((await editorDebug(page)).source.match(/\.\. controls/g) ?? []).length + 1;
      const accepted = (await editorDebug(page)).source;
      const counts = [await anchors()];
      const refinement = frame.getByRole('dialog', { name: 'Curve refinement' });
      const openRefinement = async () => {
        const simplify = frame.getByRole('button', { name: 'Simplify curve', exact: true });
        // The disclosure says whether the curve's actions are open; the controls can be between renders.
        const actions = frame.getByRole('button', { name: 'Curve actions', exact: true });
        if (await actions.getAttribute('aria-expanded') === 'false') await input.touch([await stableCenter(actions)]);
        await input.touch([await stableCenter(simplify)]);
        await expect(refinement).toBeVisible();
      };
      // Simplify opens the same refinement on the curve, with its first pass previewed.
      await openRefinement();
      await expect(refinement.getByRole('slider', { name: 'Simplification', exact: true })).toBeVisible();
      await expect.poll(anchors, { timeout: 30_000, message: 'Simplify previewed no simpler curve' }).toBeLessThan(counts[0]);
      counts.push(await anchors());
      // Simplify again runs another pass on the preview, until the curve is final.
      const final = refinement.getByText(/already as simple/i);
      for (let step = 0; step < 8 && !(await final.isVisible()); step++) {
        await input.touch([await stableCenter(refinement.getByRole('button', { name: 'Simplify again', exact: true }))]);
        await expect.poll(async () => (await anchors()) !== counts[counts.length - 1] || await final.isVisible(),
          { timeout: 30_000, message: `Simplify again step ${step + 1} neither changed the curve nor said it was final (anchors ${counts.join(' → ')})` }).toBe(true);
        if (!(await final.isVisible())) counts.push(await anchors());
      }
      await expect(final, `No final message after anchors ${counts.join(' → ')}`).toBeVisible();
      assert.ok(counts.length >= 3, `Simplify could not be repeated: anchors ${counts.join(' → ')}`);
      assert.ok(counts.every((count, index) => index === 0 || count < counts[index - 1]), `anchors ${counts.join(' → ')}`);
      assert.ok(counts[counts.length - 1] >= 2, `Simplification collapsed the curve: ${counts.join(' → ')}`);
      // Cancel returns the curve to the state before Simplify.
      await input.touch([await stableCenter(refinement.getByRole('button', { name: 'Cancel', exact: true }))]);
      await expect(refinement).toHaveCount(0);
      await expect.poll(async () => (await editorDebug(page)).source, { message: 'Cancel left the simplified preview' }).toBe(accepted);
      // Accept commits the preview as one step that one Undo reverses.
      await openRefinement();
      await expect.poll(anchors, { timeout: 30_000 }).toBeLessThan(counts[0]);
      const previewed = await anchors();
      await input.touch([await stableCenter(refinement.getByRole('button', { name: 'Accept', exact: true }))]);
      await expect(refinement).toHaveCount(0);
      assert.equal(await anchors(), previewed, 'Accept did not commit the previewed curve');
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await editorDebug(page)).source, { message: 'One Undo did not reverse the accepted simplification' }).toBe(accepted);
      // The stroke kept its recorded original, so the refinement offers it.
      await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
      await openRefinement();
      await input.touch([await stableCenter(refinement.getByRole('button', { name: 'Restore original', exact: true }))]);
      await expect(refinement).toHaveCount(0);
      await expect.poll(async () => { const source = (await editorDebug(page)).source; return !/\.\. controls/.test(source) && (source.match(/--/g) ?? []).length > 5; },
        { message: 'Restore original did not bring back the recorded stroke' }).toBe(true);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `writes a colour picked at full opacity as an xcolor value in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = frame.locator('[data-diagram-tools]');
      await input.touch([await stableCenter(rail.getByRole('button', { name: /^Drawing color/ }))]);
      const popup = frame.getByRole('dialog', { name: 'Tool options' });
      await expect(popup).toBeVisible();
      // The platform colour control delivers its value as an input event, as a tablet's colour sheet does.
      await popup.getByLabel('Choose color').fill('#ff0000');
      await input.touch([await stableCenter(rail.getByRole('button', { name: /^Drawing color/ }))]);
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Insert', exact: true }))]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Line', exact: true }))]);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const from = { x: viewport.x + viewport.width * .5, y: viewport.y + viewport.height * .5 };
      await input.penStroke([from, { x: from.x + 60, y: from.y }, { x: from.x + 120, y: from.y }]);
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw\[/);
      const draw = (await editorDebug(page)).source.split('\n').find(line => line.includes('\\draw['))!;
      assert.doesNotMatch(draw, /#[0-9a-f]{6}/i, `A picked colour is written as HTML hex, which xcolor rejects: ${draw}`);
      assert.match(draw, /rgb,255:red,255;green,0;blue,0/, draw);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `picks a drawing colour from saved swatches, one spectrum, and opacity only in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = frame.locator('[data-diagram-tools]');
      const saved = await rail.getByRole('button', { name: /^Use / }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!.slice(4)));
      await input.touch([await stableCenter(rail.getByRole('button', { name: /^Drawing color/ }))]);
      const popup = frame.getByRole('dialog', { name: 'Tool options' });
      await expect(popup).toBeVisible();
      // The swatches are the saved colours, nothing hard-coded beside them, laid out in rows.
      const swatches = popup.getByRole('button', { name: /^Choose / });
      const names = await swatches.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!.slice(7)));
      assert.deepEqual(names, saved, `The popup offers colours that are not saved: ${names.filter(name => !saved.includes(name))}`);
      const [first, second] = [(await swatches.nth(0).boundingBox())!, (await swatches.nth(1).boundingBox())!];
      assert.ok(Math.abs(first.y - second.y) < 2 && second.x > first.x, 'The swatches are stacked instead of laid out in a row');
      // One spectrum control and one opacity slider; no channel or hex fields, no collection management.
      await expect(popup.getByLabel('Choose color')).toHaveCount(1);
      await expect(popup.getByRole('slider', { name: 'Opacity' })).toBeVisible();
      for (const gone of ['Hex color', 'R', 'G', 'B']) await expect(popup.getByLabel(gone, { exact: true })).toHaveCount(0);
      for (const gone of ['Create collection', 'Save collection', 'Delete collection']) await expect(popup.getByRole('button', { name: gone })).toHaveCount(0);
      await expect(popup.getByRole('combobox')).toHaveCount(0);
      await storyScreenshot(page, `color-popup-${tablet.name}`);
      // Picking a swatch by finger sets the drawing colour.
      await input.touch([await stableCenter(swatches.nth(2))]);
      await expect(rail.getByRole('button', { name: `Drawing color: ${saved[2]}` })).toBeVisible();
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `creates, renames, switches and deletes colour collections in Settings in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => { await input.touch([await stableCenter(locator)]); };
      const rail = frame.locator('[data-diagram-tools]');
      const railColors = () => rail.getByRole('button', { name: /^Use / }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!.slice(4)));
      const openColors = async () => {
        await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
        const dialog = frame.getByTestId('settings-modal');
        await tap(dialog.getByTestId('settings-category-colors'));
        return dialog;
      };
      const original = await railColors();
      let dialog = await openColors();
      const collection = dialog.getByLabel('Collection', { exact: true });
      const names = () => collection.locator('option').allInnerTexts();
      assert.deepEqual(await names(), ['Default']);
      // A new collection starts from the current colours and becomes the rail's palette.
      await tap(dialog.getByRole('button', { name: 'New collection' }));
      await dialog.getByLabel('Collection name').fill('Roots');
      assert.deepEqual(await names(), ['Default', 'Roots']);
      assert.equal(await collection.locator('option:checked').innerText(), 'Roots');
      await tap(dialog.getByRole('button', { name: 'Remove' }).first());
      await expect.poll(railColors).toEqual(original.slice(1));
      // Switching collections switches the rail's palette.
      await collection.selectOption({ label: 'Default' });
      await expect.poll(railColors).toEqual(original);
      await collection.selectOption({ label: 'Roots' });
      await expect.poll(railColors).toEqual(original.slice(1));
      // Collections and the active choice survive a reload.
      await page.reload();
      await editorReady(page);
      await expect.poll(railColors).toEqual(original.slice(1));
      dialog = await openColors();
      assert.deepEqual(await names(), ['Default', 'Roots']);
      // Deleting asks first, then returns the rail to the remaining collection.
      await tap(dialog.getByRole('button', { name: 'Delete collection' }));
      assert.deepEqual(await names(), ['Default', 'Roots'], 'Deleted without confirmation');
      await tap(dialog.getByRole('button', { name: 'Delete Roots' }));
      await expect.poll(names).toEqual(['Default']);
      await expect.poll(railColors).toEqual(original);
      await expect(dialog.getByRole('button', { name: 'Delete collection' })).toBeDisabled();
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `scrolls 24 saved colours in their own strip, marks the active one, and keeps the tools in view in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => { await input.touch([await stableCenter(locator)]); };
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
      const dialog = frame.getByTestId('settings-modal');
      await tap(dialog.getByTestId('settings-category-colors'));
      await tap(dialog.getByRole('button', { name: 'New collection' }));
      while (await rail.getByRole('button', { name: /^Use / }).count() < 24) await tap(dialog.getByRole('button', { name: 'Add color' }));
      await tap(dialog.getByRole('button', { name: 'Close settings' }));
      await expect(dialog).toHaveCount(0);
      const swatches = rail.getByRole('button', { name: /^Use / });
      // The saved colours scroll inside their own strip; the rail does not grow past the tools.
      const strip = rail.getByLabel('Color palette');
      const overflow = await strip.evaluate(element => Math.max(element.scrollHeight - element.clientHeight, element.scrollWidth - element.clientWidth));
      assert.ok(overflow > 0, `The palette strip does not scroll (overflow ${overflow}px); the rail grows instead`);
      for (const name of ['Select', 'Lasso', 'Eraser', 'Freehand', 'Insert', 'Undo', 'Redo'])
        await expect(rail.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      // The active colour is marked, and only it.
      await tap(rail.getByRole('button', { name: 'Use red', exact: true }));
      await expect(rail.getByRole('button', { name: 'Drawing color: red' })).toBeVisible();
      assert.deepEqual(await swatches.evaluateAll(buttons => buttons.flatMap((button, index) => button.getAttribute('aria-pressed') === 'true' ? [index] : [])), [2]);
      // The last saved colour is reached by scrolling the strip, and picking it moves the mark.
      await tap(swatches.last());
      await expect(rail.getByRole('button', { name: 'Drawing color: black' })).toBeVisible();
      assert.deepEqual(await swatches.evaluateAll(buttons => buttons.flatMap((button, index) => button.getAttribute('aria-pressed') === 'true' ? [index] : [])), [0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
      for (const name of ['Select', 'Lasso', 'Eraser', 'Freehand', 'Insert'])
        await expect(rail.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      await storyScreenshot(page, `palette-strip-${tablet.name}`);
      // Leave the default collection active for the stories after this one.
      await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
      await tap(dialog.getByRole('button', { name: 'Delete collection' }));
      await tap(dialog.getByRole('button', { name: /^Delete Collection / }));
      await expect(dialog.getByLabel('Collection', { exact: true }).locator('option')).toHaveCount(1);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `repeats an element from its long press in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (2,1) -- (8,3);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const line = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(line).toBeVisible();
      const input = await TabletInput.attach(page);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await fitDiagram(frame, input);
      await input.longPress(await strokePoint(page, line, .5));
      await input.touch([await stableCenter(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Repeat...', exact: true }))]);
      const repeat = frame.getByTestId('repeat-modal');
      await expect(repeat).toBeVisible();
      await frame.getByTestId('repeat-columns-input').fill('3');
      await input.touch([await stableCenter(frame.getByTestId('repeat-confirm-button'))]);
      await expect.poll(async () => ((await editorDebug(page)).source.match(/\\draw|\\foreach/g) ?? []).length).toBeGreaterThan(1);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `states geometry in lattice units, never cm or px, in the inspector and Repeat in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,1) -- (8,3);
\draw[step=1] (-6,-6) grid (-2,-2);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const [line, grid] = [frame.locator('svg [data-source-id="path:0"]').first(), frame.locator('svg [data-source-id="path:1"]').first()];
      await expect(line).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const rail = frame.locator('[data-diagram-tools]');
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      const physical = /\d\s*(cm|px)\b|\((cm|px)\)/;
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Select', exact: true }))]);
      await input.touch([await strokePoint(page, line, .5)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
      await input.touch([await stableCenter(rail.getByRole('button', { name: 'Properties', exact: true }))]);
      await expect(panel).toBeVisible();
      await expect(panel.getByText('X shift', { exact: true })).toBeVisible();
      const lineText = await panel.innerText();
      assert.doesNotMatch(lineText, physical, `Line inspector: ${lineText.match(physical)?.[0]}`);
      assert.match(lineText, /X shift[\s\S]{0,40}units/, 'X shift is not stated in lattice units');
      // Two lattice units of shift is two centimetres in the default frame.
      const xshift = panel.locator('[class*="compactNumberField"]', { hasText: 'X shift' }).locator('input');
      await xshift.fill('2');
      await xshift.press('Enter');
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/xshift=2cm/);
      await input.touch([await strokePoint(page, grid, .5)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:1']);
      await expect(panel.getByText('Step', { exact: false }).first()).toBeVisible();
      const gridText = await panel.innerText();
      assert.doesNotMatch(gridText, physical, `Grid inspector: ${gridText.match(physical)?.[0]}`);
      // In portrait the panel lies over the line; close it before reaching for the line.
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Close properties', exact: true }))]);
      await expect(panel).toHaveCount(0);
      await fitDiagram(frame, input);
      await input.longPress(await strokePoint(page, line, .5));
      await input.touch([await stableCenter(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Repeat...', exact: true }))]);
      const repeat = frame.getByTestId('repeat-modal');
      await expect(repeat).toBeVisible();
      const repeatText = await repeat.innerText();
      assert.doesNotMatch(repeatText, physical, `Repeat: ${repeatText.match(physical)?.[0]}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `shows every drawing-rail control without scrolling in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const rail = frame.locator('[data-diagram-tools]');
      await expect(rail).toBeVisible();
      const strip = rail.locator('[class*="embeddedTools"]');
      for (const theme of ['light', 'dark'] as const) {
        if (theme === 'dark') {
          await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
          await expect(frame.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
        }
        const overflow = await strip.evaluate(element => ({
          vertical: element.scrollHeight - element.clientHeight, horizontal: element.scrollWidth - element.clientWidth }));
        assert.deepEqual(overflow, { vertical: 0, horizontal: 0 });
        for (const name of ['Layers', 'Properties', 'Settings', 'Zoom and display', 'Lock to lattice', 'Select', 'Lasso', 'Eraser', 'Freehand', 'Insert', 'Bucket', 'Undo', 'Redo'])
          await expect(rail.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
        await expect(rail.getByRole('button', { name: /^Drawing color: / })).toBeInViewport({ ratio: 1 });
        const swatches = rail.getByRole('button', { name: /^Use / });
        assert.ok(await swatches.count() > 0);
        for (const swatch of await swatches.all()) await expect(swatch).toBeInViewport({ ratio: 1 });
        await storyScreenshot(page, `rail-${tablet.name}-${theme}`);
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `names no key in the context menu a long press opens in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw[blue] (0,0) circle (2cm);\end{tikzpicture}`);
      const frame = editorFrame(page);
      const circle = frame.locator('circle[data-source-id]');
      await expect(circle).toBeInViewport();
      const input = await TabletInput.attach(page);
      const tapCenter = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      await input.touch([await tapCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await fitDiagram(frame, input);
      await input.longPress(await strokePoint(page, frame.locator('circle[data-source-id]').first(), .5));
      const menu = frame.getByRole('menu').first();
      await expect(menu).toBeVisible();
      const items = (await menu.locator('button').allInnerTexts()).map(text => text.trim().replace(/\s+/g, ' '));
      assert.ok(items.includes('Delete'), items.join(' | '));
      for (const item of items) {
        assert.doesNotMatch(item, /Ctrl|Cmd|⌘|⇧|Shift|Alt|⌥|Esc\b|Escape|⌫/, item);
        assert.doesNotMatch(item, /^(.+) \1$/, `${item} repeats its key name`);
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `offers only settings that act in the embedded editor in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: ReturnType<typeof frame.getByRole>) => {
        await input.touch([await stableCenter(locator)]);
      };
      await tap(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Settings', exact: true }));
      const dialog = frame.getByTestId('settings-modal');
      await expect(dialog).toBeVisible();
      assert.deepEqual(await dialog.locator('nav button').allInnerTexts(), ['Canvas', 'Colors', 'Keyboard shortcuts']);
      const labels = (await dialog.locator('label[for^="setting-"]').evaluateAll(nodes =>
        nodes.map(node => node.childNodes[0].textContent!.trim())));
      assert.deepEqual(labels, ['Grid Size', 'Grid Opacity', 'Edit Handle Size', 'Zoom Speed', 'Toolbar Position', 'Generated Source Indent']);
      await dialog.getByLabel('Toolbar Position').selectOption('right');
      await expect(frame.locator('[data-diagram-tools]')).toHaveAttribute('data-dock', 'right');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `selects every element from the empty-canvas long press in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (0,0) circle (1cm);\draw (3,0) -- (5,1);\end{tikzpicture}`);
      const frame = editorFrame(page);
      await expect(frame.locator('[data-source-id]')).toHaveCount(2);
      const input = await TabletInput.attach(page);
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      await input.touch([await center(frame.getByRole('button', { name: 'Select', exact: true }))]);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.longPress({ x: viewport.x + viewport.width * .85, y: viewport.y + viewport.height * .2 });
      const menu = frame.getByRole('menu').first();
      await expect(menu.getByRole('menuitem', { name: 'Paste', exact: true })).toBeVisible();
      await input.touch([await center(menu.getByRole('menuitem', { name: 'Select All', exact: true }))]);
      const debug = await editorDebug(page);
      assert.deepEqual([...debug.selection].sort(), [...new Set(debug.scene!.elements.map(element => element.sourceRef.sourceId))].sort());
      assert.equal(debug.selection.length, 2);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `sets, persists, clears and resets command shortcuts in Settings in ${tablet.name}`, async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = frame.locator('[data-diagram-tools]');
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const settings = frame.getByTestId('settings-modal');
      const openShortcuts = async () => {
        await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
        await tap(settings.getByRole('button', { name: 'Keyboard shortcuts', exact: true }));
        await settings.getByRole('searchbox', { name: 'Find command', exact: true }).fill('Line');
      };
      // The shipped default acts before we replace it.
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await page.keyboard.press('l');
      await expect.poll(async () => (await editorDebug(page)).tool).toBe('addLine');
      await openShortcuts();
      const row = settings.getByRole('group', { name: 'Line shortcut', exact: true });
      await tap(row.getByRole('button', { name: 'Set shortcut for Line', exact: true }));
      await page.keyboard.press('Control+Alt+l');
      await expect(row).toContainText('Ctrl+Alt+L');
      await storyScreenshot(page, `keyboard-shortcuts-${tablet.name}`);
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await page.keyboard.press('l');
      assert.equal((await editorDebug(page)).tool, 'select', 'The replaced shortcut still ran');
      await page.keyboard.press('Control+Alt+l');
      await expect.poll(async () => (await editorDebug(page)).tool).toBe('addLine');
      await page.reload();
      await editorReady(page);
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await page.keyboard.press('Control+Alt+l');
      await expect.poll(async () => (await editorDebug(page)).tool).toBe('addLine');
      await openShortcuts();
      await tap(row.getByRole('button', { name: 'Set shortcut for Line', exact: true }));
      await page.keyboard.press('Control+z');
      await expect(settings.getByRole('alert')).toContainText('Undo');
      await page.keyboard.press('Escape');
      await expect(row).toContainText('Ctrl+Alt+L');
      await tap(row.getByRole('button', { name: 'Set shortcut for Line', exact: true }));
      await page.keyboard.press('Control+s');
      await expect(settings.getByRole('alert')).toContainText('Save');
      await expect(settings.getByRole('alert')).toContainText('reserved');
      await page.keyboard.press('Escape');
      await expect(row).toContainText('Ctrl+Alt+L');
      await tap(row.getByRole('button', { name: 'Clear shortcut for Line', exact: true }));
      await expect(row).toContainText('Unassigned');
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await page.keyboard.press('Control+Alt+l');
      await page.keyboard.press('l');
      assert.equal((await editorDebug(page)).tool, 'select', 'A cleared shortcut still ran');
      await openShortcuts();
      await tap(row.getByRole('button', { name: 'Reset shortcut for Line', exact: true }));
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await page.keyboard.press('l');
      await expect.poll(async () => (await editorDebug(page)).tool).toBe('addLine');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps typing native when Settings has a single-letter shortcut in ${tablet.name}`, async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const settings = frame.getByTestId('settings-modal');
      await tap(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Settings', exact: true }));
      await tap(settings.getByRole('button', { name: 'Keyboard shortcuts', exact: true }));
      const search = settings.getByRole('searchbox', { name: 'Find command', exact: true });
      await search.fill('Settings');
      await tap(settings.getByRole('button', { name: 'Set shortcut for Settings', exact: true }));
      await page.keyboard.press('q');
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      await page.keyboard.press('q');
      await expect(settings).toBeVisible();
      await search.fill('');
      await search.press('q');
      await expect(search).toHaveValue('q');
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await tap(rail.getByRole('button', { name: 'Properties', exact: true }));
      const mode = frame.getByRole('complementary', { name: 'Diagram properties', exact: true }).locator('select').first();
      await expect(mode).toBeVisible();
      await mode.press('q');
      await expect(settings).toHaveCount(0);
      await mode.press('ArrowDown');
      await expect(mode).toHaveValue('fixed');
      assert.equal((await editorDebug(page)).tool, 'select', 'Native select typing switched drawing tools');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `runs a configured canvas-owned simplification command in ${tablet.name}`, async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
      const settings = frame.getByTestId('settings-modal');
      await tap(settings.getByRole('button', { name: 'Keyboard shortcuts', exact: true }));
      await settings.getByRole('searchbox', { name: 'Find command', exact: true }).fill('Simplify Path');
      await tap(settings.getByRole('button', { name: 'Set shortcut for Simplify Path', exact: true }));
      await page.keyboard.press('Control+Alt+p');
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      await tap(rail.getByRole('button', { name: 'Freehand', exact: true }));
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.penStroke(Array.from({ length: 60 }, (_, i) => ({ x: viewport.x + viewport.width * .35 + i * 6, y: viewport.y + viewport.height * .45 + Math.sin(i / 4) * 30 })));
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      await tap(result.getByRole('button', { name: 'Accept', exact: true }));
      await expect(result).toHaveCount(0);
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      const ids = await frame.locator('svg [data-source-id^="path:"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-source-id')!))]);
      const curve = frame.locator(`svg [data-source-id="${ids[ids.length - 1]}"]`).first();
      const selectCurve = async () => {
        await fitDiagram(frame, input);
        await input.touch([await strokePoint(page, curve, .3)]);
        const whole = frame.getByRole('button', { name: 'Select entire curve', exact: true });
        if (await whole.isVisible()) await tap(whole);
      };
      await selectCurve();
      const before = (await editorDebug(page)).source;
      const anchors = async () => ((await editorDebug(page)).source.match(/\.\. controls/g) ?? []).length;
      const count = await anchors();
      await tap(frame.getByRole('button', { name: 'Curve actions', exact: true }));
      await tap(frame.getByRole('button', { name: 'Simplify curve', exact: true }));
      await expect.poll(anchors, { timeout: 30_000 }).toBeLessThan(count);
      const refinement = frame.getByRole('dialog', { name: 'Curve refinement' });
      await tap(refinement.getByRole('button', { name: 'Cancel', exact: true }));
      await expect.poll(async () => (await editorDebug(page)).source).toBe(before);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual([ids[ids.length - 1]]);
      if (await frame.getByRole('button', { name: 'Curve actions', exact: true }).getAttribute('aria-expanded') === 'false')
        await tap(frame.getByRole('button', { name: 'Curve actions', exact: true }));
      await expect(frame.getByRole('button', { name: 'Simplify curve', exact: true })).toBeVisible();
      assert.equal(await anchors(), count, 'Reaching the keyboard baseline changed the curve');
      await page.keyboard.press('Control+Alt+p');
      await expect(refinement, 'The configured command did not open the curve refinement').toBeVisible();
      await expect.poll(anchors, { timeout: 30_000, message: 'The configured command did not reach the canvas simplifier' }).toBeLessThan(count);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `uses configured Undo, Delete and previously unassigned Layers shortcuts in ${tablet.name}`, async function () {
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const source = String.raw`\begin{tikzpicture}\draw (-4,-2) -- (4,2);\end{tikzpicture}`;
      await page.locator('.cm-content').fill(source);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const rail = frame.locator('[data-diagram-tools]');
      await fitDiagram(frame, input);
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await input.touch([await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), .5)]);
      await page.keyboard.press('Delete');
      await expect.poll(async () => (await editorDebug(page)).source).not.toContain('\\draw');
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await editorDebug(page)).source).toBe(source);
      await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
      const settings = frame.getByTestId('settings-modal');
      await tap(settings.getByRole('button', { name: 'Keyboard shortcuts', exact: true }));
      for (const [name, shortcut] of [['Delete', 'Control+Alt+d'], ['Undo', 'Control+Alt+u'], ['Layers', 'Control+Alt+j']]) {
        await settings.getByRole('searchbox', { name: 'Find command', exact: true }).fill(name);
        await tap(settings.getByRole('group', { name: `${name} shortcut`, exact: true }).getByRole('button', { name: `Set shortcut for ${name}`, exact: true }));
        await page.keyboard.press(shortcut);
      }
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      await fitDiagram(frame, input);
      await input.touch([await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), .5)]);
      await page.keyboard.press('Delete');
      assert.equal((await editorDebug(page)).source, source, 'The old canvas Delete binding remained active');
      await page.keyboard.press('Control+Alt+d');
      await expect.poll(async () => (await editorDebug(page)).source).not.toContain('\\draw');
      await page.keyboard.press('Control+z');
      assert.doesNotMatch((await editorDebug(page)).source, /\\draw/, 'The old canvas Undo binding remained active');
      await page.keyboard.press('Control+Alt+u');
      await expect.poll(async () => (await editorDebug(page)).source).toBe(source);
      await page.keyboard.press('Control+Alt+j');
      await expect(frame.getByRole('tab', { name: 'Layers', exact: true, selected: true })).toBeVisible();
      await tap(frame.getByRole('button', { name: 'Close properties', exact: true }));
      await tap(rail.getByRole('button', { name: 'Settings', exact: true }));
      await settings.getByRole('searchbox', { name: 'Find command', exact: true }).fill('Layers');
      await tap(settings.getByRole('button', { name: 'Set shortcut for Layers', exact: true }));
      await page.keyboard.press('ArrowLeft');
      await tap(settings.getByRole('button', { name: 'Close settings', exact: true }));
      await fitDiagram(frame, input);
      await input.touch([await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), .5)]);
      await page.keyboard.press('Control+Alt+j');
      await expect(frame.getByRole('tab', { name: 'Layers', exact: true })).toHaveCount(0);
      await page.keyboard.press('ArrowLeft');
      await expect(frame.getByRole('tab', { name: 'Layers', exact: true, selected: true })).toBeVisible();
      assert.equal((await editorDebug(page)).source, source, 'The assigned arrow key still nudged the selected line');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `constrains pen drawing and moving through a touch toggle in ${tablet.name}`, async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Lock to lattice', exact: true }));
      await tap(rail.getByRole('button', { name: 'Insert', exact: true }));
      await tap(frame.getByRole('button', { name: 'Line', exact: true }));
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const from = { x: viewport.x + viewport.width * .55, y: viewport.y + viewport.height * .4 };
      const draw = () => input.penStroke([from, { x: from.x + 60, y: from.y + 17.5 }, { x: from.x + 120, y: from.y + 35 }]);
      const points = async () => {
        const path = (await editorDebug(page)).scene?.elements.find(element => element.kind === 'Path');
        const points = path?.commands?.flatMap(command => command.to ? [command.to] : []);
        assert.ok(points && points.length >= 2, 'The drawn path has no editable geometry');
        return points;
      };
      const angle = async () => {
        const p = await points();
        return Math.abs(Math.atan2(p[p.length - 1].y - p[0].y, p[p.length - 1].x - p[0].x) * 180 / Math.PI);
      };
      await draw();
      assert.ok(Math.abs(await angle() - 15) > .5, 'The free baseline was already angle constrained');
      await tap(rail.getByRole('button', { name: 'Undo', exact: true }));
      await expect(frame.locator('svg [data-source-id^="path:"]')).toHaveCount(0);
      const constrain = rail.getByRole('button', { name: 'Constrain geometry', exact: true });
      await expect(constrain).toHaveAttribute('aria-pressed', 'false');
      await tap(constrain);
      await expect(constrain).toHaveAttribute('aria-pressed', 'true');
      await draw();
      assert.ok(Math.abs(await angle() - 15) < .1, `The constrained line was at ${await angle()} degrees`);
      await tap(rail.getByRole('button', { name: 'Undo', exact: true }));
      await tap(rail.getByRole('button', { name: 'Insert', exact: true }));
      await tap(frame.getByRole('button', { name: 'Rectangle', exact: true }));
      await input.penStroke([from, { x: from.x + 55, y: from.y + 22.5 }, { x: from.x + 110, y: from.y + 45 }]);
      const square = await points();
      const width = Math.max(...square.map(p => p.x)) - Math.min(...square.map(p => p.x));
      const height = Math.max(...square.map(p => p.y)) - Math.min(...square.map(p => p.y));
      assert.ok(width > 10 && Math.abs(width - height) < .4, `The constrained rectangle was ${width} by ${height}`);
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await fitDiagram(frame, input);
      const shape = frame.locator('svg [data-source-id="path:0"]').first();
      const drag = async () => {
        const start = await strokePoint(page, shape, .06);
        await input.penStroke([start, { x: start.x + 40, y: start.y + 11 }, { x: start.x + 80, y: start.y + 22 }]);
      };
      const before = (await points())[0];
      await drag();
      const constrained = (await points())[0];
      assert.ok(constrained.x > before.x + 1, 'The constrained move did not move the shape');
      assert.ok(Math.abs(constrained.y - before.y) < .1, 'The constrained move changed its other axis');
      await tap(constrain);
      await expect(constrain).toHaveAttribute('aria-pressed', 'false');
      await fitDiagram(frame, input);
      await drag();
      const free = (await points())[0];
      assert.ok(free.x > constrained.x + 1 && Math.abs(free.y - constrained.y) > 1, 'The free baseline could not move diagonally');
    });

    story({ viewport: tablet }, `edits figure bounds in scaled lattice units in ${tablet.name}`, async function () {
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}[x=2cm,y=0.5cm]
\draw (0,0) rectangle (4,6);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await fitDiagram(frame, input);
      await tap(rail.getByRole('button', { name: 'Properties', exact: true }));
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel.getByText('Figure Bounds', { exact: true })).toBeVisible();
      await panel.locator('select').selectOption('fixed');
      const field = (name: string) => panel.locator('[class*="compactNumberField"]', { hasText: name }).locator('input');
      assert.ok(Math.abs(Number(await field('Width').inputValue()) - 4) < .05, 'Automatic width was converted to centimetres instead of lattice units');
      assert.ok(Math.abs(Number(await field('Height').inputValue()) - 6) < .05, 'Automatic height was converted to centimetres instead of lattice units');
      assert.doesNotMatch(await panel.innerText(), /\bcm\b|\bpx\b/);
      await field('Width').fill('6');
      await field('Width').press('Enter');
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\useasboundingbox/);
      const bounds = /\\useasboundingbox \(([-\d.]+),([-\d.]+)\) rectangle \(([-\d.]+),([-\d.]+)\)/.exec((await editorDebug(page)).source);
      assert.ok(bounds, 'Fixed bounds were not written into TikZ');
      assert.ok(Math.abs(Number(bounds[3]) - Number(bounds[1]) - 6) < .02, 'The width was not written as six lattice steps');
      await storyScreenshot(page, `figure-bounds-units-${tablet.name}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `offers touch-sized floating Properties controls and only mounted tabs in ${tablet.name}`, async function () {
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const source = String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (4,6);
\end{tikzpicture}`;
      await page.locator('.cm-content').fill(source);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await fitDiagram(frame, input);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      const checkControls = async () => {
        const controls = panel.locator('button,input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),select,textarea');
        let checked = 0;
        for (const control of await controls.all()) {
          if (!(await control.isVisible())) continue;
          await stableCenter(control);
          const box = (await control.boundingBox())!;
          assert.ok(box.width >= 44 && box.height >= 44, `${await control.evaluate(element => element.outerHTML)} is ${box.width}×${box.height}, below a finger target`);
          checked++;
        }
        assert.ok(checked >= 4, 'The panel had no editable control baseline');
        const body = panel.locator('.embed-inspector-content');
        assert.ok(await body.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Properties controls overflow horizontally');
      };
      await tap(rail.getByRole('button', { name: 'Properties', exact: true }));
      await checkControls();
      assert.deepEqual(await panel.getByRole('tab').allInnerTexts(), ['Properties', 'Layers']);
      await tap(panel.getByRole('button', { name: 'Close properties', exact: true }));
      await input.touch([await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), .06)]);
      await tap(rail.getByRole('button', { name: 'Properties', exact: true }));
      await checkControls();
      assert.equal((await editorDebug(page)).source, source, 'Reaching the controls changed the drawing');
      await storyScreenshot(page, `floating-properties-${tablet.name}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `offers touch-sized Repeat dialog controls in ${tablet.name}`, async function () {
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (-4,-2) -- (4,2);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      await tap(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Select', exact: true }));
      await fitDiagram(frame, input);
      await input.longPress(await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), .5));
      await tap(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Repeat...', exact: true }));
      const repeat = frame.getByTestId('repeat-modal');
      await expect(repeat).toBeVisible();
      for (const control of await repeat.locator('button,input').all()) {
        await stableCenter(control);
        const box = (await control.boundingBox())!;
        assert.ok(box.width >= 44 && box.height >= 44, `Repeat control is ${box.width}×${box.height}, below a finger target`);
      }
      await storyScreenshot(page, `repeat-touch-${tablet.name}`);
      await tap(repeat.getByRole('button', { name: 'Close repeat dialog', exact: true }));
      await expect(repeat).toHaveCount(0);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `inserts, deletes, and opens layers through touch routes in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (0,0) circle (2cm);\end{tikzpicture}`);
      const frame = editorFrame(page);
      await expect(frame.locator('[data-source-id]')).toHaveCount(1);
      const input = await TabletInput.attach(page);
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      const rail = frame.locator('[data-diagram-tools]');
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;

      await input.touch([await center(rail.getByRole('button', { name: 'Insert', exact: true }))]);
      await input.touch([await center(frame.getByRole('button', { name: 'Line', exact: true }))]);
      assert.equal((await editorDebug(page)).tool, 'addLine');
      const from = { x: viewport.x + viewport.width * .7, y: viewport.y + viewport.height * .3 };
      await input.penStroke([from, { x: from.x + 40, y: from.y + 30 }, { x: from.x + 80, y: from.y + 60 }]);
      await expect(frame.locator('[data-source-id]')).toHaveCount(2);
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw[^;]*--[^;]*;/);

      await input.touch([await center(rail.getByRole('button', { name: 'Select', exact: true }))]);
      // The inserted line stays selected and its control may cover the circle; tap empty canvas to dismiss it.
      await input.touch([{ x: viewport.x + viewport.width - 12, y: viewport.y + viewport.height - 12 }]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
      await fitDiagram(frame, input);
      await input.longPress(await strokePoint(page, frame.locator('circle[data-source-id]').first(), .5));
      await input.touch([await center(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Delete', exact: true }))]);
      await expect(frame.locator('circle[data-source-id]')).toHaveCount(0);
      assert.doesNotMatch((await editorDebug(page)).source, /circle/);

      await input.touch([await center(rail.getByRole('button', { name: 'Layers', exact: true }))]);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('tabpanel').getByText('Layers', { exact: true })).toBeVisible();
      await expect(panel.getByText('Line', { exact: true })).toBeVisible();
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `names the layers panel Layers on the rail, its tab, and its header in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await input.touch([await stableCenter(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Layers', exact: true }))]);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel.getByRole('tab', { name: 'Layers', exact: true, selected: true })).toBeVisible();
      await expect(panel.getByRole('tab', { name: 'Objects', exact: true })).toHaveCount(0);
      await expect(panel.getByRole('tabpanel').getByText('Layers', { exact: true }).first()).toBeVisible();
      await input.touch([await stableCenter(panel.getByRole('button', { name: 'Close properties', exact: true }))]);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `creates, renames, fills, hides, locks, orders and deletes TikZ scope layers by touch in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (-14,-18) -- (-2,-12);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id]')).toHaveCount(1);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => { await input.touch([await stableCenter(locator)]); };
      const source = async () => (await editorDebug(page)).source;
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Layers', exact: true }));
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true }).getByRole('tabpanel');
      const layers = () => panel.getByRole('group', { name: / layer$/ }).evaluateAll(groups => groups.map(group => group.getAttribute('aria-label')!.replace(/ layer$/, '')));
      // A new layer is a named scope; layers are listed front first.
      await tap(panel.getByRole('button', { name: 'New layer', exact: true }));
      await tap(panel.getByRole('button', { name: 'New layer', exact: true }));
      await expect.poll(source).toMatch(/\\begin\{scope\}\[name=Layer 1\][^]*\\end\{scope\}[^]*\\begin\{scope\}\[name=Layer 2\]/);
      await expect.poll(layers).toEqual(['Layer 2', 'Layer 1']);
      for (const button of await panel.getByRole('group', { name: / layer$/ }).getByRole('button').all()) {
        const box = (await button.boundingBox())!;
        assert.ok(box.width >= 44 && box.height >= 44, `${await button.getAttribute('aria-label')} is ${box.width}x${box.height} px, under a fingertip`);
      }
      // Renaming writes the scope's name.
      await tap(panel.getByRole('button', { name: 'Rename Layer 1', exact: true }));
      await panel.getByRole('textbox', { name: 'Layer name' }).fill('Ground');
      await page.keyboard.press('Enter');
      await expect.poll(source).toMatch(/\\begin\{scope\}\[name=Ground\]/);
      // The selected line moves into the layer's scope.
      await tap(panel.getByRole('button', { name: 'Line', exact: true }));
      await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
      await tap(panel.getByRole('button', { name: 'Move selection to Ground', exact: true }));
      await expect.poll(source).toMatch(/\\begin\{scope\}\[name=Ground\]\s*\\draw \(-14,-18\) -- \(-2,-12\);\s*\\end\{scope\}/);
      assert.equal((await source()).match(/\\draw/g)!.length, 1);
      const childIndent = async () => (await panel.getByRole('button', { name: 'Line', exact: true }).boundingBox())!.x
        - (await panel.getByRole('button', { name: 'Ground Layer', exact: true }).boundingBox())!.x;
      await expect.poll(childIndent, { message: 'The layer child is drawn to the left of its parent' }).toBeGreaterThan(0);
      const line = frame.locator('svg [data-source-id]').first();
      const drawnOpacity = () => line.evaluate(element => {
        let opacity = Number(getComputedStyle(element).strokeOpacity);
        for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      });
      // Hiding changes the painted line as well as its source; showing restores both.
      await expect.poll(drawnOpacity).toBeGreaterThan(0);
      await tap(panel.getByRole('button', { name: 'Hide Ground', exact: true }));
      await expect.poll(source).toMatch(/\[name=Ground, transparent\]/);
      await expect.poll(drawnOpacity).toBe(0);
      await tap(panel.getByRole('button', { name: 'Show Ground', exact: true }));
      await expect.poll(source).toMatch(/\[name=Ground\]/);
      await expect.poll(drawnOpacity).toBeGreaterThan(0);
      // The pen drags the line of an unlocked layer, and not of a locked one.
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      // With the panel open, the fitted view keeps the line in the canvas left of it.
      await fitDiagram(frame, input);
      const drag = async () => {
        const from = await strokePoint(page, line, .5);
        await input.penDown(from);
        for (let step = 1; step <= 12; step++) await input.penMove({ x: from.x + step * 5, y: from.y - step * 3 });
        await input.penUp({ x: from.x + 60, y: from.y - 36 });
      };
      await drag();
      // A press on an object in a layer takes the object, not the whole layer.
      await expect.poll(source, 'The pen did not drag an unlocked line').not.toMatch(/\\draw \(-14,-18\) -- \(-2,-12\);/);
      assert.match(await source(), /\\begin\{scope\}\[name=Ground\]\s*\\draw/, 'The drag moved the layer instead of its line');
      // The selected line's control stays off the open panel.
      const aside = (await frame.getByRole('complementary', { name: 'Diagram properties', exact: true }).boundingBox())!;
      for (const control of [frame.getByRole('button', { name: /Lock curve/ }), frame.getByRole('button', { name: /curve actions/i }).first()]) {
        const box = (await control.boundingBox())!;
        assert.ok(box.x + box.width <= aside.x || box.x >= aside.x + aside.width || box.y + box.height <= aside.y || box.y >= aside.y + aside.height,
          `${control} at ${JSON.stringify(box)} covers the Layers panel at ${JSON.stringify(aside)}`);
      }
      await tap(rail.getByRole('button', { name: 'Undo', exact: true }));
      await expect.poll(source).toMatch(/\\draw \(-14,-18\) -- \(-2,-12\);/);
      await tap(panel.getByRole('button', { name: 'Lock Ground', exact: true }));
      await expect(panel.getByRole('button', { name: 'Unlock Ground', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await drag();
      assert.match(await source(), /\\draw \(-14,-18\) -- \(-2,-12\);/, 'A locked layer\'s line moved');
      await tap(panel.getByRole('button', { name: 'Unlock Ground', exact: true }));
      // Raising puts the layer in front: later in the source, first in the list.
      await tap(panel.getByRole('button', { name: 'Raise Ground', exact: true }));
      await expect.poll(layers).toEqual(['Ground', 'Layer 2']);
      assert.match(await source(), /\[name=Layer 2\][^]*\[name=Ground\]/);
      // Deleting asks first, then removes the scope.
      await tap(panel.getByRole('button', { name: 'Delete Layer 2', exact: true }));
      assert.match(await source(), /name=Layer 2/, 'Deleted without confirmation');
      await tap(panel.getByRole('button', { name: 'Delete Layer 2 and its objects', exact: true }));
      await expect.poll(source).not.toMatch(/Layer 2/);
      await expect.poll(layers).toEqual(['Ground']);
      await storyScreenshot(page, `layers-${tablet.name}`);
      await tap(frame.getByRole('complementary', { name: 'Diagram properties', exact: true }).getByRole('button', { name: 'Close properties', exact: true }));
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps selection actions usable beside Layers when the selection fills the canvas in ${tablet.name}`, async function () {
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\begin{scope}[name=Long foreground layer]
\draw (-100,-100) rectangle (100,100);
\end{scope}
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Layers', exact: true }))]);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      const title = panel.getByRole('button', { name: 'Long foreground layer Layer', exact: true });
      // A long name may ellipsize; the type badge must remain legible.
      const badge = title.getByText('Layer', { exact: true });
      await expect(badge).toBeVisible();
      assert.ok(await badge.evaluate(node => {
        const box = node.getBoundingClientRect();
        const parent = node.parentElement!.getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right;
      }), 'The Layer badge is clipped by the title');
      await input.touch([await stableCenter(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Select', exact: true }))]);
      const zoom = frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Zoom and display', exact: true });
      await input.touch([await stableCenter(zoom)]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: '200%', exact: true }))]);
      await input.touch([await stableCenter(zoom)]);
      await input.touch([await stableCenter(panel.getByRole('button', { name: 'Rectangle', exact: true }))]);
      const actions = frame.getByRole('button', { name: 'Selection actions', exact: true });
      await expect(actions).toBeInViewport({ ratio: 1 });
      const control = (await actions.boundingBox())!;
      const aside = (await panel.boundingBox())!;
      assert.ok(control.width >= 44 && control.height >= 44);
      assert.ok(control.x + control.width <= aside.x || control.x >= aside.x + aside.width ||
        control.y + control.height <= aside.y || control.y >= aside.y + aside.height, 'Selection actions overlap Layers');
      await input.touch([await stableCenter(actions)]);
      await expect(frame.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/workbench/layers-cramped-${tablet.name}.png` });
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `refuses to move a coordinate into a layer drawn after the line that uses it in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\coordinate (a) at (-10,-14);
\draw (a) -- (-4,-16);
\begin{scope}[name=Front]
\end{scope}
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id]').first()).toBeAttached();
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => { await input.touch([await stableCenter(locator)]); };
      const source = async () => (await editorDebug(page)).source;
      await tap(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Layers', exact: true }));
      const aside = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      const panel = aside.getByRole('tabpanel');
      const before = await source();
      await tap(panel.getByRole('button', { name: 'Coordinate', exact: true }));
      await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
      await tap(panel.getByRole('button', { name: 'Move selection to Front', exact: true }));
      await expect(frame.getByTestId('canvas-warning-message')).toContainText('out of order');
      assert.equal(await source(), before, 'The coordinate moved after the line that uses it');
      // The line itself may join the later layer.
      await tap(panel.getByRole('button', { name: 'Line', exact: true }));
      await tap(panel.getByRole('button', { name: 'Move selection to Front', exact: true }));
      await expect.poll(source).toMatch(/\\begin\{scope\}\[name=Front\]\s*\\draw \(a\) -- \(-4,-16\);\s*\\end\{scope\}/);
      await tap(aside.getByRole('button', { name: 'Close properties', exact: true }));
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps panels and the freehand result clear of the drawing rail in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = frame.locator('[data-diagram-tools]');
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      const overlap = async (locator: ReturnType<typeof frame.locator>) => {
        const [a, b] = [(await rail.boundingBox())!, (await locator.boundingBox())!];
        return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      };
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.penStroke(waveAcross(viewport, .45, .4, 120));
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      await expect(result).toBeVisible();
      assert.equal(await overlap(result), 0, 'The freehand result covers the rail');
      await input.touch([await center(result.getByRole('button', { name: 'Cancel', exact: true }))]);
      await input.touch([await center(rail.getByRole('button', { name: 'Properties', exact: true }))]);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel).toBeVisible();
      assert.equal(await overlap(panel), 0, 'The properties panel covers the rail');
      await storyScreenshot(page, `placement-${tablet.name}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `opens Properties as a side panel in landscape and a bottom sheet in portrait, clear of the selected object, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (-1,-1) rectangle (1,1);
\draw (6,-8) rectangle (9,-5);
\path[use as bounding box] (-10,-10) rectangle (10,10);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const corner = frame.locator('svg [data-source-id="path:1"]').first();
      await expect(corner).toBeVisible();
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => { await input.touch([await stableCenter(locator)]); };
      await fitDiagram(frame, input);
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await input.penStroke([await strokePoint(page, corner, .1)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:1']);
      await tap(rail.getByRole('button', { name: 'Properties', exact: true }));
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel).toBeVisible();
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
        Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const clearOfSubject = async (what: string) => {
        await expect.poll(async () => overlap((await panel.boundingBox())!, (await corner.boundingBox())!), `${what} covers the selected rectangle`).toBe(0);
        const box = (await corner.boundingBox())!;
        assert.ok(box.x >= viewport.x && box.y >= viewport.y && box.x + box.width <= viewport.x + viewport.width && box.y + box.height <= viewport.y + viewport.height, `${what} pushed the selected rectangle off the canvas`);
        assert.equal(overlap((await rail.boundingBox())!, box), 0, `The rail covers the selected rectangle beside ${what}`);
      };
      const box = (await panel.boundingBox())!;
      if (tablet.name === 'landscape') {
        assert.ok(box.x > viewport.x + viewport.width / 2 && box.height > box.width, `Properties is not a side panel: ${JSON.stringify(box)}`);
        await clearOfSubject('the side panel');
      } else {
        assert.ok(box.width > viewport.width * .9 && box.height < viewport.height * .5 && box.y > viewport.y + viewport.height / 2, `Properties is not a shallow bottom sheet: ${JSON.stringify({ box, viewport })}`);
        assert.equal(overlap(box, (await rail.boundingBox())!), 0, 'The bottom sheet covers the dock');
        await clearOfSubject('the bottom sheet');
        const expand = panel.getByRole('button', { name: 'Expand properties', exact: true });
        await expect(expand).toHaveAttribute('aria-expanded', 'false');
        await tap(expand);
        await expect(expand).toHaveAttribute('aria-expanded', 'true');
        await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(viewport.height * .6);
        await tap(expand);
        await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(viewport.height * .5);
      }
      await storyScreenshot(page, `properties-space-${tablet.name}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps the selected object and Properties above the on-screen keyboard in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (-1,-1) rectangle (1,1);
\draw (6,-8) rectangle (9,-5);
\path[use as bounding box] (-10,-10) rectangle (10,10);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const corner = frame.locator('svg [data-source-id="path:1"]').first();
      await expect(corner).toBeVisible();
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => { await input.touch([await stableCenter(locator)]); };
      await fitDiagram(frame, input);
      const rail = frame.locator('[data-diagram-tools]');
      await tap(rail.getByRole('button', { name: 'Select', exact: true }));
      await input.penStroke([await strokePoint(page, corner, .1)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:1']);
      await tap(rail.getByRole('button', { name: 'Properties', exact: true }));
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await tap(panel.getByRole('spinbutton', { name: 'X shift', exact: true }));
      const scale = (await editorDebug(page)).viewport.scale;
      // iPadOS reports the keyboard as a shorter visual viewport over an unchanged layout.
      const keyboardTop = Math.round(tablet.height * .58);
      const reportVisibleHeight = (height: number) => page.evaluate((visible) => {
        Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: visible });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      }, height);
      await reportVisibleHeight(keyboardTop);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await expect.poll(async () => { const box = (await corner.boundingBox())!; return box.y + box.height; }, 'The keyboard covers the selected rectangle').toBeLessThanOrEqual(keyboardTop);
      assert.ok((await corner.boundingBox())!.y >= viewport.y, 'The selected rectangle left the top of the canvas');
      const panelBottom = async () => { const box = (await panel.boundingBox())!; return box.y + box.height; };
      if (tablet.name === 'portrait') await expect.poll(panelBottom, 'The keyboard covers the bottom sheet').toBeLessThanOrEqual(keyboardTop);
      const field = (await panel.getByRole('spinbutton', { name: 'X shift', exact: true }).boundingBox())!;
      assert.ok(field.y + field.height <= keyboardTop, 'The keyboard covers the focused Properties field');
      const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
        Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      await expect.poll(async () => overlap((await panel.boundingBox())!, (await corner.boundingBox())!), 'The raised panel covers the selected rectangle').toBe(0);
      const control = frame.getByRole('button', { name: 'Selection actions', exact: true }).locator('..');
      assert.equal(overlap((await control.boundingBox())!, (await panel.boundingBox())!), 0, 'The selection control covers the raised panel');
      assert.equal((await editorDebug(page)).viewport.scale, scale, 'The keyboard changed the zoom');
      await storyScreenshot(page, `properties-keyboard-${tablet.name}`);
      await reportVisibleHeight(tablet.height);
      if (tablet.name === 'portrait') await expect.poll(panelBottom, 'The bottom sheet stays raised after the keyboard closes').toBeGreaterThan(keyboardTop);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `moves the drawing rail by its grip only and never over the rulers in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = frame.locator('[data-diagram-tools]');
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) =>
        input.touch(Array.from({ length: 13 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 })));
      const clearOfRulers = async () => {
        const railBox = (await rail.boundingBox())!;
        for (const ruler of ['canvas-top-ruler', 'canvas-left-ruler']) {
          const box = (await frame.getByTestId(ruler).boundingBox())!;
          const overlapX = Math.min(railBox.x + railBox.width, box.x + box.width) - Math.max(railBox.x, box.x);
          const overlapY = Math.min(railBox.y + railBox.height, box.y + box.height) - Math.max(railBox.y, box.y);
          assert.ok(overlapX <= 0 || overlapY <= 0, `The rail covers ${ruler}`);
        }
      };
      // The dock sits at the lower edge by default (docs/interaction-model.md, Space).
      await expect(rail).toHaveAttribute('data-dock', 'bottom');
      await clearOfRulers();
      const names = await rail.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
      assert.ok(names.indexOf('Lasso') < 8 && names.indexOf('Eraser') < 8, names.join(', '));
      await drag(await center(rail.getByRole('button', { name: 'Select', exact: true })), { x: viewport.x + viewport.width - 10, y: viewport.y + viewport.height / 2 });
      await expect(rail).toHaveAttribute('data-dock', 'bottom');
      await drag(await center(rail.getByRole('button', { name: 'Move toolbar', exact: true })), { x: viewport.x + viewport.width - 10, y: viewport.y + viewport.height / 2 });
      await expect(rail).toHaveAttribute('data-dock', 'right');
      await clearOfRulers();
      await drag(await center(rail.getByRole('button', { name: 'Move toolbar', exact: true })), { x: viewport.x + viewport.width / 2, y: viewport.y + 10 });
      await expect(rail).toHaveAttribute('data-dock', 'top');
      await clearOfRulers();
      await drag(await center(rail.getByRole('button', { name: 'Move toolbar', exact: true })), { x: viewport.x + 10, y: viewport.y + viewport.height / 2 });
      await expect(rail).toHaveAttribute('data-dock', 'left');
      await clearOfRulers();
    });

    story({ viewport: tablet }, `copies and pastes an element through long presses in ${tablet.name}`, async function () {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (0,0) circle (2cm);\end{tikzpicture}`);
      const frame = editorFrame(page);
      await expect(frame.locator('circle[data-source-id]')).toHaveCount(1);
      const input = await TabletInput.attach(page);
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      await input.touch([await center(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await fitDiagram(frame, input);
      await input.longPress(await strokePoint(page, frame.locator('circle[data-source-id]').first(), .5));
      await input.touch([await center(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Copy', exact: true }))]);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.longPress({ x: viewport.x + viewport.width * .85, y: viewport.y + viewport.height * .2 });
      await input.touch([await center(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Paste', exact: true }))]);
      await expect.poll(async () => ((await editorDebug(page)).source.match(/circle/g) ?? []).length).toBe(2);
    });

    story({ viewport: tablet }, `starts a new tikzpicture or tikzcd by touch in ${tablet.name}`, async function () {
      await editorReady(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: ReturnType<typeof page.locator>) => {
        await input.touch([await stableCenter(locator)]);
      };
      for (const kind of ['tikzcd', 'tikzpicture'] as const) {
        await tap(page.getByRole('group', { name: 'File' }).locator('summary'));
        await tap(page.getByRole('button', { name: 'New tikzpicture or tikzcd…', exact: true }));
        await expect(page.getByRole('dialog', { name: 'Save changes?' }), 'An untouched new diagram has no changes to save').toHaveCount(0);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: 'tikzpicture', exact: true })).toBeVisible();
        await tap(dialog.getByRole('button', { name: kind, exact: true }));
        await expect(page.locator(kind === 'tikzcd' ? 'iframe[title="Quiver diagram editor"]' : 'iframe[title="TikZ visual editor"]')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.tikz-standalone-status')).toHaveText(`New ${kind} · not saved`);
        await editorReady(page);
      }
    });
  }

  story({ viewport: { width: 768, height: 1024 } }, 'names no key in the tooltips a hovering pen shows on the drawing rail', async function () {
    await editorReady(page);
    const frame = editorFrame(page);
    const input = await TabletInput.attach(page);
    const rail = frame.locator('[data-diagram-tools]');
    for (const name of ['Select', 'Lasso', 'Eraser', 'Freehand', 'Bucket']) {
      const box = (await rail.getByRole('button', { name, exact: true }).boundingBox())!;
      await input.penHover({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      const tooltip = frame.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      assert.doesNotMatch(await tooltip.innerText(), /\([A-Z]\)|Ctrl|Cmd|Shift|Alt|Esc/, `${name} tooltip`);
      await input.penHover({ x: 2, y: 2 });
    }
  });

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `reverses a path from its long-press menu in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (-4,-2) -- (4,2);\end{tikzpicture}`);
      const frame = editorFrame(page);
      const line = frame.locator('[data-source-id]').first();
      await expect(line).toBeVisible();
      const input = await TabletInput.attach(page);
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      await input.touch([await center(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await fitDiagram(frame, input);
      await input.longPress(await strokePoint(page, line, .5));
      const menu = frame.getByRole('menu').first();
      await input.touch([await center(menu.getByRole('menuitem', { name: /^Path/ }))]);
      await input.touch([await center(frame.getByRole('menuitem', { name: 'Reverse Path', exact: true }))]);
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\(4,2\) -- \(-4,-2\)/);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `erases only the swept part of each stroke a pen sweep crosses, as one undo step, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const authored = String.raw`\begin{tikzpicture}
\draw (-6,-4) -- (-6,4);
\draw (-2,-4) -- (-2,4);
\draw (2,-4) .. controls (4,-4) and (0,4) .. (2,4);
\draw (6,-4) -- (6,4);
\end{tikzpicture}`;
      await page.locator('.cm-content').fill(authored);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('[data-source-id]')).toHaveCount(4);
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Eraser', exact: true }))]);
      const strokes = await frame.locator('[data-source-id]').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }));
      const [left, , curve, right] = [...strokes].sort((a, b) => a.x - b.x);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      // One sweep along y = 0 crosses both left lines and the curve, and stops short of the right line.
      const y = frameBox.y + left.y;
      const from = frameBox.x + left.x - 20, to = frameBox.x + (curve.x + right.x) / 2;
      await input.penStroke(Array.from({ length: 16 }, (_, i) => ({ x: from + i * (to - from) / 15, y })));
      const statements = async () => (await editorDebug(page)).source.match(/\\draw[^;]*;/g) ?? [];
      await expect.poll(async () => (await statements()).length, { message: 'The sweep did not leave two pieces of each stroke it crossed' }).toBe(7);
      const points = (statement: string) => [...statement.matchAll(/\((-?[\d.]+),\s*(-?[\d.]+)\)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
      const near = (a: number, b: number) => Math.abs(a - b) < .01;
      const drawn = await statements();
      for (const x of [-6, -2]) {
        const pieces = drawn.filter(text => !text.includes('controls') && points(text).every(point => near(point.x, x)))
          .map(text => points(text).map(point => point.y).sort((a, b) => a - b));
        assert.equal(pieces.length, 2, `The line at x = ${x} is not two pieces: ${drawn.join(' ')}`);
        const [lower, upper] = pieces.sort((a, b) => a[0] - b[0]);
        assert.ok(near(lower[0], -4) && lower[1] < 0 && lower[1] > -1, `The lower piece of x = ${x} is ${lower}`);
        assert.ok(near(upper[1], 4) && upper[0] > 0 && upper[0] < 1, `The upper piece of x = ${x} is ${upper}`);
      }
      const curvePieces = drawn.filter(text => text.includes('controls')).map(points);
      assert.equal(curvePieces.length, 2, `The curve is not two pieces: ${drawn.join(' ')}`);
      const [first, second] = curvePieces.sort((a, b) => a[0].y - b[0].y);
      assert.ok(near(first[0].x, 2) && near(first[0].y, -4) && first.at(-1)!.y < 0 && first.at(-1)!.y > -1, `The first curve piece is ${JSON.stringify(first)}`);
      assert.ok(near(second.at(-1)!.x, 2) && near(second.at(-1)!.y, 4) && second[0].y > 0 && second[0].y < 1, `The second curve piece is ${JSON.stringify(second)}`);
      assert.ok(drawn.includes(String.raw`\draw (6,-4) -- (6,4);`), 'The sweep changed the stroke it did not cross');
      // The whole sweep is one undo step.
      await input.touch([await stableCenter(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Undo', exact: true }))]);
      await expect.poll(async () => (await editorDebug(page)).source).toBe(authored);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `shows a tapped element's source in the code pane, even one opened afterward, in ${tablet.name}`, async function () {
      await editorReady(page);
      const code = page.getByRole('button', { name: 'Code: left sidebar', exact: true });
      await code.click();
      const authored = String.raw`\begin{tikzpicture}
\draw (2,8) -- (12,14);
\draw (8,-6) circle (3cm);
\end{tikzpicture}`;
      await page.locator('.cm-content').fill(authored);
      const frame = editorFrame(page);
      await expect(frame.locator('[data-source-id]')).toHaveCount(2);
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      // The source lines the code pane's selection highlight spans, as the author sees them.
      const codeSelection = () => page.locator('.cm-editor').evaluate(editor => {
        const highlights = [...editor.querySelectorAll('.cm-selectionBackground')].map(node => node.getBoundingClientRect());
        return [...editor.querySelectorAll('.cm-line')].filter(line => {
          const text = document.createRange();
          text.selectNodeContents(line);
          const box = text.getBoundingClientRect();
          return box.width > 0 && highlights.some(mark => mark.top < box.bottom && mark.bottom > box.top &&
            mark.left <= box.left + 1 && mark.right >= box.right - 1);
        }).map(line => line.textContent).join('\n');
      });
      await input.touch([await center(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.touch([await strokePoint(page, frame.locator('circle[data-source-id]').first(), .5)]);
      await expect.poll(codeSelection, { message: 'touch tap on the circle' }).toBe(String.raw`\draw (8,-6) circle (3cm);`);
      const line = (await frame.locator('[data-source-id]:not(circle)').first().boundingBox())!;
      await input.penStroke([{ x: line.x + line.width / 2, y: line.y + line.height / 2 }]);
      await expect.poll(codeSelection, { message: 'pen tap on the line' }).toBe(String.raw`\draw (2,8) -- (12,14);`);
      await code.click();
      await expect(page.locator('.cm-content')).toBeHidden();
      await input.touch([await strokePoint(page, frame.locator('circle[data-source-id]').first(), .5)]);
      await code.click();
      await expect.poll(codeSelection, { message: 'circle tapped while the code pane was closed' }).toBe(String.raw`\draw (8,-6) circle (3cm);`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `places a selected curve's control outside the curve and clear of the rail in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (-6,-3) .. controls (-2,4) and (2,-4) .. (6,3);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const curve = frame.locator('[data-source-id]').first();
      await expect(curve).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
        Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
      for (const contact of ['touch', 'pen'] as const) {
        const box = (await curve.boundingBox())!;
        const point = await curve.evaluate((path: SVGGeometryElement) => {
          const at = path.getPointAtLength(path.getTotalLength() * .2);
          const matrix = path.getScreenCTM()!;
          return { x: at.x * matrix.a + at.y * matrix.c + matrix.e, y: at.x * matrix.b + at.y * matrix.d + matrix.f };
        });
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const tapAt = { x: frameBox.x + point.x, y: frameBox.y + point.y };
        if (contact === 'touch') await input.touch([tapAt]); else await input.penStroke([tapAt]);
        const control = frame.getByRole('button', { name: 'Curve actions', exact: true }).locator('..');
        await expect(control).toBeVisible();
        const controlBox = (await control.boundingBox())!;
        assert.ok(!intersects(controlBox, box), `${contact}: the curve control covers the curve`);
        assert.ok(!intersects(controlBox, (await frame.locator('[data-diagram-tools]').boundingBox())!), `${contact}: the curve control covers the rail`);
        await input.touch([{ x: frameBox.x + 8, y: frameBox.y + frameBox.height - 8 }]);
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ['touch', 'pen'] as const) {
      story({ viewport: tablet }, `highlights, locks, and keeps a curve selected by ${contact} in ${tablet.name}`, async function () {
        await editorReady(page);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,-2) .. controls (5,6) and (9,-6) .. (12,2);
\draw (-6,14) -- (-2,18);
\end{tikzpicture}`);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const centerOf = async (locator: ReturnType<typeof frame.locator>) => {
          return stableCenter(locator);
        };
        const tap = async (point: { x: number; y: number }) => contact === 'touch' ? input.touch([point]) : input.penStroke([point]);
        const onCurve = async (fraction: number) => {
          const point = await frame.locator('svg [data-source-id="path:0"]').first().evaluate((path: SVGGeometryElement, at) => {
            const p = path.getPointAtLength(path.getTotalLength() * at);
            const m = path.getScreenCTM()!;
            return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
          }, fraction);
          return { x: frameBox.x + point.x, y: frameBox.y + point.y };
        };
        await input.touch([await centerOf(frame.getByRole('button', { name: 'Select', exact: true }))]);
        await tap(await onCurve(.3));
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
        await expect(frame.locator('[data-selection-highlight="path:0"]')).toBeVisible();
        const lock = frame.getByRole('button', { name: 'Lock curve', exact: true });
        await expect(lock).toHaveAttribute('aria-pressed', 'false');
        const hint = (await frame.getByTestId('canvas-selection-hint').boundingBox())!;
        const control = (await lock.locator('..').boundingBox())!;
        assert.ok(Math.min(hint.x + hint.width, control.x + control.width) <= Math.max(hint.x, control.x) ||
          Math.min(hint.y + hint.height, control.y + control.height) <= Math.max(hint.y, control.y), `The curve control covers the canvas hint ${JSON.stringify({ hint, control })}`);
        await storyScreenshot(page, `curve-selected-${contact}-${tablet.name}`);
        await input.touch([await centerOf(lock)]);
        await expect(lock).toHaveAttribute('aria-pressed', 'true');
        await storyScreenshot(page, `curve-locked-${contact}-${tablet.name}`);
        await tap((await emptyCanvasGesture(frame))[0]);
        // The other line is separated from the curve and its floating control.
        await tap(await strokePoint(page, frame.locator('svg [data-source-id="path:1"]').first(), .99));
        await expect(lock).toHaveAttribute('aria-pressed', 'true');
        assert.deepEqual((await editorDebug(page)).selection, ['path:0'], 'A locked curve stays selected');
        const anchor = frame.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]').first();
        await tap(await settledCenter(anchor));
        await expect.poll(async () => (await editorDebug(page)).handle).not.toBeNull();
        await expect(lock).toHaveAttribute('aria-pressed', 'true');
        assert.deepEqual((await editorDebug(page)).selection, ['path:0']);
        const before = (await editorDebug(page)).viewport;
        await input.touch(await emptyCanvasGesture(frame));
        assert.notDeepEqual((await editorDebug(page)).viewport, before, 'Finger pan still works on a locked curve');
        await expect(lock).toHaveAttribute('aria-pressed', 'true');
        assert.deepEqual((await editorDebug(page)).selection, ['path:0']);
        await input.touch([await centerOf(lock)]);
        await expect(lock).toHaveAttribute('aria-pressed', 'false');
        // Positive baseline: that same line is selectable once the curve is unlocked.
        await tap(await strokePoint(page, frame.locator('svg [data-source-id="path:1"]').first(), .99));
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:1']);
        await tap((await emptyCanvasGesture(frame))[0]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
      });
    }
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `edits a point on a styled curve from its control in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw[red, thick] (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const curve = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(curve).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.touch([await strokePoint(page, curve, .2)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
      await expect(frame.getByText('3 points', { exact: true })).toBeVisible();
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const middle = await frame.locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }).sort((a, b) => a.x - b.x)[1]);
      await input.touch([{ x: frameBox.x + middle.x, y: frameBox.y + middle.y }]);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Make corner', exact: true }))]);
      await expect.poll(async () => (await editorDebug(page)).source).not.toMatch(/\(5,4\) \.\. \(6,0\) \.\. controls \(7,-4\)/);
      assert.match((await editorDebug(page)).source, /\\draw\[red, thick\]/);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `gives a selected rectangle the shape control, not the curve control, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (2,-2) rectangle (8,2);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const rectangle = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(rectangle).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.touch([await strokePoint(page, rectangle, .1)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
      await expect(frame.getByRole('button', { name: 'Selection actions', exact: true })).toBeVisible();
      await expect(frame.getByRole('button', { name: 'Lock curve', exact: true })).toHaveCount(0);
      await expect(frame.getByRole('button', { name: 'Curve actions', exact: true })).toHaveCount(0);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ['touch', 'pen'] as const) {
      story({ viewport: tablet }, `deletes a chosen subset of a curve's points by ${contact} in ${tablet.name}`, async function () {
        await editorReady(page);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0) .. controls (11,4) and (13,4) .. (14,0) .. controls (15,-4) and (17,-4) .. (18,0);
\end{tikzpicture}`);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const centerOf = async (locator: ReturnType<typeof frame.locator>) => {
          return stableCenter(locator);
        };
        const tap = async (point: { x: number; y: number }) => contact === 'touch' ? input.touch([point]) : input.penStroke([point]);
        await input.touch([await centerOf(frame.getByRole('button', { name: 'Select', exact: true }))]);
        const onCurve = await curve.evaluate((path: SVGGeometryElement) => {
          const p = path.getPointAtLength(path.getTotalLength() * .15);
          const m = path.getScreenCTM()!;
          return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
        });
        await tap({ x: frameBox.x + onCurve.x, y: frameBox.y + onCurve.y });
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
        await input.touch([await centerOf(frame.getByRole('button', { name: 'Curve actions', exact: true }))]);
        await expect(frame.getByRole('button', { name: 'Select multiple nodes', exact: true })).toBeVisible();
        await storyScreenshot(page, `curve-actions-${contact}-${tablet.name}`);
        await input.touch([await centerOf(frame.getByRole('button', { name: 'Select multiple nodes', exact: true }))]);
        const anchors = frame.locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]');
        const points = await anchors.evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }).sort((a, b) => a.x - b.x));
        assert.ok(points.length >= 5, `anchors: ${points.length}`);
        for (const point of [points[1], points[2]]) await tap({ x: frameBox.x + point.x, y: frameBox.y + point.y });
        await expect(frame.getByRole('button', { name: '2 points selected', exact: true })).toBeVisible();
        await input.touch([await centerOf(frame.getByRole('button', { name: 'Delete points', exact: true }))]);
        await expect.poll(async () => ((await editorDebug(page)).source.match(/\.\. controls/g) ?? []).length).toBe(2);
        assert.match((await editorDebug(page)).source, /\(2,0\)[\s\S]*\(14,0\)[\s\S]*\(18,0\)/);
        assert.doesNotMatch((await editorDebug(page)).source, /\(6,0\)|\(10,0\)/);
      });
    }
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `starts with the origin visible and clear of the rail, before and after the code pane opens, in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const origin = frame.locator('text', { hasText: '(0,0)' }).first();
      const rail = frame.locator('[data-diagram-tools]');
      for (const moment of ['at startup', 'after the code pane opens']) {
        if (moment !== 'at startup') {
          await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
          await expect(page.locator('.cm-content')).toBeVisible();
        }
        const [label, railBox] = [await settledCenter(origin), (await rail.boundingBox())!];
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        assert.ok(label.x > viewport.x && label.x < viewport.x + viewport.width && label.y > viewport.y && label.y < viewport.y + viewport.height, `origin ${moment} is off the canvas`);
        const underRail = label.x >= railBox.x && label.x <= railBox.x + railBox.width && label.y >= railBox.y && label.y <= railBox.y + railBox.height;
        assert.ok(!underRail, `origin ${moment} is under the rail`);
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ['touch', 'pen'] as const) {
      story({ viewport: tablet }, `edits a curve point from the curve's own control by ${contact} in ${tablet.name}`, async function () {
        await editorReady(page);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0) .. controls (11,4) and (13,4) .. (14,0);
\end{tikzpicture}`);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const tap = async (point: { x: number; y: number }) => contact === 'touch' ? input.touch([point]) : input.penStroke([point]);
        await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
        await tap(await strokePoint(page, curve, .15));
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
        const pointAt = async (x: number) => {
          const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
          // Anchors are the square handles; round ones are control points.
          const anchors = await frame.locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]').evaluateAll(nodes => nodes.map(node => {
            const box = node.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }).sort((a, b) => a.x - b.x));
          return { x: frameBox.x + anchors[x].x, y: frameBox.y + anchors[x].y };
        };
        await tap(await pointAt(1));
        await expect(frame.getByRole('button', { name: '1 point selected', exact: true })).toBeVisible();
        for (const name of ['Make corner', 'Smooth points', 'Delete points', 'Split here'])
          await expect(frame.getByRole('button', { name, exact: true })).toBeVisible();
        const hint = (await frame.getByTestId('canvas-selection-hint').boundingBox())!;
        const control = (await frame.getByRole('button', { name: 'Make corner', exact: true }).locator('..').boundingBox())!;
        assert.ok(Math.min(hint.x + hint.width, control.x + control.width) <= Math.max(hint.x, control.x) ||
          Math.min(hint.y + hint.height, control.y + control.height) <= Math.max(hint.y, control.y), `The point control covers the canvas hint ${JSON.stringify({ hint, control })}`);
        await storyScreenshot(page, `point-selected-${contact}-${tablet.name}`);
        await expect(frame.getByRole('button', { name: 'Point actions', exact: true })).toHaveCount(0);
        await input.longPress(await pointAt(1));
        await expect(frame.getByRole('menu')).toHaveCount(0);
        await expect(frame.getByRole('button', { name: 'Make corner', exact: true })).toBeVisible();
        const before = (await editorDebug(page)).source;
        await input.touch([await stableCenter(frame.getByRole('button', { name: 'Make corner', exact: true }))]);
        await expect.poll(async () => (await editorDebug(page)).source).not.toBe(before);
        assert.match((await editorDebug(page)).source, /\(6,0\)/);
        await tap(await pointAt(1));
        await input.touch([await stableCenter(frame.getByRole('button', { name: 'Delete points', exact: true }))]);
        await expect.poll(async () => (await editorDebug(page)).source).not.toMatch(/\(6,0\)/);
      });
    }
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `adds a curve point with a finger double tap, as its hint says, in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,0) .. controls (6,8) and (10,8) .. (14,0);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const curve = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(curve).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.touch([await strokePoint(page, curve, .25)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(['path:0']);
      const hint = await frame.locator('body').innerText();
      assert.doesNotMatch(hint, /click/i, 'The canvas hint names a mouse gesture');
      assert.match(hint, /Double-tap the curve to add a point/);
      await input.doubleTap(await strokePoint(page, curve, .5));
      await expect.poll(async () => ((await editorDebug(page)).source.match(/\.\. controls/g) ?? []).length).toBe(2);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `keeps an original stroke as an editable curve whose points are counted in ${tablet.name}`, async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.penStroke(waveAcross(viewport, .45, .4, 120));
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Cancel', exact: true }))]);
      await expect(result).toHaveCount(0);
      const drawn = await frame.locator('svg [data-source-id]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-source-id')))]);
      assert.equal(drawn.length, 1);
      await input.touch([await stableCenter(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.touch([await strokePoint(page, frame.locator(`svg [data-source-id="${drawn[0]}"]`).first(), .5)]);
      const anchors = frame.locator(`rect[data-handle-kind="move-handle"][data-source-id="${drawn[0]}"]`);
      await expect(anchors.first()).toBeVisible();
      const count = await anchors.count();
      await expect(frame.getByText(`${count} points`, { exact: true })).toBeVisible();
      assert.equal(count, ((await editorDebug(page)).source.match(/--|\.\. controls/g) ?? []).length + 1);
    });

    story({ viewport: tablet }, `reaches edit commands by pen from the selection control in ${tablet.name}`, async function () {
      await editorReady(page);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (4,-2) circle (2cm);
\draw (10,-4) rectangle (14,0);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeVisible();
      const input = await TabletInput.attach(page);
      await fitDiagram(frame, input);
      const penTap = async (point: { x: number; y: number }) => input.penStroke([point]);
      await penTap(await stableCenter(frame.getByRole('button', { name: 'Select', exact: true })));
      await penTap(await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), .5));
      await penTap(await stableCenter(frame.getByRole('button', { name: 'Selection actions', exact: true })));
      const menu = frame.getByRole('menu').first();
      for (const name of ['Cut', 'Copy', 'Duplicate', 'Delete']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
      await penTap(await stableCenter(menu.getByRole('menuitem', { name: 'Duplicate', exact: true })));
      await expect.poll(async () => ((await editorDebug(page)).source.match(/circle/g) ?? []).length).toBe(2);
    });
  }

  it('copies the final drawing immediately after switching to rendered view', async function () {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('before drawing'));
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    const canvas = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * .4, canvas.y + canvas.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * .4 + 90, canvas.y + canvas.height / 2 + 25, { steps: 12 });
    const render = (await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).boundingBox())!;
    const copy = (await page.getByRole('button', { name: 'Copy source', exact: true }).boundingBox())!;
    await page.mouse.up();
    // Use the observed button positions: locator stability waits can let the
    // editor's throttled change notification arrive before this rapid sequence.
    await page.mouse.click(render.x + render.width / 2, render.y + render.height / 2);
    await page.mouse.click(copy.x + copy.width / 2, copy.y + copy.height / 2);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('workbench-ink:');
    const authored = String.raw`\begin{tikzpicture}\draw[red] (0,0) rectangle (4,3);\end{tikzpicture}`;
    await page.locator('.cm-content').fill(authored);
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(authored);
  });

  it('copies the completed Quiver edit immediately after switching to rendered view', async function () {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('.cm-content').fill(String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`);
    await page.getByRole('button', { name: 'Quiver: right sidebar', exact: true }).click();
    const frame = page.frameLocator('iframe[title="Quiver diagram editor"]');
    await frame.locator('.vertex').nth(1).click();
    await frame.locator('.label-input').evaluate((input: HTMLInputElement) => {
      input.value = 'ClipboardFinal';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const buttons = [...window.parent.document.querySelectorAll('button')];
      buttons.find(button => button.getAttribute('aria-label') === 'Preview: right sidebar')!.click();
      buttons.find(button => button.textContent?.trim() === 'Copy source')!.click();
    });
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('ClipboardFinal');
    const newer = String.raw`\begin{tikzcd}NewerAuthored \arrow[r] & Source\end{tikzcd}`;
    await page.locator('.cm-content').fill(newer);
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(newer);
  });

  story({ initialPage: "blank" }, 'persists the completed Quiver edit through the embedding owner before delayed change delivery', async function () {
    await page.goto(`${url}quiver-embedding.html`);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('.vertex')).toHaveCount(2, { timeout: 30_000 });
    await frame.locator('.vertex').nth(1).click();
    // Deliver the edit and save gesture in one browser task, before Quiver's
    // 40ms change notification can update the embedding document.
    await frame.locator('.label-input').evaluate((input: HTMLInputElement) => {
      input.value = 'Completed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true }));
    });
    await expect(page.getByLabel('Persisted document')).toContainText('Completed');
    const saved = await page.evaluate(() => localStorage.getItem('embedded-diagram'));
    assert.equal(saved, await page.getByLabel('Host document').inputValue());
    await frame.locator('.label-input').fill('Subsequent');
    await frame.locator('.label-input').press('Control+s');
    await expect(page.getByLabel('Persisted document')).toContainText('Subsequent');
    assert.equal(await page.evaluate(() => localStorage.getItem('embedded-diagram')),
      await page.getByLabel('Host document').inputValue());
    const persisted = await page.evaluate(() => localStorage.getItem('embedded-diagram'));
    await page.getByRole('checkbox', { name: 'Read-only document' }).check();
    await frame.locator('.label-input').fill('Rejected');
    await frame.locator('.label-input').press('Control+s');
    await expect(page.getByLabel('Host error')).toContainText('read-only');
    assert.equal(await page.evaluate(() => localStorage.getItem('embedded-diagram')), persisted);
    assert.equal(await page.getByLabel('Host document').inputValue(), persisted);
    await page.getByRole('checkbox', { name: 'Read-only document' }).uncheck();
    const newer = String.raw`\begin{tikzcd}HostAuthority \arrow[r] & Newer\end{tikzcd}`;
    await page.getByLabel('Host document').evaluate((input: HTMLTextAreaElement, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('iframe')!.contentDocument!.querySelector('.label-input')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true }));
    }, newer);
    await expect(frame.locator('.vertex').first()).toContainText('HostAuthority');
    assert.equal(await page.getByLabel('Host document').inputValue(), newer);
    assert.equal(await page.evaluate(() => localStorage.getItem('embedded-diagram')), persisted);
    await frame.locator('.vertex').nth(1).click();
    await frame.locator('.label-input').fill('Resumed');
    await frame.locator('.label-input').press('Control+s');
    await expect(page.getByLabel('Persisted document')).toContainText('Resumed');
    assert.equal(await page.evaluate(() => localStorage.getItem('embedded-diagram')),
      await page.getByLabel('Host document').inputValue());
  });

  story({ initialPage: "blank" }, 'matches compiled geometry for filled primitives and transformed curves', async function () {
    const examples = [
      String.raw`\begin{tikzpicture}\fill[blue] (0,0) rectangle (3,2);\fill[red] (4,1) circle (.5cm);\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}\begin{scope}[rotate=25]\fill[blue] (0,0) ellipse (2cm and 1cm);\end{scope}\fill[red] (3,1) rectangle (4,2);\end{tikzpicture}`,
    ];
    for (const authored of examples) {
      await page.goto(`${url}embedding.html`);
      await expect(page.locator('#status')).toHaveText('Loaded');
      await page.getByLabel('Authored source').fill(authored);
      await page.getByRole('button', { name: 'Load source', exact: true }).click();
      await expect(page.locator('#status')).toHaveText('Loaded');
      await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
      await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
      const visualSvg = JSON.parse(await page.locator('#result').innerText()).svg as string;
      await page.goto(url);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await editorReady(page);
      await page.locator('.cm-content').fill(authored);
      await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
      await expect(page.locator('.tikz-view-status')).toContainText('Up to date', { timeout: 40000 });
      const compiledUri = await page.locator('.tikz-figure-viewer-source').getAttribute('src');
      assert.ok(compiledUri);
      const difference = await page.evaluate(async ({ visualSvg, compiledUri }) => {
        const masks: number[][] = [];
        const aspectRatios: number[] = [];
        for (const uri of [`data:image/svg+xml;charset=utf-8,${encodeURIComponent(visualSvg)}`, compiledUri]) {
          const image = new Image();
          image.src = uri;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 512;
          const context = canvas.getContext('2d')!;
          const scale = Math.min(512 / image.naturalWidth, 512 / image.naturalHeight);
          context.drawImage(image, 0, 0, image.naturalWidth * scale, image.naturalHeight * scale);
          const pixels = context.getImageData(0, 0, 512, 512).data;
          const mask = Array.from({ length: 512 * 512 }, (_, i) => {
            const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
            return pixels[i * 4 + 3] < 128 ? 0 : r > 150 && g < 80 && b < 80 ? 1 : b > 150 && r < 80 && g < 80 ? 2 : 0;
          });
          const occupied = mask.flatMap((value, i) => value ? [i] : []);
          if (occupied.length === 0) throw new Error('The rendered diagram has no expected coloured geometry');
          let left = 511, right = 0, top = 511, bottom = 0;
          for (const i of occupied) {
            left = Math.min(left, i % 512);
            right = Math.max(right, i % 512);
            top = Math.min(top, Math.floor(i / 512));
            bottom = Math.max(bottom, Math.floor(i / 512));
          }
          aspectRatios.push((right - left) / (bottom - top));
          masks.push(Array.from({ length: 128 * 128 }, (_, i) => {
            const x = Math.round(left + (i % 128) * (right - left) / 127);
            const y = Math.round(top + Math.floor(i / 128) * (bottom - top) / 127);
            return mask[y * 512 + x];
          }));
        }
        const [visual, compiled] = masks;
        return {
          shape: visual.filter((value, i) => value !== compiled[i]).length / visual.length,
          aspect: Math.abs(aspectRatios[0] / aspectRatios[1] - 1),
        };
      }, { visualSvg, compiledUri });
      assert.ok(difference.shape < .03, `Visual and compiled coloured geometry differ at ${difference.shape * 100}% of normalized pixels`);
      assert.ok(difference.aspect < .03, `Visual and compiled aspect ratios differ by ${difference.aspect * 100}%`);
    }
  });

  story({ initialPage: "blank" }, "preserves representative trace geometry through fitting and original restoration", async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    for (const trace of geometryTraces) {
      await page.getByLabel('Authored source').fill(String.raw`\begin{tikzpicture}
% corpus authored comment
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Load source', exact: true }).click();
      const stroke = { key: trace.name, intent: trace.intent ?? 'geometry', color: '#204080',
        samples: trace.points.map(([x, y], i) => ({ x, y, time: i * 8, pressure: .4 + .1 * Math.sin(i) })) };
      await page.getByLabel('Original strokes').fill(JSON.stringify([stroke]));
      await page.getByRole('button', { name: 'Import strokes', exact: true }).click();
      await expect(page.locator('#command-result')).toHaveText('import-ink:ok:');
      await expect(page.getByLabel('Authored source')).toHaveValue(new RegExp(`workbench-ink-end:${trace.name}`));
      const original = await page.getByLabel('Authored source').inputValue();
      await page.getByLabel('Stroke key').fill(trace.name);
      await page.getByRole('button', { name: 'Interpret stroke', exact: true }).click();
      await expect(page.locator('#command-result')).toHaveText(trace.intent === 'ink' ? 'interpret-ink:failed:ink-is-not-geometry' : trace.unchanged ? 'interpret-ink:failed:no-fit' : 'interpret-ink:ok:');
      // Read current bytes through the public source operation before snapshotting.
      await page.getByRole('button', { name: 'Copy current source', exact: true }).click();
      await expect(page.locator('#command-result')).toHaveText('source:ok:');
      await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
      await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
      const accepted = JSON.parse(await page.locator('#result').innerText());
      assert.ok(accepted.source.includes(trace.primitive), trace.name);
      assert.deepEqual(accepted.originalInk[0].stroke, stroke, trace.name);
      if (trace.unchanged) assert.equal(accepted.source, original, trace.name);
      const error = await page.evaluate(({ svg, points, viewBox }) => {
        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden';
        holder.innerHTML = svg;
        document.body.append(holder);
        const root = holder.querySelector('svg')!;
        const inverse = root.getScreenCTM()!.inverse();
        const rendered: { x: number; y: number }[] = [];
        for (const element of root.querySelectorAll<SVGGeometryElement>('path,circle,ellipse,rect,line,polyline,polygon')) {
          if (element.closest('defs')) continue;
          const length = element.getTotalLength();
          const transform = inverse.multiply(element.getScreenCTM()!);
          for (let d = 0; d <= length; d += .4) rendered.push(element.getPointAtLength(d).matrixTransform(transform));
          rendered.push(element.getPointAtLength(length).matrixTransform(transform));
        }
        holder.remove();
        const raw = points.map(([x, y]) => ({ x, y: 2 * viewBox.y + viewBox.height - y }));
        const inputError = Math.max(...raw.map(p => Math.min(...rendered.map(q => Math.hypot(p.x - q.x, p.y - q.y)))));
        const outputError = Math.max(...rendered.map(p => Math.min(...raw.slice(1).map((b, i) => {
          const a = raw[i], dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
        }))));
        return Math.max(inputError, outputError);
      }, { svg: accepted.svg, points: trace.points, viewBox: accepted.viewBox });
      assert.ok(error <= trace.error + .3, `${trace.name}: bidirectional geometric error ${error} exceeds ${trace.error}`);
      await page.getByRole('button', { name: 'Restore stroke', exact: true }).click();
      await expect(page.locator('#command-result')).toHaveText('restore-ink:ok:');
      await expect(page.getByLabel('Authored source')).toHaveValue(original);
    }
  });

  it('rejects a source notification from the right frame but the wrong session', async function () {
    await page.addInitScript(() => {
      window.addEventListener('message', event => {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (message?.event === 'loaded') (window as unknown as { editorLoad: { revision: number } }).editorLoad = message;
      });
    });
    await page.reload();
    await editorReady(page);
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    const authored = await page.locator('.cm-content .cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n'));
    const loaded = await page.evaluate(() => (window as unknown as { editorLoad: { revision: number } }).editorLoad);
    await page.frames()[1].evaluate(({ revision }) => {
      window.parent.postMessage(JSON.stringify({ event: 'change', sessionId: crypto.randomUUID(), revision,
        source: String.raw`\begin{tikzpicture}\draw (0,0) rectangle (3,2);\end{tikzpicture}` }), location.origin);
    }, loaded);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.cm-content .cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n')), authored);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(authored);
    assert.equal(await page.locator('.cm-content .cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n')), authored);
  });

  story({ initialPage: "blank" }, 'starts cold and edits math-labelled geometry without external assets', async function () {
    const external: string[] = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await editorReady(page);
    await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\node at (0,0) {$x^2$};
\draw[blue] (0,0) rectangle (2,1);
\end{tikzpicture}`);
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    await expect(frame.locator('[data-canvas-viewport="true"]')).toBeVisible();
    await expect.poll(() => frame.locator('[data-source-id]').count()).toBeGreaterThan(1);
    await editorReady(page);
    await freehandTool(frame).click();
    await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
    const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(box.x + box.width * .55, box.y + box.height * .3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .55 + 90, box.y + box.height * .3 + 25, { steps: 12 });
    await page.mouse.up();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/workbench-ink:/);
    await expect(frame.locator('[data-source-id]')).not.toHaveCount(0);
    assert.deepEqual(external, []);
  });

  it("keeps authored source when a notification names a load operation", async function () {
    const sourcePane = page.locator(".cm-content");
    await sourcePane.fill(String.raw`\begin{tikzpicture}
\draw (0,0) circle (1cm);
\end{tikzpicture}`);
    await editorReady(page);
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
    const frame = editorFrame(page);
    await frame.getByRole("button", { name: "Properties", exact: true }).click();
    await expect(frame.getByRole("complementary", { name: "Diagram properties" })).toBeVisible();
    await frame.getByRole("button", { name: "Close properties", exact: true }).click();
    await expect(frame.getByRole("complementary", { name: "Diagram properties" })).toHaveCount(0);
    assert.equal(await sourcePane.innerText(), authored);
  });

  story({ initialPage: "blank" }, "keeps the drawing when another frame sends an explicit load command", async function () {
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

  story({ viewport: { width: 768, height: 1024 } }, "opens a tablet canvas and independently toggles source and properties before copying", async function () {
    await editorReady(page);
    const sourcePane = page.locator(".cm-content");
    await expect(sourcePane).toBeHidden();
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    const source = String.raw`\begin{tikzpicture}
% Keep this authored comment.
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;
    await sourcePane.fill(source);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    const frame = editorFrame(page);
    await frame.getByRole("button", { name: "Properties", exact: true }).click();
    await expect(frame.getByRole("complementary", { name: "Diagram properties" })).toBeVisible();
    await page.screenshot({ path: "test-results/workbench/tablet-properties.png" });
    await expect(sourcePane).toBeHidden();
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    assert.equal(await sourcePane.innerText(), source);
    await expect(frame.getByRole("complementary", { name: "Diagram properties" })).toBeVisible();
    await page.screenshot({ path: "test-results/workbench/tablet-both-panels.png" });
    await frame.getByRole("button", { name: "Close properties", exact: true }).click();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const writes: string[] = [];
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    await page.getByRole("button", { name: "Copy source", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
    assert.deepEqual(writes, []);
    await sourcePane.press("Control+z");
    await expect(sourcePane).not.toHaveText(source);
  });

  story({ initialPage: "blank" }, "returns a revision-matched drawing through the mounted embedding surface", async function () {
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
    assert.ok(result.localBounds, "The accepted drawing includes its local placement bounds");
    assert.ok(Math.abs((result.localBounds.maxX - result.localBounds.minX) - 85.358) < 1);
    assert.ok(Math.abs((result.localBounds.maxY - result.localBounds.minY) - 56.906) < 1);
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

  story({ initialPage: "blank" }, 'replies consistently when a completed snapshot request is repeated', async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const accepted = JSON.parse(await page.locator('#result').innerText());
    await page.evaluate(accepted => {
      const editor = document.querySelector<HTMLIFrameElement>('#editor')!;
      const output = document.createElement('pre');
      output.id = 'repeated-result';
      document.querySelector('section')!.append(output);
      window.addEventListener('message', event => {
        if (event.source !== editor.contentWindow || event.origin !== location.origin) return;
        const reply = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (reply.event === 'snapshot' && reply.requestId === accepted.requestId) output.textContent = JSON.stringify(reply);
      });
      editor.contentWindow!.postMessage({ action: 'snapshot', sessionId: accepted.sessionId,
        revision: accepted.revision, requestId: accepted.requestId, source: accepted.source }, location.origin);
    }, accepted);
    await expect(page.locator('#repeated-result')).not.toBeEmpty();
    assert.deepEqual(JSON.parse(await page.locator('#repeated-result').innerText()), accepted);
    await page.getByRole('button', { name: 'Copy current source', exact: true }).click();
    await expect(page.getByLabel('Authored source')).toHaveValue(accepted.source);
  });

  story({ initialPage: "blank" }, "retains the current drawing when an older load arrives from its host", async function () {
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

  story({ initialPage: "blank" }, "keeps exported clipping local to each independently edited diagram", async function () {
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
      const accepted = JSON.parse(await page.locator("#result").innerText());
      assert.equal(accepted.source, source);
      exports.push(accepted.svg);
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

  story({ initialPage: "blank" }, 'imports and restores ink in the selected earlier inline figure and reopens the selected snapshot', async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    const first = String.raw`\begin{tikzpicture}\draw[blue] (0,0) circle (1cm);\end{tikzpicture}`;
    const second = String.raw`\begin{tikzpicture}\fill[red] (0,0) rectangle (3,2);\end{tikzpicture}`;
    const authored = `${first} ${second}`;
    await page.getByLabel('Authored source').fill(authored);
    await page.getByRole('button', { name: 'Load source', exact: true }).click();
    const frame = page.frameLocator('#editor');
    await frame.getByRole('button', { name: 'Figure 2', exact: true }).click();
    const untouched = await hostSnapshot();
    await frame.getByRole('button', { name: 'Figure 1', exact: true }).click();
    const before = await hostSnapshot();
    const stroke = { key: 'earlier-figure-stroke', intent: 'geometry', color: '#00aa00',
      samples: Array.from({length: 16}, (_, i) => ({x: i * 4, y: 8 + Math.sin(i) * .1, time: i * 10, pressure: .4})) };
    await page.getByLabel('Original strokes').fill(JSON.stringify([stroke]));
    await page.getByRole('button', { name: 'Import strokes', exact: true }).click();
    await expect(page.getByLabel('Authored source')).toHaveValue(/earlier-figure-stroke/);
    const imported = await hostSnapshot();
    assert.equal(imported.source.slice(imported.source.indexOf('\\end{tikzpicture}') + '\\end{tikzpicture}'.length), ` ${second}`);
    assert.deepEqual(imported.originalInk.map(entry => entry.stroke), [stroke]);
    assert.equal(imported.state.activeFigureId, before.state.activeFigureId);
    const associated = imported.originalInk[0].sourceIds[0];
    await expect(frame.locator(`path[data-source-id="${associated}"]`).first()).toHaveAttribute('stroke', '#00aa00');
    await page.getByLabel('Stroke key').fill(stroke.key);
    await page.getByRole('button', { name: 'Interpret stroke', exact: true }).click();
    await expect(page.getByLabel('Authored source')).not.toHaveValue(imported.source);
    const fitted = await hostSnapshot();
    assert.equal(fitted.source.slice(fitted.source.indexOf('\\end{tikzpicture}') + '\\end{tikzpicture}'.length), ` ${second}`);
    await frame.locator('[data-canvas-viewport="true"]').press('Control+z');
    await expect(page.getByLabel('Authored source')).toHaveValue(imported.source);
    await frame.locator('[data-canvas-viewport="true"]').press('Control+Shift+z');
    await expect(page.getByLabel('Authored source')).toHaveValue(fitted.source);
    await page.getByRole('button', { name: 'Restore stroke', exact: true }).click();
    await expect(page.getByLabel('Authored source')).toHaveValue(imported.source);
    assert.deepEqual((await hostSnapshot()).originalInk, imported.originalInk);
    await frame.getByRole('button', { name: 'Figure 2', exact: true }).click();
    const later = await hostSnapshot();
    assert.deepEqual(await paintedGeometry(later.svg), await paintedGeometry(untouched.svg));
    assert.deepEqual(later.originalInk, []);
    await page.getByRole('button', { name: 'Restore stroke', exact: true }).click();
    await expect(page.locator('#command-result')).toHaveText('restore-ink:failed:missing-stroke');
    assert.equal(await page.getByLabel('Authored source').inputValue(), imported.source);
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Loaded');
    await page.getByLabel('Saved snapshot').fill(JSON.stringify(later));
    await page.getByRole('button', { name: 'Load snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Loaded');
    const reopened = await hostSnapshot();
    assert.equal(reopened.state.activeFigureId, later.state.activeFigureId);
    assert.equal(reopened.source, later.source);
    assert.deepEqual(await paintedGeometry(reopened.svg), await paintedGeometry(later.svg));
    await page.evaluate(snapshot => {
      document.querySelector<HTMLIFrameElement>('#editor')!.contentWindow!.postMessage({
        action: 'load', sessionId: snapshot.sessionId, revision: snapshot.revision + 1,
        requestId: 'invalid-figure-state', source: snapshot.source,
        state: {...snapshot.state, activeFigureId: 'figure:999'}, fileName: 'fixture.tikz',
      }, location.origin);
    }, reopened);
    await expect(page.locator('#command-result')).toHaveText('load:failed:invalid-command');
    const afterRejectedLoad = await hostSnapshot();
    assert.equal(afterRejectedLoad.source, reopened.source);
    assert.equal(afterRejectedLoad.state.activeFigureId, reopened.state.activeFigureId);
    assert.deepEqual(await paintedGeometry(afterRejectedLoad.svg), await paintedGeometry(reopened.svg));
  });

  story({ initialPage: "blank" }, 'interprets the newly drawn stroke instead of identical drawing text in a later figure', async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    const first = String.raw`\begin{tikzpicture}
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;
    const second = String.raw`\begin{tikzpicture}
\draw[red] (0,0) rectangle (3,2);
\end{tikzpicture}`;
    await page.getByLabel('Authored source').fill(`${first}\n${second}`);
    await page.getByRole('button', { name: 'Load source', exact: true }).click();
    const frame = page.frameLocator('#editor');
    await frame.getByRole('button', { name: 'Figure 1', exact: true }).click();
    await freehandTool(page.frameLocator('#editor')).click();
    const before = await hostSnapshot();
    const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    const draw = async () => {
      await freehandTool(frame).click();
      await page.mouse.move(bounds.x + bounds.width * .35, bounds.y + bounds.height * .6);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * .35 + 110, bounds.y + bounds.height * .6 + 25, {steps: 15});
      await page.mouse.up();
      await frame.getByRole('dialog', {name: 'Freehand result'}).getByRole('button', {name: 'Accept', exact: true}).click();
      // The stroke stays selected; its restore control belongs to the Select tool.
      await frame.getByRole('button', {name: 'Select', exact: true}).click();
      await expect(frame.getByRole('button', {name: 'Restore original stroke', exact: true})).toBeVisible();
    };
    await draw();
    const fittedSource = await page.getByLabel('Authored source').inputValue();
    await frame.getByRole('button', {name: 'Restore original stroke', exact: true}).click();
    await expect(page.getByLabel('Authored source')).not.toHaveValue(fittedSource);
    const raw = await hostSnapshot();
    const originalDrawing = /\\begin\{scope\}\n([\s\S]*?)\n\\end\{scope\}/.exec(raw.source)![1];
    const duplicateFigure = second.replace('\\end{tikzpicture}', `${originalDrawing}\n\\end{tikzpicture}`);
    const duplicateSource = `${first}\n${duplicateFigure}`;
    await page.getByLabel('Saved snapshot').fill(JSON.stringify({...before, source: duplicateSource}));
    await page.getByRole('button', {name: 'Load snapshot', exact: true}).click();
    await expect(page.locator('#status')).toHaveText('Loaded');
    await expect(page.getByLabel('Authored source')).toHaveValue(duplicateSource);
    await frame.getByRole('button', {name: 'Figure 2', exact: true}).click();
    const laterBeforeDraw = await hostSnapshot();
    await page.getByRole('button', {name: 'Load snapshot', exact: true}).click();
    await expect(page.locator('#status')).toHaveText('Loaded');
    await hostSnapshot();
    await draw();
    const fitted = await hostSnapshot();
    assert.equal(fitted.source.slice(fitted.source.indexOf('\\end{tikzpicture}') + '\\end{tikzpicture}'.length), `\n${duplicateFigure}`);
    assert.equal(fitted.originalInk.length, 1);
    assert.notEqual(fitted.originalInk[0].stroke.key, raw.originalInk[0].stroke.key);
    assert.deepEqual(fitted.originalInk[0].stroke.samples.map(({x,y}) => [x,y]), raw.originalInk[0].stroke.samples.map(({x,y}) => [x,y]));
    const fittedDrawing = /\\begin\{scope\}\n([\s\S]*?)\n\\end\{scope\}/.exec(fitted.source)![1];
    assert.notEqual(fittedDrawing, originalDrawing);
    await frame.locator('[data-canvas-viewport="true"]').press('Control+z');
    await expect(page.getByLabel('Authored source')).toHaveValue(fitted.source.replace(fittedDrawing, originalDrawing));
    const restored = await hostSnapshot();
    assert.equal(/\\begin\{scope\}\n([\s\S]*?)\n\\end\{scope\}/.exec(restored.source)![1], originalDrawing);
    assert.deepEqual(restored.originalInk, fitted.originalInk);
    await frame.locator('[data-canvas-viewport="true"]').press('Control+Shift+z');
    await expect(page.getByLabel('Authored source')).toHaveValue(fitted.source);
    await page.getByLabel('Stroke key').fill(fitted.originalInk[0].stroke.key);
    await page.getByRole('button', {name: 'Restore stroke', exact: true}).click();
    await expect(page.getByLabel('Authored source')).toHaveValue(restored.source);
    await frame.getByRole('button', {name: 'Figure 2', exact: true}).click();
    const other = await hostSnapshot();
    assert.deepEqual(other.originalInk, []);
    assert.deepEqual(await paintedGeometry(other.svg), await paintedGeometry(laterBeforeDraw.svg));
  });

  story({ initialPage: "blank" }, "preserves imported stroke channels and outlines after saving and reopening its source", async function () {
    const strokes = [{
      key: "lecture-stroke-1", intent: "geometry", color: "#112233",
      samples: Array.from({ length: 20 }, (_, i) => ({
        x: i * 4, y: 12 + Math.sin(i) * .2, time: i * 8,
        pressure: .3 + i / 40, altitude: 1.1, azimuth: .7, roll: .2,
        hoverHeight: 0, buttons: 1, capabilities: 15, id: i, tool: 0, phase: i === 0 ? 0 : 1, predicted: false,
      })),
      outline: { path: "M0 5L76 5L76 35L0 35Z", fill: "#e02040" },
    }];
    await page.goto(`${url}embedding.html`);
    await expect(page.locator("#status")).toHaveText("Loaded");
    await page.getByLabel("Original strokes").fill(JSON.stringify(strokes));
    await page.getByRole("button", { name: "Import strokes", exact: true }).click();
    await expect(page.getByLabel("Authored source")).toHaveValue(/lecture-stroke-1/);
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const saved = JSON.parse(await page.locator("#result").innerText());
    assert.deepEqual(saved.originalInk.map((entry: { stroke: unknown }) => entry.stroke), strokes);
    async function assertPaintedOutline(svg: string): Promise<void> {
      const paint = await page.evaluate((markup) => {
        const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
        document.body.append(root);
        const path = root.querySelector('path[data-source-id]') as SVGPathElement;
        const box = path.getBBox();
        const matrix = (root as unknown as SVGSVGElement).getCTM()!.inverse().multiply(path.getCTM()!);
        const corners = [new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y + box.height)]
          .map(point => point.matrixTransform(matrix));
        const origin = root.querySelector('circle') as SVGCircleElement;
        const result = { fill: getComputedStyle(path).fill, bounds: corners.map(point => [point.x - origin.cx.baseVal.value, point.y - origin.cy.baseVal.value]),
          interior: path.isPointInFill(new DOMPoint(box.x + box.width / 2, box.y + box.height / 2)) };
        root.remove();
        return result;
      }, svg);
      assert.equal(paint.fill, 'rgb(224, 32, 64)');
      assert.equal(paint.interior, true);
      assert.ok(Math.abs(paint.bounds[0][0]) < .01 && Math.abs(paint.bounds[1][0] - 76) < .01);
      const ys = paint.bounds.map(point => point[1]).sort((a,b) => a-b);
      assert.ok(Math.abs(ys[0] + 35) < .01 && Math.abs(ys[1] + 5) < .01, JSON.stringify(paint));
    }
    await assertPaintedOutline(saved.svg);
    await page.getByLabel("Stroke key").fill(strokes[0].key);
    await page.getByRole("button", { name: "Interpret stroke", exact: true }).click();
    await expect(page.getByLabel("Authored source")).not.toHaveValue(saved.source);
    const fitted = await page.getByLabel("Authored source").inputValue();
    await page.reload();
    await expect(page.locator("#status")).toHaveText("Loaded");
    await page.getByLabel("Authored source").fill(fitted);
    await page.getByRole("button", { name: "Load source", exact: true }).click();
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const reopened = JSON.parse(await page.locator("#result").innerText());
    assert.equal(reopened.source, fitted);
    assert.deepEqual(reopened.originalInk.map((entry: { stroke: unknown }) => entry.stroke), strokes);
    assert.ok(reopened.svg.includes("#112233"));
    await page.getByLabel("Stroke key").fill(strokes[0].key);
    await page.getByRole("button", { name: "Restore stroke", exact: true }).click();
    await expect(page.getByLabel("Authored source")).toHaveValue(saved.source);
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const restored = JSON.parse(await page.locator('#result').innerText());
    await assertPaintedOutline(restored.svg);
    assert.deepEqual(restored.originalInk, saved.originalInk);
    await page.frameLocator("iframe").locator('[data-canvas-viewport="true"]').press("Control+z");
    await expect(page.getByLabel("Authored source")).toHaveValue(fitted);
    const frame = page.frameLocator('#editor');
    await frame.locator('[data-canvas-viewport="true"]').scrollIntoViewIfNeeded();
    await frame.locator('[data-canvas-viewport="true"]').press('v');
    const line = (await frame.locator(`path[data-source-id="${reopened.originalInk[0].sourceIds[0]}"]`).first().boundingBox())!;
    // A horizontal SVG line has a zero-height DOM box, but its painted stroke
    // is hittable. Send the real pointer to its midpoint.
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2);
    const selected = await hostSnapshot();
    assert.equal(selected.state.selection.length, 1);
    await frame.getByRole('button', { name: 'Restore original stroke', exact: true }).click();
    await expect(page.getByLabel('Authored source')).toHaveValue(saved.source);
    await frame.getByRole('button', { name: 'Reapply original fit', exact: true }).click();
    await expect(page.getByLabel('Authored source')).toHaveValue(fitted);
  });

  story({ initialPage: "blank" }, "refits translucent ink the same way from the host and from the canvas", async function () {
    const strokes = [{
      key: "translucent-stroke", intent: "geometry", color: "#11223380",
      samples: Array.from({ length: 20 }, (_, i) => ({
        x: i * 4, y: 12 + Math.sin(i) * .2, time: i * 8,
        pressure: .5, altitude: 1.1, azimuth: .7, roll: .2,
        hoverHeight: 0, buttons: 1, capabilities: 15, id: i, tool: 0, phase: i === 0 ? 0 : 1, predicted: false,
      })),
    }];
    await page.goto(`${url}embedding.html`);
    await expect(page.locator("#status")).toHaveText("Loaded");
    await page.getByLabel("Original strokes").fill(JSON.stringify(strokes));
    await page.getByRole("button", { name: "Import strokes", exact: true }).click();
    await expect(page.getByLabel("Authored source")).toHaveValue(/translucent-stroke/);
    const imported = await page.getByLabel("Authored source").inputValue();
    await page.getByLabel("Stroke key").fill(strokes[0].key);
    await page.getByRole("button", { name: "Interpret stroke", exact: true }).click();
    await expect(page.getByLabel("Authored source")).not.toHaveValue(imported);
    const hostFit = await page.getByLabel("Authored source").inputValue();
    await page.getByRole("button", { name: "Restore stroke", exact: true }).click();
    await expect(page.getByLabel("Authored source")).toHaveValue(imported);
    const frame = page.frameLocator('#editor');
    await frame.locator('[data-canvas-viewport="true"]').scrollIntoViewIfNeeded();
    await frame.locator('[data-canvas-viewport="true"]').press('v');
    const snapshot = await hostSnapshot();
    const line = (await frame.locator(`path[data-source-id="${snapshot.originalInk[0].sourceIds[0]}"]`).first().boundingBox())!;
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2);
    await frame.getByRole('button', { name: 'Reapply original fit', exact: true }).click();
    await expect(page.getByLabel('Authored source'), 'The canvas refit differs from the host refit').toHaveValue(hostFit);
  });

  story({ initialPage: "blank" }, "exports an image resource that renders outside its document while offline", async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator("#status")).toHaveText("Loaded");
    await page.getByLabel("Authored source").fill(String.raw`\begin{tikzpicture}
\node[inner sep=0pt] at (0,0) {\includegraphics[width=4cm]{image-resource.svg}};
\end{tikzpicture}`);
    await page.getByRole("button", { name: "Load source", exact: true }).click();
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    await expect(page.locator("#status")).toHaveText("Snapshot ready", { timeout: 12000 });
    const exported = JSON.parse(await page.locator("#result").innerText());
    await page.goto(`${url}svg-viewer.html`);
    await context.setOffline(true);
    await page.getByLabel("Exported SVG").fill(exported.svg);
    await page.getByRole("button", { name: "Append diagram" }).click();
    const href = await page.locator("figure image").getAttribute("href");
    assert.ok(href?.startsWith("data:image/svg+xml;base64,"), "The export must own the image bytes");
    const loaded = await page.evaluate(async data => {
      const image = new Image(); image.src = data!;
      await image.decode(); return [image.naturalWidth, image.naturalHeight];
    }, href);
    assert.deepEqual(loaded, [120, 60]);
  });

  story({ initialPage: "blank" }, "retains pen samples when the drawing rail fits a stroke", async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator("#status")).toHaveText("Loaded");
    const frame = page.frameLocator('#editor');
    await freehandTool(page.frameLocator('#editor')).click();
    const viewport = frame.locator('[data-canvas-viewport="true"]');
    await viewport.scrollIntoViewIfNeeded();
    const bounds = (await viewport.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = bounds.x + bounds.width * .35, y = bounds.y + bounds.height * .5;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .4, tiltX: 12, tiltY: -8 });
    for (let i = 1; i <= 20; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 6, y: y + Math.sin(i) * 2,
        button: 'left', buttons: 1, pointerType: 'pen', force: .4 + i / 100, tiltX: 12, tiltY: -8 });
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 120, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
    await expect(page.getByLabel('Authored source')).toHaveValue(/workbench-ink:/);
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const snapshot = JSON.parse(await page.locator('#result').innerText());
    assert.equal(snapshot.originalInk.length, 1);
    const samples = snapshot.originalInk[0].stroke.samples;
    assert.ok(samples.length >= 22);
    assert.ok(samples.some((sample: { pressure: number }) => Math.abs(sample.pressure - .5) < .01));
    assert.ok(samples.some((sample: { tiltX: number; tiltY: number }) => sample.tiltX === 12 && sample.tiltY === -8));
  });

  it('lets the author keep handwritten ink outside geometric interpretation', async function () {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const frame = editorFrame(page);
    await frame.getByRole('button', { name: 'Properties', exact: true }).click();
    await frame.getByRole('checkbox', { name: 'Interpret geometry', exact: true }).uncheck();
    await frame.getByRole('button', { name: 'Close properties', exact: true }).click();
    const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    const x = box.x + box.width * .4, y = box.y + box.height * .55;
    await frame.locator('body').evaluate(() => {
      const received: { time: number; pressure: number }[] = [];
      (window as unknown as { receivedPen: typeof received }).receivedPen = received;
      for (const kind of ['pointerdown', 'pointermove', 'pointerup']) {
        window.addEventListener(kind, event => {
          const pointer = event as PointerEvent;
          if (pointer.pointerType !== 'pen') return;
          const coalesced = pointer.getCoalescedEvents();
          for (const sample of coalesced.length ? coalesced : [pointer]) {
            received.push({ time: sample.timeStamp, pressure: sample.pressure });
          }
        }, true);
      }
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x + 35, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .5 });
    for (let i = 1; i <= 40; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 35 * Math.cos(i * Math.PI / 20), y: y + 35 * Math.sin(i * Math.PI / 20), button: 'left', buttons: 1, pointerType: 'pen', force: .5 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 35, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('workbench-ink-end:');
    const source = await page.evaluate(() => navigator.clipboard.readText());
    const record = /% workbench-ink:([^\r\n]+)/.exec(source);
    assert.ok(record);
    const original = JSON.parse(decodeURIComponent(record[1]));
    assert.equal(original.intent, 'ink');
    assert.ok(original.samples.length >= 42);
    const received = await frame.locator('body').evaluate(() =>
      (window as unknown as { receivedPen: { time: number; pressure: number }[] }).receivedPen);
    assert.deepEqual(original.samples.map((sample: { time: number; pressure: number }) =>
      ({ time: sample.time, pressure: sample.pressure })), received,
    'Stored originals retain every delivered pen sample in order');
    assert.equal((source.match(/ circle /g) ?? []).length, 0, 'The handwritten loop must not become a circle');
    await expect(frame.getByRole('dialog', { name: 'Freehand result' })).toHaveCount(0);
    await frame.getByRole('button', { name: 'Properties', exact: true }).click();
    await expect(frame.getByRole('checkbox', { name: 'Interpret geometry', exact: true })).not.toBeChecked();
  });

  story({ initialPage: "blank" }, 'preserves a short pen stroke even when interpretation has no fit', async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    const frame = page.frameLocator('#editor');
    await freehandTool(page.frameLocator('#editor')).click();
    const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    const x = box.x + box.width * .3, y = box.y + box.height * .55;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .5 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 3, y: y + 2, button: 'left', buttons: 1, pointerType: 'pen', force: .6 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 3, y: y + 2, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
    await page.getByRole('button', { name: 'Copy current source', exact: true }).click();
    await expect(page.getByLabel('Authored source')).toHaveValue(/workbench-ink:/);
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const result = JSON.parse(await page.locator('#result').innerText());
    assert.equal(result.originalInk.length, 1);
    assert.ok(result.originalInk[0].stroke.samples.length >= 3);
    assert.ok(result.svg.includes(`data-source-id="${result.originalInk[0].sourceIds[0]}"`));
    await expect(freehandTool(page.frameLocator('#editor'))).toHaveAttribute('aria-pressed', 'true');
  });

  async function embeddingSnapshot(): Promise<EditorSnapshot> {
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    return JSON.parse(await page.locator('#result').innerText());
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet, initialPage: "blank" }, `keeps palm contact out of pen drawing and supports finger pan and pinch afterward in ${tablet.name}`, async function () {
      await page.goto(`${url}embedding.html`);
      await expect(page.locator('#status')).toHaveText('Loaded');
      const frame = page.frameLocator('#editor');
      await freehandTool(frame).click();
      const input = await TabletInput.attach(page);
      const viewport = frame.locator('[data-canvas-viewport="true"]');
      await viewport.scrollIntoViewIfNeeded();
      const box = (await viewport.boundingBox())!;
      const x = box.x + box.width * .3, y = box.y + box.height * .55;
      await input.penDown({ x, y });
      for (let i = 1; i <= 20; i++) {
        if (i === 5) await input.palm({ x: x + 160, y: y + 50 }, 'touchStart');
        if (i === 10) await input.palm({ x: x + 180, y: y + 70 }, 'touchMove');
        await input.penMove({ x: x + i * 5, y });
      }
      await input.palm({ x: x + 180, y: y + 70 }, 'touchEnd');
      await input.penUp({ x: x + 100, y });
      await frame.getByRole('dialog', { name: 'Freehand result' }).getByRole('button', { name: 'Accept', exact: true }).click();
      await expect(frame.getByRole('dialog', { name: 'Freehand result' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Copy current source', exact: true }).click();
      await expect(page.getByLabel('Authored source')).toHaveValue(/workbench-ink:/);
      await fitDiagram(frame, input);
      const drawn = await embeddingSnapshot();
      assert.equal(drawn.originalInk.length, 1);
      assert.ok(drawn.originalInk[0].stroke.samples.length >= 22, 'Palm contact must not replace the pen drag');
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      await input.touch([{ x, y }, { x: x + 55, y: y + 35 }]);
      const panned = await embeddingSnapshot();
      assert.equal(panned.source, drawn.source);
      assert.notDeepEqual(panned.state.viewport, drawn.state.viewport);
      await fitDiagram(frame, input);
      const beforePinch = await embeddingSnapshot();
      await input.pinch({ x: x + 40, y }, 80, 140);
      const pinched = await embeddingSnapshot();
      assert.equal(pinched.source, drawn.source);
      assert.ok(pinched.state.viewport.scale > beforePinch.state.viewport.scale);
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      await storyScreenshot(page, `palm-pan-pinch-${tablet.name}`);
    });
  }

  story({ initialPage: "blank" }, "cancels a resource-pending snapshot and continues with a newer drawing", async function () {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let exporting = false;
    await page.route('**/image-resource.svg', async route => {
      if (route.request().resourceType() === 'fetch') exporting = true;
      await delayed; await route.continue();
    });
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    await page.getByLabel('Authored source').fill(String.raw`\begin{tikzpicture}\node at (0,0) {\includegraphics[width=4cm]{image-resource.svg}};\end{tikzpicture}`);
    await page.getByRole('button', { name: 'Load source', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Loaded', { timeout: 15000 });
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect.poll(() => exporting).toBe(true);
    await expect(page.locator('#status')).toHaveText('Awaiting snapshot');
    await page.getByRole('button', { name: 'Cancel snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot failed');
    assert.equal(JSON.parse(await page.locator('#result').innerText()).error, 'cancelled');
    const next = String.raw`\begin{tikzpicture}\draw[red] (0,0) rectangle (3,2);\end{tikzpicture}`;
    await page.getByLabel('Authored source').fill(next);
    await page.getByRole('button', { name: 'Load source', exact: true }).click();
    release();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const accepted = JSON.parse(await page.locator('#result').innerText());
    assert.equal(accepted.source, next);
    assert.ok(accepted.svg.includes('85.358'));
    assert.ok(!accepted.svg.includes('<image'));
  });

  it('keeps file ownership in the standalone host', async function () {
    await expect(page.frameLocator('iframe[title="TikZ visual editor"]').getByRole('menuitem', { name: 'File', exact: true })).toBeHidden();
    await expect(page.getByRole('group', { name: 'File' })).toBeVisible();
  });

  story({ initialPage: "blank" }, 'restores its accepted tool and viewport in a fresh editor session', async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    const frame = page.frameLocator('#editor');
    await freehandTool(page.frameLocator('#editor')).click();
    const viewport = frame.locator('[data-canvas-viewport="true"]');
    await viewport.scrollIntoViewIfNeeded();
    const box = (await viewport.boundingBox())!;
    const originalScale = await frame.locator('[data-canvas-scale]').getAttribute('data-canvas-scale');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -180);
    await page.keyboard.up('Control');
    await expect(frame.locator('[data-canvas-scale]')).not.toHaveAttribute('data-canvas-scale', originalScale!);
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const saved = JSON.parse(await page.locator('#result').innerText());
    assert.equal(saved.state.tool, 'addFreehand');
    const displayedCircle = frame.locator('[data-canvas-viewport="true"] circle[data-source-id="path:0"]');
    await expect(displayedCircle).toBeVisible();
    const before = await displayedCircle.boundingBox();
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Loaded');
    await page.getByLabel('Saved snapshot').fill(JSON.stringify(saved));
    await page.getByRole('button', { name: 'Load snapshot', exact: true }).click();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const restored = JSON.parse(await page.locator('#result').innerText());
    assert.deepEqual(restored.state, saved.state);
    await expect(freehandTool(page.frameLocator('#editor'))).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await frame.locator('[data-canvas-scale]').getAttribute('data-canvas-scale'), String(saved.state.viewport.scale));
    await expect.poll(async () => {
      const after = await displayedCircle.boundingBox();
      return after && before ? Math.max(...['x', 'y', 'width', 'height'].map(key =>
        Math.abs(after[key as keyof typeof after] - before[key as keyof typeof before]))) : Infinity;
    }).toBeLessThan(1);
  });

  it('copies a just-finished canvas edit before the throttled source notification', async function () {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 3 + 110, box.y + box.height / 2 + 25, { steps: 12 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('workbench-ink:');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('workbench-ink-end:');
    const current = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(current.includes('workbench-ink-end:'));
    // CodeMirror virtualizes long metadata lines; use its full-document copy.
    await page.evaluate(() => navigator.clipboard.writeText('previous clipboard'));
    await page.locator('.cm-content').press('Control+a');
    await page.locator('.cm-content').press('Control+c');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(current);
  });

  for (const width of [1280, 768]) {
    story({ viewport: { width, height: 1024 } }, `edits a Quiver diagram and retains source and selection across views at ${width}px`, async function () {
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const authored = String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`;
      await page.locator('.cm-content').fill(authored);
      await page.getByRole('button', { name: 'Quiver: right sidebar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Quiver: right sidebar', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await editorReady(page);
      await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
      await expect(page.locator('.tikz-view-status')).toContainText('Up to date', { timeout: 30000 });
      assert.equal(await page.locator('.cm-content').innerText(), authored);
      await page.getByRole('button', { name: 'Quiver: right sidebar', exact: true }).click();
      if (width === 768) await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = page.frameLocator('iframe[title="Quiver diagram editor"]');
      await frame.locator('.vertex').nth(1).click();
      await frame.locator('.label-input').fill('C');
      await expect(page.locator('.cm-content')).toContainText('C');
      await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
      await expect(page.locator('.tikz-view-status')).toContainText('Up to date', { timeout: 30000 });
      await page.screenshot({ path: `test-results/workbench/quiver-render-${width}.png` });
      await page.getByRole('button', { name: 'Quiver: right sidebar', exact: true }).click();
      await expect(frame.locator('.label-input')).toHaveValue('C');
      await frame.locator('.label-input').press('Control+z');
      await expect(frame.locator('.vertex').nth(1)).toContainText('B');
    });
  }

  const renderSwitchAuthored = String.raw`\begin{tikzpicture}
% Retain this comment and the authored macro even if the canvas does not interpret it.
\pgfmathsetmacro{\unused}{3+4}
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;

  async function authorAndRender(width: number, height: number): Promise<void> {
    await editorReady(page);
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await page.locator('.cm-content').fill(renderSwitchAuthored);
    await editorReady(page);
    await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
    await expect(page.locator('.tikz-view-status')).toContainText('Up to date', { timeout: 40000 });
    assert.equal(await page.locator('.cm-content').innerText(), renderSwitchAuthored);
    await page.screenshot({ path: `test-results/workbench/rendered-${width}x${height}.png` });
    await page.getByRole('button', { name: 'Canvas: right sidebar', exact: true }).click();
  }

  story({ viewport: { width: 1280, height: 1024 } }, 'retains authored source and its drawing tool through rendered-view switches with a desktop mouse', async function () {
    await authorAndRender(1280, 1024);
    const viewport = editorFrame(page).locator('[data-canvas-viewport="true"]');
    const bounds = (await viewport.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 3, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 3 + 100, bounds.y + bounds.height / 2 + 25, { steps: 16 });
    await page.mouse.up();
    await expect(page.locator('.cm-content')).toContainText('workbench-ink:');
    await viewport.press('Control+z');
    await viewport.press('Control+z');
    await expect.poll(() => page.locator('.cm-content').innerText()).toBe(renderSwitchAuthored);
  });

  for (const tablet of TABLET_VIEWPORTS) {
    story({ viewport: tablet }, `retains authored source and its drawing tool through rendered-view switches by pen in ${tablet.name}`, async function () {
      await authorAndRender(tablet.width, tablet.height);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const before = (await editorDebug(page)).historyIndex;
      await input.penStroke(waveAcross(bounds, .45, .5, 100));
      await frame.getByRole('dialog', { name: 'Freehand result' }).getByRole('button', { name: 'Accept', exact: true }).click();
      await expect(page.locator('.cm-content')).toContainText('workbench-ink:');
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      const strokeEdits = (await editorDebug(page)).historyIndex - before;
      assert.ok(strokeEdits > 0, 'The stroke is an undoable edit');
      for (let i = 0; i < strokeEdits; i++) await frame.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(() => page.locator('.cm-content').innerText()).toBe(renderSwitchAuthored);
    });
  }
});
