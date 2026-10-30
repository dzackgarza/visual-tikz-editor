/** Shared story harness: an isolated workbench server and tablet pen/touch input. */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type CDPSession,
  expect,
  type Frame,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

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
    server.once("exit", (code) => reject(new Error(`Standalone server exited: ${code}`)));
    server.stdout!.on("data", (chunk) => {
      const match = /TikZ workbench: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(chunk));
      if (match !== null) {
        resolve(match[1]);
      }
    });
  });
  server.removeAllListeners("exit");
  return {
    url,
    configHome,
    stop: () =>
      new Promise((resolve) => {
        server.once("exit", () => resolve());
        process.kill(-server.pid!, "SIGTERM");
      }),
  };
}

export const editorFrame = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="TikZ visual editor"]');

/**
 * The centre of `locator` once its box has stopped moving, as Playwright's own
 * clicks require; a touch aimed at a box measured mid-layout lands elsewhere.
 */
export async function stableCenter(locator: Locator): Promise<Point> {
  // A finger scrolls a scrollable control to reach a button; canvas items use settledCenter.
  await locator.scrollIntoViewIfNeeded();
  return settledCenter(locator);
}

/** The centre of a canvas item once its box stops moving; never scrolls its container. */
export async function settledCenter(locator: Locator): Promise<Point> {
  // Settled means the same box on three reads 100 ms apart.
  const boxes: Array<{ x: number; y: number; width: number; height: number } | null> = [
    await locator.boundingBox(),
  ];
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    boxes.push(await locator.boundingBox());
    const [a, b, c] = boxes.slice(-3);
    if (
      boxes.length >= 3 &&
      a &&
      b &&
      c &&
      [b, c].every(
        (box) => box.x === a.x && box.y === a.y && box.width === a.width && box.height === a.height,
      )
    ) {
      const center = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
      const window = locator.page().viewportSize()!;
      if (center.x < 0 || center.y < 0 || center.x > window.width || center.y > window.height) {
        throw new Error(
          `${locator} is outside the window at ${JSON.stringify(center)}; a finger cannot reach it`,
        );
      }
      return center;
    }
  }
  throw new Error(`${locator} did not settle within 5 s`);
}

/** A page point on the drawn stroke of `element`, `fraction` of the way along it. */
export async function strokePoint(page: Page, element: Locator, fraction: number): Promise<Point> {
  await settledCenter(element);
  const local = await element.evaluate((geometry: SVGGeometryElement, at) => {
    const point = geometry.getPointAtLength(geometry.getTotalLength() * at);
    const matrix = geometry.getScreenCTM()!;
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    };
  }, fraction);
  const frame = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
  return { x: frame.x + local.x, y: frame.y + local.y };
}

/**
 * Fit the figure into the canvas the rail and an open panel leave free, by the user's route.
 * The startup zoom depends on the canvas size at mount; a story acting on drawn items sets its view here.
 */
export async function fitDiagram(frame: FrameLocator, input: TabletInput): Promise<void> {
  const zoom = frame
    .locator("[data-diagram-tools]")
    .getByRole("button", { name: "Zoom and display", exact: true });
  await input.touch([await stableCenter(zoom)]);
  await input.touch([
    await stableCenter(frame.getByRole("button", { name: "Fit diagram", exact: true })),
  ]);
  await input.touch([await stableCenter(zoom)]);
  await expect(frame.getByRole("dialog", { name: "Tool options" })).toHaveCount(0);
}

/** A gesture, by default a short finger swipe, whose every point hits empty canvas, not diagram content or floating controls. */
export async function emptyCanvasGesture(
  frame: FrameLocator,
  path: Point[] = [
    { x: 0, y: 0 },
    { x: -25, y: 20 },
    { x: -50, y: 40 },
  ],
): Promise<Point[]> {
  const viewport = frame.locator('[data-canvas-viewport="true"]');
  const box = (await viewport.boundingBox())!;
  const offsets = await viewport.evaluate((element, path) => {
    const bounds = element.getBoundingClientRect();
    for (const y of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      for (const x of [0.85, 0.7, 0.55, 0.4, 0.25]) {
        const start = { x: bounds.left + bounds.width * x, y: bounds.top + bounds.height * y };
        const points = path.map((offset) => ({ x: start.x + offset.x, y: start.y + offset.y }));
        if (
          points.every((point) => {
            const target = document.elementFromPoint(point.x, point.y);
            return (
              target !== null &&
              element.contains(target) &&
              target.closest(
                '[data-source-id], [data-hit-region-target-id], [data-handle-kind], button, input, aside, [role="dialog"], [data-testid="canvas-selection-hint"], [data-testid="canvas-drag-tooltip"]',
              ) === null
            );
          })
        ) {
          return points.map((point) => ({ x: point.x - bounds.left, y: point.y - bounds.top }));
        }
      }
    }
    throw new Error("No clear canvas area for the gesture");
  }, path);
  return offsets.map((point) => ({ x: box.x + point.x, y: box.y + point.y }));
}

/** The part of `visualTikzEditorDebug()` the stories read; the iframe exposes more. */
export type EditorDebug = {
  historyIndex: number;
  tool: string;
  source: string;
  selection: string[];
  handle: string | null;
  scene: {
    elements: {
      sourceRef: { sourceId: string };
      kind?: string;
      commands?: { kind: string; to?: { x: number; y: number } }[];
    }[];
  } | null;
  viewport: { translateX: number; translateY: number; scale: number };
  pendingRequestId: string | null;
  snapshotSource: string;
  canvasAids: { grid: boolean; rulers: boolean; documentBounds: boolean };
  settings: {
    canvas: {
      latticeLock: boolean;
      freehandSimplificationUnits: number;
      freehandAutoApply: boolean;
    };
  };
};

/**
 * Every shown diagram editor has loaded the current source, reports no synchronization
 * issue, has rendered that source, and holds a startup view that no longer moves. The
 * host reports the load once the editor's parse matches the source; the first render
 * and the view centred on the page follow, and a pen contact before them is measured
 * against a view that is about to change.
 */
export async function editorReady(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.locator('[data-editor-state="ready"]:visible').first()).toBeVisible({
    timeout,
  });
  await expect(page.locator('[data-editor-state="busy"]:visible')).toHaveCount(0, { timeout });
  // A page whose shown editor is Quiver has no visual editor view to settle.
  const frame = debugFrame(page);
  if (frame === undefined) {
    return;
  }
  await expect
    .poll(
      () =>
        frame.evaluate(async () => {
          const debug = (window as unknown as { visualTikzEditorDebug: () => EditorDebug })
            .visualTikzEditorDebug;
          const before = debug();
          if (before.pendingRequestId !== null || before.snapshotSource !== before.source) {
            return "rendering";
          }
          if ((document.querySelector('[data-canvas-viewport="true"]')?.clientWidth ?? 0) === 0) {
            return "no canvas size";
          }
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const after = debug();
          return JSON.stringify(before.viewport) === JSON.stringify(after.viewport)
            ? "settled"
            : "moving";
        }),
      { timeout },
    )
    .toBe("settled");
}

function debugFrame(page: Page): Frame | undefined {
  return page
    .frames()
    .find((candidate) => new URL(candidate.url()).pathname === "/tikz-editor/index.html");
}

export async function editorDebug(page: Page): Promise<EditorDebug> {
  const frame = debugFrame(page);
  if (frame === undefined) {
    throw new Error("The page has no mounted TikZ visual editor frame");
  }
  return frame.evaluate(() =>
    (window as unknown as { visualTikzEditorDebug: () => EditorDebug }).visualTikzEditorDebug(),
  );
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
    for (const point of points.slice(1)) {
      await this.penMove(point);
    }
    await this.penUp(points.at(-1)!);
  }

  /** One finger: a tap when `points` has one entry, a drag otherwise. */
  async touch(points: Point[]): Promise<void> {
    const [first, ...rest] = points;
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, ...first }],
    });
    for (const point of rest) {
      await this.cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, ...point }],
      });
    }
    if (rest.length > 0) {
      await this.rest([{ id: 1, ...rest.at(-1)! }]);
    }
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async doubleTap(point: Point): Promise<void> {
    await this.touch([point]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await this.touch([point]);
  }

  /** One finger held still past the editor's 550 ms long-press threshold. */
  async longPress(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, ...point }],
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async pinch(center: Point, startGap: number, endGap: number): Promise<void> {
    const pair = (gap: number) => [
      { id: 1, x: center.x - gap / 2, y: center.y },
      { id: 2, x: center.x + gap / 2, y: center.y },
    ];
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: pair(startGap),
    });
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: pair(endGap),
    });
    await this.rest(pair(endGap));
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  /**
   * Fingers come to rest before lifting. Lifting straight out of a move reads to
   * Chromium as a fling, and it spends the next tap stopping that fling instead of
   * clicking (reproduced on a bare page with no editor code).
   */
  private async rest(touchPoints: Array<{ id: number } & Point>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints });
  }

  /** A finger of the other hand, held down until `fingerUp`, while the pen works. */
  async fingerDown(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 2, ...point }],
    });
  }

  async fingerUp(): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async palm(point: Point, phase: "touchStart" | "touchMove" | "touchEnd"): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: phase,
      touchPoints: phase === "touchEnd" ? [] : [{ id: 9, ...point, radiusX: 35, radiusY: 30 }],
    });
  }

  /** The pen within hover range of the screen, not touching it. */
  async penHover(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
      button: "none",
      buttons: 0,
      pointerType: "pen",
    });
  }

  async penMove(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
      button: "left",
      buttons: 1,
      pointerType: "pen",
      force: 0.5,
    });
  }

  async penDown(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "pen",
      force: 0.5,
    });
  }

  async penUp(point: Point): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "pen",
    });
  }
}

/** A 16-sample wavy stroke `length` px wide, starting at fractions (fx, fy) of `box`. */
export function waveAcross(
  box: { x: number; y: number; width: number; height: number },
  fx: number,
  fy: number,
  length: number,
): Point[] {
  return Array.from({ length: 16 }, (_, i) => ({
    x: box.x + box.width * fx + (i * length) / 15,
    y: box.y + box.height * fy + (25 * i) / 15 + Math.sin(i) * 2,
  }));
}

/**
 * Record V8 coverage of the page's scripts when TIKZ_WORKBENCH_V8_COVERAGE names a
 * directory, as NODE_V8_COVERAGE does for Node; unset means no collection. Call it
 * before the first navigation; `stopPageCoverage` writes the result.
 */
export async function startPageCoverage(page: Page): Promise<void> {
  if (process.env.TIKZ_WORKBENCH_V8_COVERAGE === undefined) {
    return;
  }
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
}

/** Write the page's coverage of the standalone build's chunks as one JSON file; scripts/coverage.mjs reads them. */
export async function stopPageCoverage(page: Page): Promise<void> {
  const directory = process.env.TIKZ_WORKBENCH_V8_COVERAGE;
  if (directory === undefined) {
    return;
  }
  const entries = await page.coverage.stopJSCoverage();
  const chunks = entries.filter(
    (entry) => entry.url.startsWith("http") && new URL(entry.url).pathname.startsWith("/assets/"),
  );
  // A page that never loaded a built chunk has nothing to report; the reporter rejects an empty list.
  if (chunks.length === 0) {
    return;
  }
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${randomUUID()}.json`), JSON.stringify(chunks));
}

export async function storyScreenshot(page: Page, title: string): Promise<void> {
  await mkdir("test-results/workbench", { recursive: true });
  await page.screenshot({
    path: `test-results/workbench/${title.replace(/[^a-z0-9]+/gi, "-")}.png`,
  });
}
