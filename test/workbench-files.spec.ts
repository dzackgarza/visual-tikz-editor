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
    const { stdout } = await execute('xdotool', ['search', '--sync', '--onlyvisible', '--class', 'zenity'], { env: desktopEnv, timeout: 10000 });
    const id = stdout.trim().split('\n')[0];
    await execute('xdotool', ['windowfocus', '--sync', id], { env: desktopEnv });
    await execute('import', ['-window', 'root', `test-results/workbench/native-${name}-dialog.png`], { env: desktopEnv });
    await execute('xdotool', ['key', '--clearmodifiers', 'ctrl+l'], { env: desktopEnv });
    await execute('xdotool', ['type', '--clearmodifiers', '--delay', '1', diagramPath], { env: desktopEnv });
    await execute('xdotool', ['key', '--clearmodifiers', 'Return'], { env: desktopEnv });
    if (name === 'open') {
      // GTK resolves the typed path asynchronously before enabling confirmation.
      await expect.poll(async () => {
        const result = await execute('/usr/bin/python3', ['-c', `
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

def confirm(node):
    if node.get_role_name() == 'push button' and node.get_name() == 'OK':
        if node.get_state_set().contains(Atspi.StateType.SENSITIVE):
            return node.do_action(0)
    return any(confirm(node.get_child_at_index(i)) for i in range(node.get_child_count()))

print(confirm(Atspi.get_desktop(0)))
`], { env: desktopEnv, timeout: 10000 });
        return result.stdout.trim();
      }, { timeout: 15000 }).toBe('True');
    }
  }

  before(async function () {
    displayServer = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const display = await new Promise<string>((resolve, reject) => {
      displayServer.once('error', reject);
      displayServer.once('exit', code => reject(new Error(`Display exited: ${code}`)));
      displayServer.stdout!.once('data', data => resolve(`:${String(data).trim()}`));
    });
    desktopEnv = Object.fromEntries(Object.entries({ ...process.env, DISPLAY: display, GDK_BACKEND: "x11", GSK_RENDERER: "cairo" }).filter((entry): entry is [string, string] => entry[1] !== undefined));
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
    await expect(page.getByText('Synced', { exact: true })).toBeVisible();
    await page.locator('.cm-content').fill(authored);
    await page.locator('.file-menu summary').click();
    await page.getByRole('button', { name: 'Save As…', exact: true }).click();
    await chooseFile('save');
    await expect.poll(() => existsSync(diagramPath)).toBe(true);
    assert.equal(await readFile(diagramPath, 'utf8'), authored);
    await expect(page.locator('.tikz-standalone-status')).toHaveText('Saved');
    await page.goto('about:blank');
    process.kill(-server.pid!, 'SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    await startServer();
    await page.goto(url);
    await expect(page.getByText('Synced', { exact: true })).toBeVisible();
    await page.locator('.file-menu summary').click();
    await page.getByRole('button', { name: 'Open…', exact: true }).click();
    await chooseFile('open');
    await expect(page.locator('.document-bar strong')).toHaveText('authored.tikz');
    assert.equal(await page.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n')), authored);
    await expect(page.frameLocator('iframe').locator('path[data-source-id]')).toHaveCount(1);
    await page.locator('.file-menu summary').click();
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Freehand', exact: true }).click();
    const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * .35, bounds.y + bounds.height * .65);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .35 + 100, bounds.y + bounds.height * .65 + 30, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press('Control+s');
    await expect.poll(() => readFile(diagramPath, 'utf8')).toContain('workbench-ink:');
    const edited = await page.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n'));
    assert.equal(await readFile(diagramPath, 'utf8'), edited);
    await expect(page.locator('.tikz-standalone-status')).toHaveText('Saved');
  });
});
