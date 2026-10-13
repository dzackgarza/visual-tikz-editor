import { strict as assert } from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, expect, type Browser } from '@playwright/test';

describe('hosted workbench', function () {
  let server: ChildProcess;
  let browser: Browser;
  let url: string;

  before(async function () {
    server = spawn('just', ['run'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
    url = await new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Workbench exited: ${code}`)));
      server.stdout!.on('data', chunk => {
        const match = /TikZ workbench: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(chunk));
        if (match !== null) resolve(match[1]);
      });
    });
    browser = await chromium.launch();
  });

  after(async function () {
    await browser?.close();
    if (server?.pid !== undefined) process.kill(-server.pid, 'SIGTERM');
  });

  it('returns a completed drawing to its embedding document', async function () {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(url);
    await page.evaluate(() => {
      document.body.innerHTML = '<iframe title="Hosted figure" style="width:100%;height:750px" src="/hosted.html"></iframe>';
      (window as typeof window & { editorMessages: unknown[] }).editorMessages = [];
      window.addEventListener('message', event => {
        if (event.source === document.querySelector('iframe')?.contentWindow && event.origin === location.origin) {
          (window as typeof window & { editorMessages: unknown[] }).editorMessages.push(JSON.parse(event.data));
        }
      });
    });
    const hosted = page.frameLocator('iframe[title="Hosted figure"]');
    await expect(hosted.getByText('Loading figure…')).toBeVisible();
    const sessionId = crypto.randomUUID();
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
    await page.evaluate(({ sessionId, source }) => {
      document.querySelector('iframe')!.contentWindow!.postMessage(JSON.stringify({
        action: 'load', sessionId, revision: 1, requestId: crypto.randomUUID(),
        source, fileName: 'figure.tikz', autosave: 0,
      }), location.origin);
    }, { sessionId, source });
    await expect(hosted.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();
    const canvas = hosted.frameLocator('iframe[title="TikZ visual editor"]');
    await expect(canvas.locator('[data-source-id]').first()).toBeVisible();
    await hosted.getByRole('button', { name: 'Draw', exact: true }).click();
    const box = (await canvas.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(box.x + box.width * .4, box.y + box.height * .45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * .55, { steps: 12 });
    await page.mouse.up();
    await page.evaluate(sessionId => document.querySelector('iframe')!.contentWindow!.postMessage(JSON.stringify({
      action: 'source', sessionId, revision: 1, requestId: 'completed-drawing',
    }), location.origin), sessionId);
    await expect.poll(() => page.evaluate(() => (window as typeof window & { editorMessages: Array<{ requestId?: string }> })
      .editorMessages.find(message => message.requestId === 'completed-drawing'))).toBeDefined();
    const reply = await page.evaluate(() => (window as typeof window & { editorMessages: Array<{ requestId?: string; source?: string; paperSource?: string }> })
      .editorMessages.find(message => message.requestId === 'completed-drawing'));
    assert.match(reply!.source!, /workbench-ink:/);
    assert.doesNotMatch(reply!.paperSource!, /workbench-ink:/);
    assert.match(reply!.paperSource!, /\\draw/);
    await mkdir('test-results/workbench', { recursive: true });
    await page.screenshot({ path: 'test-results/workbench/hosted-drawing.png' });
    await page.close();
  });
});
