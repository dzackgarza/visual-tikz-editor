import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { geometryTraces } from "./geometry-traces";

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
      await expect(page.locator('#command-result')).toHaveText(trace.intent === 'ink' ? 'interpret-ink:failed:ink-is-not-geometry' : 'interpret-ink:ok:');
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
        const distance = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
          const dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
        };
        const outputError = Math.max(...rendered.map(p => Math.min(...raw.slice(1).map((b, i) => distance(p, raw[i], b)))));
        return Math.max(inputError, outputError);
      }, { svg: accepted.svg, points: trace.points, viewBox: accepted.viewBox });
      assert.ok(error <= trace.error + .3, `${trace.name}: bidirectional geometric error ${error} exceeds ${trace.error}`);
      await page.getByRole('button', { name: 'Restore stroke', exact: true }).click();
      await expect(page.locator('#command-result')).toHaveText('restore-ink:ok:');
      await expect(page.getByLabel('Authored source')).toHaveValue(original);
    }
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

  it("preserves imported stroke channels and outlines after saving and reopening its source", async function () {
    const strokes = [{
      key: "lecture-stroke-1", intent: "geometry", color: "#112233",
      samples: Array.from({ length: 20 }, (_, i) => ({
        x: i * 4, y: 12 + Math.sin(i) * .2, time: i * 8,
        pressure: .3 + i / 40, altitude: 1.1, azimuth: .7, roll: .2,
        hoverHeight: 0, buttons: 1, capabilities: 15, id: i, tool: 0, phase: i === 0 ? 0 : 1, predicted: false,
      })),
      outline: { path: "M0 11L76 11L76 13L0 13Z", fill: "#112233" },
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
    assert.deepEqual(reopened.originalInk, saved.originalInk);
    assert.ok(reopened.svg.includes("#112233"));
    await page.getByLabel("Stroke key").fill(strokes[0].key);
    await page.getByRole("button", { name: "Restore stroke", exact: true }).click();
    await expect(page.getByLabel("Authored source")).toHaveValue(saved.source);
    await page.frameLocator("iframe").locator('[data-canvas-viewport="true"]').press("Control+z");
    await expect(page.getByLabel("Authored source")).toHaveValue(fitted);
    const frame = page.frameLocator('#editor');
    await frame.locator('[data-canvas-viewport="true"]').scrollIntoViewIfNeeded();
    const line = (await frame.locator(`path[data-source-id="${reopened.originalInk[0].sourceIds[0]}"]`).first().boundingBox())!;
    // A horizontal SVG line has a zero-height DOM box, but its painted stroke
    // is hittable. Send the real pointer to its midpoint.
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2);
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const selected = JSON.parse(await page.locator('#result').innerText());
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
    await frame.getByRole('button', { name: 'Freehand', exact: true }).click();
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

  it("cancels a resource-pending snapshot and continues with a newer drawing", async function () {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/image-resource.svg', async route => { await delayed; await route.continue(); });
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    await page.getByLabel('Authored source').fill(String.raw`\begin{tikzpicture}\node at (0,0) {\includegraphics{image-resource.svg}};\end{tikzpicture}`);
    await page.getByRole('button', { name: 'Load source', exact: true }).click();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
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

  it('offers only supported views and keeps file ownership in the standalone host', async function () {
    await expect(page.getByRole('button', { name: 'Quiver canvas', exact: true })).toHaveCount(0);
    await expect(page.frameLocator('iframe').getByRole('menuitem', { name: 'File', exact: true })).toBeHidden();
    await expect(page.locator('.file-menu summary')).toBeVisible();
  });

  it('restores its accepted tool and viewport in a fresh editor session', async function () {
    await page.goto(`${url}embedding.html`);
    await expect(page.locator('#status')).toHaveText('Loaded');
    const frame = page.frameLocator('#editor');
    await frame.getByRole('button', { name: 'Freehand', exact: true }).click();
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
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Loaded');
    await page.getByLabel('Saved snapshot').fill(JSON.stringify(saved));
    await page.getByRole('button', { name: 'Load snapshot', exact: true }).click();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Snapshot ready', { timeout: 12000 });
    const restored = JSON.parse(await page.locator('#result').innerText());
    assert.deepEqual(restored.state, saved.state);
    await expect(frame.getByRole('button', { name: 'Freehand', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await frame.locator('[data-canvas-scale]').getAttribute('data-canvas-scale'), String(saved.state.viewport.scale));
  });

  it('copies a just-finished canvas edit before the throttled source notification', async function () {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Freehand', exact: true }).click();
    const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 3 + 110, box.y + box.height / 2 + 25, { steps: 12 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('workbench-ink:');
    const current = await page.locator('.cm-content .cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n'));
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(current);
  });

  for (const width of [1280, 768]) {
    it(`retains authored source and its drawing tool through rendered-view switches at ${width}px`, async function () {
      await page.setViewportSize({ width, height: 1024 });
      await page.reload();
      await expect(page.getByText('Synced', { exact: true })).toBeVisible();
      if (width === 768) await page.getByRole('button', { name: 'Source', exact: true }).click();
      const authored = String.raw`\begin{tikzpicture}
% Retain this comment and the authored macro even if the canvas does not interpret it.
\pgfmathsetmacro{\unused}{3+4}
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;
      const sourcePane = page.locator('.cm-content');
      await sourcePane.fill(authored);
      await expect(page.getByText('Synced', { exact: true })).toBeVisible();
      const frame = page.frameLocator('iframe');
      await frame.getByRole('button', { name: 'Freehand', exact: true }).click();
      await expect(frame.getByRole('button', { name: 'Freehand', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'TeX render', exact: true }).click();
      await expect(page.getByText('Up to date', { exact: true })).toBeVisible({ timeout: 40000 });
      assert.equal(await sourcePane.innerText(), authored);
      await page.screenshot({ path: `test-results/workbench/rendered-${width}.png` });
      await page.getByRole('button', { name: 'Drawing canvas', exact: true }).click();
      await expect(frame.getByRole('button', { name: 'Freehand', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const viewport = frame.locator('[data-canvas-viewport="true"]');
      const bounds = (await viewport.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 3, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 3 + 100, bounds.y + bounds.height / 2 + 25, { steps: 16 });
      await page.mouse.up();
      await expect(sourcePane).toContainText('workbench-ink:');
      await viewport.press('Control+z');
      await viewport.press('Control+z');
      await expect.poll(() => sourcePane.innerText()).toBe(authored);
    });
  }
});
