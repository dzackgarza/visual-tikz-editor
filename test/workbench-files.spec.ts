import { strict as assert } from 'node:assert';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect, type Browser, type Page } from '@playwright/test';

const execute = promisify(execFile);

describe('standalone native file workflow', function () {
  let displayServer: ChildProcess;
  let sessionBus: ChildProcess;
  let server: ChildProcess;
  let browser: Browser;
  let page: Page;
  let desktopEnv: Record<string, string>;
  let diagramPath: string;
  let url: string;

  async function startServer(): Promise<void> {
    server = spawn('just', ['run'], { env: desktopEnv, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
    url = await new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Standalone server exited: ${code}`)));
      server.stdout!.on('data', chunk => {
        const match = /TikZ workbench: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(chunk));
        if (match) resolve(match[1]);
      });
    });
  }

  async function chooseFile(name: string): Promise<void> {
    const { stdout } = await execute('xdotool', ['search', '--sync', '--onlyvisible', '--class', 'xdg-desktop-portal-gtk'], { env: desktopEnv, timeout: 10000 });
    const id = stdout.trim().split('\n').at(-1)!;
    await execute('xdotool', ['windowfocus', '--sync', id], { env: desktopEnv });
    await execute('import', ['-window', 'root', `test-results/workbench/native-${name}-dialog.png`], { env: desktopEnv });
    await execute('xdotool', ['key', '--clearmodifiers', 'ctrl+l'], { env: desktopEnv });
    await execute('xdotool', ['key', '--clearmodifiers', 'ctrl+a'], { env: desktopEnv });
    await execute('xdotool', ['type', '--clearmodifiers', '--delay', '1', diagramPath], { env: desktopEnv });
    await execute('xdotool', ['key', '--clearmodifiers', 'Return'], { env: desktopEnv });
    if (name === 'open') {
      await new Promise(resolve => setTimeout(resolve, 300));
      await execute('xdotool', ['key', '--clearmodifiers', 'Return'], { env: desktopEnv });
    }
  }

  before(async function () {
    displayServer = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const display = await new Promise<string>((resolve, reject) => {
      displayServer.once('error', reject);
      displayServer.once('exit', code => reject(new Error(`Display exited: ${code}`)));
      displayServer.stdout!.once('data', data => resolve(`:${String(data).trim()}`));
    });
    desktopEnv = Object.fromEntries(Object.entries({ ...process.env, DISPLAY: display, GDK_BACKEND: "x11", GSK_RENDERER: "cairo", GTK_USE_PORTAL: "0" }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    sessionBus = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { env: desktopEnv, stdio: ['ignore', 'pipe', 'inherit'] });
    desktopEnv.DBUS_SESSION_BUS_ADDRESS = await new Promise<string>((resolve, reject) => {
      sessionBus.once('error', reject);
      sessionBus.stdout!.once('data', data => resolve(String(data).trim()));
    });
    diagramPath = join(await mkdtemp(join(tmpdir(), 'workbench-native-')), 'authored.tikz');
    await mkdir('test-results/workbench', { recursive: true });
    await startServer();
    browser = await chromium.launch({ headless: false, env: desktopEnv });
    page = await browser.newPage();
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  });

  after(async function () {
    if (page) {
      await execute('import', ['-window', 'root', 'test-results/workbench/native-final.png'], { env: desktopEnv });
      await page.context().tracing.stop({ path: 'test-results/workbench/native-files.zip' });
    }
    await browser?.close();
    if (server?.pid) process.kill(-server.pid, 'SIGTERM');
    sessionBus?.kill('SIGTERM');
    displayServer?.kill('SIGTERM');
  });

  it('saves through the native chooser and reopens exact authored bytes after restarting', async function () {
    const authored = String.raw`\begin{tikzpicture}
% source survives a real native save and process restart
\draw[blue] (0,0) rectangle (3,2);
\end{tikzpicture}`;
    await page.goto(url);
    await page.getByRole('button', { name: 'TikZ picture', exact: true }).click();
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30_000 });
    await page.locator('.cm-content').fill(authored);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Save As…', exact: true }).click();
    await chooseFile('save');
    await expect.poll(() => existsSync(diagramPath)).toBe(true);
    assert.equal(await readFile(diagramPath, 'utf8'), authored);
    await expect(page.locator('.tikz-standalone-status')).toContainText('Saved');
    await page.goto('about:blank');
    process.kill(-server.pid!, 'SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    await startServer();
    await page.goto(url);
    await expect(page.getByRole('button', { name: 'Open existing…', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Open existing…', exact: true }).click();
    await chooseFile('open');
    await expect(page.locator('.document-bar strong')).toHaveText('authored.tikz');
    await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
    assert.equal(await page.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n')), authored);
    await expect(page.frameLocator('iframe[title="TikZ visual editor"]').locator('path[data-source-id]')).toHaveCount(1);
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * .35, bounds.y + bounds.height * .65);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .35 + 100, bounds.y + bounds.height * .65 + 30, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press('Control+s');
    await expect.poll(() => readFile(diagramPath, 'utf8')).toContain('workbench-ink:');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    const edited = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(await readFile(diagramPath, 'utf8'), edited);
    await expect(page.locator('.tikz-standalone-status')).toContainText('Saved');
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open…', exact: true }).click();
    const dialog = await execute('xdotool', ['search', '--sync', '--onlyvisible', '--class', 'xdg-desktop-portal-gtk'], { env: desktopEnv, timeout: 10000 });
    await execute('xdotool', ['windowfocus', '--sync', dialog.stdout.trim().split('\n').at(-1)!], { env: desktopEnv });
    const cancelled = page.waitForResponse(response => response.url().endsWith('/api/open'));
    await execute('xdotool', ['key', '--clearmodifiers', 'Escape'], { env: desktopEnv });
    assert.equal((await cancelled).status(), 204);
    await expect(page.locator('.tikz-standalone-status')).toContainText('Saved');
    assert.equal(await readFile(diagramPath, 'utf8'), edited);
    await page.locator('.cm-content').fill(String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`);
    await page.getByRole('button', { name: 'Quiver: right sidebar', exact: true }).click();
    const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]');
    await quiver.locator('.vertex').nth(1).click();
    await quiver.locator('.label-input').fill('C');
    await quiver.locator('.label-input').press('Control+s');
    await expect.poll(() => readFile(diagramPath, 'utf8')).toMatch(/\\begin\{tikzcd\}[\s\S]*\bC\b/);
    await page.getByRole('button', { name: 'Copy source', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(await readFile(diagramPath, 'utf8'));
  });
  it('saves completed canvas and Quiver edits after an immediate rendered-view switch', async function () {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    for (const provider of ['visual', 'quiver']) {
      await page.request.post(`${url}api/new`, { data: provider === 'visual' ? 'tikzpicture' : 'tikzcd' });
      await page.goto(url);
      await page.getByRole('button', { name: 'Code: left sidebar', exact: true }).click();
      const authored = provider === 'visual'
        ? String.raw`\begin{tikzpicture}\draw (0,0) -- (2,1);\end{tikzpicture}`
        : String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`;
      await page.locator('.cm-content').fill(authored);
      const frame = page.frameLocator(provider === 'visual' ? 'iframe[title="TikZ visual editor"]' : 'iframe[title="Quiver diagram editor"]');
      await expect(page.locator('.tikz-standalone-status')).toContainText('Synced', );
      diagramPath = join(await mkdtemp(join(tmpdir(), 'workbench-render-save-')), `${provider}.tikz`);
      if (provider === 'visual') {
        const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width * .35, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * .35 + 100, bounds.y + bounds.height / 2 + 25, { steps: 12 });
        await page.mouse.up();
        await page.evaluate(() => {
          const buttons = [...document.querySelectorAll('button')];
          buttons.find(button => button.getAttribute('aria-label') === 'Preview: right sidebar')!.click();
          buttons.find(button => button.textContent?.trim() === 'File')!.click();
        });
      } else {
        await frame.locator('.vertex').nth(1).click();
        await frame.locator('.label-input').evaluate((input: HTMLInputElement) => {
          input.value = 'Completed';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const buttons = [...window.parent.document.querySelectorAll('button')];
          buttons.find(button => button.getAttribute('aria-label') === 'Preview: right sidebar')!.click();
          buttons.find(button => button.textContent?.trim() === 'File')!.click();
        });
      }
      await page.getByRole('menuitem', { name: 'Save As…', exact: true }).click();
      await chooseFile('save');
      await expect.poll(() => existsSync(diagramPath)).toBe(true);
      const browserWindow = await execute('xdotool', ['search', '--onlyvisible', '--class', 'chromium'], { env: desktopEnv });
      await execute('xdotool', ['windowfocus', '--sync', browserWindow.stdout.trim().split('\n')[0]], { env: desktopEnv });
      await page.bringToFront();
      await page.locator('.document-bar strong').click();
      const saved = await readFile(diagramPath, 'utf8');
      assert.match(saved, provider === 'visual' ? /workbench-ink:/ : /Completed/);

      const later = authored.replace(provider === 'visual' ? '(2,1)' : 'B', provider === 'visual' ? '(8,6)' : 'HostAuthored');
      await page.locator('.cm-content').fill(later);
      await page.getByRole('button', { name: 'Copy source', exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(later);
      await page.keyboard.press('Control+s');
      await expect.poll(() => readFile(diagramPath, 'utf8')).toBe(later);
    }
  });

});
