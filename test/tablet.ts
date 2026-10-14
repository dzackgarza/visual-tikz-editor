/** Shared story harness: an isolated workbench server and tablet pen/touch input. */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CDPSession, FrameLocator, Page } from "@playwright/test";

export const TABLET_VIEWPORTS = [
  { name: "portrait", width: 768, height: 1024 },
  { name: "landscape", width: 1024, height: 768 },
] as const;

export type Point = { x: number; y: number };

/** Build the standalone page once per spec; every server in the spec serves this build. */
export async function buildWorkbench(): Promise<void> {
  await promisify(execFile)("just", ["build"]);
}

export type Workbench = { url: string; configHome: string; stop: () => Promise<void> };

/**
 * Serve the built page with a private XDG config home, so preferences written by
 * one story (theme, editor settings, toolbar dock) never reach another story or
 * the author's own configuration.
 */
export async function startWorkbench(env: NodeJS.ProcessEnv): Promise<Workbench> {
  const configHome = await mkdtemp(join(tmpdir(), "workbench-config-"));
  const server: ChildProcess = spawn("bun", ["run", "standalone/server.ts", ""], {
    env: { ...env, XDG_CONFIG_HOME: configHome },
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });
  const url = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", code => reject(new Error(`Standalone server exited: ${code}`)));
    server.stdout!.on("data", chunk => {
      const match = /TikZ workbench: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(chunk));
      if (match !== null) resolve(match[1]);
    });
  });
  server.removeAllListeners("exit");
  return {
    url,
    configHome,
    stop: () => new Promise(resolve => {
      server.once("exit", () => resolve());
      process.kill(-server.pid!, "SIGTERM");
    }),
  };
}

export const editorFrame = (page: Page): FrameLocator => page.frameLocator('iframe[title="TikZ visual editor"]');

/** The part of `visualTikzEditorDebug()` the stories read; the iframe exposes more. */
export type EditorDebug = {
  historyIndex: number;
  tool: string;
  source: string;
  selection: string[];
  scene: { elements: { sourceRef: { sourceId: string } }[] } | null;
  viewport: { translateX: number; translateY: number; scale: number };
  canvasAids: { grid: boolean; rulers: boolean; documentBounds: boolean };
  snapModes: { grid: boolean; latticeLock: boolean };
};

export async function editorDebug(page: Page): Promise<EditorDebug> {
  const frame = page.frames().find(candidate => new URL(candidate.url()).pathname === "/tikz-editor/index.html");
  if (frame === undefined) throw new Error("The page has no mounted TikZ visual editor frame");
  return frame.evaluate(() => (window as unknown as { visualTikzEditorDebug: () => EditorDebug }).visualTikzEditorDebug());
}

/** Pen and finger contacts delivered through Chromium's input pipeline, as a tablet delivers them. */
export class TabletInput {
  private constructor(private readonly cdp: CDPSession) {}

  static async attach(page: Page): Promise<TabletInput> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    return new TabletInput(cdp);
  }

  async penStroke(points: Point[]): Promise<void> {
    await this.penDown(points[0]);
    for (const point of points.slice(1)) await this.penMove(point);
    await this.penUp(points.at(-1)!);
  }

  /** One finger: a tap when `points` has one entry, a drag otherwise. */
  async touch(points: Point[]): Promise<void> {
    const [first, ...rest] = points;
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, ...first }] });
    for (const point of rest) await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, ...point }] });
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  /** One finger held still past the editor's 550 ms long-press threshold. */
  async longPress(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, ...point }] });
    await new Promise(resolve => setTimeout(resolve, 800));
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async pinch(center: Point, startGap: number, endGap: number): Promise<void> {
    const pair = (gap: number) => [{ id: 1, x: center.x - gap / 2, y: center.y }, { id: 2, x: center.x + gap / 2, y: center.y }];
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pair(startGap) });
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pair(endGap) });
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async palm(point: Point, phase: "touchStart" | "touchMove" | "touchEnd"): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: phase, touchPoints: phase === "touchEnd" ? [] : [{ id: 9, ...point, radiusX: 35, radiusY: 30 }] });
  }

  /** The pen within hover range of the screen, not touching it. */
  async penHover(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none", buttons: 0, pointerType: "pen" });
  }

  async penMove(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "left", buttons: 1, pointerType: "pen", force: .5 });
  }

  async penDown(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1, pointerType: "pen", force: .5 });
  }

  async penUp(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
  }
}

/** A 16-sample wavy stroke `length` px wide, starting at fractions (fx, fy) of `box`. */
export function waveAcross(box: { x: number; y: number; width: number; height: number }, fx: number, fy: number, length: number): Point[] {
  return Array.from({ length: 16 }, (_, i) => ({
    x: box.x + box.width * fx + i * length / 15,
    y: box.y + box.height * fy + 25 * i / 15 + Math.sin(i) * 2,
  }));
}

export async function storyScreenshot(page: Page, title: string): Promise<void> {
  await mkdir("test-results/workbench", { recursive: true });
  await page.screenshot({ path: `test-results/workbench/${title.replace(/[^a-z0-9]+/gi, "-")}.png` });
}
