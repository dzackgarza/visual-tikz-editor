import { strict as assert } from "node:assert";
import { chromium, expect, type Browser, type BrowserContext, type FrameLocator, type Page } from "@playwright/test";

import { geometryTraces } from "./geometry-traces";
import { buildWorkbench, editorDebug, editorFrame, startWorkbench, settledCenter, stableCenter, storyScreenshot, strokePoint, TABLET_VIEWPORTS, TabletInput, waveAcross, type Workbench } from "./tablet";
import type { EditorSnapshot } from '../src/host';

const freehandTool = (frame: FrameLocator) => frame.getByRole('button', { name: 'Freehand', exact: true });

describe("standalone workbench host boundary", function () {
  let workbench: Workbench;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let url: string;

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
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    await page.request.post(`${url}api/new`, { data: 'tikzpicture' });
    await page.goto(url);
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
  });

  afterEach(async function () {
    const name = this.currentTest!.title.replace(/[^a-z0-9]+/gi, "-");
    await storyScreenshot(page, name);
    await context.tracing.stop({ path: `test-results/workbench/${name}.zip` });
    await context.close();
    await workbench.stop();
  });

  after(async function () {
    await browser?.close();
  });

  it('keeps authored source through a render error and recovers in the dark tablet workspace', async function () {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
    const valid = String.raw`\begin{tikzpicture}\draw[blue] (0,0) circle (1cm);\end{tikzpicture}`;
    await page.locator('.cm-content').fill(valid);
    await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
    await expect(page.locator('.tikz-standalone-status')).toContainText('Up to date', { timeout: 40000 });
    const invalid = valid.replace('\\draw', '\\thisCommandDoesNotExist\\draw');
    await page.locator('.cm-content').fill(invalid);
    await expect(page.locator('.tikz-compiler-preview-error')).toBeVisible({ timeout: 40000 });
    assert.equal(await page.locator('.cm-content').innerText(), invalid);
    await page.screenshot({ path: 'test-results/workbench/dark-tablet-render-error.png' });
    await page.locator('.cm-content').fill(valid);
    await expect(page.locator('.tikz-standalone-status')).toContainText('Up to date', { timeout: 40000 });
    await expect(page.locator('.tikz-compiler-preview-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Canvas: right sidebar', exact: true }).click();
    await expect(page.frameLocator('iframe[title="TikZ visual editor"]').locator('circle[data-source-id]')).toBeInViewport();
    assert.equal(await page.locator('.cm-content').innerText(), valid);
  });

  for (const tablet of TABLET_VIEWPORTS) {
    it(`reaches zoom, snapping, lattice lock, and canvas aids by touch in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
      await tap(frame.getByRole('button', { name: 'Lock geometry to lattice', exact: true }));
      await tap(frame.getByRole('button', { name: 'Snap to grid', exact: true }));
      await tap(frame.getByRole('button', { name: 'Rulers', exact: true }));
      await tap(frame.getByRole('button', { name: '200%', exact: true }));
      const after = await editorDebug(page);
      assert.equal(after.snapModes.latticeLock, !before.snapModes.latticeLock);
      assert.equal(after.snapModes.grid, !before.snapModes.grid);
      assert.equal(after.canvasAids.rulers, !before.canvasAids.rulers);
      assert.notEqual(after.viewport.scale, before.viewport.scale);
      await expect(frame.getByRole('button', { name: 'Lock geometry to lattice', exact: true })).toHaveAttribute('aria-pressed', String(after.snapModes.latticeLock));
      await expect(frame.getByRole('button', { name: '200%', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    it(`shows every drawing-rail control without scrolling in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
        for (const name of ['Layers', 'Properties', 'Settings', 'Zoom and display', 'Select', 'Lasso', 'Eraser', 'Freehand', 'Insert', 'Bucket', 'Undo', 'Redo'])
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
    it(`names no key in the context menu a long press opens in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
    it(`offers only settings that act in the embedded editor in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const tap = async (locator: ReturnType<typeof frame.getByRole>) => {
        await input.touch([await stableCenter(locator)]);
      };
      await tap(frame.locator('[data-diagram-tools]').getByRole('button', { name: 'Settings', exact: true }));
      const dialog = frame.getByTestId('settings-modal');
      await expect(dialog).toBeVisible();
      assert.deepEqual(await dialog.locator('nav button').allInnerTexts(), ['Canvas', 'Colors']);
      const labels = (await dialog.locator('label[for^="setting-"]').evaluateAll(nodes =>
        nodes.map(node => node.childNodes[0].textContent!.trim())));
      assert.deepEqual(labels, ['Grid Size', 'Grid Opacity', 'Edit Handle Size', 'Zoom Speed', 'Toolbar Position', 'Generated Source Indent']);
      await dialog.getByLabel('Toolbar Position').selectOption('right');
      await expect(frame.locator('[data-diagram-tools]')).toHaveAttribute('data-dock', 'right');
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    it(`selects every element from the empty-canvas long press in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
    it(`inserts, deletes, and opens layers through touch routes in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
      await input.longPress(await strokePoint(page, frame.locator('circle[data-source-id]').first(), .5));
      await input.touch([await center(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Delete', exact: true }))]);
      await expect(frame.locator('circle[data-source-id]')).toHaveCount(0);
      assert.doesNotMatch((await editorDebug(page)).source, /circle/);

      await input.touch([await center(rail.getByRole('button', { name: 'Layers', exact: true }))]);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByText('Layers', { exact: true })).toBeVisible();
      await expect(panel.getByText('Line', { exact: true })).toBeVisible();
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    it(`keeps panels and the freehand result clear of the drawing rail in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
      await input.touch([await center(result.getByRole('button', { name: 'Keep original', exact: true }))]);
      await input.touch([await center(rail.getByRole('button', { name: 'Properties', exact: true }))]);
      const panel = frame.getByRole('complementary', { name: 'Diagram properties', exact: true });
      await expect(panel).toBeVisible();
      assert.equal(await overlap(panel), 0, 'The properties panel covers the rail');
      await storyScreenshot(page, `placement-${tablet.name}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    it(`moves the drawing rail by its grip only and never over the rulers in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
      await expect(rail).toHaveAttribute('data-dock', 'left');
      await clearOfRulers();
      const names = await rail.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
      assert.ok(names.indexOf('Lasso') < 8 && names.indexOf('Eraser') < 8, names.join(', '));
      await drag(await center(rail.getByRole('button', { name: 'Select', exact: true })), { x: viewport.x + viewport.width - 10, y: viewport.y + viewport.height / 2 });
      await expect(rail).toHaveAttribute('data-dock', 'left');
      await drag(await center(rail.getByRole('button', { name: 'Move toolbar', exact: true })), { x: viewport.x + viewport.width - 10, y: viewport.y + viewport.height / 2 });
      await expect(rail).toHaveAttribute('data-dock', 'right');
      await clearOfRulers();
      await drag(await center(rail.getByRole('button', { name: 'Move toolbar', exact: true })), { x: viewport.x + viewport.width / 2, y: viewport.y + 10 });
      await expect(rail).toHaveAttribute('data-dock', 'top');
      await clearOfRulers();
    });

    it(`copies and pastes an element through long presses in ${tablet.name}`, async function () {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (0,0) circle (2cm);\end{tikzpicture}`);
      const frame = editorFrame(page);
      await expect(frame.locator('circle[data-source-id]')).toHaveCount(1);
      const input = await TabletInput.attach(page);
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      await input.touch([await center(frame.getByRole('button', { name: 'Select', exact: true }))]);
      await input.longPress(await strokePoint(page, frame.locator('circle[data-source-id]').first(), .5));
      await input.touch([await center(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Copy', exact: true }))]);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.longPress({ x: viewport.x + viewport.width * .85, y: viewport.y + viewport.height * .2 });
      await input.touch([await center(frame.getByRole('menu').first().getByRole('menuitem', { name: 'Paste', exact: true }))]);
      await expect.poll(async () => ((await editorDebug(page)).source.match(/circle/g) ?? []).length).toBe(2);
    });

    it(`starts a new tikzpicture or tikzcd by touch in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
        await expect(page.locator('.tikz-standalone-status')).toHaveText(`New ${kind} · Synced`);
      }
    });
  }

  it('names no key in the tooltips a hovering pen shows on the drawing rail', async function () {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
    it(`reverses a path from its long-press menu in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
      // Of the line's two ends, press the one the rail does not cover.
      const lineBox = (await line.boundingBox())!;
      const railBox = (await frame.locator('[data-diagram-tools]').boundingBox())!;
      const lowerLeft = { x: lineBox.x + lineBox.width * .1, y: lineBox.y + lineBox.height * .9 };
      const upperRight = { x: lineBox.x + lineBox.width * .9, y: lineBox.y + lineBox.height * .1 };
      await input.longPress(lowerLeft.x > railBox.x + railBox.width ? lowerLeft : upperRight);
      const menu = frame.getByRole('menu').first();
      await input.touch([await center(menu.getByRole('menuitem', { name: /^Path/ }))]);
      await input.touch([await center(frame.getByRole('menuitem', { name: 'Reverse Path', exact: true }))]);
      await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\(4,2\) -- \(-4,-2\)/);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    it(`erases every stroke a pen sweep crosses and nothing else in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (-6,-4) -- (-6,4);
\draw (-2,-4) -- (-2,4);
\draw (6,-4) -- (6,4);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('[data-source-id]')).toHaveCount(3);
      const input = await TabletInput.attach(page);
      const center = async (locator: ReturnType<typeof frame.locator>) => {
        return stableCenter(locator);
      };
      await input.touch([await center(frame.getByRole('button', { name: 'Eraser', exact: true }))]);
      const lines = await frame.locator('[data-source-id]').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { id: node.getAttribute('data-source-id'), x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }));
      const [left, middle] = [...lines].sort((a, b) => a.x - b.x);
      const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
      const y = frameBox.y + left.y;
      await input.penStroke(Array.from({ length: 12 }, (_, i) => ({ x: frameBox.x + left.x - 20 + i * (middle.x - left.x + 40) / 11, y })));
      await expect.poll(async () => (await editorDebug(page)).source).toBe(String.raw`\begin{tikzpicture}
\draw (6,-4) -- (6,4);
\end{tikzpicture}`);
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    it(`shows a tapped element's source in the code pane, even one opened afterward, in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
    it(`places a selected curve's control outside the curve and clear of the rail in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}\draw (-6,-3) .. controls (-2,4) and (2,-4) .. (6,3);\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const curve = frame.locator('[data-source-id]').first();
      await expect(curve).toBeVisible();
      const input = await TabletInput.attach(page);
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
      it(`highlights, locks, and keeps a curve selected by ${contact} in ${tablet.name}`, async function () {
        await page.setViewportSize({ width: tablet.width, height: tablet.height });
        await page.reload();
        await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,-2) .. controls (5,6) and (9,-6) .. (12,2);
\draw (4,10) -- (10,12);
\end{tikzpicture}`);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeVisible();
        const input = await TabletInput.attach(page);
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
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await tap({ x: viewport.x + viewport.width - 20, y: viewport.y + viewport.height - 20 });
        await tap(await settledCenter(frame.locator('svg [data-source-id="path:1"]').first()));
        assert.deepEqual((await editorDebug(page)).selection, ['path:0'], 'A locked curve stays selected');
        const anchor = frame.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]').first();
        await tap(await settledCenter(anchor));
        await expect.poll(async () => (await editorDebug(page)).handle).not.toBeNull();
        assert.deepEqual((await editorDebug(page)).selection, ['path:0']);
        const before = (await editorDebug(page)).viewport;
        await input.touch([{ x: viewport.x + viewport.width - 40, y: viewport.y + viewport.height - 60 }, { x: viewport.x + viewport.width - 90, y: viewport.y + viewport.height - 100 }]);
        assert.notDeepEqual((await editorDebug(page)).viewport, before, 'Finger pan still works on a locked curve');
        assert.deepEqual((await editorDebug(page)).selection, ['path:0']);
        await input.touch([await centerOf(lock)]);
        await expect(lock).toHaveAttribute('aria-pressed', 'false');
        await tap({ x: viewport.x + viewport.width - 20, y: viewport.y + viewport.height - 20 });
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
      });
    }
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ['touch', 'pen'] as const) {
      it(`deletes a chosen subset of a curve's points by ${contact} in ${tablet.name}`, async function () {
        await page.setViewportSize({ width: tablet.width, height: tablet.height });
        await page.reload();
        await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0) .. controls (11,4) and (13,4) .. (14,0) .. controls (15,-4) and (17,-4) .. (18,0);
\end{tikzpicture}`);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
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
    it(`starts with the origin visible and clear of the rail, before and after the code pane opens, in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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
        assert.ok(label.x > railBox.x + railBox.width, `origin ${moment} is under the rail`);
      }
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ['touch', 'pen'] as const) {
      it(`edits a curve point from the curve's own control by ${contact} in ${tablet.name}`, async function () {
        await page.setViewportSize({ width: tablet.width, height: tablet.height });
        await page.reload();
        await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0) .. controls (11,4) and (13,4) .. (14,0);
\end{tikzpicture}`);
        await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
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
    it(`adds a curve point with a finger double tap, as its hint says, in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (2,0) .. controls (6,8) and (10,8) .. (14,0);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      const curve = frame.locator('svg [data-source-id="path:0"]').first();
      await expect(curve).toBeVisible();
      const input = await TabletInput.attach(page);
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
    it(`keeps an original stroke as an editable curve whose points are counted in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await input.penStroke(waveAcross(viewport, .45, .4, 120));
      const result = frame.getByRole('dialog', { name: 'Freehand result' });
      await input.touch([await stableCenter(result.getByRole('button', { name: 'Keep original', exact: true }))]);
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

    it(`reaches edit commands by pen from the selection control in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
      await page.reload();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\draw (4,-2) circle (2cm);
\draw (10,-4) rectangle (14,0);
\end{tikzpicture}`);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = editorFrame(page);
      await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeVisible();
      const input = await TabletInput.attach(page);
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

  it('persists the completed Quiver edit through the embedding owner before delayed change delivery', async function () {
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

  it('matches compiled geometry for filled primitives and transformed curves', async function () {
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
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
      await page.locator('.cm-content').fill(authored);
      await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Up to date', { timeout: 40000 });
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

  it("preserves representative trace geometry through fitting and original restoration", async function () {
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
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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

  it('starts cold and edits math-labelled geometry without external assets', async function () {
    await context.tracing.stop();
    await context.close();
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const external: string[] = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    page = await context.newPage();
    await page.goto(url);
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
    await page.locator('.cm-content').fill(String.raw`\begin{tikzpicture}
\node at (0,0) {$x^2$};
\draw[blue] (0,0) rectangle (2,1);
\end{tikzpicture}`);
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    await expect(frame.locator('[data-canvas-viewport="true"]')).toBeVisible();
    await expect.poll(() => frame.locator('[data-source-id]').count()).toBeGreaterThan(1);
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced');
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
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', );
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
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
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

  it('replies consistently when a completed snapshot request is repeated', async function () {
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

  it('imports and restores ink in the selected earlier inline figure and reopens the selected snapshot', async function () {
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

  it('interprets the newly drawn stroke instead of identical drawing text in a later figure', async function () {
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
      await page.mouse.move(bounds.x + bounds.width * .35, bounds.y + bounds.height * .6);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * .35 + 110, bounds.y + bounds.height * .6 + 25, {steps: 15});
      await page.mouse.up();
      await frame.getByRole('dialog', {name: 'Freehand result'}).getByRole('button', {name: 'Apply simplification', exact: true}).click();
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

  it("preserves imported stroke channels and outlines after saving and reopening its source", async function () {
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

  it("exports an image resource that renders outside its document while offline", async function () {
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

  it("retains pen samples when the drawing rail fits a stroke", async function () {
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

  it('preserves a short pen stroke even when interpretation has no fit', async function () {
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
    it(`keeps palm contact out of pen drawing and supports finger pan and pinch afterward in ${tablet.name}`, async function () {
      await page.setViewportSize({ width: tablet.width, height: tablet.height });
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
      await frame.getByRole('dialog', { name: 'Freehand result' }).getByRole('button', { name: 'Apply simplification', exact: true }).click();
      await expect(frame.getByRole('dialog', { name: 'Freehand result' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Copy current source', exact: true }).click();
      await expect(page.getByLabel('Authored source')).toHaveValue(/workbench-ink:/);
      const drawn = await embeddingSnapshot();
      assert.equal(drawn.originalInk.length, 1);
      assert.ok(drawn.originalInk[0].stroke.samples.length >= 22, 'Palm contact must not replace the pen drag');
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      await input.touch([{ x, y }, { x: x + 55, y: y + 35 }]);
      const panned = await embeddingSnapshot();
      assert.equal(panned.source, drawn.source);
      assert.notDeepEqual(panned.state.viewport, drawn.state.viewport);
      await input.pinch({ x: x + 40, y }, 80, 140);
      const pinched = await embeddingSnapshot();
      assert.equal(pinched.source, drawn.source);
      assert.ok(pinched.state.viewport.scale > panned.state.viewport.scale);
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      await storyScreenshot(page, `palm-pan-pinch-${tablet.name}`);
    });
  }

  it("cancels a resource-pending snapshot and continues with a newer drawing", async function () {
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

  it('restores its accepted tool and viewport in a fresh editor session', async function () {
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
    it(`edits a Quiver diagram and retains source and selection across views at ${width}px`, async function () {
      await page.setViewportSize({ width, height: 1024 });
      await page.reload();
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const authored = String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`;
      await page.locator('.cm-content').fill(authored);
      await page.getByRole('button', { name: 'Quiver: right sidebar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Quiver: right sidebar', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced');
      await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Up to date', { timeout: 30000 });
      assert.equal(await page.locator('.cm-content').innerText(), authored);
      await page.getByRole('button', { name: 'Quiver: right sidebar', exact: true }).click();
      if (width === 768) await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const frame = page.frameLocator('iframe[title="Quiver diagram editor"]');
      await frame.locator('.vertex').nth(1).click();
      await frame.locator('.label-input').fill('C');
      await expect(page.locator('.cm-content')).toContainText('C');
      await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
      await expect(page.locator('.tikz-standalone-status')).toContainText('Up to date', { timeout: 30000 });
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
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await page.locator('.cm-content').fill(renderSwitchAuthored);
    await expect(page.locator('.tikz-standalone-status')).toContainText('Synced');
    await page.getByRole('button', { name: 'Preview: right sidebar', exact: true }).click();
    await expect(page.locator('.tikz-standalone-status')).toContainText('Up to date', { timeout: 40000 });
    assert.equal(await page.locator('.cm-content').innerText(), renderSwitchAuthored);
    await page.screenshot({ path: `test-results/workbench/rendered-${width}x${height}.png` });
    await page.getByRole('button', { name: 'Canvas: right sidebar', exact: true }).click();
  }

  it('retains authored source and its drawing tool through rendered-view switches with a desktop mouse', async function () {
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
    it(`retains authored source and its drawing tool through rendered-view switches by pen in ${tablet.name}`, async function () {
      await authorAndRender(tablet.width, tablet.height);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const before = (await editorDebug(page)).historyIndex;
      await input.penStroke(waveAcross(bounds, .45, .5, 100));
      await frame.getByRole('dialog', { name: 'Freehand result' }).getByRole('button', { name: 'Apply simplification', exact: true }).click();
      await expect(page.locator('.cm-content')).toContainText('workbench-ink:');
      await expect(freehandTool(frame)).toHaveAttribute('aria-pressed', 'true');
      const strokeEdits = (await editorDebug(page)).historyIndex - before;
      assert.ok(strokeEdits > 0, 'The stroke is an undoable edit');
      for (let i = 0; i < strokeEdits; i++) await frame.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(() => page.locator('.cm-content').innerText()).toBe(renderSwitchAuthored);
    });
  }
});
