# Probes and measurements for the desktop app and the stroke path

This note keeps the tools of the work on [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18), [#88](https://github.com/dzackgarza/visual-tikz-editor/issues/88), [#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89), and [#90](https://github.com/dzackgarza/visual-tikz-editor/issues/90) (2026-11-15 and
2026-11-16). They were written in a cloud session that no longer exists. None is part of the story
suites. Each is given whole, with how it was run and what it showed, so that a later reproduction
does not start from nothing. Paths are those of that session: the repository at
`/home/user/visual-tikz-editor`, the package built by `npm run package`.

## 1. Two environments for the desktop stories

The reporter of [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18) runs WebKitGTK 2.54.2. An Ubuntu 24.04 machine has 2.52.6.

### WebKitGTK 2.54.2: a Debian sid image

The package that Ubuntu builds runs in this image, and `test/desktop` runs there as committed.

```dockerfile
FROM debian:sid
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-0 webkitgtk-webdriver libgtk-3-0 libgtk-3-dev gcc libc6-dev pkg-config \
    xvfb xauth xdotool x11-apps imagemagick weston procps nodejs ca-certificates \
    libayatana-appindicator3-1 librsvg2-common fonts-dejavu-core adwaita-icon-theme dbus-x11 \
    libgl1-mesa-dri libegl1 libgles2 mesa-utils zenity \
 && rm -rf /var/lib/apt/lists/*
```

```bash
docker build -t vte-sid <directory of the Dockerfile>
```

```bash
docker run --rm --shm-size=1g -v /home/user/visual-tikz-editor:/home/user/visual-tikz-editor -w /home/user/visual-tikz-editor vte-sid bash -c 'node node_modules/mocha/bin/mocha.js --no-config --no-package --require tsx --timeout 240000 test/desktop/*.spec.ts'
```

The image has Node 24 and weston 16. In the cloud container the Docker daemon had to be started
by hand (`dockerd` in the background) before the first build.

### WebKitGTK 2.52.6: Ubuntu 24.04, with a local change

WebKitWebDriver 2.52 returns no `webkit:processID`, so `DesktopApp.start` rejects the session
([#94](https://github.com/dzackgarza/visual-tikz-editor/issues/94)). This change was applied for local runs and never committed:

```diff
127c127
<         .object({ sessionId: z.string(), capabilities: z.object({ "webkit:processID": z.number() }) })
---
>         .object({ sessionId: z.string(), capabilities: z.object({ "webkit:processID": z.number().optional() }) })
135c135
<         created.capabilities["webkit:processID"],
---
>         created.capabilities["webkit:processID"] ?? Number(execFileSync("pgrep", ["-n", "-f", "usr/bin/visual-tikz-editor"], { encoding: "utf8" }).trim()), // LOCAL ONLY: WebKitWebDriver 2.52 gives no process ID
```

The browser stories needed a second local change there, because the container's Chromium and
ffmpeg were of other Playwright revisions than the repository pins and the video failed. A
machine set up by `just _ci-environment` does not need it:

```diff
diff --git a/test/workbench-browser.spec.ts b/test/workbench-browser.spec.ts
index 8fe9cab..781d382 100644
--- a/test/workbench-browser.spec.ts
+++ b/test/workbench-browser.spec.ts
@@ -380,7 +380,7 @@ describe("standalone workbench host boundary", function () {
     // (docs/development.md); https://playwright.dev/docs/videos.
     context = await browser.newContext({
       ...(viewport ? { viewport } : {}),
-      recordVideo: { dir: "test-results/workbench/video" },
+
     });
     await context.addInitScript(recordCanvasProtocol);
     await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
@@ -413,9 +413,7 @@ describe("standalone workbench host boundary", function () {
     } finally {
       try {
         await context.close();
-        const video = page.video()!;
-        await video.saveAs(`test-results/workbench/${name}.webm`);
-        await video.delete();
+
       } finally {
         await workbench.stop();
       }
```

The same container needed two links so that Playwright found its browsers:
`/opt/pw-browsers/chromium_headless_shell-1248` to `-1243`, and `ffmpeg-1013` to `ffmpeg-1011`.

The file stories fail in that container at the native chooser whatever is done ([#94](https://github.com/dzackgarza/visual-tikz-editor/issues/94)).

## 2. Input as the X server delivers it

WebKitWebDriver's wheel and key chords do not reach the canvas as a device's do. This probe runs
the package on Xvfb, sends input with `xdotool`, reads the canvas through the driver, and takes a
picture of the X display after each step, which is what a person would see.

It showed for [#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18): Ctrl+wheel and the zoom keys do not fail on a figure with no pen stroke;
with pen strokes one zoom key took 1.0–1.3 s (six strokes, WebKitGTK 2.54.2) before `2aefa1d` and
90 ms after it.

Environment: `PROBE_BINARY` (the application), `PROBE_OUT` (pictures and `record.json`),
`PROBE_SOURCE` (the figure), `PROBE_ENV` (JSON of extra variables, for example
`LD_PRELOAD` and `PINCH_SHIM_FILE` or `TOUCH_SHIM_FILE` for the libraries below),
`PROBE_STEPS`. A step is `kind:count`: `wheel-in`, `wheel-out`, `keys-in`, `keys-out` (Ctrl+= and
Ctrl+−), `lat-keys` and `lat-wheel` (the time of each single step until the scale changes),
`draw` (one pen-like stroke with the mouse), `pinch-in`, `pinch-out`, `touch-in`, `touch-out`,
`click`, `plainwheel`.

```js
// Probe for #18: the built desktop package on Xvfb, with input sent at the level of the X server
// (xdotool) and the state read through WebKitWebDriver and through pictures of the X display.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = "/home/user/visual-tikz-editor";
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const BINARY = process.env.PROBE_BINARY ?? resolve(repo, `src-tauri/target/release/bundle/deb/Visual TikZ Editor_${version}_amd64/data/usr/bin/visual-tikz-editor`);
const out = process.env.PROBE_OUT ?? join(import.meta.dirname, "out");
mkdirSync(out, { recursive: true });
const DISPLAY = process.env.PROBE_DISPLAY ?? ":99";
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = mkdtempSync(join(tmpdir(), "probe18-"));
const stateDirectory = join(home, "state", "visual-tikz-editor");
mkdirSync(stateDirectory, { recursive: true });
const figure = join(home, "figure.tikz");
writeFileSync(figure, process.env.PROBE_SOURCE ?? "\\begin{tikzpicture}\n\\draw (0,0) circle (1);\n\\draw[->] (0,0) -- (2,1);\n\\node at (1,2) {$x^2$};\n\\end{tikzpicture}\n");

const display = spawn("Xvfb", [DISPLAY, "-screen", "0", "1400x1100x24", "-nolisten", "tcp"], { stdio: "ignore" });
await sleep(1000);
const env = { ...process.env, DISPLAY, XDG_SESSION_TYPE: "x11", GDK_BACKEND: "x11",
  XDG_STATE_HOME: join(home, "state"), XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
  XDG_DATA_HOME: join(home, "data"), TAURI_WEBVIEW_AUTOMATION: "true", ...(JSON.parse(process.env.PROBE_ENV ?? "{}")) };
delete env.WAYLAND_DISPLAY;
const port = 4600;
const driver = spawn("WebKitWebDriver", [`--port=${port}`, "--host=127.0.0.1"], { env, stdio: ["ignore", "inherit", "inherit"], detached: true });
const end = () => { try { process.kill(-driver.pid, "SIGTERM"); } catch {} display.kill(); };
process.once("exit", end);
const origin = `http://127.0.0.1:${port}`;
async function call(method, path, body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const { value } = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
for (let i = 0; i < 50; i++) { try { await call("GET", "/status"); break; } catch { await sleep(200); } }
const created = await call("POST", "/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: BINARY, args: [figure] } } } });
const session = `/session/${created.sessionId}`;
const command = (method, path, body) => call(method, `${session}${path}`, body);
const script = (source, args = []) => command("POST", "/execute/sync", { script: source, args });
const enterWindow = () => command("POST", "/frame", { id: null });
const enterEditor = async () => {
  await enterWindow();
  const frame = await command("POST", "/element", { using: "css selector", value: 'iframe[title="TikZ visual editor"]' });
  await command("POST", "/frame", { id: frame });
};
await command("POST", "/window/rect", { width: 1366, height: 1024 });
const x = (...args) => execFileSync("xdotool", args, { env: { ...process.env, DISPLAY } }).toString().trim();
const shot = async (name) => {
  // The picture of the X display is what a person sees; the driver's picture is WebKit's own snapshot.
  execFileSync("bash", ["-c", `xwd -root -display ${DISPLAY} | convert xwd:- ${join(out, name + "-x.png")}`]);
  writeFileSync(join(out, name + "-wd.png"), Buffer.from(await command("GET", "/screenshot"), "base64"));
};
const state = async () => {
  await enterEditor();
  return script(`const stage = document.querySelector('[data-testid="canvas-world-stage"]');
    const viewport = document.querySelector('[data-canvas-viewport="true"]');
    const box = viewport?.getBoundingClientRect();
    const figure = [...document.querySelectorAll('[data-source-id]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width + r.height > 0);
    const visible = figure.filter((r) => box && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom).length;
    return { scale: stage ? Number(stage.dataset.canvasScale) : null, stage: stage ? [stage.offsetWidth, stage.offsetHeight] : null,
      elements: figure.length, visible, error: document.body.innerText.includes('Error rendering') ,
      noSvg: document.querySelector('[data-testid="canvas-no-svg"]')?.textContent ?? null,
      visual: [window.visualViewport.scale, window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio };`);
};
const shellState = async () => {
  await enterWindow();
  return script(`return { visual: [window.visualViewport.scale, window.visualViewport.width, window.visualViewport.height], inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio, status: document.querySelector('[role=status]')?.textContent ?? null };`);
};
const log = () => {
  const dir = join(stateDirectory, "logs");
  if (!existsSync(dir)) return "(no log directory)";
  return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
};
const record = [];
const note = async (label) => {
  let editor, shell;
  try { editor = await state(); } catch (error) { editor = { failed: String(error).slice(0, 200) }; }
  try { shell = await shellState(); } catch (error) { shell = { failed: String(error).slice(0, 200) }; }
  const entry = { label, editor, shell };
  record.push(entry);
  console.log(JSON.stringify(entry));
};

// Wait for the canvas.
for (let i = 0; i < 100; i++) { try { const s = await state(); if (s.scale !== null && s.elements > 0) break; } catch {} await sleep(300); }
await sleep(1500);
await note("open");
await shot("00-open");

// The canvas centre in screen coordinates.
const win = x("search", "--onlyvisible", "--name", "figure.tikz").split("\n").pop();
const geometry = Object.fromEntries(x("getwindowgeometry", "--shell", win).split("\n").map((l) => l.split("=")));
await enterEditor();
const canvasBox = await script(`const r = document.querySelector('[data-canvas-viewport="true"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height];`);
await enterWindow();
const frameBox = await script(`const r = document.querySelector('iframe[title="TikZ visual editor"]').getBoundingClientRect(); return [r.left, r.top];`);
const cx = Math.round(Number(geometry.X) + frameBox[0] + canvasBox[0] + canvasBox[2] / 2);
const cy = Math.round(Number(geometry.Y) + frameBox[1] + canvasBox[1] + canvasBox[3] / 2);
console.log(JSON.stringify({ win, geometry, canvasBox, frameBox, cx, cy }));
x("mousemove", String(cx), String(cy));
await sleep(300);

const steps = (process.env.PROBE_STEPS ?? "wheel-in:10,wheel-in:10,wheel-in:10,wheel-in:15,wheel-out:45,wheel-out:30,wheel-out:30,keys-in:25,keys-out:50").split(",");
let index = 1;
for (const step of steps) {
  const [kind, countText] = step.split(":");
  const count = Number(countText);
  if (kind === "wheel-in" || kind === "wheel-out") {
    x("keydown", "ctrl");
    for (let i = 0; i < count; i++) { x("click", kind === "wheel-in" ? "4" : "5"); await sleep(40); }
    x("keyup", "ctrl");
  } else if (kind === "keys-in" || kind === "keys-out") {
    for (let i = 0; i < count; i++) { x("key", kind === "keys-in" ? "ctrl+equal" : "ctrl+minus"); await sleep(60); }
  } else if (kind === "pinch-in" || kind === "pinch-out") {
    const scales = kind === "pinch-in" ? [1.1, 1.3, 1.6, 2, 2.5] : [0.9, 0.75, 0.6, 0.5, 0.4];
    writeFileSync(env.PINCH_SHIM_FILE, `${cx - Number(geometry.X)} ${cy - Number(geometry.Y)} ${scales.join(" ")}\n`);
    await sleep(1500);
  } else if (kind === "draw") {
    x("mousemove", String(cx - 200), String(cy + 120)); x("mousedown", "1");
    for (let i = 1; i <= 20; i++) { x("mousemove", String(cx - 200 + i * 20), String(Math.round(cy + 120 + 40 * Math.sin(i / 2)))); await sleep(15); }
    x("mouseup", "1"); x("mousemove", String(cx), String(cy));
  } else if (kind === "lat-keys" || kind === "lat-wheel") {
    await enterEditor();
    const read = () => script(`return Number(document.querySelector('[data-testid="canvas-world-stage"]').dataset.canvasScale);`);
    const times = [];
    for (let i = 0; i < count; i++) {
      const before = await read();
      const t0 = Date.now();
      if (kind === "lat-keys") x("key", "ctrl+equal"); else { x("keydown", "ctrl"); x("click", "4"); x("keyup", "ctrl"); }
      let waited = 0;
      while ((await read()) === before && waited < 8000) { await sleep(15); waited = Date.now() - t0; }
      times.push(Date.now() - t0);
      await sleep(300);
    }
    console.log(JSON.stringify({ latency: kind, ms: times }));
  } else if (kind === "touch-in" || kind === "touch-out") {
    writeFileSync(env.TOUCH_SHIM_FILE, `${cx - Number(geometry.X)} ${cy - Number(geometry.Y)} ${kind === "touch-in" ? "100 200" : "200 100"} 10\n`);
    await sleep(1500);
  } else if (kind === "click") {
    x("click", "1");
  } else if (kind === "plainwheel") {
    for (let i = 0; i < count; i++) { x("click", "5"); await sleep(40); }
  }
  await sleep(1200);
  await note(step);
  await shot(String(index).padStart(2, "0") + "-" + step.replace(":", ""));
  index++;
}
writeFileSync(join(out, "record.json"), JSON.stringify(record, null, 2));
writeFileSync(join(out, "launch.log"), log());
console.log("LOG TAIL:\n" + log().split("\n").slice(-25).join("\n"));
process.off("exit", end);
end();
process.exit(0);
```

For a touchpad pinch the library is `test/desktop/touchpad.c` of the repository, which this
probe's first version (`pinch-shim.c`) became.

## 3. A touchpad pinch under Wayland

The stories run on X11. This probe runs the package under a headless weston with GDK's Wayland
backend and gives the pinch with `test/desktop/touchpad.c`. Run in the Debian sid image.
`PROBE_GL=1` makes weston use its GL renderer; `PROBE_GPU=1` prints the rows of `webkit://gpu`.

Result at the head of the pinch repair (`97d412d`), WebKitGTK 2.54.2: the figure zooms by 2 about
the pointer (the circle's centre at (279, 321) before and (279, 322) after) and back, the window
is not magnified, and Ctrl+wheel reaches 1506 % and 4 % with no error. With the GL renderer
`webkit://gpu` reported the accelerated path: policy "always", EGL, the DMABuf renderer,
GPU-threaded rendering, on Mesa's software driver. Before the repair the figure kept its scale.

```js
// The built package under a headless Wayland compositor (weston), GDK's Wayland backend, with the
// touchpad library of test/desktop giving the pinch. State is read through WebKitWebDriver.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const repo = "/home/user/visual-tikz-editor";
const BINARY = resolve(repo, process.env.PROBE_BINARY ?? "src-tauri/target/release/bundle/deb/Visual TikZ Editor_0.1.0_amd64/data/usr/bin/visual-tikz-editor");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = mkdtempSync(join(tmpdir(), "wl-probe-"));
const runtime = join(home, "run"); mkdirSync(runtime, { mode: 0o700 });
const stateDirectory = join(home, "state", "visual-tikz-editor"); mkdirSync(stateDirectory, { recursive: true });
const lib = join(home, "touchpad.so");
execFileSync("bash", ["-c", `cc -shared -fPIC -Wno-deprecated-declarations -o ${lib} ${repo}/test/desktop/touchpad.c $(pkg-config --cflags --libs gtk+-3.0)`]);
const figure = join(home, "figure.tikz");
writeFileSync(figure, "\\begin{tikzpicture}\n\\draw (0,0) circle (1);\n\\draw (3,0) circle (1);\n\\end{tikzpicture}\n");
const weston = spawn("weston", ["--backend=headless", "--socket=wl-probe", "--width=1400", "--height=1100", ...(process.env.PROBE_GL ? ["--renderer=gl"] : [])], { env: { ...process.env, XDG_RUNTIME_DIR: runtime }, stdio: ["ignore", "ignore", "pipe"] });
let westonLog = ""; weston.stderr.on("data", (d) => { westonLog += d; });
await sleep(1500);
const touchpadFile = join(home, "touchpad");
const env = { ...process.env, XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: "wl-probe", GDK_BACKEND: "wayland", XDG_SESSION_TYPE: "wayland",
  XDG_STATE_HOME: join(home, "state"), XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_DATA_HOME: join(home, "data"),
  TAURI_WEBVIEW_AUTOMATION: "true", LD_PRELOAD: lib, TOUCHPAD_FILE: touchpadFile, ...(JSON.parse(process.env.PROBE_ENV ?? "{}")) };
delete env.DISPLAY;
const port = 4700;
const driver = spawn("WebKitWebDriver", [`--port=${port}`, "--host=127.0.0.1"], { env, stdio: ["ignore", "inherit", "inherit"], detached: true });
const end = () => { try { process.kill(-driver.pid, "SIGTERM"); } catch {} weston.kill(); };
process.once("exit", end);
const origin = `http://127.0.0.1:${port}`;
async function call(method, path, body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const { value } = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
for (let i = 0; i < 50; i++) { try { await call("GET", "/status"); break; } catch { await sleep(200); } }
const created = await call("POST", "/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: BINARY, args: [figure] } } } });
const session = `/session/${created.sessionId}`;
const command = (method, path, body) => call(method, `${session}${path}`, body);
const script = (source, args = []) => command("POST", "/execute/sync", { script: source, args });
const enterWindow = () => command("POST", "/frame", { id: null });
const enterEditor = async () => { await enterWindow(); await command("POST", "/frame", { id: await command("POST", "/element", { using: "css selector", value: 'iframe[title="TikZ visual editor"]' }) }); };
const log = () => { const dir = join(stateDirectory, "logs"); return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("") : ""; };
const state = async () => {
  await enterEditor();
  const editor = await script(`const stage = document.querySelector('[data-testid="canvas-world-stage"]'); const c = document.querySelector('[data-canvas-viewport="true"]').getBoundingClientRect(); const b = document.querySelector('svg [data-source-id]')?.getBoundingClientRect();
    return { scale: stage ? Number(stage.dataset.canvasScale) : null, circle: b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width } : null, canvas: { x: c.x, y: c.y, w: c.width, h: c.height }, error: document.body.innerText.includes('Error rendering') };`);
  await enterWindow();
  const shell = await script(`const f = document.querySelector('iframe[title="TikZ visual editor"]').getBoundingClientRect(); return { magnification: window.visualViewport.scale, frame: { x: f.x, y: f.y }, inner: [window.innerWidth, window.innerHeight] };`);
  return { editor, shell };
};
for (let i = 0; i < 100; i++) { try { const s = await state(); if (s.editor.scale !== null && s.editor.circle) break; } catch {} await sleep(300); }
await sleep(1500);
const pinch = async (scales) => {
  const s = await state();
  const ended = (log().match(/^touchpad: a pinch of \d+ updates ended$/gm) ?? []).length;
  writeFileSync(touchpadFile, `${s.shell.frame.x + s.editor.circle.x} ${s.shell.frame.y + s.editor.circle.y} ${scales.join(" ")}\n`);
  for (let i = 0; i < 100; i++) { if ((log().match(/^touchpad: a pinch of \d+ updates ended$/gm) ?? []).length > ended) break; await sleep(100); }
  await sleep(800);
};
const out = { backend: env.GDK_BACKEND, webkit: created.capabilities?.browserVersion };
out.open = await state();
await pinch([1.1, 1.25, 1.5, 1.75, 2]);
out.afterPinchIn = await state();
await pinch([0.9, 0.75, 0.6, 0.5]);
out.afterPinchOut = await state();
// Wheel with Ctrl, made in the page, to both limits.
await enterEditor();
await script(`const v = document.querySelector('[data-canvas-viewport="true"]'); const b = v.getBoundingClientRect(); for (let i = 0; i < 60; i++) v.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })); return null;`);
await sleep(1500); out.wheelIn = await state();
await enterEditor();
await script(`const v = document.querySelector('[data-canvas-viewport="true"]'); const b = v.getBoundingClientRect(); for (let i = 0; i < 120; i++) v.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })); return null;`);
await sleep(1500); out.wheelOut = await state();
const brief = (s) => ({ scale: Number(s.editor.scale.toFixed(4)), circle: s.editor.circle && { x: Math.round(s.editor.circle.x), y: Math.round(s.editor.circle.y), w: Math.round(s.editor.circle.w) }, magnification: s.shell.magnification, error: s.editor.error });
console.log(JSON.stringify({ backend: out.backend, webkit: out.webkit, open: brief(out.open), pinchIn: brief(out.afterPinchIn), pinchOut: brief(out.afterPinchOut), wheelIn: brief(out.wheelIn), wheelOut: brief(out.wheelOut) }));
writeFileSync(process.env.PROBE_SHOT ?? join(home, "shot.png"), Buffer.from(await command("GET", "/screenshot"), "base64"));
if (process.env.PROBE_GPU) { await enterWindow(); await command("POST", "/url", { url: "webkit://gpu" }); await sleep(1500); const rows = await script("return [...document.querySelectorAll('tr')].map((r) => [...r.children].map((c) => c.innerText.trim().slice(0, 70)).join(' = '));"); console.log("GPU:", rows.filter((l) => /^(WebKit version|Type|Policy|WebGL enabled|2D canvas|API|Renderer|Native interface|GL_RENDERER|GL_VERSION|Mode|Threaded rendering)/.test(l)).join(" | ")); }
console.log("LOG:", log().split("\n").filter((l) => /error|terminated|EGL|GL|wayland/i.test(l)).slice(0, 8).join(" | "));
console.log("WESTON:", westonLog.split("\n").filter((l) => /renderer|EGL|GL_|error/i.test(l)).slice(0, 6).join(" | "));
process.off("exit", end); end(); process.exit(0);
```

## 4. A two-finger pinch on a touch screen: an attempt that shows nothing

Xvfb has no touch device. This library, loaded into the application like `touchpad.c`, makes
`GDK_TOUCH_BEGIN`, `GDK_TOUCH_UPDATE`, and `GDK_TOUCH_END` for two fingers from the pointer
device. A line in the file that `TOUCH_SHIM_FILE` names is `x y gap0 gap1 steps`.

Result: for a pinch from 100 px to 200 px the canvas scale changed by 1.05 and the window was not
magnified, on the unrepaired and the repaired package alike. Touch events from a pointer device
may not be what a touch screen sends, so nothing is concluded ([#96](https://github.com/dzackgarza/visual-tikz-editor/issues/96)).

```c
// Scratch shim: two-finger pinch on a touch screen as GDK touch events (GDK_TOUCH_BEGIN/UPDATE/END).
// Command in TOUCH_SHIM_FILE: "x y gap0 gap1 steps" (centre, start and end distance of the fingers).
#include <gtk/gtk.h>
#include <stdio.h>
#include <unistd.h>
static GtkWidget *find_view(GtkWidget *w) {
  if (g_str_has_prefix(G_OBJECT_TYPE_NAME(w), "WebKitWebView")) return w;
  GtkWidget *f = NULL;
  if (GTK_IS_CONTAINER(w)) { GList *c = gtk_container_get_children(GTK_CONTAINER(w)); for (GList *i = c; i && !f; i = i->next) f = find_view(i->data); g_list_free(c); }
  return f;
}
typedef struct { GtkWidget *view; double x, y, gap0, gap1; int steps, next; } Pinch;
static void touch(Pinch *p, GdkEventType type, int finger, double x) {
  GdkWindow *window = gtk_widget_get_window(p->view);
  GdkDevice *pointer = gdk_seat_get_pointer(gdk_display_get_default_seat(gdk_window_get_display(window)));
  int left, top; gdk_window_get_origin(window, &left, &top);
  GdkEvent *e = gdk_event_new(type);
  e->touch.window = g_object_ref(window);
  e->touch.time = (guint32)(g_get_monotonic_time() / 1000);
  e->touch.x = x; e->touch.y = p->y; e->touch.x_root = left + x; e->touch.y_root = top + p->y;
  e->touch.state = type == GDK_TOUCH_BEGIN ? 0 : GDK_BUTTON1_MASK;
  e->touch.sequence = GUINT_TO_POINTER(finger);
  e->touch.emulating_pointer = finger == 1;
  gdk_event_set_device(e, pointer); gdk_event_set_source_device(e, pointer);
  gtk_main_do_event(e); gdk_event_free(e);
}
static gboolean step(gpointer data) {
  Pinch *p = data;
  double gap = p->gap0 + (p->gap1 - p->gap0) * p->next / p->steps;
  GdkEventType type = p->next == 0 ? GDK_TOUCH_BEGIN : GDK_TOUCH_UPDATE;
  if (p->next <= p->steps) { touch(p, type, 1, p->x - gap / 2); touch(p, type, 2, p->x + gap / 2); p->next++; return G_SOURCE_CONTINUE; }
  touch(p, GDK_TOUCH_END, 1, p->x - p->gap1 / 2); touch(p, GDK_TOUCH_END, 2, p->x + p->gap1 / 2);
  fprintf(stderr, "touch-shim: a pinch from %g to %g ended\n", p->gap0, p->gap1);
  g_free(p); return G_SOURCE_REMOVE;
}
static gboolean poll(gpointer u) {
  const char *path = g_getenv("TOUCH_SHIM_FILE"); char *text = NULL;
  if (!path || !g_file_get_contents(path, &text, NULL, NULL)) return G_SOURCE_CONTINUE;
  GtkWidget *view = NULL; GList *t = gtk_window_list_toplevels(); for (GList *i = t; i && !view; i = i->next) view = find_view(i->data); g_list_free(t);
  if (!view) return G_SOURCE_CONTINUE;
  unlink(path);
  Pinch *p = g_new0(Pinch, 1); p->view = view;
  sscanf(text, "%lf %lf %lf %lf %d", &p->x, &p->y, &p->gap0, &p->gap1, &p->steps); g_free(text);
  g_timeout_add(16, step, p); return G_SOURCE_CONTINUE;
}
__attribute__((constructor)) static void start(void) {
  char exe[512] = {0}; if (readlink("/proc/self/exe", exe, sizeof exe - 1) < 0) return;
  if (!g_str_has_suffix(exe, "/visual-tikz-editor")) return;
  g_timeout_add(50, poll, NULL);
}
```

```bash
cc -shared -fPIC -Wno-deprecated-declarations -o touch-shim.so touch-shim.c $(pkg-config --cflags --libs gtk+-3.0)
```

## 5. The time of a pen stroke

### The benchmark

It draws N strokes of 60 samples that do not touch each other, in four columns, with the mouse in
Chromium, and reports the median of five strokes at three places: `commit` is the time from the
lift to the change of the source, `render` the time from the lift to the stroke's path in the
canvas. With `paused` each stroke waits for the one before to be drawn. Save it as
`.tmp/bench.mts` and run `npx tsx .tmp/bench.mts 80 paused`.

Strokes must not touch: a stroke whose end lands on a point of another stroke names that point,
which edits an earlier statement, and such a stroke is rightly computed whole. An earlier
benchmark of this work drew strokes over each other and measured that case without knowing it.

```ts
// Stroke timing in a figure of N strokes: the commit (pen lift to source change) and the drawn result
// (pen lift to the stroke's path in the canvas). Strokes do not touch each other.
import { chromium } from "@playwright/test";
import { startWorkbench } from "../test/tablet";
const STROKES = Number(process.argv[2] ?? 80), POINTS = 60, PAUSED = process.argv[3] === "paused";
const browser = await chromium.launch();
const workbench = await startWorkbench(process.env);
const page = await browser.newPage({ viewport: { width: 1366, height: 1024 } });
await page.goto(workbench.url);
await page.waitForSelector('iframe[title="TikZ visual editor"]');
let frame;
for (let i = 0; i < 100 && !frame; i++) { frame = page.frames().find((f) => f.url().includes("/tikz-editor/")); if (!frame) await page.waitForTimeout(200); }
await frame.waitForSelector('[data-testid="canvas-world-stage"]', { timeout: 60000 });
await page.waitForTimeout(1500);
const fb = (await (await page.$('iframe[title="TikZ visual editor"]'))!.boundingBox())!;
const vb = await frame.evaluate(`(() => { const r = document.querySelector('[data-canvas-viewport="true"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const left = fb.x + vb.x + 40, top = fb.y + vb.y + 40, width = vb.w - 80, height = vb.h - 240;
const COLS = 4, ROWS = Math.ceil(STROKES / COLS);
const src = () => frame.evaluate(`window.visualTikzEditorDebug().source.length`);
const drawn = () => frame.evaluate(`new Set([...document.querySelectorAll('svg [data-source-id^="path:"]')].map((e) => e.getAttribute("data-source-id"))).size`);
const commit = [], render = [];
for (let s = 0; s < STROKES; s++) {
  const col = s % COLS, row = Math.floor(s / COLS);
  const x0 = left + col * (width / COLS) + 10, y0 = top + (row + 0.5) * (height / ROWS), span = width / COLS - 40;
  const before = await src(), paths = await drawn();
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= POINTS; i++) await page.mouse.move(x0 + (i * span) / POINTS, y0 + (height / ROWS) * 0.3 * Math.sin(i / 4), { steps: 1 });
  const t0 = Date.now();
  await page.mouse.up();
  for (let i = 0; i < 4000 && (await src()) === before; i++) await page.waitForTimeout(2);
  commit.push(Date.now() - t0);
  if (PAUSED || s % 20 === 19 || s === 0) { for (let i = 0; i < 4000 && (await drawn()) <= paths; i++) await page.waitForTimeout(2); render.push(Date.now() - t0); }
}
const at = (a, i) => a[Math.min(i, a.length - 1)];
const med = (a, from, to) => [...a.slice(from, to)].sort((x, y) => x - y)[Math.floor((to - from) / 2)];
console.log(JSON.stringify({ strokes: STROKES, paused: PAUSED, sourceKB: Math.round((await src()) / 1024),
  commitMedian: { "1-5": med(commit, 0, 5), "36-40": med(commit, 35, 40), "76-80": med(commit, STROKES - 5, STROKES) },
  render: PAUSED ? { "1-5": med(render, 0, 5), "36-40": med(render, 35, 40), "76-80": med(render, STROKES - 5, STROKES) } : render }));
await browser.close(); await workbench.stop(); process.exit(0);
```

### What it measured

Lift to the drawn stroke (`render`, paused), strokes of 60 samples:

| Head | Strokes 1–5 | Strokes 36–40 | Strokes 76–80 |
| --- | --- | --- | --- |
| `f343c40` (after [#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89)) | 182 ms | 393 ms | 542 ms |
| `1974d90` (after [#90](https://github.com/dzackgarza/visual-tikz-editor/issues/90)) | 61 ms | 76 ms | 138 ms |

Before [#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89) the lift alone took 80 ms for the first stroke and 512 ms for the fortieth, and
forty strokes took 795 kB of source (288 kB after).

The compute of an added stroke at `1974d90`, by phase, from 15 kB to 574 kB of source: 9–17 ms in
all; the parse of the added statements under 1 ms, the evaluation 2–5 ms, the SVG 1–3 ms, and the
wait for the text engine's pending sizes 5–8 ms, which does not depend on the figure.

A whole compute at seventy strokes (508 kB) before [#90](https://github.com/dzackgarza/visual-tikz-editor/issues/90): parse 54–66 ms, evaluation 12–16 ms,
SVG 3 ms; a second parse of the whole source only to decide the SVG's padding, 60–90 ms; and
28–40 ms to prime the two sessions that a drag would use.

### The ink between the lift and the drawn stroke

This sampler records each change of two facts at each frame: whether the Pen's mark is shown, and
how many strokes are drawn. A state with no mark and the old count, after a state with the mark,
is a time with no ink. Before [#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89) that lasted 150–170 ms in an empty figure. The story "the
ink of a pen stroke stays on the canvas after the pen lifts, and the thirtieth stroke is written
as fast as the first" holds the same reading.

```ts
// The time with no ink of a stroke on the canvas: from the preview's removal to the stroke's path.
import { chromium } from "@playwright/test";
import { startWorkbench } from "../test/tablet";
const STROKES = Number(process.argv[2] ?? 3);
const browser = await chromium.launch();
const workbench = await startWorkbench(process.env);
const page = await browser.newPage({ viewport: { width: 1366, height: 1024 } });
await page.goto(workbench.url);
await page.waitForSelector('iframe[title="TikZ visual editor"]');
let frame;
for (let i = 0; i < 100 && !frame; i++) { frame = page.frames().find((f) => f.url().includes("/tikz-editor/")); if (!frame) await page.waitForTimeout(200); }
await frame.waitForSelector('[data-testid="canvas-world-stage"]', { timeout: 60000 });
await page.waitForTimeout(1500);
await frame.evaluate(`(() => {
  window.inkLog = [];
  const state = () => ({ preview: document.querySelector('[data-tool-preview="freehand"]') !== null, paths: new Set([...document.querySelectorAll('svg [data-source-id^="path:"]')].map((e) => e.getAttribute("data-source-id"))).size });
  let last = JSON.stringify(state());
  const tick = () => { const now = JSON.stringify(state()); if (now !== last) { window.inkLog.push([Math.round(performance.now()), now]); last = now; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})()`);
for (let s = 0; s < STROKES; s++) {
  const x0 = 200, y0 = 250 + s * 40;
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(x0 + i * 8, y0 + 10 * Math.sin(i / 4), { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}
console.log(JSON.stringify(await frame.evaluate(`window.inkLog`)));
await browser.close(); await workbench.stop(); process.exit(0);
```

### How the causes were found

- **A CPU profile of one stroke.** `Profiler.enable`, `Profiler.setSamplingInterval` (200 µs),
  and `Profiler.start` on a CDP session of the page just before the lift, `Profiler.stop` after
  the stroke is drawn; then self time and total time by call frame. The canvas frame is in the
  page's process, so its functions are in the profile.
- **Names.** The bundle is minified. A frame's line and column give the place in
  `vendor/tikz-editor/src/assets/index-*.js`; the text there (a hook's destructured arguments, a
  string) names the function in the fork's source.
- **"(program)" is not the product.** Polling the page from the test every 2 ms shows up as
  native time. `Performance.getMetrics` before and after (ScriptDuration, LayoutDuration,
  RecalcStyleDuration) showed that layout and style were under 20 ms of a 300 ms stroke.
- **A split inside the compute.** A temporary `console.log` of `performance.now()` around the
  parse, the evaluation, and the SVG in `renderTikzToSvgAsync` found that these three were half of
  the time of the call that contains them; the other half was the argument that decides the
  padding, which parsed the source again.
- **The fork's quick build.** `bunx vite build --outDir <repo>/vendor/tikz-editor/src
  --emptyOutDir false` in `.cache/tikz-editor/apps/zettlr-embed` rebuilds the canvas in 25 s for
  such a trial. It does not copy `vendor/tikz-editor/embed/src`; the vendor script does.

The causes, in the order found: a trial of Smooth on every point at each zoom step ([#18](https://github.com/dzackgarza/visual-tikz-editor/issues/18));
the stroke's record and its 17-digit coordinates; a parse of the whole source at each lift; the
locked and hidden ids read from every statement at each action of the store; the handles that can
be dragged, found by comparing each with every other; the mark removed at the lift; the typing
wait before a stroke's compute; the whole compute for an added statement; the parse for the
padding; and the parse that the rulers ask for before the snapshot has caught up
([#89](https://github.com/dzackgarza/visual-tikz-editor/issues/89), [#90](https://github.com/dzackgarza/visual-tikz-editor/issues/90)). What remains is [#91](https://github.com/dzackgarza/visual-tikz-editor/issues/91).

## 6. The zoom readout after a tool menu closes

For [#93](https://github.com/dzackgarza/visual-tikz-editor/issues/93): six rounds in one application of the sequence that failed once in the story. Each
round printed `true>true>false`: the press opened the popover, it stayed open, and the second
press closed it. It needs the local change of section 1 on WebKitGTK 2.52. Save it under `.tmp/`.

```ts
import { z } from "zod";
import { DesktopApp } from "../test/desktop/package";
const app = await DesktopApp.start();
const any = z.any();
await app.enterWindow();
for (let i = 0; i < 200; i++) { const s = await app.script(any, "return document.querySelector('[data-editor-state]')?.getAttribute('data-editor-state') ?? null;"); if (s === "ready") break; await new Promise((r) => setTimeout(r, 300)); }
await app.enterEditor();
await new Promise((r) => setTimeout(r, 1000));
const state = () => app.script(any, "return document.querySelector('button[aria-label=\"Zoom and display\"]').getAttribute('aria-expanded');");
const menus = () => app.script(any, "return document.querySelectorAll('[role=\"dialog\"][aria-label=\"Active Tool Menu\"]').length;");
const out = [];
for (let round = 0; round < 6; round++) {
  await app.press("Eraser"); await app.press("Eraser");
  for (let i = 0; i < 50 && (await menus()) !== 1; i++) await new Promise((r) => setTimeout(r, 50));
  await app.press("Eraser");
  for (let i = 0; i < 50 && (await menus()) !== 0; i++) await new Promise((r) => setTimeout(r, 50));
  await app.press("Zoom and display");
  const a = [await state()]; await new Promise((r) => setTimeout(r, 300)); a.push(await state());
  await app.press("Zoom and display");
  await new Promise((r) => setTimeout(r, 300)); a.push(await state());
  out.push(a.join(">"));
  await app.press("Pen");
}
console.log(JSON.stringify(out));
await app.stop(); process.exit(0);
```
