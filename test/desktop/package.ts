/**
 * Starts the built desktop package (the Tauri shell on WebKitGTK) and drives its window by
 * W3C WebDriver (https://www.w3.org/TR/webdriver2/). WebKitWebDriver takes the protocol
 * directly, and the package accepts automation when TAURI_WEBVIEW_AUTOMATION is true; Tauri's
 * guide starts the same driver through tauri-driver (https://v2.tauri.app/develop/tests/webdriver/).
 *
 * The application gets its own XDG directories and an Xvfb display, so a story reads and
 * writes no file of the person who runs it.
 *
 * WebKitWebDriver 2.54 delivers mouse pointer actions in full. A pen sequence stops after a
 * pointerdown on which the page calls preventDefault, a touch contact arrives as a mouse, and
 * wheel actions do not reach the page. The stories here therefore use mouse
 * contacts, and make wheel events in the page.
 */

import { strict as assert } from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { z } from "zod";
import { version } from "../../package.json";

const BINARY = resolve(
  `src-tauri/target/release/bundle/deb/Visual TikZ Editor_${version}_amd64/data/usr/bin/visual-tikz-editor`,
);
/** The key of an element reference in a WebDriver response (https://www.w3.org/TR/webdriver2/#elements). */
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const elementSchema = z.object({ [ELEMENT]: z.string() });
type ElementReference = z.infer<typeof elementSchema>;
type Json = z.infer<ReturnType<typeof z.json>>;

/** WebDriver's key codes (https://www.w3.org/TR/webdriver2/#keyboard-actions). */
export const KEY = { control: "\uE009", delete: "\uE017", escape: "\uE00C" } as const;

/** An offset, in CSS pixels, from the centre of the canvas. */
export type Offset = { x: number; y: number };

export class DesktopApp {
  private constructor(
    /** The directory of the application's state: recovery draft, view state, and launch logs. */
    readonly stateDirectory: string,
    /** The process of the desktop shell. */
    readonly pid: number,
    private readonly driver: ChildProcess,
    private readonly origin: string,
    private readonly session: string,
    private readonly end: () => void,
  ) {}

  /**
   * Starts the package on fresh XDG directories. `seedState` is copied to the state directory first,
   * and `args` is the application's command line.
   */
  static async start({ seedState, args = [] }: { seedState?: string; args?: string[] } = {}): Promise<DesktopApp> {
    assert.ok(existsSync(BINARY), `Build the desktop package first (just package): ${BINARY}`);
    const home = await mkdtemp(join(tmpdir(), "desktop-package-"));
    const stateDirectory = join(home, "state", "visual-tikz-editor");
    if (seedState === undefined) await mkdir(stateDirectory, { recursive: true });
    else await cp(seedState, stateDirectory, { recursive: true });
    const display = spawn("Xvfb", ["-displayfd", "1", "-screen", "0", "1400x1100x24", "-nolisten", "tcp"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const displayNumber = await new Promise<string>((resolve) => {
      display.stdout!.once("data", (text) => resolve(String(text).trim()));
    });
    const { WAYLAND_DISPLAY: _wayland, ...inherited } = process.env;
    const port = 4455 + Math.floor(Math.random() * 400);
    // The driver leads a process group of its own, so `stop` ends it with the application and the file host.
    const driver = spawn("WebKitWebDriver", [`--port=${port}`, "--host=127.0.0.1"], {
      env: {
        ...inherited,
        DISPLAY: `:${displayNumber}`,
        XDG_SESSION_TYPE: "x11",
        GDK_BACKEND: "x11",
        XDG_STATE_HOME: join(home, "state"),
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_DATA_HOME: join(home, "data"),
        TAURI_WEBVIEW_AUTOMATION: "true",
      },
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
    });
    const end = () => {
      process.kill(-driver.pid!, "SIGTERM");
      display.kill();
    };
    // A run that ends early leaves no driver, application, or display.
    process.once("exit", end);
    const origin = `http://127.0.0.1:${port}`;
    let started = false;
    try {
      await expect(async () => {
        await call(origin, "GET", "/status");
      }, "WebKitWebDriver did not start").toPass({ timeout: 10_000 });
      // The driver makes the session when the application has a window; with no window, this command gets no answer.
      const created = z
        .object({ sessionId: z.string(), capabilities: z.object({ "webkit:processID": z.number() }) })
        .parse(
          await call(origin, "POST", "/session", {
            capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: BINARY, args } } },
          }),
        );
      const app = new DesktopApp(
        stateDirectory,
        created.capabilities["webkit:processID"],
        driver,
        origin,
        `/session/${created.sessionId}`,
        end,
      );
      await app.command("POST", "/window/rect", { width: 1366, height: 1024 });
      started = true;
      return app;
    } finally {
      // A start that fails leaves none of them either.
      if (!started) {
        process.off("exit", end);
        end();
      }
    }
  }

  private command(method: string, path: string, body?: Json): Promise<Json> {
    return call(this.origin, method, `${this.session}${path}`, body);
  }

  /** Runs `source` as the body of a function in the current frame and reads its result as `schema`. */
  async script<T>(schema: z.ZodType<T>, source: string, args: Json[] = []): Promise<T> {
    return schema.parse(await this.command("POST", "/execute/sync", { script: source, args }));
  }

  /** Makes the window's own page the target of `script`. */
  async enterWindow(): Promise<void> {
    await this.command("POST", "/frame", { id: null });
  }

  /** Makes the canvas editor's frame the target of `script`. */
  async enterEditor(): Promise<void> {
    await this.enterWindow();
    await this.command("POST", "/frame", { id: await this.element('iframe[title="TikZ visual editor"]') });
  }

  private async element(selector: string): Promise<ElementReference> {
    return elementSchema.parse(await this.command("POST", "/element", { using: "css selector", value: selector }));
  }

  /** A press and a release of the mouse on the visible control of the current frame that has this accessible name. */
  async press(name: string): Promise<void> {
    const control = await this.script(
      elementSchema.nullable(),
      `const name = arguments[0];
       return [...document.querySelectorAll('button,[role=button],[role=radio],[role=menuitem]')]
         .filter((control) => control.offsetParent !== null)
         .find((control) => {
           const label = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim();
           return label === name || label.startsWith(name + ':');
         }) ?? null;`,
      [name],
    );
    assert.ok(control, `no visible control is named "${name}"`);
    await this.command("POST", `/element/${control[ELEMENT]}/click`, {});
  }

  /** One mouse contact on the canvas: a tap when `path` has one entry, a drag otherwise. The editor's frame must be the target. */
  async contact(path: Offset[]): Promise<void> {
    const origin = await this.element('[data-canvas-viewport="true"]');
    const [first, ...rest] = path.map(({ x, y }) => ({ origin, x: Math.round(x), y: Math.round(y) }));
    await this.command("POST", "/actions", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", duration: 0, ...first },
            { type: "pointerDown", button: 0 },
            ...rest.map((point) => ({ type: "pointerMove", duration: 16, ...point })),
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    await this.command("DELETE", "/actions");
  }

  /** Presses and releases each key in turn; `held` stays down for all of them. */
  async keys(keys: string[], held?: string): Promise<void> {
    const presses = keys.flatMap((value) => [
      { type: "keyDown", value },
      { type: "keyUp", value },
    ]);
    const actions =
      held === undefined ? presses : [{ type: "keyDown", value: held }, ...presses, { type: "keyUp", value: held }];
    await this.command("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions }] });
    await this.command("DELETE", "/actions");
  }

  /** Writes a picture of the window. */
  async screenshot(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(z.string().parse(await this.command("GET", "/screenshot")), "base64"));
  }

  /** Ends the driver, the application, the file host, and the display. */
  async stop(): Promise<void> {
    const ended = new Promise<void>((resolve) => {
      this.driver.once("exit", () => resolve());
    });
    process.off("exit", this.end);
    this.end();
    await ended;
  }
}

/** One WebDriver command; a command that fails, or that gets no answer in 30 seconds, throws. */
async function call(origin: string, method: string, path: string, body?: Json): Promise<Json> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const { value } = z.object({ value: z.json() }).parse(await response.json());
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
