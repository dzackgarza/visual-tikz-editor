import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import type { EditorSnapshot, EditorSnapshotResult, HostCommand } from "../src/host";
import { snapshotResultSchema } from "../vendor/tikz-editor/embed/src/snapshot-protocol";
import { geometryTraces } from "./geometry-traces";
import {
  buildWorkbench,
  editorDebug,
  editorFrame,
  editorReady,
  emptyCanvasGesture,
  dockGripPoint,
  fitDiagram,
  layoutBox,
  pasteCode,
  type Point,
  settledCenter,
  selectedPoints,
  stableCenter,
  startPageCoverage,
  startWorkbench,
  stopPageCoverage,
  storyScreenshot,
  strokePoint,
  TABLET_VIEWPORTS,
  TabletInput,
  type Workbench,
  waveAcross,
} from "./tablet";

/**
 * The canvas frame's session as its last `loaded` notification names it, its snapshot replies by request, and
 * how many reports that a shell menu opened or closed it has acknowledged.
 */
type CanvasProtocol = {
  session: { sessionId: string; revision: number } | null;
  snapshots: Record<string, EditorSnapshotResult>;
  shellMenuReports: number;
};

/** The sensor channels of one pen event as the canvas frame received it. */
type PenChannels = { time: number; pressure: number; tiltX: number; tiltY: number };

declare global {
  interface Window {
    canvasProtocol: CanvasProtocol;
    receivedPen: PenChannels[];
    /** Each state of the pen's mark and the count of drawn strokes, one entry for each change, in the canvas frame. */
    inkStates: { mark: boolean; strokes: number }[];
    /** The time from each lift of the pen to the next frame, in ms, in the canvas frame. */
    liftTimes: number[];
  }
}

/** Records in the top page what the canvas frame tells the shell about its session and its snapshots. */
function recordCanvasProtocol(): void {
  if (window !== window.top) {
    return;
  }
  const protocol: CanvasProtocol = { session: null, snapshots: {}, shellMenuReports: 0 };
  window.canvasProtocol = protocol;
  window.addEventListener("message", (event) => {
    const canvas = document.querySelector<HTMLIFrameElement>('iframe[title="TikZ visual editor"]');
    // The canvas frame posts each notification as a JSON string (vendor/tikz-editor/embed/src/main.tsx).
    if (canvas === null || event.source !== canvas.contentWindow || typeof event.data !== "string") {
      return;
    }
    const message = JSON.parse(event.data);
    if (message.event === "loaded") {
      protocol.session = { sessionId: message.sessionId, revision: message.revision };
    }
    if (message.event === "snapshot") {
      protocol.snapshots[message.requestId] = message;
    }
    if (message.event === "reply" && message.action === "host-popover" && message.status === "ok") {
      protocol.shellMenuReports += 1;
    }
  });
}

/** The fixture of the canvas stories: one authored circle, whose last authored line ends before the closing line. */
const circleFigure = String.raw`\begin{tikzpicture}
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;

describe("standalone workbench host boundary", function () {
  let workbench: Workbench;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let url: string;
  /** The file that the story's editor opened at launch, when its setup names a document. */
  let documentPath: string | undefined;

  type StorySetup = {
    viewport?: { width: number; height: number };
    initialPage?: "blank";
    /** The directory from which the document's relative image paths resolve. */
    resources?: string;
    /** The source of a diagram file that the editor opens at launch. */
    document?: string;
  };
  const storySetups = new Map<string, StorySetup>();
  function story(setup: StorySetup, title: string, run: Mocha.AsyncFunc): void {
    storySetups.set(title, setup);
    it(title, run);
  }

  /** The drawing toolbar of the canvas frame. */
  const drawingToolbar = (frame: FrameLocator) => frame.locator("[data-diagram-tools]");
  /** A control of the drawing toolbar, by its accessible name in contracts/surfaces.md. */
  const toolbarItem = (frame: FrameLocator, name: string) =>
    drawingToolbar(frame).getByRole("button", { name, exact: true });
  /** The Active Tool Menu of the active tool (FR-009). */
  const activeToolMenu = (frame: FrameLocator) => frame.getByRole("dialog", { name: "Active Tool Menu" });
  /** A control of the document bar, by its accessible name in contracts/surfaces.md. */
  const documentBarButton = (name: string) =>
    page.locator(".document-bar").getByRole("button", { name, exact: true });
  /**
   * A menu of the document bar: the title menu, Share and Export, or More. Its button and its list
   * (contracts/surfaces.md, Document bar).
   */
  const barMenu = (name: "title" | "share" | "more") => {
    const root = page.locator(`.document-bar [data-menu="${name}"]`);
    return { button: root.locator(":scope > button"), list: root.getByRole("menu") };
  };
  /** A choice of an open menu of the document bar. */
  const barMenuItem = (name: string) =>
    page.locator(".document-bar").getByRole("menuitem", { name, exact: true });
  /** Copies the document's TikZ from Share and Export. */
  const copyTikz = async () => {
    await barMenu("share").button.click();
    await barMenuItem("Copy TikZ").click();
  };
  /** A history control of the document bar (FR-012). */
  const documentHistory = (name: "Undo" | "Redo") => documentBarButton(name);
  /** A panel control of the document bar (contracts/surfaces.md, FR-060). */
  const documentPanelButton = (name: "Layers" | "Properties") => documentBarButton(name);
  /** The Layers or the Properties panel of the canvas frame. */
  const sidePanel = (frame: FrameLocator, name: "Layers" | "Properties") =>
    frame.getByRole("complementary", { name, exact: true });
  /** The Snap toggle at the canvas's lower leading corner (contracts/surfaces.md, Canvas controls). */
  const snapToggle = (frame: FrameLocator) => frame.getByRole("button", { name: "Snap", exact: true });
  /** The zoom control at the canvas's lower trailing corner; T057 turns it into the readout "Zoom: n %". */
  const zoomControl = (frame: FrameLocator) => frame.getByRole("button", { name: "Zoom and display", exact: true });

  /**
   * Makes a tool the active tool by a tap, or by a click for "mouse". It taps only an inactive
   * tool: a tap on the active tool opens its Active Tool Menu instead (FR-009).
   */
  async function chooseTool(
    frame: FrameLocator,
    input: TabletInput | "mouse",
    name: "Lasso" | "Pen" | "Eraser" | "Shapes" | "Text" | "Fill",
  ): Promise<void> {
    const tool = toolbarItem(frame, name);
    if ((await tool.getAttribute("aria-pressed")) !== "true") {
      await (input === "mouse" ? tool.click() : input.touch([await stableCenter(tool)]));
    }
    await expect(tool).toHaveAttribute("aria-pressed", "true");
  }

  /** Chooses one construction in the Shapes Active Tool Menu, which closes on the choice. */
  async function chooseShape(frame: FrameLocator, input: TabletInput, construction: string): Promise<void> {
    const shapes = toolbarItem(frame, "Shapes");
    const menu = activeToolMenu(frame);
    await chooseTool(frame, input, "Shapes");
    await input.touch([await stableCenter(shapes)]);
    await expect(menu).toBeVisible();
    await input.touch([await stableCenter(menu.getByRole("option", { name: construction, exact: true }))]);
    await expect(menu).toHaveCount(0);
  }

  /** The curve refinement that Simplify opens on the selected curve (FR-027). */
  const curveRefinement = (frame: FrameLocator) => frame.getByRole("dialog", { name: "Curve refinement" });

  /**
   * Selects a stroke with the Lasso and opens Simplify from its object menu. A tap that lands on one of the
   * stroke's points selects that point; Done leaves the point and keeps the curve selected.
   */
  async function openSimplify(frame: FrameLocator, input: TabletInput, stroke: Locator): Promise<void> {
    await chooseTool(frame, input, "Lasso");
    await input.touch([await strokePoint(page, stroke, 0.3)]);
    await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
    const done = frame.getByRole("button", { name: "Done", exact: true });
    if (await done.isVisible()) await input.touch([await stableCenter(done)]);
    await input.touch([await stableCenter(frame.getByRole("button", { name: "Simplify", exact: true }))]);
    await expect(curveRefinement(frame)).toBeVisible();
  }

  /** Simplifies a stroke and accepts the first simpler pass. */
  async function simplifyStroke(frame: FrameLocator, input: TabletInput, stroke: Locator): Promise<void> {
    await openSimplify(frame, input, stroke);
    await input.touch([
      await stableCenter(curveRefinement(frame).getByRole("button", { name: "Accept", exact: true })),
    ]);
    await expect(curveRefinement(frame)).toHaveCount(0);
  }

  /** The last path the canvas draws: a new stroke's drawing, inside the scope that keeps its original. */
  const lastPath = (frame: FrameLocator) => frame.locator('svg [data-source-id^="path:"]').last();

  /** A draw command's coordinates in centimetres; a pen stroke writes its ends in points (TeX's 72.27 pt to 2.54 cm). */
  const drawCoordinates = (draw: string): Point[] =>
    [...draw.matchAll(/\((-?[\d.]+)(pt)?,\s*(-?[\d.]+)(pt)?\)/g)].map((match) => ({
      x: Number(match[1]) / (match[2] ? 72.27 / 2.54 : 1),
      y: Number(match[3]) / (match[4] ? 72.27 / 2.54 : 1),
    }));

  /** The frame that shows Settings over the whole window (FR-005). */
  const settingsFrame = () => page.frameLocator('iframe[title="Settings"]');
  /** The Settings dialog in its frame. */
  const settingsDialog = () => settingsFrame().getByRole("dialog", { name: "Settings" });

  /** Opens Settings from More, over the whole window (FR-005), and returns its dialog. */
  async function openSettings(): Promise<Locator> {
    await barMenu("more").button.click();
    await barMenuItem("Settings…").click();
    const settings = settingsDialog();
    await expect(settings).toBeVisible({ timeout: 30_000 });
    return settings;
  }

  type SnapRule = "Lattice" | "Objects" | "Alignment" | "Angle";

  /** Opens the snapping rules beside Snap, puts one rule in the wanted state, and closes them. */
  async function setSnapRule(
    frame: FrameLocator,
    input: TabletInput,
    rule: SnapRule,
    on: boolean,
  ): Promise<void> {
    const trigger = frame.getByRole("button", { name: "Snapping rules", exact: true });
    await input.touch([await stableCenter(trigger)]);
    const popup = frame.getByRole("dialog", { name: "Tool options" });
    const toggle = popup.getByRole("button", { name: rule, exact: true });
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute("aria-pressed")) !== String(on)) {
      await input.touch([await stableCenter(toggle)]);
    }
    await expect(toggle).toHaveAttribute("aria-pressed", String(on));
    await input.touch([await stableCenter(trigger)]);
    await expect(popup).toHaveCount(0);
  }

  /**
   * Where content sits from the centre of the canvas, and its size. A file reopens at the scale
   * and the figure point at the centre of the canvas that it was left with (FR-040), so this
   * place is the same after a reopen although the panels around the canvas can differ.
   */
  async function placeOnCanvas(frame: FrameLocator, content: Locator): Promise<Record<"x" | "y" | "width" | "height", number>> {
    const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
    const box = await layoutBox(content);
    return {
      x: box.x - (canvas.x + canvas.width / 2),
      y: box.y - (canvas.y + canvas.height / 2),
      width: box.width,
      height: box.height,
    };
  }

  /** The shell's current canvas session. */
  async function canvasSession(): Promise<{ sessionId: string; revision: number }> {
    const session = await page.evaluate(() => window.canvasProtocol.session);
    assert.ok(session !== null, "The canvas has not loaded a source");
    return session;
  }

  /**
   * Runs `change`, which opens or closes one shell menu, and waits until the canvas frame has the report of it.
   * The shell reports the change by a message that the frame gets some milliseconds later. A person presses
   * after that; a press that this driver sends at once overtakes the message.
   */
  async function shellMenuChange(change: () => Promise<void>): Promise<void> {
    const reports = () => page.evaluate(() => window.canvasProtocol.shellMenuReports);
    const before = await reports();
    await change();
    await expect
      .poll(reports, { message: "The canvas frame did not get the report that a shell menu opened or closed" })
      .toBeGreaterThan(before);
  }

  /** Posts one frame-protocol command to the canvas from the shell's window. */
  async function postCanvasCommand(command: HostCommand): Promise<void> {
    await page.evaluate((command) => {
      document
        .querySelector<HTMLIFrameElement>('iframe[title="TikZ visual editor"]')!
        .contentWindow!.postMessage(command, location.origin);
    }, command);
  }

  /** Requests a snapshot of the canvas's current source in the shell's session and returns its request id. */
  async function requestCanvasSnapshot(): Promise<string> {
    const { source } = await editorDebug(page);
    const requestId = randomUUID();
    await postCanvasCommand({ action: "snapshot", ...(await canvasSession()), requestId, source });
    return requestId;
  }

  async function canvasSnapshotReply(requestId: string): Promise<EditorSnapshotResult> {
    await expect
      .poll(() => page.evaluate((id) => id in window.canvasProtocol.snapshots, requestId), {
        timeout: 12000,
      })
      .toBe(true);
    return snapshotResultSchema.parse(
      await page.evaluate((id) => window.canvasProtocol.snapshots[id], requestId),
    );
  }

  async function canvasSnapshot(): Promise<EditorSnapshot> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await editorReady(page);
      const result = await canvasSnapshotReply(await requestCanvasSnapshot());
      if (result.status === "ready") {
        return result;
      }
      if (result.error !== "source-changed") {
        throw new Error(`Snapshot failed: ${result.error}`);
      }
    }
    throw new Error("Source changed during three consecutive snapshot requests");
  }

  /**
   * The document source that the shell has stored. The source pane is no witness for it:
   * CodeMirror renders only the visible part of a long line such as a stroke record.
   */
  const storedSource = async (): Promise<string> =>
    (await page.request.get(`${url}api/document`)).text();

  /** The geometry attributes of each painted source element of an exported SVG, in document order. */
  async function paintedGeometry(svg: string): Promise<string[][]> {
    return page.evaluate(
      (markup) =>
        [
          ...new DOMParser()
            .parseFromString(markup, "image/svg+xml")
            .querySelectorAll(
              "path[data-source-id],circle[data-source-id],ellipse[data-source-id],rect[data-source-id]",
            ),
        ].map((element) =>
          ["d", "cx", "cy", "r", "x", "y", "width", "height", "stroke", "fill"].map(
            (attribute) => element.getAttribute(attribute) ?? "",
          ),
        ),
      svg,
    );
  }

  /** The drawing inside the first stroke record's scope. */
  const recordedDrawing = (source: string): string =>
    /\\begin\{scope\}\n([\s\S]*?)\n\\end\{scope\}/.exec(source)![1];

  /** Fills the source pane, opening it for the fill when it is closed. */
  async function author(source: string): Promise<void> {
    await editorReady(page);
    const code = page.getByRole("button", { name: "Code: left sidebar", exact: true });
    const closed = (await code.getAttribute("aria-pressed")) === "false";
    if (closed) {
      await code.click();
    }
    await pasteCode(page, source);
    await expect.poll(async () => (await editorDebug(page)).source).toBe(source);
    if (closed) {
      await code.click();
    }
    await editorReady(page);
  }

  before(async function () {
    await buildWorkbench();
    browser = await chromium.launch();
  });

  beforeEach(async function () {
    const setup = storySetups.get(this.currentTest!.title);
    documentPath =
      setup?.document === undefined
        ? undefined
        : join(await mkdtemp(join(tmpdir(), "workbench-document-")), "figure.tikz");
    if (documentPath !== undefined) await writeFile(documentPath, setup!.document!);
    workbench = await startWorkbench(process.env, undefined, setup?.resources, documentPath);
    url = workbench.url;
    const viewport = setup?.viewport;
    // Each story keeps a video beside its screenshot, for the review of what the stories show
    // (docs/development.md); https://playwright.dev/docs/videos.
    context = await browser.newContext({
      ...(viewport ? { viewport } : {}),
      recordVideo: { dir: "test-results/workbench/video" },
    });
    await context.addInitScript(recordCanvasProtocol);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    await startPageCoverage(page);
    if (setup?.initialPage === "blank") {
      return;
    }
    await page.goto(url);
    if (!viewport) {
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      await expect(page.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
    }
    await editorReady(page);
  });

  afterEach(async function () {
    const name = this.currentTest!.title.replace(/[^a-z0-9]+/gi, "-");
    try {
      await storyScreenshot(page, name);
      // Only a failed story keeps its trace, as Playwright's retain-on-failure mode does
      // (https://playwright.dev/docs/test-use-options#recording-options); the dated name
      // keeps the trace of an intermittent failure when a later run of the story passes.
      await context.tracing.stop(
        this.currentTest!.state === "failed"
          ? { path: `test-results/workbench/failed-${Date.now()}-${name}.zip` }
          : {},
      );
      await stopPageCoverage(page);
    } finally {
      try {
        await context.close();
        const video = page.video()!;
        await video.saveAs(`test-results/workbench/${name}.webm`);
        await video.delete();
      } finally {
        await workbench.stop();
      }
    }
  });

  after(async function () {
    await browser?.close();
  });

  story(
    { viewport: { width: 768, height: 1024 } },
    "keeps authored source through a render error and recovers in the dark tablet workspace",
    async function () {
      await editorReady(page);
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      await page.emulateMedia({ colorScheme: "dark" });
      const valid = String.raw`\begin{tikzpicture}\draw[blue] (0,0) circle (1cm);\end{tikzpicture}`;
      await pasteCode(page, valid);
      await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
      await expect(page.locator(".tikz-view-status")).toContainText("Up to date", {
        timeout: 40000,
      });
      const invalid = valid.replace("\\draw", "\\thisCommandDoesNotExist\\draw");
      await pasteCode(page, invalid);
      await expect(page.locator(".tikz-compiler-preview-error")).toBeVisible({ timeout: 40000 });
      assert.equal(await page.locator(".cm-content").innerText(), invalid);
      await page.screenshot({ path: "test-results/workbench/dark-tablet-render-error.png" });
      await pasteCode(page, valid);
      await expect(page.locator(".tikz-view-status")).toContainText("Up to date", {
        timeout: 40000,
      });
      await expect(page.locator(".tikz-compiler-preview-error")).toHaveCount(0);
      await page.getByRole("button", { name: "Canvas: right sidebar", exact: true }).click();
      await expect(
        page.frameLocator('iframe[title="TikZ visual editor"]').locator("circle[data-source-id]"),
      ).toBeInViewport();
      assert.equal(await page.locator(".cm-content").innerText(), valid);
    },
  );

  story(
    {
      initialPage: "blank",
      document: String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,1);
\end{tikzpicture}
`,
    },
    "Settings › Appearance follows the system by default, holds Light under a dark system across a restart, is kept in the config directory, and opens over Quiver",
    async function () {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(url);
      await editorReady(page);
      const bar = page.locator(".document-bar");
      // The appearance is a setting, not a control of the document bar (FR-005).
      await expect(bar.getByRole("button", { name: /\b(theme|appearance|dark|light)\b/iu })).toHaveCount(0);
      const canvas = editorFrame(page).locator("html");
      const views = async (scheme: "light" | "dark") => {
        const dark = scheme === "dark" ? /\bdark\b/u : /^(?![\s\S]*\bdark\b)/u;
        await expect(page.locator(".tikz-standalone")).toHaveClass(dark);
        await expect(canvas).toHaveAttribute("data-color-scheme", scheme);
      };
      const settings = settingsDialog();
      const match = settings.getByRole("checkbox", { name: "Match System Appearance" });
      const resetAppearance = settings.getByRole("button", { name: "Reset Appearance", exact: true });

      // By default the editor follows the system.
      await views("dark");
      await page.emulateMedia({ colorScheme: "light" });
      await views("light");
      await page.emulateMedia({ colorScheme: "dark" });
      await views("dark");

      // Settings holds Appearance, Canvas, Colours, and Keyboard shortcuts (FR-062).
      await openSettings();
      for (const category of ["Appearance", "Canvas", "Colors", "Keyboard shortcuts"]) {
        await expect(settings.getByRole("button", { name: category, exact: true })).toBeVisible();
      }
      await settings.getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(match).toBeChecked();
      await expect(resetAppearance).toHaveCount(0);
      await expect(settings.getByRole("radio", { name: "Light", exact: true })).toBeDisabled();
      await match.uncheck();
      await settings.getByRole("radio", { name: "Light", exact: true }).check();
      await expect(resetAppearance).toBeVisible();

      // A changed canvas setting shows its own reset, which restores that setting only.
      await settings.getByRole("button", { name: "Canvas", exact: true }).click();
      const gridSize = settings.getByRole("combobox", { name: "Grid Size" });
      const resetGrid = settings.getByRole("button", { name: "Reset Grid Size", exact: true });
      await expect(resetGrid).toHaveCount(0);
      await gridSize.selectOption("Coarse");
      await expect(resetGrid).toBeVisible();
      await resetGrid.click();
      await expect(gridSize).toHaveValue("standard");
      await expect(resetGrid).toHaveCount(0);

      await settings.getByRole("button", { name: "Close settings", exact: true }).click();
      await expect(page.locator('iframe[title="Settings"]')).toHaveCount(0);

      // Light holds under a dark system, in the shell, the code panel, and the canvas.
      await views("light");
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      await expect(page.locator(".tikz-source-editor")).not.toHaveClass(/\bdark\b/u);

      // The choice survives a restart; it lives in the config directory, and the figure's
      // directory holds the figure alone.
      const configHome = workbench.configHome;
      await workbench.stop();
      workbench = await startWorkbench(process.env, configHome, undefined, documentPath);
      url = workbench.url;
      await page.goto(url);
      await editorReady(page);
      await views("light");
      assert.deepEqual(await readdir(dirname(documentPath!)), ["figure.tikz"]);
      assert.ok(
        Object.keys(JSON.parse(await readFile(join(configHome, "visual-tikz-editor", "preferences.json"), "utf8"))).length > 0,
      );

      // For a tikzcd document, Settings opens over Quiver and its appearance reaches Quiver.
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      await pasteCode(page, String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`);
      const quiverFrame = page.locator('iframe[title="Quiver diagram editor"]');
      const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]').locator("body");
      await expect(quiverFrame).toBeVisible();
      await expect(quiver).not.toHaveClass(/\bdark-theme\b/u);
      await openSettings();
      await settings.getByRole("button", { name: "Appearance", exact: true }).click();
      await settings.getByRole("radio", { name: "Dark", exact: true }).check();
      await expect(quiver).toHaveClass(/\bdark-theme\b/u);
      await expect(page.locator(".tikz-standalone")).toHaveClass(/\bdark\b/u);
      await page.emulateMedia({ colorScheme: "light" });
      await resetAppearance.click();
      await expect(match).toBeChecked();
      await expect(quiver).not.toHaveClass(/\bdark-theme\b/u);
      await settings.getByRole("button", { name: "Close settings", exact: true }).click();
      await expect(page.locator('iframe[title="Settings"]')).toHaveCount(0);
      await expect(quiverFrame).toBeVisible();
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(quiver).toHaveClass(/\bdark-theme\b/u);
    },
  );

  story(
    { initialPage: "blank" },
    "opens an untitled tikzpicture at launch, starts each kind from the title menu, and closes Save changes on Escape",
    async function () {
      await page.goto(url);
      await expect(barMenu("title").button).toHaveText("Unsaved Document");
      await expect(page.locator('iframe[title="TikZ visual editor"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await editorReady(page);
      const fileMenu = barMenu("title").button;
      await fileMenu.click();
      await barMenuItem("New tikzcd").click();
      await expect(barMenu("title").button).toHaveText("Unsaved Document");
      await expect(page.locator('iframe[title="Quiver diagram editor"]')).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      const edited = String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`;
      await pasteCode(page, edited);
      await fileMenu.click();
      await barMenuItem("New tikzpicture").click();
      const prompt = page.getByRole("dialog", { name: "Save changes?" });
      await expect(prompt).toBeVisible();
      await expect(page.locator(".workspace")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(prompt).toHaveCount(0);
      await expect(fileMenu).toBeFocused();
      await expect(page).toHaveTitle("Unsaved Document - Visual TikZ Editor");
      assert.equal(await page.locator(".cm-content").innerText(), edited);
      await expect(page.locator('iframe[title="Quiver diagram editor"]')).toBeVisible();
    },
  );

  story(
    {},
    "Undo acts on the one document history in every view",
    async function () {
      const bar = page.locator(".document-bar");
      const undo = bar.getByRole("button", { name: "Undo", exact: true });
      const redo = bar.getByRole("button", { name: "Redo", exact: true });
      const code = page.locator(".cm-content");
      // Typing at the end of the first line; the source editor groups the keystrokes into one step.
      const typeComment = async () => {
        await code.click();
        await page.keyboard.press("Control+Home");
        await page.keyboard.press("End");
        await page.keyboard.type("% typed");
      };

      // The canvas: an authored line, one of its ends dragged, then a comment typed.
      const authored = String.raw`\begin{tikzpicture}
\draw (1,1) -- (4,1);
\end{tikzpicture}`;
      await code.fill(authored);
      const frame = editorFrame(page);
      const canvasSource = async () => (await editorDebug(page)).source;
      await expect.poll(canvasSource).toBe(authored);
      const input = await TabletInput.attach(page);
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      await fitDiagram(frame, input);
      const line = frame.locator('svg [data-source-id="path:0"]').first();
      await chooseTool(frame, input, "Lasso");
      await input.penStroke([await strokePoint(page, line, 0.5)]);
      await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
      const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
      await tap(strip.getByRole("button", { name: "Edit Points", exact: true }));
      const handle = (await frame
        .locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]')
        .first()
        .boundingBox())!;
      const end = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await input.penDown(end);
      for (let i = 1; i <= 15; i++) await input.penMove({ x: end.x - i * 8, y: end.y });
      await input.penUp({ x: end.x - 120, y: end.y });
      await expect.poll(canvasSource, { message: "The drag did not reach the source" }).not.toBe(authored);
      const dragged = await canvasSource();
      await expect.poll(() => code.innerText()).toBe(dragged);
      await typeComment();
      const typed = dragged.replace("\\begin{tikzpicture}", "\\begin{tikzpicture}% typed");
      await expect.poll(canvasSource).toBe(typed);

      const bothShow = async (expected: string, message: string) => {
        await expect.poll(canvasSource, { message: `${message}: the canvas` }).toBe(expected);
        await expect.poll(() => code.innerText(), { message: `${message}: the source editor` }).toBe(expected);
      };
      await undo.click();
      await bothShow(dragged, "The first Undo did not remove the whole typed comment");
      await undo.click();
      await bothShow(authored, "The second Undo did not remove the whole drag");
      await redo.click();
      await bothShow(dragged, "Redo did not restore the drag");

      // Quiver: an authored tikzcd, a label edited in Quiver, then a comment typed.
      const diagram = String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`;
      await code.fill(diagram);
      const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]');
      await expect(quiver.locator(".vertex")).toHaveCount(2, { timeout: 30_000 });
      await quiver.locator(".vertex").nth(1).click();
      await quiver.locator(".label-input").fill("Edited");
      await expect.poll(() => code.innerText(), { message: "The Quiver edit did not reach the source" }).toContain("Edited");
      const relabelled = await code.innerText();
      await typeComment();
      await expect.poll(() => code.innerText()).toBe(`${relabelled.split("\n")[0]}% typed${relabelled.slice(relabelled.split("\n")[0].length)}`);
      await undo.click();
      await expect.poll(() => code.innerText(), { message: "The first Undo did not remove the typed comment" }).toBe(relabelled);
      await expect(quiver.locator(".vertex").nth(1)).toContainText("Edited");
      await undo.click();
      await expect.poll(() => code.innerText(), { message: "The second Undo did not remove the Quiver edit" }).toBe(diagram);
      await expect(quiver.locator(".vertex").nth(1)).toContainText("B");
      await expect(quiver.locator(".vertex").nth(1)).not.toContainText("Edited");
    },
  );

  story(
    {},
    "Quiver's Undo shortcut takes back a label typed letter by letter as one step of the document",
    async function () {
      const bar = page.locator(".document-bar");
      const code = page.locator(".cm-content");
      const diagram = String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`;
      await code.fill(diagram);
      const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]');
      await expect(quiver.locator(".vertex")).toHaveCount(2, { timeout: 30_000 });
      await expect(quiver.locator('.toolbar .action[data-name="undo"]')).toHaveCount(0);
      await expect(quiver.locator('.toolbar .action[data-name="redo"]')).toHaveCount(0);

      await quiver.locator(".vertex").nth(1).click();
      const label = quiver.locator(".label-input");
      await label.click();
      await page.keyboard.press("Control+A");
      // One letter per 150 ms: each letter reaches the document as its own change.
      await label.pressSequentially("Typed", { delay: 150 });
      await expect.poll(() => code.innerText(), { message: "The Quiver label did not reach the source" }).toContain("Typed");
      const relabelled = await code.innerText();
      await expect(bar.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();

      // Escape leaves the label field; Quiver's own Undo shortcut then acts on the document.
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+z");
      await expect.poll(() => code.innerText(), { message: "Quiver's Undo did not take back the whole label" }).toBe(diagram);
      await expect(quiver.locator(".vertex").nth(1)).toContainText("B");
      // The step Quiver's Undo took back is on the document's Redo.
      await expect(bar.getByRole("button", { name: "Redo", exact: true })).toBeEnabled();
      await page.keyboard.press("Control+Shift+z");
      await expect.poll(() => code.innerText(), { message: "Quiver's Redo did not restore the label" }).toBe(relabelled);
      await expect(bar.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();

      // The document's own Undo also takes back the whole label in one step.
      await bar.getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(() => code.innerText(), { message: "The document's Undo took back only part of the label" }).toBe(diagram);
    },
  );

  /** The accessible names of the view controls that the shell offers, in their order. */
  const viewControls = () =>
    page.locator(".view-rail button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));

  story(
    { initialPage: "blank" },
    "a tikzpicture offers the canvas and no Quiver, and a tikzcd offers Quiver and no canvas",
    async function () {
      await page.goto(url);
      await editorReady(page);
      assert.deepEqual(await viewControls(), ["Code: left sidebar", "Preview: right sidebar", "Canvas: right sidebar"]);
      await barMenu("title").button.click();
      await barMenuItem("New tikzcd").click();
      await expect(page.locator('iframe[title="Quiver diagram editor"]')).toBeVisible({ timeout: 30_000 });
      assert.deepEqual(await viewControls(), ["Code: left sidebar", "Preview: right sidebar", "Quiver: right sidebar"]);
    },
  );

  story(
    {},
    "a source that becomes a tikzcd opens in Quiver and one that becomes a tikzpicture opens in the canvas, and no view tells why another is not there",
    async function () {
      const canvas = page.locator('iframe[title="TikZ visual editor"]');
      const quiver = page.locator('iframe[title="Quiver diagram editor"]');
      const alerts = page.locator(".workspace").getByRole("alert");
      await pasteCode(page, String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`);
      await expect(page.frameLocator('iframe[title="Quiver diagram editor"]').locator(".vertex")).toHaveCount(2, {
        timeout: 30_000,
      });
      await expect(quiver).toBeVisible();
      await expect(canvas).toHaveCount(0);
      await expect(alerts).toHaveCount(0);
      await page.screenshot({ path: "test-results/workbench/source-became-tikzcd.png" });
      await pasteCode(page, String.raw`\begin{tikzpicture}\draw (0,0) circle (1cm);\end{tikzpicture}`);
      await expect(
        page.frameLocator('iframe[title="TikZ visual editor"]').locator("circle[data-source-id]"),
      ).toBeInViewport({ timeout: 30_000 });
      await expect(quiver).toHaveCount(0);
      await expect(alerts).toHaveCount(0);
      await page.screenshot({ path: "test-results/workbench/source-became-tikzpicture.png" });
    },
  );

  story(
    { initialPage: "blank", document: "" },
    "a stroke on the canvas of an empty file makes its tikzpicture",
    async function () {
      await page.goto(url);
      const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
      const viewport = frame.locator('[data-canvas-viewport="true"]');
      await expect(viewport, "The canvas did not open on the empty file").toBeVisible({ timeout: 30_000 });
      await editorReady(page);
      await chooseTool(frame, "mouse", "Pen");
      const box = await layoutBox(viewport);
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.55 + 90, box.y + box.height * 0.3 + 25, { steps: 12 });
      await page.mouse.up();
      await expect(lastPath(frame), "The canvas does not show the stroke").toBeInViewport();
      await expect
        .poll(() => readFile(documentPath!, "utf8"), {
          message: "The file is not one tikzpicture that holds the record of one stroke",
        })
        .toMatch(
          /^\\begin\{tikzpicture\}\n% workbench-ink:[^\n]+\n\\begin\{scope\}\n\\draw[^;\n]+;\n\\end\{scope\}\n% workbench-ink-end:[^\n]+\n\\end\{tikzpicture\}$/u,
        );
    },
  );

  story(
    { initialPage: "blank", document: "" },
    "the first stroke on an empty file, its Undo and its Redo keep the view",
    async function () {
      await page.goto(url);
      const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
      const viewport = frame.locator('[data-canvas-viewport="true"]');
      await expect(viewport, "The canvas did not open on the empty file").toBeVisible({ timeout: 30_000 });
      await editorReady(page);
      const zoom = zoomControl(frame);
      await expect(zoom, "The empty file does not open at printed size").toHaveText("100%");
      await chooseTool(frame, "mouse", "Pen");
      const box = await layoutBox(viewport);
      const from = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.3 };
      const to = { x: from.x + 90, y: from.y + 25 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
      await expect
        .poll(() => readFile(documentPath!, "utf8"), { message: "The stroke did not reach the file" })
        .toContain(String.raw`\begin{tikzpicture}`);
      await editorReady(page);
      await expect(zoom, "The first stroke changed the zoom").toHaveText("100%");
      // The stroke is where the pen drew it: its box on the screen is the box of the gesture.
      const drawn = await layoutBox(lastPath(frame));
      expect(Math.abs(drawn.x - from.x), "The stroke moved away from the pen across the screen").toBeLessThan(6);
      expect(Math.abs(drawn.y - from.y), "The stroke moved away from the pen down the screen").toBeLessThan(6);
      expect(Math.abs(drawn.width - 90), "The stroke on the screen is not as wide as the gesture").toBeLessThan(6);
      const bar = page.locator(".document-bar");
      await bar.getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(() => readFile(documentPath!, "utf8"), { message: "Undo did not empty the file" }).toBe("");
      await editorReady(page);
      await expect(zoom, "Undo of the first stroke changed the zoom").toHaveText("100%");
      await bar.getByRole("button", { name: "Redo", exact: true }).click();
      await expect
        .poll(() => readFile(documentPath!, "utf8"), { message: "Redo did not bring the stroke back" })
        .toContain(String.raw`\begin{tikzpicture}`);
      await editorReady(page);
      await expect(zoom, "Redo of the first stroke changed the zoom").toHaveText("100%");
      const redone = await layoutBox(lastPath(frame));
      expect(Math.abs(redone.x - drawn.x), "Redo put the stroke at another place across the screen").toBeLessThan(2);
      expect(Math.abs(redone.y - drawn.y), "Redo put the stroke at another place down the screen").toBeLessThan(2);
    },
  );

  for (const [object, statement] of [
    ["shape", String.raw`\\draw[^;\n]+;`],
    ["text", String.raw`\\node at \([^)]*\) \{first\};`],
  ] as const) {
    story(
      { initialPage: "blank", document: "" },
      `a ${object} on the canvas of an empty file makes its tikzpicture`,
      async function () {
        await page.goto(url);
        const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
        const viewport = frame.locator('[data-canvas-viewport="true"]');
        await expect(viewport, "The canvas did not open on the empty file").toBeVisible({ timeout: 30_000 });
        await editorReady(page);
        const box = await layoutBox(viewport);
        const at = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.4 };
        if (object === "shape") {
          await chooseTool(frame, "mouse", "Shapes");
          await page.mouse.move(at.x, at.y);
          await page.mouse.down();
          await page.mouse.move(at.x + 120, at.y + 80, { steps: 10 });
          await page.mouse.up();
        } else {
          await chooseTool(frame, "mouse", "Text");
          await page.mouse.click(at.x, at.y);
          await expect(frame.getByTestId("canvas-text-edit-textarea"), "The new text is not in edit").toBeFocused();
          await page.keyboard.type("first");
          await page.keyboard.press("Escape");
        }
        await expect
          .poll(() => readFile(documentPath!, "utf8"), {
            message: `The file is not one tikzpicture that holds the ${object}`,
          })
          .toMatch(new RegExp(String.raw`^\\begin\{tikzpicture\}\n\s*${statement}\n\\end\{tikzpicture\}\n?$`, "u"));
        await storyScreenshot(page, `empty-file-${object}`);
      },
    );
  }

  story(
    {},
    "a tikzcd that Quiver exported, with its link comment and its display-math brackets, opens in Quiver and renders",
    async function () {
      // The text that q.uiver.app gives for one arrow from A to B with its default export settings.
      await pasteCode(
        page,
        [
          "% https://q.uiver.app/#q=WzAsMixbMCwwLCJBIl0sWzEsMCwiQiJdLFswLDFdXQ==",
          String.raw`\[\begin{tikzcd}`,
          "\tA & B",
          "\t" + String.raw`\arrow[from=1-1, to=1-2]`,
          String.raw`\end{tikzcd}\]`,
        ].join("\n"),
      );
      await expect(page.frameLocator('iframe[title="Quiver diagram editor"]').locator(".vertex")).toHaveCount(2, {
        timeout: 30_000,
      });
      assert.deepEqual(await viewControls(), ["Code: left sidebar", "Preview: right sidebar", "Quiver: right sidebar"]);
      await expect(page.locator('iframe[title="TikZ visual editor"]')).toHaveCount(0);
      await expect(page.locator(".workspace").getByRole("alert")).toHaveCount(0);
      await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
      await expect(page.locator(".tikz-view-status")).toContainText("Up to date", { timeout: 40_000 });
      await expect(page.locator(".tikz-compiler-preview-error")).toHaveCount(0);
      await expect(page.locator(".tikz-figure-viewer")).toBeVisible();
      await page.screenshot({ path: "test-results/workbench/quiver-export-rendered.png" });
    },
  );

  /** One step of a pinch on a touchpad, as the desktop shell reports it to the window (src/touchpad-pinch.ts). */
  const touchpadPinch = (step: { ratio: number; x: number; y: number }) =>
    page.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent("touchpad-pinch", { detail }));
    }, step);

  story(
    { document: String.raw`\begin{tikzpicture}\draw (0,0) circle (1);\draw (3,0) circle (1);\end{tikzpicture}` },
    "a touchpad pinch that the desktop shell reports zooms the render view by its ratio, about its place",
    async function () {
      // In the desktop app a pinch over the render view magnified the whole window (issue #18).
      await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
      await expect(page.locator(".tikz-view-status")).toContainText("Up to date", { timeout: 40_000 });
      const figure = page.locator(".tikz-figure-viewer .viewer-canvas img");
      await expect(figure).toBeVisible();
      const opened = await layoutBox(figure);
      // The pointer is on a place of the figure a quarter across and three quarters down.
      const place = { x: opened.x + opened.width / 4, y: opened.y + (opened.height * 3) / 4 };
      for (const ratio of [1.25, 1.2, 4 / 3]) {
        await touchpadPinch({ ratio, ...place });
      }
      await expect
        .poll(async () => (await layoutBox(figure)).width / opened.width, {
          message: "The pinch did not zoom the rendered figure to twice its size",
        })
        .toBeCloseTo(2, 2);
      const zoomed = await layoutBox(figure);
      assert.ok(
        Math.abs(zoomed.x + zoomed.width / 4 - place.x) <= 1 && Math.abs(zoomed.y + (zoomed.height * 3) / 4 - place.y) <= 1,
        `The place under the pinch moved: ${JSON.stringify({ opened, zoomed })}`,
      );
      // A pinch with the pointer on the document bar is not a pinch on the figure.
      const bar = await layoutBox(page.locator(".document-bar"));
      await touchpadPinch({ ratio: 2, x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 });
      await touchpadPinch({ ratio: 0.5, ...place });
      await expect
        .poll(async () => (await layoutBox(figure)).width / opened.width, {
          message: "The pinch did not zoom the rendered figure back",
        })
        .toBeCloseTo(1, 2);
    },
  );

  story({}, "a touchpad pinch that the desktop shell reports zooms Quiver by its ratio", async function () {
    // In the desktop app a pinch over Quiver magnified the whole window (issue #18). Quiver zooms about
    // the centre of its view, as its own wheel with Shift does.
    await page.locator(".cm-content").fill(String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`);
    const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]');
    await expect(quiver.locator(".vertex")).toHaveCount(2, { timeout: 30_000 });
    const frame = await layoutBox(page.locator('iframe[title="Quiver diagram editor"]'));
    const place = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    /** The distance between the two vertices, in the window. */
    const gap = async () => {
      const [first, second] = await quiver
        .locator(".vertex")
        .evaluateAll((vertices) => vertices.map((vertex) => vertex.getBoundingClientRect().x));
      return second - first;
    };
    const opened = await gap();
    for (const ratio of [1.25, 1.2, 4 / 3]) {
      await touchpadPinch({ ratio, ...place });
    }
    await expect
      .poll(async () => (await gap()) / opened, { message: "The pinch did not zoom Quiver to twice its size" })
      .toBeCloseTo(2, 2);
    await touchpadPinch({ ratio: 0.5, ...place });
    await expect.poll(async () => (await gap()) / opened, { message: "The pinch did not zoom Quiver back" }).toBeCloseTo(1, 2);
  });

  /** Two presses on an empty cell of Quiver: the first shows the focus point there, and the second makes a vertex. */
  async function addQuiverVertex(at: { x: number; y: number }): Promise<void> {
    const focusPoint = page.frameLocator('iframe[title="Quiver diagram editor"]').locator(".focus-point");
    await page.mouse.click(at.x, at.y);
    await expect(focusPoint, "The press was not on an empty cell of Quiver").toHaveClass(/revealed/);
    await page.mouse.click(at.x, at.y);
  }

  story({}, "the first vertex that presses add in the Quiver view reaches the source", async function () {
    const code = page.locator(".cm-content");
    await code.fill(String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`);
    const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]');
    await expect(quiver.locator(".vertex")).toHaveCount(2, { timeout: 30_000 });
    const box = await layoutBox(page.locator('iframe[title="Quiver diagram editor"]'));
    await addQuiverVertex({ x: box.x + box.width * 0.75, y: box.y + box.height * 0.75 });
    await expect(quiver.locator(".vertex")).toHaveCount(3);
    await expect
      .poll(() => code.innerText(), { message: "The vertex that Quiver shows did not reach the source" })
      .toContain(String.raw`\bullet`);
  });

  story({}, "Undo after a label and a new vertex in Quiver takes back only the vertex", async function () {
    const bar = page.locator(".document-bar");
    const code = page.locator(".cm-content");
    await code.fill(String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`);
    const quiver = page.frameLocator('iframe[title="Quiver diagram editor"]');
    await expect(quiver.locator(".vertex")).toHaveCount(2, { timeout: 30_000 });
    await quiver.locator(".vertex").nth(1).click();
    const label = quiver.locator(".label-input");
    await label.click();
    await page.keyboard.press("Control+A");
    await label.pressSequentially("Typed", { delay: 150 });
    await expect.poll(() => code.innerText(), { message: "The Quiver label did not reach the source" }).toContain("Typed");
    await page.keyboard.press("Escape");
    const box = await layoutBox(page.locator('iframe[title="Quiver diagram editor"]'));
    await addQuiverVertex({ x: box.x + box.width * 0.75, y: box.y + box.height * 0.75 });
    await expect(quiver.locator(".vertex")).toHaveCount(3);
    await expect
      .poll(() => code.innerText(), { message: "The vertex that Quiver shows did not reach the source" })
      .toContain(String.raw`\bullet`);

    await bar.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => code.innerText(), { message: "Undo did not take back the vertex" }).not.toContain(String.raw`\bullet`);
    assert.ok((await code.innerText()).includes("Typed"), "Undo took back the label together with the vertex");
    await expect(quiver.locator(".vertex")).toHaveCount(2);
  });

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `reaches zoom and canvas aids by touch in ${tablet.name}`,
      async function () {
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
        await tap(frame.getByRole("button", { name: "Zoom and display", exact: true }));
        await tap(frame.getByRole("button", { name: "Rulers", exact: true }));
        await tap(frame.getByRole("button", { name: "200%", exact: true }));
        const after = await editorDebug(page);
        assert.equal(after.canvasAids.rulers, !before.canvasAids.rulers);
        assert.notEqual(after.viewport.scale, before.viewport.scale);
        await expect(frame.getByRole("button", { name: "200%", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `lands drawn points on the lattice by default, under a lock toggle on the rail, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const drawLine = async () => {
          const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
          // Screen position of lattice coordinates (x, y), from the two reference segments of length 10.
          const at = (x: number, y: number) => ({
            x:
              frameBox.x +
              origin.x +
              ((xTen.x - origin.x) * x) / 10 +
              ((yTen.x - origin.x) * y) / 10,
            y:
              frameBox.y +
              origin.y +
              ((xTen.y - origin.y) * x) / 10 +
              ((yTen.y - origin.y) * y) / 10,
          });
          await chooseShape(frame, input, "Line");
          const [from, to] = [at(3.5, 2.5), at(6.5, 4.5)];
          await input.penStroke([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to]);
          await expect
            .poll(async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length)
            .toBeGreaterThan(2);
          const lines = (await editorDebug(page)).source
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"));
          const added = lines[lines.length - 1];
          await input.touch([
            await stableCenter(documentHistory("Undo")),
          ]);
          // The next line must not be read back from this one: wait for the undo to land.
          await expect
            .poll(async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length)
            .toBe(2);
          return [...added.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        };
        const locked = await drawLine();
        assert.ok(
          locked.length >= 4 && locked.every(Number.isInteger),
          `A line drawn with default settings leaves the lattice: ${locked}`,
        );
        await setSnapRule(frame, input, "Lattice", false);
        // Zoomed out, a lattice cell is a few pixels wide: points still move freely.
        const zoom = zoomControl(frame);
        await input.touch([await stableCenter(zoom)]);
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "10%", exact: true })),
        ]);
        await input.touch([await stableCenter(zoom)]);
        await expect(zoom).toHaveText("10%");
        const free = await drawLine();
        assert.ok(
          free.some((value) => !Number.isInteger(value)),
          `With the lock off the line still lands on the lattice: ${free}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `turns all snapping off with one tap and back on with the rules it had in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        // Draws a line from (3.5, 2.5) to (6.5, 4.5), reads its numbers, and undoes it.
        const drawLine = async () => {
          const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
          const at = (x: number, y: number) => ({
            x: frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
            y: frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
          });
          await chooseShape(frame, input, "Line");
          const [from, to] = [at(3.5, 2.5), at(6.5, 4.5)];
          await input.penStroke([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to]);
          const draws = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
          await expect.poll(draws).toBe(3);
          const added = (await editorDebug(page)).source
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"))
            .at(-1)!;
          await tap(documentHistory("Undo"));
          await expect.poll(draws).toBe(2);
          return [...added.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        };
        // Inkscape's snap toolbar: one toggle (win.snap-global-toggle, "Snapping") and a popover button beside it.
        const snapping = snapToggle(frame);
        const rulesButton = frame.getByRole("button", { name: "Snapping rules", exact: true });
        const popup = frame.getByRole("dialog", { name: "Tool options" });
        const rules = ["Lattice", "Objects", "Alignment", "Angle"] as const;
        const ruleStates = async () => {
          await tap(rulesButton);
          await expect(popup).toBeVisible();
          const states = [];
          for (const name of rules) {
            const rule = popup.getByRole("button", { name, exact: true });
            states.push([name, await rule.getAttribute("aria-pressed"), await rule.isEnabled()]);
          }
          const text = (await popup.innerText()).replace(/\s+/g, " ").trim();
          await tap(rulesButton);
          await expect(popup).toHaveCount(0);
          return { states, text };
        };
        await expect(snapping).toHaveAttribute("aria-pressed", "true");
        // Angle starts off and Objects is turned off, so the restore below is of the rules, not of the defaults.
        await setSnapRule(frame, input, "Objects", false);
        assert.deepEqual(await ruleStates(), {
          states: [
            ["Lattice", "true", true],
            ["Objects", "false", true],
            ["Alignment", "true", true],
            ["Angle", "false", true],
          ],
          text: "Snapping Lattice Objects Alignment Angle",
        });
        const locked = await drawLine();
        assert.ok(locked.length >= 4 && locked.every(Number.isInteger), `Snapping on leaves the lattice: ${locked}`);

        await tap(snapping);
        await expect(snapping).toHaveAttribute("aria-pressed", "false");
        const free = await drawLine();
        assert.ok(free.some((value) => !Number.isInteger(value)), `Snapping off still lands on the lattice: ${free}`);
        // With snapping off the rules keep their states and cannot be changed, as Inkscape disables them.
        assert.deepEqual((await ruleStates()).states, [
          ["Lattice", "true", false],
          ["Objects", "false", false],
          ["Alignment", "true", false],
          ["Angle", "false", false],
        ]);

        await tap(snapping);
        await expect(snapping).toHaveAttribute("aria-pressed", "true");
        assert.deepEqual((await ruleStates()).states, [
          ["Lattice", "true", true],
          ["Objects", "false", true],
          ["Alignment", "true", true],
          ["Angle", "false", true],
        ]);
        const restored = await drawLine();
        assert.ok(restored.every(Number.isInteger), `Snapping back on leaves the lattice: ${restored}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows one snapping toggle, with lattice, object, alignment and angle rules behind it, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \node[draw] (A) at (5,5) {A};
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const node = frame.locator('svg [data-source-id="path:2"]').first();
        await expect(node).toBeAttached();
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await fitDiagram(frame, input);
        const rail = drawingToolbar(frame);
        const popup = frame.getByRole("dialog", { name: "Tool options" });
        // At rest snapping is on, and the rail holds no separate lattice or angle toggles.
        await expect(snapToggle(frame)).toHaveAttribute("aria-pressed", "true");
        const snap = frame.getByRole("button", { name: "Snapping rules", exact: true });
        await expect(
          rail.getByRole("button", { name: "Lock to lattice", exact: true }),
        ).toHaveCount(0);
        await expect(
          rail.getByRole("button", { name: "Constrain geometry", exact: true }),
        ).toHaveCount(0);
        // The zoom popup keeps the view settings only.
        const zoom = zoomControl(frame);
        await tap(zoom);
        await expect(popup.getByRole("button", { name: "Grid", exact: true })).toBeVisible();
        for (const name of ["Lattice", "Objects", "Alignment", "Angle"]) {
          await expect(popup.getByRole("button", { name, exact: true })).toHaveCount(0);
        }
        await tap(zoom);
        await expect(popup).toHaveCount(0);
        // The rules button shows every rule with its state.
        await tap(snap);
        const rule = (name: SnapRule) => popup.getByRole("button", { name, exact: true });
        for (const [name, pressed] of [
          ["Lattice", "true"],
          ["Objects", "true"],
          ["Alignment", "true"],
          ["Angle", "false"],
        ] as const) {
          await expect(rule(name)).toHaveAttribute("aria-pressed", pressed);
        }
        await storyScreenshot(page, `snap-control-${tablet.name}`);
        // Each rule turns on and off by itself, and the settings follow.
        await tap(rule("Lattice"));
        await tap(rule("Objects"));
        await tap(rule("Alignment"));
        await tap(rule("Angle"));
        const canvas = (await editorDebug(page)).settings.canvas;
        assert.deepEqual(
          {
            latticeLock: canvas.latticeLock,
            snapObjects: canvas.snapObjects,
            snapAlignment: canvas.snapAlignment,
            constrainGeometry: canvas.constrainGeometry,
          },
          { latticeLock: false, snapObjects: false, snapAlignment: false, constrainGeometry: true },
        );
        await tap(rule("Angle"));
        await tap(rule("Objects"));
        await expect(rule("Objects")).toHaveAttribute("aria-pressed", "true");
        await tap(snap);
        await expect(popup).toHaveCount(0);
        // Object snapping: a line started at the node's edge is attached to the node in the source.
        const drawFromNodeEdge = async () => {
          const box = (await node.boundingBox())!;
          await chooseShape(frame, input, "Line");
          const from = { x: box.x + box.width, y: box.y + box.height / 2 };
          await input.penStroke([
            from,
            { x: from.x + 60, y: from.y + 40 },
            { x: from.x + 120, y: from.y + 80 },
          ]);
          const draws = async () =>
            ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
          await expect.poll(draws).toBe(3);
          const added = (await editorDebug(page)).source
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"))
            .at(-1)!;
          await tap(documentHistory("Undo"));
          await expect.poll(draws).toBe(2);
          return added;
        };
        const attached = await drawFromNodeEdge();
        assert.match(
          attached,
          /\(A(\.[a-z ]+)?\)/,
          `With Objects on, the line is not attached to the node: ${attached}`,
        );
        await setSnapRule(frame, input, "Objects", false);
        const loose = await drawFromNodeEdge();
        assert.doesNotMatch(
          loose,
          /\(A[.)]/,
          `With Objects off, the line is still attached to the node: ${loose}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `names the snap target it chooses, object points before alignment before the lattice, at two zooms and on a scaled lattice, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        // Axes of length 10; a line off the lattice; two crossing lines; a circle; a circle whose
        // left edge x = 2.4 competes with the endpoint (2.3,1.4) as an alignment guide.
        const figure = (options: string) => String.raw`\begin{tikzpicture}${options}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2.3,1.4) -- (5.3,3.4);
\draw (3,5.3) -- (7,5.3);
\draw (5.4,3) -- (5.4,7);
\draw (8.4,7.6) circle (0.9);
\draw (3,9.6) circle (0.6);
\end{tikzpicture}`;
        const load = async (source: string) => {
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await pasteCode(page, source);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await expect.poll(async () => (await editorDebug(page)).source.trim()).toBe(source);
          await editorReady(page);
        };
        await load(figure(""));
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        // Screen position of lattice coordinates (x, y), from the two axes of length 10.
        const lattice = async () => {
          const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
          return (x: number, y: number) => ({
            x:
              frameBox.x +
              origin.x +
              ((xTen.x - origin.x) * x) / 10 +
              ((yTen.x - origin.x) * y) / 10,
            y:
              frameBox.y +
              origin.y +
              ((xTen.y - origin.y) * x) / 10 +
              ((yTen.y - origin.y) * y) / 10,
          });
        };
        const target = frame.locator("[data-snap-target]").first();
        const draws = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
        // Hovers a pen at `start`, checks the named target, draws a line to `end` whose target is
        // named too, and returns the committed line's coordinates after undoing it.
        const draw = async (
          start: { x: number; y: number },
          startTarget: string,
          end: { x: number; y: number },
          endTarget: string,
        ) => {
          await chooseShape(frame, input, "Line");
          await input.penHover(start);
          await expect(target).toHaveAttribute("data-snap-target", startTarget);
          await input.penDown(start);
          await input.penMove({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
          await input.penMove(end);
          await expect(target).toHaveAttribute("data-snap-target", endTarget);
          await input.penUp(end);
          await expect.poll(draws).toBe(8);
          const added = (await editorDebug(page)).source
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"))
            .at(-1)!;
          await tap(documentHistory("Undo"));
          await expect.poll(draws).toBe(7);
          return [...added.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        };
        await fitDiagram(frame, input);
        let at = await lattice();
        // An endpoint beats the alignment guide 0.1 units away and the lattice; the far end lands on the lattice.
        assert.deepEqual(
          await draw(at(2.3, 1.4), "Endpoint", at(6, 1), "Lattice"),
          [2.3, 1.4, 6, 1],
          "The line does not start at the endpoint it named",
        );
        await chooseShape(frame, input, "Line");
        await input.penHover(at(2.3, 1.4));
        await expect(target).toHaveAttribute("data-snap-target", "Endpoint");
        await storyScreenshot(page, `snap-target-${tablet.name}`);
        assert.deepEqual(
          await draw(at(8.4, 7.6), "Centre", at(6, 1), "Lattice"),
          [8.4, 7.6, 6, 1],
          "The line does not start at the circle centre it named",
        );
        assert.deepEqual(
          await draw(at(5.4, 5.3), "Intersection", at(6, 1), "Lattice"),
          [5.4, 5.3, 6, 1],
          "The line does not start at the crossing it named",
        );
        // No object point near (6, 8.5): the circle's top aligns the y coordinate and the lattice owns x.
        assert.deepEqual(
          await draw(at(6, 8.5), "Aligned with top", at(6, 1), "Lattice"),
          [6, 8.5, 6, 1],
          "The line does not start on the alignment guide it named",
        );
        // Twelve pixels short of the endpoint is out of reach: no object target, so the lattice takes the point.
        const shy = { x: at(2.3, 1.4).x - 12, y: at(2.3, 1.4).y };
        assert.deepEqual(
          await draw(shy, "Lattice", at(6, 1), "Lattice"),
          [2, 1, 6, 1],
          "A pointer out of reach of the endpoint is still pulled to it",
        );
        // The same figure on a lattice of 2 cm steps, at a zoom preset other than the fit.
        await load(figure("[x=2cm,y=2cm]"));
        await fitDiagram(frame, input);
        const zoom = zoomControl(frame);
        const fitZoom = await zoom.innerText();
        await tap(zoom);
        await tap(frame.getByRole("button", { name: "50%", exact: true }));
        await tap(zoom);
        await expect(zoom).toHaveText("50%");
        assert.notEqual(fitZoom, "50%", "The preset zoom is the fit zoom");
        at = await lattice();
        assert.deepEqual(
          await draw(at(2.3, 1.4), "Endpoint", at(6, 1), "Lattice"),
          [2.3, 1.4, 6, 1],
          "On the scaled lattice the line does not start at the endpoint it named",
        );
        const shyScaled = { x: at(2.3, 1.4).x - 12, y: at(2.3, 1.4).y };
        assert.deepEqual(
          await draw(shyScaled, "Lattice", at(6, 1), "Lattice"),
          [2, 1, 6, 1],
          "On the scaled lattice a pointer out of reach of the endpoint is still pulled to it",
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `constrains an arrow's angle, a square, and an axis move, aligns to a bottom and a side, takes circle and arc radii from the centre, and ends an arc on a common angle or a lattice point of its ray, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \draw (8,8) circle (3);
        \draw (-3,-3) rectangle (-1,-1);
        \draw (-3,4.5) -- (-1,4.5);
        \path[use as bounding box] (-6,-6) rectangle (14,14);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const rectangle = frame.locator('svg [data-source-id="path:3"]').first();
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        // The screen point `dx`, `dy` lattice units away from `from`.
        const offset = (from: { x: number; y: number }, dx: number, dy: number) => ({
          x: from.x + at(dx, dy).x - at(0, 0).x,
          y: from.y + at(dx, dy).y - at(0, 0).y,
        });
        const target = frame.locator("[data-snap-target]").first();
        const draws = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
        const lastDraw = async () =>
          (await editorDebug(page)).source
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"))
            .at(-1)!;
        const numbers = (text: string) =>
          [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        // A tool tap on a diagram whose geometry is still recomputing is dropped, so an undo waits for the editor to settle.
        const undo = async () => {
          await tap(documentHistory("Undo"));
          await expect.poll(draws).toBe(5);
          await editorReady(page);
        };
        const pick = async (choice: string) => {
          await chooseShape(frame, input, choice);
        };
        // Drags a pen from `from` to `to` in two moves, checks the target the last move names, and lifts.
        const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, named: string) => {
          await input.penDown(from);
          await input.penMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
          await input.penMove(to);
          await expect(target).toHaveAttribute("data-snap-target", named);
          await input.penUp(to);
          await expect.poll(draws).toBe(6);
          return lastDraw();
        };
        const angle = (raw: string) => {
          const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
          return pair
            ? (Math.atan2(Number(pair[1]), Number(pair[2])) * 180) / Math.PI + Number(pair[3] ?? 0)
            : Number(raw.replace(/[{}]/g, ""));
        };
        const arcAngles = (arc: string) => ({
          start: angle(/start angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]),
          end: angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]),
        });

        // Angle snapping alone: an arrow drawn at 12.9 degrees is written at 15.
        await setSnapRule(frame, input, "Lattice", false);
        await setSnapRule(frame, input, "Alignment", false);
        await setSnapRule(frame, input, "Angle", true);
        await pick("Arrow");
        const arrow = await drag(at(2, 1), at(5.5, 1.8), "Angle");
        assert.match(arrow, /^\\draw\[->\]/, arrow);
        const [x0, y0, x1, y1] = numbers(arrow.replace(/^\\draw\[->\]/, ""));
        const arrowAngle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
        assert.ok(Math.abs(arrowAngle - 15) < 0.1, `The arrow is at ${arrowAngle} degrees: ${arrow}`);
        await undo();
        // The rectangle tool draws a square and names the constraint.
        await pick("Rectangle");
        const square = await drag(at(1, -3), at(4, -1.5), "Square");
        const [sx0, sy0, sx1, sy1] = numbers(square);
        assert.ok(
          Math.abs(sx1 - sx0) > 1 && Math.abs(Math.abs(sx1 - sx0) - Math.abs(sy1 - sy0)) < 0.05,
          `The constrained rectangle is ${sx1 - sx0} by ${sy1 - sy0}: ${square}`,
        );
        await undo();
        // A selection move stays on its dominant axis and names it.
        await chooseTool(frame, input, "Lasso");
        const grip = await strokePoint(page, rectangle, 0.06);
        await input.penDown(grip);
        await input.penMove(offset(grip, 1.5, 0.4));
        await input.penMove(offset(grip, 3, 0.8));
        await expect(target).toHaveAttribute("data-snap-target", "Axis");
        await input.penUp(offset(grip, 3, 0.8));
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toMatch(/\((-?[\d.]+),-3\) rectangle \((-?[\d.]+),-1\)/);
        const moved = numbers(
          /\((-?[\d.]+),-3\) rectangle \((-?[\d.]+),-1\)/.exec((await editorDebug(page)).source)![0],
        );
        assert.ok(
          Math.abs(moved[0]) < 0.1 && Math.abs(moved[2] - 2) < 0.1,
          `The axis move left the rectangle at x ${moved[0]} to ${moved[2]}`,
        );
        await tap(documentHistory("Undo"));
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toContain("(-3,-3) rectangle (-1,-1)");

        // Alignment snapping alone: the dragged rectangle's bottom meets the circle's bottom, then its left side meets the circle's right side.
        await setSnapRule(frame, input, "Angle", false);
        await setSnapRule(frame, input, "Alignment", true);
        // `dx`, `dy` move the rectangle's centre from (-2,-2) in lattice units.
        const slide = async (dx: number, dy: number, named: string, expected: RegExp) => {
          const from = await strokePoint(page, rectangle, 0.06);
          const to = offset(from, dx, dy);
          await input.penDown(from);
          for (let step = 1; step <= 8; step++) {
            await input.penMove({
              x: from.x + ((to.x - from.x) * step) / 8,
              y: from.y + ((to.y - from.y) * step) / 8,
            });
          }
          await expect(target).toHaveAttribute("data-snap-target", named);
          await input.penUp(to);
          await expect.poll(async () => (await editorDebug(page)).source).toMatch(expected);
          await tap(documentHistory("Undo"));
          await expect
            .poll(async () => (await editorDebug(page)).source)
            .toContain("(-3,-3) rectangle (-1,-1)");
          await editorReady(page);
        };
        // The rectangle's bottom meets the circle's bottom at y=5; its left side then meets the circle's right side at x=11.
        await slide(0.5, 8.15, "Aligned with bottom", /\(-2\.\d+,5\) rectangle \(-0\.\d+,7\)/);
        await slide(13.95, 2.5, "Aligned with right", /\(11,-0\.\d+\) rectangle \(13,1\.\d+\)/);

        // The circle and arc tools take the radius from the centre; the written radius is the lattice distance.
        await setSnapRule(frame, input, "Alignment", false);
        await setSnapRule(frame, input, "Lattice", true);
        await pick("Circle");
        const circle = await drag(at(2, -4), at(5, -4), "Lattice");
        assert.match(circle, /\(2,-4\) circle \(3cm\)/, circle);
        await undo();
        await pick("Arc");
        const ray = (centre: { x: number; y: number }, radius: number, degrees: number) =>
          at(
            centre.x + radius * Math.cos((degrees * Math.PI) / 180),
            centre.y + radius * Math.sin((degrees * Math.PI) / 180),
          );
        // Centre (10,-3), radius point (12,-1): the half circle ends on the lattice point (8,-5) of that ray.
        for (const point of [at(10, -3), at(12, -1)]) await input.penStroke([point]);
        for (const degrees of [90, 135, 180]) await input.penHover(ray({ x: 10, y: -3 }, Math.SQRT2 * 2, degrees));
        const halfEnd = ray({ x: 10, y: -3 }, Math.SQRT2 * 2, 227);
        await input.penHover(halfEnd);
        await expect(target).toHaveAttribute("data-snap-target", "Lattice");
        await input.penStroke([halfEnd]);
        await expect.poll(draws).toBe(6);
        const half = await lastDraw();
        assert.match(half, /^\\draw \(12,-1\) arc\[/, half);
        assert.match(half, /radius=\{sqrt\(8\)\*1cm\}/, half);
        const halfAngles = arcAngles(half);
        assert.ok(
          Math.abs(halfAngles.end - halfAngles.start - 180) < 1e-6 && Math.abs(((halfAngles.end % 360) + 360) % 360 - 225) < 1e-6,
          `The half circle runs from ${halfAngles.start} to ${halfAngles.end}: ${half}`,
        );
        await undo();
        // Radius 3 has no lattice point near 31 degrees, so the common angle 30 takes the end.
        assert.equal((await editorDebug(page)).tool, "addArc", "the Arc tool stays active across a commit and an undo");
        for (const point of [at(10, -3), at(13, -3)]) await input.penStroke([point]);
        const thirtyEnd = ray({ x: 10, y: -3 }, 3, 31);
        for (const degrees of [8, 20]) await input.penHover(ray({ x: 10, y: -3 }, 3, degrees));
        await input.penHover(thirtyEnd);
        await expect(target).toHaveAttribute("data-snap-target", "Angle");
        await input.penStroke([thirtyEnd]);
        await expect.poll(draws).toBe(6);
        const thirty = await lastDraw();
        assert.match(thirty, /radius=\{3cm\}/, thirty);
        const thirtyAngles = arcAngles(thirty);
        assert.ok(
          Math.abs(thirtyAngles.end - 30) < 1e-6 && Math.abs(thirtyAngles.start) < 1e-6,
          `The arc runs from ${thirtyAngles.start} to ${thirtyAngles.end}: ${thirty}`,
        );
        await undo();
        // A centre on an object point off the lattice still takes an arc; its end lands on the common angle 90.
        await input.penHover(at(-1, 4.5));
        await expect(target).toHaveAttribute("data-snap-target", "Endpoint");
        for (const point of [at(-1, 4.5), at(1, 5)]) await input.penStroke([point]);
        const upEnd = ray({ x: -1, y: 4.5 }, Math.sqrt(4.25), 91);
        for (const degrees of [40, 70]) await input.penHover(ray({ x: -1, y: 4.5 }, Math.sqrt(4.25), degrees));
        await input.penHover(upEnd);
        await expect(target).toHaveAttribute("data-snap-target", "Angle");
        await input.penStroke([upEnd]);
        await expect.poll(draws).toBe(6);
        const up = await lastDraw();
        assert.match(up, /^\\draw \(1,5\) arc\[/, up);
        const upAngles = arcAngles(up);
        assert.ok(Math.abs(upAngles.end - 90) < 1e-6, `The arc ends at ${upAngles.end}: ${up}`);
        await storyScreenshot(page, `constrained-constructions-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `commits the locked curve its preview shows, with lattice control points, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await expect(snapToggle(frame)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await chooseShape(frame, input, "Curve");
        assert.equal((await editorDebug(page)).tool, "addBezier");
        await input.penStroke([at(2, 1), at(5, 1), at(8, 1)]);
        await input.penDown(at(5, 1));
        // A bend one unit off the chord puts unrounded controls 4/3 of a unit off it.
        await input.penMove(at(5.1, 1.6));
        await input.penMove(at(5.1, 2.1));
        const preview = frame.getByTestId("canvas-tool-preview-bezier");
        await expect(preview).toBeAttached();
        const numbers = (d: string) =>
          [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        const previewed = numbers((await preview.getAttribute("d"))!);
        await input.penUp(at(5.1, 2.1));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\.\. controls/);
        const curve = (await editorDebug(page)).source
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.includes(".. controls"))!;
        assert.ok(
          numbers(curve).every(Number.isInteger),
          `A locked curve has off-lattice points: ${curve}`,
        );
        const committed = numbers(
          (await frame.locator('svg [data-source-id="path:2"]').first().getAttribute("d"))!,
        );
        assert.equal(
          committed.length,
          previewed.length,
          `preview ${previewed} vs committed ${committed}`,
        );
        assert.ok(
          committed.every((value, index) => Math.abs(value - previewed[index]) < 0.05),
          `The preview showed ${previewed}; the editor committed ${committed}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows an alignment guide when a dragged square meets a circle's top, locked and free, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \draw (0,0) circle (2);
        \draw (4,-6) rectangle (6,-4);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:3"]').first()).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await chooseTool(frame, input, "Lasso");
        const guides = frame.locator('[class*="snapOverlay"] [class*="snapLine"]');
        for (const locked of [true, false]) {
          await setSnapRule(frame, input, "Lattice", locked);
          // Grab the square's left edge and lift its top edge from y = -4 to the circle's top, y = 2.
          const grab = at(4, -5);
          await input.penDown(grab);
          for (let step = 1; step <= 12; step++) {
            await input.penMove(at(4, -5 + step / 2));
          }
          // The drag is live: the square's top edge is drawn at the circle's top.
          await expect(async () => {
            const top = (await layoutBox(frame.locator('svg [data-source-id="path:3"]').first())).y;
            expect(Math.abs(top - at(0, 2).y)).toBeLessThan(3);
          }).toPass({ timeout: 5_000 });
          // A horizontal guide has no height, so Playwright's area-based visibility cannot judge it; require a drawn length and stroke.
          await expect(async () => {
            const drawn = await guides.first().evaluate((line) => {
              const box = line.getBoundingClientRect();
              const style = getComputedStyle(line);
              return (
                Math.max(box.width, box.height) > 20 &&
                style.visibility === "visible" &&
                style.stroke !== "none" &&
                Number(style.opacity) > 0
              );
            });
            expect(drawn, "The alignment guide is drawn").toBe(true);
          }).toPass({ timeout: 5_000 });
          await storyScreenshot(
            page,
            `alignment-guide-${locked ? "locked" : "free"}-${tablet.name}`,
          );
          await input.penUp(at(4, 1));
          await expect.poll(async () => (await editorDebug(page)).source).toMatch(/rectangle/);
          await input.touch([
            await stableCenter(documentHistory("Undo")),
          ]);
          await expect
            .poll(async () => (await editorDebug(page)).source)
            .toContain("(4,-6) rectangle (6,-4)");
        }
        // With alignment snapping off the same drag draws no guide.
        await setSnapRule(frame, input, "Alignment", false);
        await input.penDown(at(4, -5));
        for (let step = 1; step <= 12; step++) {
          await input.penMove(at(4, -5 + step / 2));
        }
        await expect(async () => {
          const top = (await layoutBox(frame.locator('svg [data-source-id="path:3"]').first())).y;
          expect(Math.abs(top - at(0, 2).y)).toBeLessThan(3);
        }).toPass({ timeout: 5_000 });
        await expect(guides).toHaveCount(0);
        await input.penUp(at(4, 1));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/rectangle/);
        await input.touch([
          await stableCenter(documentHistory("Undo")),
        ]);
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toContain("(4,-6) rectangle (6,-4)");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `labels both rulers in whole centimetres at Inkscape's step and subdivision for every zoom, under the tooltip "cm", in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}[x=2cm,y=2cm]
        \draw (0,0) -- (5,0);
        \draw (0,0) -- (0,5);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        // Screen position of the origin and screen pixels per centimetre along x and y,
        // from the segments of 5 figure units of 2 cm each.
        const axes = () =>
          Promise.all(
            ["path:0", "path:1"].map((id) =>
              frame
                .locator(`svg [data-source-id="${id}"]`)
                .first()
                .evaluate((path: SVGGeometryElement) => {
                  const m = path.getScreenCTM()!;
                  const [start, end] = [0, path.getTotalLength()].map((length) => {
                    const p = path.getPointAtLength(length);
                    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
                  });
                  return { origin: start, perCm: { x: (end.x - start.x) / 10, y: (end.y - start.y) / 10 } };
                }),
            ),
          );
        // The ruler's length, its label font size, and every tick's screen position with its label:
        // each tick's group is translated to the tick.
        const ruler = (testId: string, axis: "x" | "y") =>
          frame.getByTestId(testId).evaluate((svg: SVGSVGElement, along) => {
            const box = svg.getBoundingClientRect();
            const label = svg.querySelector("text");
            return {
              lengthPx: along === "x" ? box.width : box.height,
              fontPx: label ? parseFloat(getComputedStyle(label).fontSize) : NaN,
              ticks: [...svg.querySelectorAll(":scope > g")].map((group) => {
                const m = (group as SVGGElement).getScreenCTM()!;
                return { position: along === "x" ? m.e : m.f, label: group.querySelector("text")?.textContent ?? null };
              }),
            };
          }, axis);
        // Inkscape's label step in cm and its subdivision for a ruler lengthPx long at perCm px per cm
        // with labels of fontPx: the "general" metric of share/ui/units.xml:3-21 and the selection of
        // src/ui/widget/ink-ruler.cpp:217-247, both at Inkscape 70feba2.
        const inkscapeStep = (lengthPx: number, perCm: number, fontPx: number) => {
          const metric = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
          const digits = String(Math.ceil(lengthPx / perCm)).length + 1;
          const minimum = digits * Math.trunc(fontPx * 0.75) * 2;
          const step = metric.find((entry) => entry * perCm > minimum) ?? metric[metric.length - 1];
          const divide = [100, 50, 10, 5, 1].find((entry) => step * perCm >= 5 * entry)!;
          return { step, divide };
        };
        // The rule for one ruler, or the reason it is broken.
        const ruleBroken = (
          axis: "x" | "y",
          origin: { x: number; y: number },
          perCm: number,
          { lengthPx, fontPx, ticks }: { lengthPx: number; fontPx: number; ticks: { position: number; label: string | null }[] },
        ) => {
          const labelled = ticks.filter((tick) => tick.label !== null);
          if (labelled.length === 0) return "no label";
          const { step, divide } = inkscapeStep(lengthPx, Math.abs(perCm), fontPx);
          const context = JSON.stringify({ step, divide, lengthPx, perCm, fontPx });
          for (const tick of labelled) {
            const value = Number(tick.label);
            if (!Number.isInteger(value)) return `label ${tick.label} is not whole centimetres`;
            if (Math.abs(tick.position - (origin[axis] + value * perCm)) > 2) return `label ${value} is not at its centimetre (${context})`;
            if (value % step !== 0) return `label ${value} is not a multiple of Inkscape's step (${context})`;
          }
          const stepPx = Math.abs(perCm * step);
          const spacing = stepPx / divide;
          // A tick is on the step when it is nearer to a multiple of the step than to the next tick.
          const unlabelled = ticks.find((tick) => {
            const offset = (tick.position - origin[axis]) / stepPx;
            return tick.label === null && Math.abs(offset - Math.round(offset)) * stepPx < spacing / 2;
          });
          if (unlabelled) return `the tick at ${unlabelled.position} px is on Inkscape's step but has no label (${context})`;
          const positions = ticks.map((tick) => tick.position).sort((a, b) => a - b);
          const uneven = positions.slice(1).find((position, index) => Math.abs(position - positions[index] - spacing) > 0.5);
          if (uneven !== undefined) return `ticks are not ${spacing.toFixed(2)} px apart, Inkscape's subdivision (${context}): ${positions}`;
          return null;
        };
        const zoom = zoomControl(frame);
        const levels =["10%", "20%", "100%", "1000%", "Fit diagram"];
        for (const level of levels) {
          await input.touch([await stableCenter(zoom)]);
          await input.touch([await stableCenter(frame.getByRole("button", { name: level, exact: true }))]);
          await input.touch([await stableCenter(zoom)]);
          await expect
            .poll(async () => {
              const [[x, y], top, left] = await Promise.all([
                axes(),
                ruler("canvas-top-ruler", "x"),
                ruler("canvas-left-ruler", "y"),
              ]);
              const broken =
                ruleBroken("x", x.origin, x.perCm.x, top) ?? ruleBroken("y", y.origin, y.perCm.y, left);
              return broken === null ? "readable" : `${level}: ${broken}`;
            })
            .toBe("readable");
        }
        for (const testId of ["canvas-top-ruler", "canvas-left-ruler"]) {
          await expect(frame.getByTitle("cm", { exact: true }).getByTestId(testId)).toHaveCount(1);
        }
        const corner = frame.locator('[class*="rulerCorner"]');
        await expect(corner).toHaveText("");
        await expect(corner).not.toHaveAttribute("title");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `labels the rulers in centimetres when the figure scales its lattice in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}[x=2cm,y=2cm]
        \draw (0,0) -- (10,0);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const axis = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(axis).toBeAttached();
        // The startup view depends on the canvas size at mount; the user fits the figure through the zoom popup.
        await fitDiagram(frame, await TabletInput.attach(page));
        // Screen x of x = 0 and the screen width of one centimetre, from the segment (0,0) -- (10,0) of 20 cm.
        const centimetre = () =>
          axis.evaluate((path: SVGGeometryElement) => {
            const m = path.getScreenCTM()!;
            const start = path.getPointAtLength(0);
            const end = path.getPointAtLength(path.getTotalLength());
            const origin = start.x * m.a + start.y * m.c + m.e;
            return { origin, unit: (end.x * m.a + end.y * m.c + m.e - origin) / 20 };
          });
        // Each label with its tick's screen x: the label's group is translated to the tick.
        const labels = () =>
          frame
            .getByTestId("canvas-top-ruler")
            .locator("text")
            .evaluateAll((texts) =>
              texts.map((text) => ({
                label: Number(text.textContent),
                x: text.parentElement!.getBoundingClientRect().left,
              })),
            );
        // Every ruler label sits at its own centimetre once the fitted view has rendered its labels.
        await expect
          .poll(async () => {
            const [{ origin, unit }, entries] = await Promise.all([centimetre(), labels()]);
            const misplaced = entries.filter(
              (entry) => Math.abs(entry.x - (origin + entry.label * unit)) > 2,
            );
            return entries.length >= 3 && misplaced.length === 0
              ? "aligned"
              : JSON.stringify({ entries, origin, unit, misplaced });
          })
          .toBe("aligned");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `draws the axes distinct from major grid lines, undimmed, in both themes in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const axis = frame.locator('line[class*="gridAxis"]').first();
        const major = frame.locator('line[class*="gridMajor"]').first();
        await expect(axis).toBeAttached();
        const look = (line: typeof axis) =>
          line.evaluate((element) => {
            let opacity = 1;
            for (let node: Element | null = element; node; node = node.parentElement) {
              opacity *= Number(getComputedStyle(node).opacity);
            }
            const rgb = getComputedStyle(element)
              .stroke.match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number);
            return { rgb, opacity, width: Number(element.getAttribute("stroke-width")) };
          });
        for (const theme of ["light", "dark"] as const) {
          if (theme === "dark") {
            await page.emulateMedia({ colorScheme: "dark" });
            await expect(frame.locator("html")).toHaveAttribute("data-color-scheme", "dark");
          }
          const [a, m] = [await look(axis), await look(major)];
          const distance = Math.hypot(...a.rgb.map((value, index) => value - m.rgb[index]));
          assert.ok(
            distance > 60,
            `${theme}: axis ${a.rgb} and major line ${m.rgb} share a colour`,
          );
          assert.ok(a.opacity >= 0.95, `${theme}: the axis is dimmed to ${a.opacity}`);
          assert.ok(a.width >= m.width + 0.5, `${theme}: axis width ${a.width}, major ${m.width}`);
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `an empty figure starts at 100 % with the origin centred, and 100 % is a preset, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const zoom = frame.getByRole("button", { name: "Zoom and display", exact: true });
        await expect(zoom).toHaveText("100%");
        const readout = (await zoom.innerText()).trim();
        // Measure the view the author sees once startup layout has settled (FR-041): the
        // origin is centred in the canvas that the rulers and the dock leave free (research R8).
        await settledCenter(frame.locator("text", { hasText: "(0,0)" }).first());
        const area = await canvasFreeArea(frame);
        const origin = await figurePoint(frame, 0, 0);
        assert.ok(
          Math.abs(origin.x - (area.left + area.right) / 2) <= 2 &&
            Math.abs(origin.y - (area.top + area.bottom) / 2) <= 2,
          `The origin ${JSON.stringify(origin)} is not centred in ${JSON.stringify(area)}`,
        );
        const input = await TabletInput.attach(page);
        // The popup lists the current zoom beside its presets, so move away first: the startup zoom must still be offered.
        await input.touch([await stableCenter(zoom)]);
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "50%", exact: true })),
        ]);
        await expect(zoom).toHaveText("50%");
        const presets = await frame.getByRole("button", { name: /^\d+%$/ }).allInnerTexts();
        assert.ok(
          presets.includes(readout),
          `startup zoom ${readout} is not among the presets ${presets}`,
        );
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: readout, exact: true })),
        ]);
        await expect(zoom).toHaveText(readout);
        await input.touch([await stableCenter(zoom)]);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      {
        viewport: tablet,
        document: String.raw`\begin{tikzpicture}\draw (0,0) circle (1);\draw (3,0) circle (1);\end{tikzpicture}`,
      },
      `a touchpad pinch that the desktop shell reports zooms the figure by its ratio, about its place, in ${tablet.name}`,
      async function () {
        // WebKitGTK gives a page no event of a pinch on a touchpad, so the desktop shell reports each step
        // of the pinch as a `touchpad-pinch` event of the window (src-tauri/src/main.rs; issue #18).
        await editorReady(page);
        const frame = editorFrame(page);
        const pinch = (detail: { ratio: number; x: number; y: number }) =>
          page.evaluate((step) => {
            window.dispatchEvent(new CustomEvent("touchpad-pinch", { detail: step }));
          }, detail);
        const scale = async () => Number((await shownTransform(frame)).scale);
        /** The centre and the width of the first circle, in the window. */
        const circle = async () => {
          const box = (await frame.locator("svg [data-source-id]").first().boundingBox())!;
          return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
        };
        await settledCenter(frame.locator("svg [data-source-id]").first());
        const opened = { scale: await scale(), circle: await circle() };

        // Three steps of a pinch whose fingers end at twice their distance, with the pointer on the circle's centre.
        for (const ratio of [1.25, 1.2, 4 / 3]) {
          await pinch({ ratio, x: opened.circle.x, y: opened.circle.y });
        }
        await expect
          .poll(async () => (await scale()) / opened.scale, { message: "The pinch did not zoom the figure to twice its size" })
          .toBeCloseTo(2, 5);
        const zoomed = await circle();
        assert.ok(
          Math.abs(zoomed.width / opened.circle.width - 2) < 0.02,
          `The circle is ${zoomed.width} px wide after the pinch, from ${opened.circle.width} px`,
        );
        assert.ok(
          Math.hypot(zoomed.x - opened.circle.x, zoomed.y - opened.circle.y) <= 1,
          `The place under the pinch moved: ${JSON.stringify({ opened: opened.circle, zoomed })}`,
        );

        // A pinch with the pointer on the document bar is not a pinch on the canvas.
        const bar = (await page.locator(".document-bar").boundingBox())!;
        await pinch({ ratio: 2, x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 });
        await pinch({ ratio: 0.5, x: zoomed.x, y: zoomed.y });
        await expect
          .poll(async () => (await scale()) / opened.scale, { message: "The pinch did not zoom the figure back" })
          .toBeCloseTo(1, 5);
        assert.equal(await page.evaluate(() => window.visualViewport!.scale), 1);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the ink of a pen stroke stays on the canvas after the pen lifts, and the thirtieth stroke is written as fast as the first, in ${tablet.name}`,
      async function () {
        // #89. The pen's mark left the canvas at the lift, and the stroke came 150 ms later in an empty
        // figure and half a second later in a figure of forty strokes. The lift itself took 80 ms for the
        // first stroke and 512 ms for the fortieth: each lift read the whole source again, each action of
        // the store read every statement four times, and every point was compared with every other point.
        // A stroke of 62 samples added 20 kB to the source.
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const source = async () => (await editorDebug(page)).source;
        const area = await canvasFreeArea(frame);
        await chooseTool(frame, input, "Pen");
        // Each frame of the canvas: whether the pen's mark is shown and how many strokes are drawn; and for
        // each lift of the pen, the time to the next frame, which the work of the lift holds back.
        await frame.locator("body").evaluate(`(() => {
          window.inkStates = [];
          window.liftTimes = [];
          let last = "";
          const frameOfCanvas = () => {
            const state = JSON.stringify({
              mark: document.querySelector('[data-tool-preview="freehand"]') !== null,
              strokes: new Set([...document.querySelectorAll('svg [data-source-id^="path:"]')].map((path) => path.getAttribute("data-source-id"))).size,
            });
            if (state !== last) { window.inkStates.push(JSON.parse(state)); last = state; }
            requestAnimationFrame(frameOfCanvas);
          };
          requestAnimationFrame(frameOfCanvas);
          window.addEventListener("pointerup", (event) => {
            if (event.pointerType !== "pen") return;
            const lifted = performance.now();
            requestAnimationFrame(() => window.liftTimes.push(performance.now() - lifted));
          }, true);
        })()`);
        const drawn = () =>
          frame.locator("body").evaluate(
            () => new Set([...document.querySelectorAll('svg [data-source-id^="path:"]')].map((path) => path.getAttribute("data-source-id"))).size,
          );
        const STROKES = 30, SAMPLES = 16, COLUMNS = 3, ROWS = STROKES / COLUMNS;
        const width = area.right - area.left, height = area.bottom - area.top;
        for (let stroke = 0; stroke < STROKES; stroke += 1) {
          const left = area.left + width * (0.06 + (0.3 * (stroke % COLUMNS))), top = area.top + height * (0.08 + (0.84 * Math.floor(stroke / COLUMNS)) / ROWS);
          await input.penStroke(
            Array.from({ length: SAMPLES }, (_, i) => ({ x: left + (i * width * 0.22) / (SAMPLES - 1), y: top + Math.sin(i) * height * 0.012 })),
          );
          // The next stroke starts when the canvas has drawn this one, so each lift is timed alone.
          await expect.poll(drawn, { message: `The canvas did not draw stroke ${stroke + 1}` }).toBe(stroke + 1);
        }
        const { states, lifts } = await frame
          .locator("body")
          .evaluate(() => ({ states: window.inkStates, lifts: window.liftTimes }));
        // No frame between a stroke's mark and the stroke itself shows neither.
        const gaps = states.filter((state, index) => index > 0 && !state.mark && states[index - 1].mark && state.strokes === states[index - 1].strokes);
        assert.deepEqual(gaps, [], `The ink left the canvas after a lift: ${JSON.stringify(states)}`);
        assert.equal(lifts.length, STROKES, "A lift of the pen was not timed");
        const median = (times: number[]) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
        const first = median(lifts.slice(0, 5)), last = median(lifts.slice(-5));
        assert.ok(
          last <= 3 * first + 50,
          `The lift of the pen takes ${Math.round(last)} ms after ${STROKES} strokes and ${Math.round(first)} ms at the start: ${lifts.map(Math.round).join(", ")}`,
        );
        // The record holds the name of each reading once and the values of each sample in a row.
        const perSample = (await source()).length / (STROKES * SAMPLES);
        assert.ok(perSample <= 200, `A sample takes ${Math.round(perSample)} bytes of the source`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a zoom step with a pen stroke selected takes no longer than with nothing selected, in ${tablet.name}`,
      async function () {
        // With a curve selected, each change of the view tried Smooth on every point of the curve, and each
        // trial parsed the whole source. A zoom step then took 1.2 s in a figure of twelve strokes, against
        // 33 ms with nothing selected; a turn of the wheel stopped the canvas for many seconds (issue #18).
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const source = async () => (await editorDebug(page)).source;
        const selection = async () => (await editorDebug(page)).selection.length;
        const area = await canvasFreeArea(frame);
        const point = (fx: number, fy: number) => ({
          x: area.left + (area.right - area.left) * fx,
          y: area.top + (area.bottom - area.top) * fy,
        });
        await chooseTool(frame, input, "Pen");
        for (let stroke = 0; stroke < 8; stroke += 1) {
          const before = await source();
          await input.penStroke(
            Array.from({ length: 16 }, (_, i) => point(0.2 + (i * 0.6) / 15, 0.2 + stroke * 0.07 + Math.sin(i) * 0.01)),
          );
          await expect.poll(source, { message: "A pen stroke changed nothing" }).not.toBe(before);
        }
        /**
         * The median time of five zoom steps by the wheel with Ctrl, in ms. A step runs from the wheel event
         * to the second frame after the canvas shows the new scale.
         */
        const zoomStep = () =>
          frame.locator('[data-canvas-viewport="true"]').evaluate(async (viewport) => {
            const box = viewport.getBoundingClientRect();
            const times: number[] = [];
            for (let step = 0; step < 5; step += 1) {
              const before = document.querySelector<HTMLElement>("[data-canvas-scale]")!.dataset.canvasScale;
              const started = performance.now();
              viewport.dispatchEvent(
                new WheelEvent("wheel", {
                  deltaY: step % 2 === 0 ? -60 : 60,
                  ctrlKey: true,
                  bubbles: true,
                  cancelable: true,
                  clientX: box.left + box.width / 2,
                  clientY: box.top + box.height / 2,
                }),
              );
              while (document.querySelector<HTMLElement>("[data-canvas-scale]")!.dataset.canvasScale === before) {
                await new Promise((resolve) => setTimeout(resolve, 4));
              }
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              times.push(performance.now() - started);
            }
            return times.sort((left, right) => left - right)[2];
          });

        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, frame.locator("svg [data-source-id]").last(), 0.5)]);
        await expect.poll(selection, { message: "The pen tap did not select the stroke" }).toBe(1);
        const selected = await zoomStep();
        await input.penStroke([point(0.9, 0.92)]);
        await expect.poll(selection, { message: "The pen tap on the empty canvas kept the selection" }).toBe(0);
        const unselected = await zoomStep();
        assert.ok(
          selected <= 3 * unselected + 50,
          `A zoom step takes ${Math.round(selected)} ms with a stroke selected and ${Math.round(unselected)} ms with nothing selected`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps the rail and its popups off the rulers, and the popups off the rail, docked bottom by default, docked left, and floating in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const rail = drawingToolbar(frame);
        await expect(rail).toBeVisible();
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const rulers = await Promise.all(
          ["canvas-top-ruler", "canvas-left-ruler"].map(async (id) => ({
            id,
            box: (await frame.getByTestId(id).boundingBox())!,
          })),
        );
        const clear = (
          what: string,
          box: { x: number; y: number; width: number; height: number },
          others: typeof rulers = [],
        ) => {
          for (const ruler of [...rulers, ...others]) {
            const overlapX =
              Math.min(box.x + box.width, ruler.box.x + ruler.box.width) -
              Math.max(box.x, ruler.box.x);
            const overlapY =
              Math.min(box.y + box.height, ruler.box.y + ruler.box.height) -
              Math.max(box.y, ruler.box.y);
            assert.ok(overlapX <= 0 || overlapY <= 0, `${what} covers ${ruler.id}`);
          }
        };
        const drag = async (to: { x: number; y: number }) => {
          const from = await dockGripPoint(rail);
          await input.touch(
            Array.from({ length: 13 }, (_, i) => ({
              x: from.x + ((to.x - from.x) * i) / 12,
              y: from.y + ((to.y - from.y) * i) / 12,
            })),
          );
        };
        const placements = [
          { dock: "bottom", to: null },
          { dock: "left", to: { x: frameBox.x + 20, y: frameBox.y + frameBox.height / 2 } },
          { dock: "floating", to: { x: frameBox.x + 130, y: frameBox.y + 150 } },
        ] as const;
        for (const placement of placements) {
          if (placement.to) {
            await drag(placement.to);
          }
          await expect(rail).toHaveAttribute("data-dock", placement.dock);
          clear(`the ${placement.dock} rail`, (await rail.boundingBox())!);
          // A tap on the active tool opens its Active Tool Menu; a tap on the active preset opens its colour options (FR-009, FR-022).
          for (const name of ["Shapes", "Text", /^Colour 1: /] as const) {
            const button =
              typeof name === "string"
                ? rail.getByRole("button", { name, exact: true })
                : rail.getByRole("button", { name });
            if ((await button.getAttribute("aria-pressed")) !== "true") {
              await input.touch([await stableCenter(button)]);
              await expect(button).toHaveAttribute("aria-pressed", "true");
            }
            await input.touch([await stableCenter(button)]);
            const popup = frame.getByRole("dialog", {
              name: typeof name === "string" ? "Active Tool Menu" : "Colour options",
            });
            await expect(popup).toBeVisible();
            // A popup beside the rail never covers its other columns or the saved colours.
            clear(
              `the ${String(name)} popup of the ${placement.dock} rail`,
              (await popup.boundingBox())!,
              [{ id: "the rail", box: (await rail.boundingBox())! }],
            );
            await input.touch([await stableCenter(button)]);
            await expect(
              popup,
              `the ${String(name)} popup of the ${placement.dock} rail stays open after a second tap`,
            ).toHaveCount(0);
          }
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `snaps a free arc's end to the nearby common angle by pen in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \path[use as bounding box] (-10,-10) rectangle (15,15);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await setSnapRule(frame, input, "Lattice", false);
        await chooseShape(frame, input, "Arc");
        assert.equal((await editorDebug(page)).tool, "addArc");
        // Centre, radius point, then an end 7 degrees short of the half circle and clear of the lattice pull.
        for (const point of [at(0, 0), at(6, 0), at(-5.955, 0.731)]) {
          await input.penStroke([point]);
        }
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/arc/);
        const arc = (await editorDebug(page)).source
          .split("\n")
          .find((line) => line.includes("arc"))!;
        // The editor writes angles as numbers or as atan2(y,x) of a lattice direction.
        const angle = (raw: string) => {
          const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
          return pair
            ? (Math.atan2(Number(pair[1]), Number(pair[2])) * 180) / Math.PI + Number(pair[3] ?? 0)
            : Number(raw.replace(/[{}]/g, ""));
        };
        const end = angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
        assert.ok(
          Math.abs(end - 180) < 1e-6,
          `The free arc ends at ${end} degrees, not 180: ${arc}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `sweeps an arc the way the pen went round, past a half circle, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \path[use as bounding box] (-10,-10) rectangle (15,15);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await chooseShape(frame, input, "Arc");
        await input.penStroke([at(0, 0)]);
        await input.penStroke([at(3, 0)]);
        // Hover counterclockwise through a quarter, a half, and five eighths of the circle, then tap at three quarters.
        for (let degrees = 10; degrees <= 260; degrees += 10) {
          const radians = (degrees * Math.PI) / 180;
          await input.penHover(at(3 * Math.cos(radians), 3 * Math.sin(radians)));
        }
        await input.penStroke([at(0, -3)]);
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/arc/);
        const arc = (await editorDebug(page)).source
          .split("\n")
          .find((line) => line.includes("arc"))!;
        const angle = (raw: string) => {
          const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
          return pair
            ? (Math.atan2(Number(pair[1]), Number(pair[2])) * 180) / Math.PI + Number(pair[3] ?? 0)
            : Number(raw.replace(/[{}]/g, ""));
        };
        const start = angle(/start angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
        const end = angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
        assert.ok(
          Math.abs(end - start - 270) < 1e-6,
          `The arc sweeps ${end - start} degrees, not 270 counterclockwise: ${arc}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `each construction on lattice points emits its TikZ and shows no sentence at any stage, in ${tablet.name}`,
      async function () {
        // FR-030, FR-031, SC-003 (T042). The constructions of several stages have stories of their own: the
        // open path, the curve, the circles on a diameter and through three points, and the arcs.
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \path[use as bounding box] (-10,-10) rectangle (15,15);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        const source = async () => (await editorDebug(page)).source;
        // A line of text that teaches is a sentence; a label is short and has no full stop (FR-031).
        const sentences = () =>
          frame.locator("body").evaluate((body) =>
            (body as HTMLElement).innerText
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 30 || /[.!?]$/.test(line)),
          );
        const shapes = toolbarItem(frame, "Shapes");
        const menu = activeToolMenu(frame);
        await setSnapRule(frame, input, "Lattice", true);

        // The Shapes menu groups its choices by family, and each choice is drawn.
        await chooseTool(frame, input, "Shapes");
        await input.touch([await stableCenter(shapes)]);
        await expect(menu).toBeVisible();
        const families = await menu.getByRole("group").evaluateAll((groups) =>
          groups.map((group) => ({
            family: group.getAttribute("aria-label"),
            // A choice shows its picture over its name; the Matrix's picture is its four entries.
            choices: [...group.querySelectorAll<HTMLElement>('[role="option"]')].map((choice) => ({
              name: choice.innerText.split("\n").at(-1),
              drawn: choice.querySelector("svg") !== null || choice.innerText.split("\n").length > 1,
            })),
          })),
        );
        const drawn = (...names: string[]) => names.map((name) => ({ name, drawn: true }));
        assert.deepEqual(families, [
          { family: "Lines and arrows", choices: drawn("Point", "Line", "Arrow", "Path") },
          { family: "Curves", choices: drawn("Curve") },
          { family: "Circles and arcs", choices: drawn("Circle", "Circle on a diameter", "Circle through three points", "Arc", "Arc through three points") },
          { family: "Shapes", choices: drawn("Rectangle", "Ellipse", "Node shape") },
          { family: "Diagrams", choices: drawn("Grid", "Matrix", "Image") },
        ]);
        assert.deepEqual(await sentences(), [], "The Shapes menu shows a sentence");
        await input.touch([await stableCenter(shapes)]);
        await expect(menu).toHaveCount(0);

        // Each construction of one gesture, from (2,2) to (5,4) or at (3,3): its statement, and one Undo removes it.
        const constructions: [string, "tap" | "drag", string][] = [
          ["Point", "tap", String.raw`\fill (3,3) circle (0.04cm);`],
          ["Line", "drag", String.raw`\draw (2,2) -- (5,4);`],
          ["Arrow", "drag", String.raw`\draw[->] (2,2) -- (5,4);`],
          ["Circle", "drag", String.raw`\draw (2,2) circle ({sqrt(13)*1cm});`],
          ["Rectangle", "drag", String.raw`\draw (2,2) rectangle (5,4);`],
          ["Ellipse", "drag", String.raw`\draw (3.5,3) ellipse [x radius=1.5cm, y radius=1cm];`],
          ["Grid", "drag", String.raw`\draw (2,2) grid (5,4);`],
        ];
        for (const [name, gesture, statement] of constructions) {
          await chooseShape(frame, input, name);
          const before = await source();
          if (gesture === "tap") {
            await input.penStroke([at(3, 3)]);
          } else {
            const from = at(2, 2), to = at(5, 4);
            await input.penDown(from);
            for (let step = 1; step <= 6; step += 1) {
              await input.penMove({ x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 });
              if (step === 3) {
                assert.deepEqual(await sentences(), [], `${name} shows a sentence during its gesture`);
              }
            }
            await input.penUp(to);
          }
          await expect.poll(source, { message: `${name} wrote nothing` }).not.toBe(before);
          const added = (await source()).split("\n").filter((line) => !before.split("\n").includes(line)).map((line) => line.trim());
          assert.deepEqual(added, [statement], name);
          assert.deepEqual(await sentences(), [], `${name} shows a sentence after its gesture`);
          await page.getByRole("button", { name: "Undo", exact: true }).click();
          await expect.poll(source, { message: `One Undo did not remove the ${name}` }).toBe(before);
          await editorReady(page);
        }

        // The Text menu offers Text and Equation, and Equation opens the equation editor.
        const text = toolbarItem(frame, "Text");
        await chooseTool(frame, input, "Text");
        await input.touch([await stableCenter(text)]);
        await expect(menu).toBeVisible();
        assert.deepEqual(
          await menu.getByRole("option").evaluateAll((choices) => choices.map((choice) => (choice as HTMLElement).innerText.split("\n").at(-1))),
          ["Text", "Equation"],
        );
        await input.touch([await stableCenter(menu.getByRole("option", { name: "Equation", exact: true }))]);
        await expect(frame.getByTestId("equation-modal"), "Equation did not open the equation editor").toBeVisible();
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `an open path ends with Finish, Cancel drops a construction, and neither shows before a point is placed, in ${tablet.name}`,
      async function () {
        // FR-032: Cancel and Finish are in the Active Tool Menu while a construction is in progress, and a
        // construction is in progress from its first placed point (FR-034). The menu showed Cancel as soon as a
        // shape was chosen, and no story finished an open path (T042).
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \path[use as bounding box] (-10,-10) rectangle (15,15);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        const source = async () => (await editorDebug(page)).source;
        const draws = async () =>
          (await source())
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"));
        const shapes = toolbarItem(frame, "Shapes");
        const menu = activeToolMenu(frame);
        const command = (name: "Finish" | "Cancel") => menu.getByRole("button", { name, exact: true });
        const openMenu = async (when: string) => {
          await input.touch([await stableCenter(shapes)]);
          await expect(menu, `A tap on Shapes did not open its menu ${when}`).toBeVisible();
        };
        await setSnapRule(frame, input, "Lattice", true);
        await chooseShape(frame, input, "Path");
        const authored = await source();

        // A chosen construction with no point placed is not in progress.
        await openMenu("before a point is placed");
        await expect(command("Finish"), "Finish shows before a point is placed").toHaveCount(0);
        await expect(command("Cancel"), "Cancel shows before a point is placed").toHaveCount(0);
        await input.touch([await stableCenter(shapes)]);
        await expect(menu).toHaveCount(0);

        // Three points of an open path; the source stays until Finish.
        for (const point of [at(2, 2), at(6, 2), at(6, 5)]) {
          await input.penStroke([point]);
        }
        assert.equal(await source(), authored, "The source changed before Finish");
        await openMenu("with three points placed");
        await expect(command("Cancel")).toBeVisible();
        await input.touch([await stableCenter(command("Finish"))]);
        await expect(menu, "Finish left the menu open").toHaveCount(0);
        await expect.poll(async () => (await draws()).length, { message: "Finish did not write the path" }).toBe(3);
        const path = (await draws())[2];
        assert.match(path, /\(2,2\)\s*--\s*\(6,2\)\s*--\s*\(6,5\)\s*;$/, path);
        const withPath = await source();
        await editorReady(page);

        // Cancel drops the placed points and writes nothing; the next taps start a new path.
        for (const point of [at(2, 7), at(5, 7)]) {
          await input.penStroke([point]);
        }
        await openMenu("with two points placed");
        await input.touch([await stableCenter(command("Cancel"))]);
        await expect(menu, "Cancel left the menu open").toHaveCount(0);
        await openMenu("after Cancel");
        await expect(command("Cancel"), "Cancel shows after the construction was dropped").toHaveCount(0);
        await input.touch([await stableCenter(shapes)]);
        await expect(menu).toHaveCount(0);
        assert.equal(await source(), withPath, "Cancel changed the source");
        for (const point of [at(8, 6), at(8, 9)]) {
          await input.penStroke([point]);
        }
        await openMenu("with the second path placed");
        await input.touch([await stableCenter(command("Finish"))]);
        await expect.poll(async () => (await draws()).length, { message: "Finish did not write the second path" }).toBe(4);
        const second = (await draws())[3];
        assert.match(second, /\(8,6\)\s*--\s*\(8,9\)\s*;$/, second);
        // One Undo takes back the path.
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect.poll(source, { message: "Undo did not take back the path" }).toBe(withPath);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `Undo during a construction takes back its last point and leaves the document, in ${tablet.name}`,
      async function () {
        // FR-034, US4/AC3: with points of a construction placed, the document bar's Undo removes the last
        // placed point and the source stays; with no point left the construction has ended, and Undo acts on
        // the document again.
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \path[use as bounding box] (-10,-10) rectangle (15,15);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        const source = async () => (await editorDebug(page)).source;
        const draws = async () =>
          (await source())
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"));
        const angle = (raw: string) => {
          const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
          return pair
            ? (Math.atan2(Number(pair[1]), Number(pair[2])) * 180) / Math.PI + (pair[3] === undefined ? 0 : Number(pair[3]))
            : Number(raw.replace(/[{}]/g, ""));
        };
        const sweep = (arc: string) =>
          angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]) -
          angle(/start angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
        const undo = page.getByRole("button", { name: "Undo", exact: true });

        // A circle is in the document, so the document has a step that Undo could take back.
        await chooseShape(frame, input, "Circle on a diameter");
        await input.penStroke([at(-6, -2)]);
        await input.penStroke([at(-2, -2)]);
        await expect.poll(async () => (await draws()).length, { message: "The circle is not in the source" }).toBe(3);
        const withCircle = await source();

        // Two points of the arc through three points; Undo removes the second, and the source stays.
        await chooseShape(frame, input, "Arc through three points");
        await input.penStroke([at(6, 0)]);
        await input.penStroke([at(8, 2)]);
        await expect(undo, "Undo is disabled during a construction").toBeEnabled();
        await undo.click();
        await page.waitForTimeout(300);
        assert.equal(await source(), withCircle, "Undo during the construction changed the source");
        // The construction still has its first point: two more taps complete the arc, through the new second point.
        await input.penStroke([at(8, -2)]);
        assert.equal(await source(), withCircle, "The tap after Undo was not taken as the second point");
        await input.penStroke([at(10, 0)]);
        await expect.poll(async () => (await draws()).length, { message: "The arc is not in the source" }).toBe(4);
        const arc = (await draws())[3];
        assert.match(arc, /\(6,0\) arc\[/, arc);
        assert.ok(
          Math.abs(sweep(arc) - 180) < 1e-6,
          `The arc sweeps ${sweep(arc)} degrees, not 180 through (8,-2): ${arc}`,
        );
        const withArc = await source();

        // Two points again; two Undos remove both, the construction ends, and the source stays.
        await input.penStroke([at(2, 6)]);
        await input.penStroke([at(4, 8)]);
        await undo.click();
        await undo.click();
        await page.waitForTimeout(300);
        assert.equal(await source(), withArc, "Two Undos during the construction changed the source");
        // The next Undo acts on the document: it takes back the arc.
        await undo.click();
        await expect.poll(source, { message: "Undo after the construction ended did not take back the arc" }).toBe(withCircle);
        await editorReady(page);
        // No point of the ended construction is left: three taps make an arc from the first of them.
        await input.penStroke([at(6, 0)]);
        await input.penStroke([at(8, 2)]);
        await input.penStroke([at(10, 0)]);
        await expect.poll(async () => (await draws()).length, { message: "The arc after the ended construction is not in the source" }).toBe(4);
        const fresh = (await draws())[3];
        assert.match(fresh, /\(6,0\) arc\[/, fresh);
        assert.ok(Math.abs(sweep(fresh) + 180) < 1e-6, `The arc sweeps ${sweep(fresh)} degrees, not -180: ${fresh}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `builds circles on a diameter and through three points, and an arc through three points, by pen in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \path[use as bounding box] (-10,-10) rectangle (15,15);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        const construct = async (choice: string, taps: { x: number; y: number }[]) => {
          await chooseShape(frame, input, choice);
          const before = ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
          for (const tap of taps) {
            await input.penStroke([tap]);
          }
          await expect
            .poll(async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length)
            .toBe(before + 1);
          const lines = (await editorDebug(page)).source
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("\\draw"));
          return lines[lines.length - 1];
        };
        const three = await construct("Circle through three points", [
          at(0, 3),
          at(3, 0),
          at(0, -3),
        ]);
        assert.match(three, /\(0,0\) circle \(3cm\)/, three);
        const diameter = await construct("Circle on a diameter", [at(-6, -2), at(-2, -2)]);
        assert.match(diameter, /\(-4,-2\) circle \(2cm\)/, diameter);
        const arc = await construct("Arc through three points", [at(6, 0), at(8, 2), at(10, 0)]);
        const angle = (raw: string) => {
          const pair = /atan2\(([-\d.]+),([-\d.]+)\)([+-]\d+)?/.exec(raw);
          return pair
            ? (Math.atan2(Number(pair[1]), Number(pair[2])) * 180) / Math.PI + Number(pair[3] ?? 0)
            : Number(raw.replace(/[{}]/g, ""));
        };
        assert.match(arc, /\(6,0\) arc\[/, arc);
        assert.match(arc, /radius=\{2cm\}/, arc);
        const sweep =
          angle(/end angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]) -
          angle(/start angle=(\{[^}]*\}|[-\d.]+)/.exec(arc)![1]);
        assert.ok(
          Math.abs(sweep + 180) < 1e-6,
          `The arc through (8,2) sweeps ${sweep} degrees, not -180: ${arc}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `rotates a square 45 degrees by its handle with the pen in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (2,2) rectangle (6,6);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const square = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(square).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, square, 0.1)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        const handle = await settledCenter(frame.getByTestId("canvas-rotate-handle"));
        const centre = await settledCenter(square);
        // Turn the handle 45 degrees counterclockwise about the square's centre (screen y grows downward).
        const radius = Math.hypot(handle.x - centre.x, handle.y - centre.y);
        const from = Math.atan2(centre.y - handle.y, handle.x - centre.x);
        const path = Array.from({ length: 10 }, (_, i) => {
          const angle = from + ((Math.PI / 4) * i) / 9;
          return { x: centre.x + radius * Math.cos(angle), y: centre.y - radius * Math.sin(angle) };
        });
        await input.penDown(path[0]);
        for (const point of path.slice(1)) {
          await input.penMove(point);
        }
        await input.penUp(path[path.length - 1]);
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/rotate/);
        const source = (await editorDebug(page)).source;
        assert.match(
          source,
          /rotate( around)?=\{?45\b/,
          `The square did not turn 45 degrees: ${source}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `undoes a handle rotation, then a quarter-turn and a flip, and keeps transforming in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}\draw (2,2) rectangle (6,5);\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const rectangle = frame.locator('svg [data-source-id="path:0"]').first();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, rectangle, 0.1)]);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const selected = async () => (await editorDebug(page)).selection;
        const source = async () => (await editorDebug(page)).source;
        const undo = async () => {
          await input.penStroke([await stableCenter(documentHistory("Undo"))]);
          await expect.poll(source).toBe(authored);
          await editorReady(page);
          await expect.poll(selected).toEqual(["path:0"]);
        };
        await expect.poll(selected).toEqual(["path:0"]);
        const handle = await settledCenter(frame.getByTestId("canvas-rotate-handle"));
        const centre = await settledCenter(rectangle);
        const radius = Math.hypot(handle.x - centre.x, handle.y - centre.y);
        const start = Math.atan2(centre.y - handle.y, handle.x - centre.x);
        const path = Array.from({ length: 10 }, (_, index) => {
          const angle = start + Math.PI * index / 18;
          return { x: centre.x + radius * Math.cos(angle), y: centre.y - radius * Math.sin(angle) };
        });
        await input.penDown(path[0]);
        for (const point of path.slice(1)) await input.penMove(point);
        await input.penUp(path.at(-1)!);
        await expect.poll(source).toMatch(/rotate/);
        await undo();

        const command = async (name: string) => {
          // Transform is a secondary command, under More (contracts/surfaces.md, Object menu).
          await input.penStroke([await stableCenter(strip.getByRole("button", { name: "More", exact: true }))]);
          await input.penStroke([await stableCenter(frame.getByRole("menuitem", { name: /^Transform/ }))]);
          await input.penStroke([await stableCenter(frame.getByRole("menu").last().getByRole("menuitem", { name, exact: true }))]);
          await expect.poll(source).not.toBe(authored);
          await undo();
        };
        await command("Rotate Right 90°");
        await command("Flip Horizontally");
        await command("Flip Vertically");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `scales a lasso-selected pair by 2 from a corner of their frame in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,2) circle (1);
\draw (6,2) circle (1);
\path[use as bounding box] (-10,-10) rectangle (15,15);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:3"]').first()).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await chooseTool(frame, input, "Lasso");
        // A loop round both circles and clear of the axes.
        await input.penStroke([at(8, 3.6), at(0.5, 3.6), at(0.5, 0.5), at(8, 0.5), at(8, 3.5)]);
        await expect
          .poll(async () => [...(await editorDebug(page)).selection].sort())
          .toEqual(["path:2", "path:3"]);
        await chooseTool(frame, input, "Lasso");
        await expect
          .poll(async () => [...(await editorDebug(page)).selection].sort())
          .toEqual(["path:2", "path:3"]);
        const corner = at(7, 3);
        const handles = await frame
          .locator('[data-handle-kind="group-scale"]')
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const box = node.getBoundingClientRect();
              return {
                role: node.getAttribute("data-resize-role"),
                x: box.x + box.width / 2,
                y: box.y + box.height / 2,
              };
            }),
          );
        const nearest = handles
          .map((entry) => ({ ...entry, x: entry.x + frameBox.x, y: entry.y + frameBox.y }))
          .sort(
            (a, b) =>
              Math.hypot(a.x - corner.x, a.y - corner.y) -
              Math.hypot(b.x - corner.x, b.y - corner.y),
          )[0];
        assert.ok(
          nearest !== undefined && Math.hypot(nearest.x - corner.x, nearest.y - corner.y) < 16,
          `No frame corner handle at (7,3) for the pair: ${JSON.stringify(handles)}`,
        );
        const target = at(13, 5);
        await input.penDown(nearest);
        for (let i = 1; i <= 10; i++) {
          await input.penMove({
            x: nearest.x + ((target.x - nearest.x) * i) / 10,
            y: nearest.y + ((target.y - nearest.y) * i) / 10,
          });
        }
        await input.penUp(target);
        // The rendered circles: centres at (3,3) and (11,3), each 4 units across.
        const unit = Math.hypot(at(1, 0).x - at(0, 0).x, at(1, 0).y - at(0, 0).y);
        // The box of the circle's geometry, without its stroke: at this zoom the stroke is a twentieth of a unit wide.
        const circle = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGraphicsElement, offset) => {
              const box = path.getBBox();
              const m = path.getScreenCTM()!;
              const left = box.x * m.a + box.y * m.c + m.e;
              const right = (box.x + box.width) * m.a + (box.y + box.height) * m.c + m.e;
              const top = box.x * m.b + box.y * m.d + m.f;
              const bottom = (box.x + box.width) * m.b + (box.y + box.height) * m.d + m.f;
              return { x: offset.x + (left + right) / 2, y: offset.y + (top + bottom) / 2, width: Math.abs(right - left) };
            }, { x: frameBox.x, y: frameBox.y });
        for (const [id, x, y] of [
          ["path:2", 3, 3],
          ["path:3", 11, 3],
        ] as const) {
          await expect
            .poll(
              async () => Math.round(((await circle(id)).width / unit) * 10) / 10,
              `${id} is not 4 units across`,
            )
            .toBe(4);
          const centre = await circle(id);
          const expected = at(x, y);
          assert.ok(
            Math.hypot(centre.x - expected.x, centre.y - expected.y) < 4,
            `${id} centre at ${JSON.stringify(centre)}, expected (${x},${y}) at ${JSON.stringify(expected)}: ${(await editorDebug(page)).source}`,
          );
        }
        await input.penStroke([await stableCenter(documentHistory("Undo"))]);
        await expect.poll(async () => (await editorDebug(page)).source).toBe(authored);
        await editorReady(page);
        await expect.poll(async () => [...(await editorDebug(page)).selection].sort()).toEqual(["path:2", "path:3"]);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shears a square from its right edge after a second tap with the pen in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,2) rectangle (6,6);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const square = frame.locator('svg [data-source-id="path:2"]').first();
        await expect(square).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const unit = Math.hypot(xTen.x - origin.x, xTen.y - origin.y) / 10;
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([at(2, 4)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:2"]);
        // A second tap on the selected square switches its frame to rotate-and-shear handles, as in Inkscape.
        // A tap within half a second of the first is the second tap of a double tap, which switches nothing.
        await page.waitForTimeout(600);
        await input.penStroke([at(2, 4.2)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:2"]);
        // The switch waits out the double-tap window; the author sees the edge handles appear.
        await expect(frame.locator('[data-handle-kind="shear"]').first()).toBeAttached();
        const edge = at(6, 4);
        const handles = await frame.locator('[data-resize-role="right"]').evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }),
        );
        // Grab the handle at the right edge's midpoint if the frame shows one there, else the edge itself.
        const grip = [
          ...handles.map((point) => ({ x: point.x + frameBox.x, y: point.y + frameBox.y })),
          edge,
        ].filter((point) => Math.hypot(point.x - edge.x, point.y - edge.y) < 24)[0];
        const target = { x: grip.x, y: grip.y - 2 * unit };
        await input.penDown(grip);
        for (let i = 1; i <= 10; i++) {
          await input.penMove({ x: grip.x, y: grip.y + ((target.y - grip.y) * i) / 10 });
        }
        await input.penUp(target);
        // A shear that lifts the right edge by 2 keeps the width at 4 and makes the outline 6 tall.
        // The outline box includes the stroke, so allow a few tenths of a unit.
        await expect(async () => {
          const box = await layoutBox(square);
          expect(Math.abs(box.width / unit - 4), "The sheared square is 4 wide").toBeLessThan(0.3);
          expect(Math.abs(box.height / unit - 6), "The sheared square is 6 tall").toBeLessThan(0.3);
        }).toPass({ timeout: 5_000 });
        await input.penStroke([await stableCenter(documentHistory("Undo"))]);
        await expect.poll(async () => (await editorDebug(page)).source).toBe(authored);
        await editorReady(page);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:2"]);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `creates, hides, and deletes a ruler guide by finger from one Ruler guides control in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        const ruler = (await frame.getByTestId("canvas-top-ruler").boundingBox())!;
        const guides = frame.locator('[class*="guideOverlay"] line');
        const guideAtThree = async () =>
          (
            await guides.evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().y))
          ).some((y) => Math.abs(frameBox.y + y - at(3, 3).y) < 4);
        // A finger drags a guide down out of the top ruler to y = 3.
        // The ruler's box is already in page coordinates.
        const from = { x: at(3, 3).x, y: ruler.y + ruler.height / 2 };
        const to = at(3, 3);
        await input.touch(
          Array.from({ length: 13 }, (_, i) => ({
            x: from.x,
            y: from.y + ((to.y - from.y) * i) / 12,
          })),
        );
        await expect
          .poll(guideAtThree, { message: "No guide at y = 3 after a finger drag from the ruler" })
          .toBe(true);
        // One control owns ruler guides: turning it off hides them, turning it on restores them.
        const zoom = frame.getByRole("button", { name: "Zoom and display", exact: true });
        await input.touch([await stableCenter(zoom)]);
        const control = frame.getByRole("button", { name: "Ruler guides", exact: true });
        await expect(control).toHaveAttribute("aria-pressed", "true");
        await input.touch([await stableCenter(control)]);
        await expect.poll(guideAtThree).toBe(false);
        await input.touch([await stableCenter(control)]);
        await expect.poll(guideAtThree).toBe(true);
        await input.touch([await stableCenter(zoom)]);
        // Dragging the guide back onto its ruler deletes it.
        await input.touch(
          Array.from({ length: 13 }, (_, i) => ({
            x: to.x + 40,
            y: to.y + ((from.y - to.y) * i) / 12,
          })),
        );
        await expect
          .poll(guideAtThree, { message: "The guide survives being dragged onto its ruler" })
          .toBe(false);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `reads a drawn line's end as the coordinates the source gets, with no unit word, in a scaled and an unscaled figure in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const drawLine = async (options: string, from: [number, number], to: [number, number]) => {
          await editorReady(page);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await pasteCode(page, String.raw`\begin{tikzpicture}${options}
          \draw (0,0) -- (5,0);
          \draw (0,0) -- (0,5);
          \end{tikzpicture}`);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
          await fitDiagram(frame, input);
          const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
          const ends = async (id: string) =>
            frame
              .locator(`svg [data-source-id="${id}"]`)
              .first()
              .evaluate((path: SVGGeometryElement) => {
                const m = path.getScreenCTM()!;
                return [0, path.getTotalLength()].map((length) => {
                  const p = path.getPointAtLength(length);
                  return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
                });
              });
          const [[origin, xFive], [, yFive]] = [await ends("path:0"), await ends("path:1")];
          // Screen position of figure coordinate (x, y), from the two segments of length 5.
          const at = ([x, y]: [number, number]) => ({
            x: frameBox.x + origin.x + ((xFive.x - origin.x) * x) / 5 + ((yFive.x - origin.x) * y) / 5,
            y: frameBox.y + origin.y + ((xFive.y - origin.y) * x) / 5 + ((yFive.y - origin.y) * y) / 5,
          });
          await chooseShape(frame, input, "Line");
          const [start, end] = [at(from), at(to)];
          await input.penDown(start);
          for (let i = 1; i <= 10; i++) {
            await input.penMove({
              x: start.x + ((end.x - start.x) * i) / 10,
              y: start.y + ((end.y - start.y) * i) / 10,
            });
          }
          const tooltip = frame.getByTestId("canvas-drag-tooltip");
          await expect(tooltip).toBeVisible();
          const rows = await tooltip
            .getByTestId("canvas-drag-tooltip-row")
            .evaluateAll((elements) => elements.map((row) => row.textContent ?? ""));
          await input.penUp(end);
          const draws = (await editorDebug(page)).source
            .split("\n")
            .filter((line) => line.trim().startsWith("\\draw"));
          return { rows, line: draws[draws.length - 1] };
        };
        // x=2cm, y=2cm: the end at figure coordinate (1,1) is 2 cm from the origin on each axis.
        const scaled = await drawLine("[x=2cm,y=2cm]", [3, 2], [1, 1]);
        assert.match(scaled.line, /-- \(1,\s*1\)/, `The line does not end at (1,1): ${scaled.line}`);
        assert.deepEqual(scaled.rows, ["X:1", "Y:1"], "The readout does not show the end's coordinates");
        // With no scaling the readout shows the numbers the source gets.
        const plain = await drawLine("", [1, 1], [4, 3]);
        const written = /-- \((-?[\d.]+),\s*(-?[\d.]+)\)/.exec(plain.line);
        assert.ok(written, `The line has no end coordinate: ${plain.line}`);
        assert.deepEqual(plain.rows, [`X:${written[1]}`, `Y:${written[2]}`], "The readout differs from the source");
        for (const row of [...scaled.rows, ...plain.rows]) {
          assert.doesNotMatch(row, /units|cm|pt|px/, `The readout names a unit for a figure coordinate: ${row}`);
        }
      },
    );

    story(
      { viewport: tablet },
      `reads a drawn rectangle's size in figure coordinates when the figure scales its lattice in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}[x=2cm,y=2cm]
        \draw (0,0) -- (5,0);
        \draw (0,0) -- (0,5);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xFive], [, yFive]] = [await ends("path:0"), await ends("path:1")];
        // Screen position of lattice (x, y) in the x=2cm, y=2cm frame, from the two segments of length 5.
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xFive.x - origin.x) * x) / 5 + ((yFive.x - origin.x) * y) / 5,
          y:
            frameBox.y + origin.y + ((xFive.y - origin.y) * x) / 5 + ((yFive.y - origin.y) * y) / 5,
        });
        await chooseShape(frame, input, "Rectangle");
        const [from, to] = [at(1, 1), at(3, 2)];
        await input.penDown(from);
        for (let i = 1; i <= 10; i++) {
          await input.penMove({
            x: from.x + ((to.x - from.x) * i) / 10,
            y: from.y + ((to.y - from.y) * i) / 10,
          });
        }
        const tooltip = frame.getByTestId("canvas-drag-tooltip");
        await expect(tooltip).toBeVisible();
        const rows = await tooltip
          .getByTestId("canvas-drag-tooltip-row")
          .evaluateAll((elements) => elements.map((row) => row.textContent ?? ""));
        await input.penUp(to);
        // From (1,1) to (3,2) the rectangle is 2 by 1 in figure coordinates; in centimetres it would read 4 by 2.
        assert.deepEqual(rows, ["Width:2", "Height:1"], "The drag readout does not state the size");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `rotates a lasso-selected pair a quarter turn about their centre in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \draw (2,2) circle (1);
        \draw (6,2) circle (1);
        \path[use as bounding box] (-10,-10) rectangle (15,15);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:3"]').first()).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([at(8, 3.6), at(0.5, 3.6), at(0.5, 0.5), at(8, 0.5), at(8, 3.5)]);
        await expect
          .poll(async () => [...(await editorDebug(page)).selection].sort())
          .toEqual(["path:2", "path:3"]);
        await chooseTool(frame, input, "Lasso");
        await expect
          .poll(async () => [...(await editorDebug(page)).selection].sort())
          .toEqual(["path:2", "path:3"]);
        // Turn the frame's rotate handle (or, without one, the point above the pair's centre) a quarter turn counterclockwise.
        const centre = at(4, 2);
        const handles = await frame.getByTestId("canvas-rotate-handle").evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }),
        );
        const start =
          handles.length > 0
            ? { x: handles[0].x + frameBox.x, y: handles[0].y + frameBox.y }
            : at(4, 4.5);
        const radius = Math.hypot(start.x - centre.x, start.y - centre.y);
        const from = Math.atan2(centre.y - start.y, start.x - centre.x);
        const path = Array.from({ length: 12 }, (_, i) => {
          const angle = from + ((Math.PI / 2) * i) / 11;
          return { x: centre.x + radius * Math.cos(angle), y: centre.y - radius * Math.sin(angle) };
        });
        await input.penDown(path[0]);
        for (const point of path.slice(1)) {
          await input.penMove(point);
        }
        await input.penUp(path[path.length - 1]);
        // About (4,2), (2,2) goes to (4,0) and (6,2) to (4,4).
        const centreOf = async (id: string) => {
          const box = (await frame.locator(`svg [data-source-id="${id}"]`).first().boundingBox())!;
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        };
        const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
          Math.hypot(a.x - b.x, a.y - b.y) < 6;
        await expect
          .poll(
            async () =>
              near(await centreOf("path:2"), at(4, 0)) && near(await centreOf("path:3"), at(4, 4)),
            { message: "The pair did not turn a quarter about (4,2)" },
          )
          .toBe(true);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `states the pen's options in its Active Tool Menu without pixels in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Pen");
        assert.equal((await editorDebug(page)).tool, "addFreehand");
        // A tap on the active Pen opens its options (FR-009).
        await input.touch([await stableCenter(toolbarItem(frame, "Pen"))]);
        const menu = activeToolMenu(frame);
        await expect(menu.getByRole("slider", { name: "Width", exact: true })).toBeVisible();
        const text = await menu.innerText();
        assert.doesNotMatch(
          text,
          /\d\s*px\b/,
          `The pen's options state pixels: ${text.match(/[^\n]*\d\s*px[^\n]*/)?.[0]}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps every stroke drawn and erased in quick succession in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const draws = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
        // No stroke waits for the canvas to finish redrawing the one before it.
        await input.penStroke(waveAcross(viewport, 0.45, 0.2, 120));
        await input.penStroke(waveAcross(viewport, 0.45, 0.4, 120));
        await input.penStroke(waveAcross(viewport, 0.45, 0.6, 120));
        await expect
          .poll(draws, { message: "A stroke drawn while the canvas redrew was lost" })
          .toBe(3);
        await input.touch([
          await stableCenter(
            frame
              .locator("[data-diagram-tools]")
              .getByRole("button", { name: "Eraser", exact: true }),
          ),
        ]);
        await input.penStroke(
          Array.from({ length: 12 }, (_, i) => ({
            x: viewport.x + viewport.width * 0.52,
            y: viewport.y + viewport.height * (0.15 + i * 0.05),
          })),
        );
        // The sweep crosses each wave once and cuts it in two.
        await expect
          .poll(draws, { message: "An eraser sweep right after a stroke did not erase" })
          .toBe(6);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet, initialPage: "blank" },
      `carries one offline pen session through a pen stroke, a constructed line, a deletion, an erasure, and the whole history in ${tablet.name}`,
      async function () {
        const external: string[] = [];
        await context.route("**/*", (route) => {
          if (new URL(route.request().url()).origin === new URL(url).origin) {
            return route.continue();
          }
          external.push(route.request().url());
          return route.abort();
        });
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        const authored = String.raw`\begin{tikzpicture}
% a comment the editor must keep
\draw[blue] (0,0) rectangle (2,1);
\draw[red] (0,-1) -- (2,-1.5);
\end{tikzpicture}`;
        await page.goto(url);
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const rail = drawingToolbar(frame);
        const source = async () => (await editorDebug(page)).source;
        const redLine = frame.locator('svg [data-source-id="path:1"]').first();
        await expect(redLine).toBeVisible();
        await expect.poll(source).toBe(authored);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const steps: string[] = [authored];
        const step = async (message: string) => {
          await expect.poll(source, { message }).not.toBe(last());
          steps.push(await source());
        };
        const last = () => steps[steps.length - 1];
        const strokeRecords = (text: string) => (text.match(/^% workbench-ink:/gm) ?? []).length;
        const fitShown = (text: string) => text.includes(".. controls");
        const press = async (name: "Undo" | "Redo", message: string, expected: string) => {
          await tap(documentHistory(name));
          await expect.poll(source, { message }).toBe(expected);
        };

        // A pen stroke stays as drawn, with its recorded original, as one history step; nothing opens after it.
        await chooseTool(frame, input, "Pen");
        await input.penStroke(waveAcross(viewport, 0.15, 0.12, 140));
        await step("The pen stroke is not in the source");
        assert.equal(strokeRecords(last()), 1);
        assert.ok(!fitShown(last()), `The pen stroke was fitted:\n${last()}`);
        await expect(frame.getByRole("dialog")).toHaveCount(0);

        // A line placed with the Line tool.
        await chooseShape(frame, input, "Line");
        const lineY = viewport.y + viewport.height * 0.25;
        const lineFrom = viewport.x + viewport.width * 0.15;
        await input.penStroke([
          { x: lineFrom, y: lineY },
          { x: lineFrom + 160, y: lineY },
        ]);
        await step("The constructed line is not in the source");
        // A straight line has one segment; the pen stroke's polyline has many.
        const lines = (text: string) =>
          (text.match(/\\draw[^;]*;/g) ?? []).filter((draw) => (draw.match(/--/g) ?? []).length === 1).length;
        assert.equal(lines(last()), 2);

        // The authored red line, picked with the pen and deleted from the selection strip's menu.
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, redLine, 0.5)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
        await tap(
          frame
            .getByRole("toolbar", { name: "Selection", exact: true })
            .getByRole("button", { name: "More", exact: true }),
        );
        await tap(
          frame.getByRole("menu").first().getByRole("menuitem", { name: "Delete", exact: true }),
        );
        await step("The deleted line is still in the source");
        assert.ok(!last().includes("\\draw[red]"), last());

        // An eraser sweep across the constructed line cuts it in two.
        await chooseTool(frame, input, "Eraser");
        await input.penStroke(
          Array.from({ length: 9 }, (_, i) => ({ x: lineFrom + 80, y: lineY - 20 + i * 5 })),
        );
        await step("The eraser sweep did not change the source");
        const final = last();
        assert.equal(lines(final), 2, `The swept line is not two lines:\n${final}`);
        for (const kept of ["% a comment the editor must keep", "\\draw[blue] (0,0) rectangle (2,1);"]) {
          assert.ok(final.includes(kept), `The session lost the authored line ${kept}:\n${final}`);
        }
        const finalPicture = await frame.locator("svg [data-source-id]").count();

        // Undo walks back through every step to the authored bytes; Redo walks forward to the final source.
        for (const earlier of steps.slice(1, -1).reverse()) {
          await press("Undo", "Undo did not restore the step before", earlier);
        }
        // The document's own Undo is the same history: it takes the stroke away.
        await tap(documentHistory("Undo"));
        await expect.poll(source, { message: "Undo did not restore the authored source" }).toBe(authored);
        for (const later of steps.slice(1)) {
          await press("Redo", "Redo did not restore the step after", later);
        }
        await expect(frame.locator("svg [data-source-id]")).toHaveCount(finalPicture);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await copyTikz();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(final);
        assert.deepEqual(external, [], "The session asked for an external asset");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `carries one session through a saved style, a second line given the style, a new layer, a line moved into it, and the whole history in ${tablet.name}`,
      async function () {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        const authored = String.raw`\begin{tikzpicture}
% a comment the editor must keep
\draw[red,line width=2pt] (0,0) -- (4,0);
\draw (0,2) -- (4,2);
\end{tikzpicture}`;
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const source = async () => (await editorDebug(page)).source;
        const steps: string[] = [authored];
        const last = () => steps[steps.length - 1];
        const step = async (message: string) => {
          await expect.poll(source, { message }).not.toBe(last());
          steps.push(await source());
        };
        await expect.poll(source).toBe(authored);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const style = sidePanel(frame, "Properties");

        // The red line's appearance becomes a named style, saved from Properties (FR-060a).
        await input.penStroke([
          await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.3),
        ]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await tap(documentPanelButton("Properties"));
        await style.getByLabel("Style name", { exact: true }).fill("accent line");
        await tap(style.getByRole("button", { name: "Save style" }));
        await step("The style is not in the source");
        assert.match(last(), /accent line\/\.style=\{red,\s*line width=2pt\}/);
        assert.match(last(), /\\draw\[accent line\] \(0,0\) -- \(4,0\)/);

        // The plain line takes the same style.
        await input.penStroke([
          await strokePoint(page, frame.locator('svg [data-source-id="path:1"]').first(), 0.3),
        ]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
        await tap(style.getByRole("button", { name: "Apply accent line" }));
        await step("The second line did not take the style");
        assert.match(last(), /\\draw\[accent line\] \(0,2\) -- \(4,2\)/);

        // A new layer takes the styled line, picked in the layer list, into its scope.
        await tap(documentPanelButton("Layers"));
        const panel = sidePanel(frame, "Layers");
        await tap(panel.getByRole("button", { name: "New layer", exact: true }));
        await step("The layer is not in the source");
        assert.match(last(), /\\begin\{scope\}\[name=Layer 1\]/);
        await tap(panel.getByRole("button", { name: "Line", exact: true }).first());
        await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
        await tap(panel.getByRole("button", { name: "Move selection to Layer 1", exact: true }));
        await step("The line did not move into the layer");
        const final = last();
        assert.match(
          final,
          /\\begin\{scope\}\[name=Layer 1\]\s*\\draw\[accent line\] \(0,2\) -- \(4,2\);\s*\\end\{scope\}/,
        );
        assert.ok(final.includes("% a comment the editor must keep"), final);
        assert.equal(final.match(/\\draw/g)!.length, 2, `The session changed the number of lines:\n${final}`);
        const finalPicture = await frame.locator("svg [data-source-id]").count();

        // Undo walks back through every step to the authored bytes; Redo walks forward to the final source.
        for (const earlier of steps.slice(0, -1).reverse()) {
          await tap(documentHistory("Undo"));
          await expect.poll(source, { message: "Undo did not restore the step before" }).toBe(earlier);
        }
        for (const later of steps.slice(1)) {
          await tap(documentHistory("Redo"));
          await expect.poll(source, { message: "Redo did not restore the step after" }).toBe(later);
        }
        await expect(frame.locator("svg [data-source-id]")).toHaveCount(finalPicture);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await copyTikz();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(final);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `carries one session through a recolored shape, a moved point, a bucket fill, a label, the whole history, and a TeX compile in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzpicture}
% a comment the editor must keep
\draw (2,2) rectangle (6,5);
\draw (1,1) -- (4,1);
\end{tikzpicture}`;
        await editorReady(page);
        await page
          .getByRole("button", { name: "Code: left sidebar", exact: true })
          .click();
        await pasteCode(page, authored);
        await page
          .getByRole("button", { name: "Code: left sidebar", exact: true })
          .click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) =>
          input.touch([await stableCenter(locator)]);
        const strip = frame.getByRole("toolbar", {
          name: "Selection",
          exact: true,
        });
        const source = async () => (await editorDebug(page)).source;
        const steps: string[] = [authored];
        const last = () => steps[steps.length - 1];
        const step = async (message: string) => {
          await expect.poll(source, { message }).not.toBe(last());
          steps.push(await source());
        };
        await expect.poll(source).toBe(authored);
        await fitDiagram(frame, input);
        const rectangle = frame
          .locator('svg [data-source-id="path:0"]')
          .first();
        const line = frame.locator('svg [data-source-id="path:1"]').first();

        // The rectangle's stroke takes a color from the rail.
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, rectangle, 0.1)]);
        await expect
          .poll(async () => (await editorDebug(page)).selection)
          .toEqual(["path:0"]);
        await tap(toolbarItem(frame, "Colour 3: red"));
        await step("The stroke color is not in the source");
        assert.match(
          last(),
          /\\draw\[[^\]]*\bred\b[^\]]*\] \(2,2\) rectangle \(6,5\);/,
        );

        // One end of the line moves; the other end stays as written.
        await input.penStroke([await strokePoint(page, line, 0.5)]);
        await expect
          .poll(async () => (await editorDebug(page)).selection)
          .toEqual(["path:1"]);
        await tap(
          strip.getByRole("button", { name: "Edit Points", exact: true }),
        );
        await expect(
          strip.getByRole("button", { name: "Done", exact: true }),
        ).toBeVisible();
        const handle = (await frame
          .locator(
            'rect[data-handle-kind="move-handle"][data-source-id="path:1"]',
          )
          .first()
          .boundingBox())!;
        const end = {
          x: handle.x + handle.width / 2,
          y: handle.y + handle.height / 2,
        };
        await input.penDown(end);
        for (let i = 1; i <= 15; i++)
          await input.penMove({ x: end.x - i * 8, y: end.y });
        await input.penUp({ x: end.x - 120, y: end.y });
        await step("The moved point is not in the source");
        assert.ok(!last().includes("\\draw (1,1) -- (4,1);"), last());
        assert.match(last(), /\\draw \([^)]*\) -- \([^)]*\);/);
        assert.ok(
          /\(1,1\) -- |-- \(4,1\)/.test(last()),
          `Both ends of the line moved:\n${last()}`,
        );

        // The bucket fills the rectangle. A preset tap also colours a selection (FR-021), so a tap on empty canvas clears it first.
        // The Fill tool previews its fill under the pen, which redraws the rectangle, so the rectangle is measured before.
        // A tap outside the line in Edit Points only clears its points, so Done ends Edit Points first.
        const box = (await rectangle.boundingBox())!;
        await tap(strip.getByRole("button", { name: "Done", exact: true }));
        await input.penStroke([(await emptyCanvasGesture(frame))[0]]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        await chooseTool(frame, input, "Fill");
        await tap(toolbarItem(frame, "Colour 2: blue!20"));
        await input.penStroke([
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        ]);
        await step("The fill is not in the source");
        assert.match(last(), /blue/);

        // A text label goes on empty canvas; the keys typed make it a part of the document.
        await chooseTool(frame, input, "Text");
        await expect(toolbarItem(frame, "Text")).toHaveAttribute("aria-pressed", "true");
        await input.penStroke([{ x: box.x + box.width / 2, y: box.y - 40 }]);
        await expect(frame.getByTestId("canvas-text-edit-textarea"), "The label is not in edit").toBeFocused();
        await page.keyboard.type("L");
        await expect.poll(source, { message: "The typed key is not the label" }).toMatch(/\{L\};/);
        await step("The label is not in the source");
        const final = last();
        assert.match(final, /\\node/);
        assert.ok(final.includes("% a comment the editor must keep"), final);
        const finalPicture = await frame
          .locator("svg [data-source-id]")
          .count();

        // Undo walks back through every step to the authored bytes; Redo walks forward to the final source.
        for (const earlier of steps.slice(0, -1).reverse()) {
          await tap(documentHistory("Undo"));
          await expect
            .poll(source, { message: "Undo did not restore the step before" })
            .toBe(earlier);
        }
        for (const later of steps.slice(1)) {
          await tap(documentHistory("Redo"));
          await expect
            .poll(source, { message: "Redo did not restore the step after" })
            .toBe(later);
        }
        await expect(frame.locator("svg [data-source-id]")).toHaveCount(
          finalPicture,
        );

        // TeX compiles the session's source.
        await page
          .getByRole("button", { name: "Preview: right sidebar", exact: true })
          .click();
        await expect(page.locator(".tikz-view-status")).toContainText(
          "Up to date",
          { timeout: 40000 },
        );
        assert.ok(
          (await page
            .locator(".tikz-figure-viewer-source")
            .getAttribute("src")) !== null,
        );
        assert.equal(await source(), final);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `carries one two-figure document through edits in each figure, the whole history, and a TeX compile in ${tablet.name}`,
      async function () {
        const firstAuthored = String.raw`\begin{tikzpicture}
% the first figure
\draw (1,1) -- (4,1);
\end{tikzpicture}`;
        const secondAuthored = String.raw`\begin{tikzpicture}
% the second figure
\draw (2,2) rectangle (6,5);
\end{tikzpicture}`;
        const authored = `${firstAuthored}\n\n${secondAuthored}`;
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const source = async () => (await editorDebug(page)).source;
        const steps: string[] = [authored];
        const last = () => steps[steps.length - 1];
        const step = async (message: string) => {
          await expect.poll(source, { message }).not.toBe(last());
          steps.push(await source());
        };
        // Each figure's text: the first ends at the first \end{tikzpicture}.
        const figures = (text: string) => {
          const cut = text.indexOf("\\end{tikzpicture}") + "\\end{tikzpicture}".length;
          return [text.slice(0, cut), text.slice(cut)];
        };
        await expect.poll(source).toBe(authored);

        // A line constructed in the first figure leaves the second figure's text as written.
        await tap(frame.getByRole("button", { name: "Figure 1", exact: true }));
        await fitDiagram(frame, input);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await chooseShape(frame, input, "Line");
        const lineY = viewport.y + viewport.height * 0.25;
        const lineFrom = viewport.x + viewport.width * 0.2;
        await input.penStroke([
          { x: lineFrom, y: lineY },
          { x: lineFrom + 160, y: lineY },
        ]);
        await step("The constructed line is not in the source");
        assert.equal(figures(last())[1], `\n\n${secondAuthored}`, last());
        assert.equal((figures(last())[0].match(/\\draw[^;]*--[^;]*;/g) ?? []).length, 2, last());
        const firstWithLine = figures(last())[0];

        // The second figure's rectangle takes a stroke color and a bucket fill; the first figure stays as it was.
        await tap(frame.getByRole("button", { name: "Figure 2", exact: true }));
        await fitDiagram(frame, input);
        const rectangle = frame.locator("svg [data-source-id]").first();
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, rectangle, 0.1)]);
        await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
        await tap(toolbarItem(frame, "Colour 3: red"));
        await step("The stroke color is not in the source");
        // A preset tap also colours a selection (FR-021), so a tap on empty canvas clears it before the bucket.
        await input.penStroke([(await emptyCanvasGesture(frame))[0]]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        await chooseTool(frame, input, "Fill");
        await tap(toolbarItem(frame, "Colour 2: blue!20"));
        // The color choice redraws the picture; the pen waits for the redrawn rectangle.
        await input.penStroke([await settledCenter(rectangle)]);
        await step("The fill is not in the source");
        assert.equal(figures(last())[0], firstWithLine, last());
        assert.match(figures(last())[1], /\\draw\[red, fill=blue!20\] \(2,2\) rectangle \(6,5\);/);
        const secondEdited = figures(last())[1];

        // Back in the first figure, the authored line is deleted; the second figure keeps its edits.
        await tap(frame.getByRole("button", { name: "Figure 1", exact: true }));
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        // At a landscape fit the constructed line snaps onto the authored line's row from x=2, so the tap is near x=1.
        await input.penStroke([await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.1)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await tap(strip.getByRole("button", { name: "More", exact: true }));
        await tap(frame.getByRole("menu").first().getByRole("menuitem", { name: "Delete", exact: true }));
        await step("The deleted line is still in the source");
        const final = last();
        assert.ok(!figures(final)[0].includes("\\draw (1,1) -- (4,1);"), final);
        assert.ok(figures(final)[0].includes("% the first figure"), final);
        assert.equal(figures(final)[1], secondEdited, final);

        // Undo walks back through every step of both figures to the authored bytes; Redo walks forward.
        for (const earlier of steps.slice(0, -1).reverse()) {
          await tap(documentHistory("Undo"));
          await expect.poll(source, { message: "Undo did not restore the step before" }).toBe(earlier);
        }
        for (const later of steps.slice(1)) {
          await tap(documentHistory("Redo"));
          await expect.poll(source, { message: "Redo did not restore the step after" }).toBe(later);
        }

        // TeX compiles the session's document.
        await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
        await expect(page.locator(".tikz-view-status")).toContainText("Up to date", { timeout: 40000 });
        assert.ok((await page.locator(".tikz-figure-viewer-source").first().getAttribute("src")) !== null);
        assert.equal(await source(), final);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `simplifies a stroke to anchors a pen can pick apart, also at its slow and hooked ends, in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const x0 = viewport.x + viewport.width * 0.2,
          y0 = viewport.y + viewport.height * 0.4,
          width = viewport.width * 0.5;
        // The pen eases in and out, so samples crowd at both ends, and it trails a small hook as it lifts.
        const points = Array.from({ length: 60 }, (_, i) => {
          const t = (1 - Math.cos((Math.PI * i) / 59)) / 2;
          return { x: x0 + width * t, y: y0 + 60 * Math.sin(2 * Math.PI * t) };
        });
        const last = points.at(-1)!;
        points.push({ x: last.x + 2, y: last.y + 3 }, { x: last.x + 1, y: last.y + 5 });
        await input.penStroke(points);
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        await simplifyStroke(frame, input, lastPath(frame));
        const draw = (await editorDebug(page)).source.match(/\\draw[^;]*;/g)!.at(-1)!;
        assert.match(draw, /\.\. controls/, "Accept did not apply the simplified curve");
        const anchors = drawCoordinates(draw).filter((_, i) => i % 3 === 0);
        // The figure has no transform: a centimetre is 28.4528 pt of the rendered picture.
        const pxPerCm =
          28.4528 *
          (await frame
            .locator("svg [data-source-id]")
            .last()
            .evaluate((path: SVGGraphicsElement) => path.getScreenCTM()!.a));
        const gaps = anchors
          .slice(1)
          .map(
            (anchor, i) => Math.hypot(anchor.x - anchors[i].x, anchor.y - anchors[i].y) * pxPerCm,
          );
        // Each anchor stays outside the reach in which a pen contact lands on its neighbour.
        assert.ok(
          gaps.every((gap) => gap >= 12),
          `Anchors crowd: gaps ${gaps.map((gap) => gap.toFixed(1)).join(", ")} px in ${draw}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps a simplified stroke's ends where the pen drew them when no point is within reach, in ${tablet.name}`,
      async function () {
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (4,0);
        \draw (0,3) -- (4,3);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const reference = frame.locator('svg [data-source-id="path:0"]').first();
        const origin = await strokePoint(page, reference, 0);
        const pxPerCm = ((await strokePoint(page, reference, 1)).x - origin.x) / 4;
        // The pen ends lie 0.5 cm or more from every lattice point and 1.1 cm from both lines.
        const start = { x: 0.4, y: 1.4 },
          end = { x: 3.5, y: 1.9 };
        const points = Array.from({ length: 22 }, (_, i) => {
          const t = i / 21;
          const x = start.x + (end.x - start.x) * t;
          const y = start.y + (end.y - start.y) * t - 0.2 * Math.sin(Math.PI * t);
          return { x: origin.x + x * pxPerCm, y: origin.y - y * pxPerCm };
        });
        await input.penStroke(points);
        await expect.poll(async () => (await editorDebug(page)).source.match(/\\draw/g)?.length).toBe(3);
        await simplifyStroke(frame, input, lastPath(frame));
        const draw = (await editorDebug(page)).source.match(/\\draw[^;]*;/g)!.at(-1)!;
        assert.match(draw, /\.\. controls/, "Accept did not apply the simplified curve");
        const ends = drawCoordinates(draw);
        for (const [name, drawn, fitted] of [
          ["start", start, ends[0]],
          ["end", end, ends.at(-1)!],
        ] as const) {
          const offset = Math.hypot(fitted.x - drawn.x, fitted.y - drawn.y);
          assert.ok(
            offset <= 0.1,
            `The fitted ${name} moved ${offset.toFixed(2)} cm from where the pen drew it: ${draw}`,
          );
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `starts a new stroke near a raw stroke's end and leaves that stroke unchanged in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const draws = async () =>
          Array.from((await editorDebug(page)).source.matchAll(/\\draw(?:\{[^}]*\}|[^;{])*;/g), (match) => match[0]);
        await input.penStroke(waveAcross(viewport, 0.3, 0.4, 120));
        await expect.poll(async () => (await draws()).length).toBe(1);
        const [first] = await draws();
        const end = await strokePoint(page, frame.locator("svg [data-source-id]").first(), 1);
        // The second stroke goes down a few pixels past the first one's end and continues away from it.
        await input.penStroke(
          Array.from({ length: 16 }, (_, i) => ({
            x: end.x + 4 + i * 6,
            y: end.y - 3 - i * 5 + Math.sin(i) * 2,
          })),
        );
        await expect
          .poll(async () => (await draws()).length, {
            message: "The stroke near the end did not draw a new stroke",
          })
          .toBe(2);
        // Snap to objects lands the new stroke on the end, and the new stroke is written against
        // the end's name (FR-023): the old stroke gains `coordinate (pN)` and keeps every point.
        const [old, added] = await draws();
        const named = /^(.*) coordinate \((p\d+)\);$/.exec(old);
        assert.ok(named, `The new stroke did not attach to the end: ${old}`);
        assert.equal(`${named[1]};`, first, "The stroke near the end changed the stroke it started near");
        assert.ok(added.includes(`(${named[2]})`), `The new stroke does not start at (${named[2]}): ${added}`);
        // The canvas draws both strokes, and still does after the render of the new source lands.
        const second = frame.locator('svg [data-source-id="path:1"]').first();
        await expect(second, "The canvas does not draw the new stroke").toBeVisible();
        await page.waitForTimeout(1000);
        await expect(second, "The canvas stopped drawing the new stroke").toBeVisible();
        assert.equal((await draws()).length, 2, "The new stroke left the source");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `draws from an existing point with the pen, and moves it under a held finger or a held pen, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        // Neither end is on the lattice, so a stroke that lands on one took the point, not the lattice.
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (0.37,0.61) -- (4.23,2.29);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => {
          await input.touch([await stableCenter(locator)]);
        };
        const line = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(line).toBeVisible();
        await fitDiagram(frame, input);
        const source = async () => (await editorDebug(page)).source;
        const draws = async () => Array.from((await source()).matchAll(/\\draw(?:\{[^}]*\}|[^;{])*;/g), (match) => match[0]);
        // The stroke is written against the point's name, so it follows the point (docs/interaction-model.md, "Attached relationships").
        const named = String.raw`\draw (0.37,0.61) coordinate (p1) -- (4.23,2.29);`;
        // The delay that turns a held pen into a move is a setting.
        const settings = await openSettings();
        await tap(settings.getByTestId("settings-category-canvas"));
        await expect(settings.getByRole("slider", { name: /^Hold to move a point/ })).toHaveValue(
          "450",
        );
        await tap(settings.getByRole("button", { name: "Close settings" }));
        await chooseTool(frame, input, "Pen");
        const start = await strokePoint(page, line, 0);
        // Hovering the pen over a point marks it as the stroke's attachment, before any contact.
        await input.penHover(start);
        await expect(frame.locator('[data-point-target="attach"]')).toBeVisible();
        // A stroke that starts on a point draws at once, from exactly that point.
        await input.penStroke(
          Array.from({ length: 12 }, (_, i) => ({
            x: start.x + i * 6,
            y: start.y + i * 4 + Math.sin(i) * 3,
          })),
        );
        await expect
          .poll(async () => (await draws()).length, {
            message: "The stroke from the point did not draw",
          })
          .toBe(2);
        const stroke = (await draws())[1];
        assert.match(stroke, /^\s*\\draw(?:\[[^\]]*\])?\s*\(p1\)/, `The stroke did not start at the point: ${stroke}`);
        assert.equal((await draws())[0].trim(), named, "Drawing from the point moved it");
        const drawn = await source();
        // With a finger of the other hand held down, a pen drag on a point moves the point.
        const clear = (await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0];
        // Selecting the moved point can pan the view, so each step measures the point again.
        const endPoint = () => strokePoint(page, line, 1);
        const end = await endPoint();
        await input.fingerDown(clear);
        await input.penDown(end);
        for (let step = 1; step <= 8; step++) {
          await input.penMove({ x: end.x - step * 5, y: end.y + step * 5 });
        }
        await input.penUp({ x: end.x - 40, y: end.y + 40 });
        await input.fingerUp();
        await expect
          .poll(async () => (await draws()).length, {
            message: "The modified pen drag drew a stroke",
          })
          .toBe(2);
        await expect
          .poll(async () => (await draws())[0], {
            message: "The held finger did not make the pen move the point",
          })
          .not.toContain("(4.23,2.29)");
        assert.match((await draws())[0], /\(0\.37,0\.61\)/, "Moving the end moved the start");
        // The move is one undo step.
        await tap(documentHistory("Undo"));
        await expect.poll(source).toBe(drawn);
        // A pen held still on a point past the delay moves it, and the mark says so before the pen moves.
        const heldEnd = await endPoint();
        await input.penDown(heldEnd);
        await expect(frame.locator('[data-point-target="move"]')).toBeVisible({ timeout: 2000 });
        for (let step = 1; step <= 8; step++) {
          await input.penMove({ x: heldEnd.x + step * 5, y: heldEnd.y - step * 4 });
        }
        await input.penUp({ x: heldEnd.x + 40, y: heldEnd.y - 32 });
        await expect
          .poll(async () => (await draws())[0], { message: "The held pen did not move the point" })
          .not.toContain("(4.23,2.29)");
        assert.equal((await draws()).length, 2, "The held pen drew a stroke");
        await tap(documentHistory("Undo"));
        await expect.poll(source).toBe(drawn);
        // A double tap on a point never moves it.
        await input.doubleTap(await endPoint());
        assert.equal((await draws())[0].trim(), named, "A double tap moved the point");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `attaches an arrow end to a node, a label to a line, and a stroke to a point, each named before commit, and moves them with their hosts as one undo step, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        // Axes of length 10; a named node; a line to label; a line whose ends are off the lattice.
        const figure = String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\node[draw] (A) at (2,6) {A};
\draw (5,3) -- (9,3);
\draw (3.37,8.61) -- (7.23,9.29);
\end{tikzpicture}`;
        const load = async (text: string) => {
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await pasteCode(page, text);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await expect.poll(async () => (await editorDebug(page)).source.trim()).toBe(text);
          await editorReady(page);
        };
        await load(figure);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeVisible();
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        const unit = Math.hypot(xTen.x - origin.x, xTen.y - origin.y) / 10;
        const tap = async (locator: Locator) => {
          await input.touch([await stableCenter(locator)]);
        };
        const undo = documentHistory("Undo");
        const source = async () => (await editorDebug(page)).source;
        const sourceIds = async () =>
          frame
            .locator("svg [data-source-id]")
            .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-source-id")!));
        const newSourceId = async (before: string[]) =>
          (await sourceIds()).find((id) => !before.includes(id))!;
        // Rendered elements carry their source id; the node statement is path:2.
        const centerOf = async (id: string) => {
          const box = (await frame.locator(`svg [data-source-id="${id}"]`).first().boundingBox())!;
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        };
        const labelId = async () =>
          (await editorDebug(page)).scene!.elements.find(
            (element) => element.pathAttachment?.hostPathSourceId === "path:3",
          )!.sourceRef.sourceId;
        const target = frame.locator("[data-snap-target]");
        const targetLabel = async () => target.first().getAttribute("data-snap-target");
        // The arrow ends on the node's border, so "at the node" means inside its drawn box (frame coordinates, as `ends` reports).
        const onNode = async (point: Point) => {
          const box = (await frame.locator('svg path[data-source-id="path:2"]').first().boundingBox())!;
          const x = point.x + frameBox.x, y = point.y + frameBox.y;
          return x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2;
        };
        const drag = async (from: Point, to: Point) => {
          await input.penDown(from);
          for (let step = 1; step <= 10; step++) {
            await input.penMove({
              x: from.x + ((to.x - from.x) * step) / 10,
              y: from.y + ((to.y - from.y) * step) / 10,
            });
          }
          await input.penUp(to);
        };

        // An arrow end placed on a node is written against the node's name: the mark names the node before commit.
        await chooseShape(frame, input, "Arrow");
        const nodeCenter = await centerOf("path:2");
        await input.penHover(nodeCenter);
        await expect.poll(targetLabel, { message: "Hovering the node did not name it" }).toBe("A");
        const before = await sourceIds();
        await drag(at(6, 6), nodeCenter);
        await expect
          .poll(source, { message: "The arrow end was not written against the node" })
          .toMatch(/\\draw\[[^\]]*->[^\]]*\]\s*\(6,6\) -- \(A(?:\.[a-z ]+)?\);/);
        await editorReady(page);
        const arrowId = await newSourceId(before);
        await storyScreenshot(page, `attached-arrow-${tablet.name}`);

        // A label placed on a line is a path-attached node: the mark says "On line" before commit.
        await chooseTool(frame, input, "Text");
        await expect(toolbarItem(frame, "Text")).toHaveAttribute("aria-pressed", "true");
        await input.penHover(at(7, 3));
        await expect.poll(targetLabel, { message: "Hovering the line did not name it" }).toBe("On line");
        await input.penStroke([at(7, 3)]);
        await expect(frame.getByTestId("canvas-text-edit-textarea"), "The label is not in edit").toBeFocused();
        await page.keyboard.type("m");
        await expect
          .poll(source, { message: "The label was not attached to the line" })
          .toMatch(/\\draw \(5,3\) -- \(9,3\) node\[midway[^\]]*\] \{m\};/);
        await editorReady(page);
        await expect.poll(labelId, { message: "The label is not a path-attached node" }).toMatch(/./);
        const label = await labelId();
        await expect(frame.locator(`svg [data-source-id="${label}"]`).first()).toBeVisible();
        await storyScreenshot(page, `attached-label-${tablet.name}`);

        // A stroke that starts on a point is written against the point's name.
        await chooseTool(frame, input, "Pen");
        const host = frame.locator('svg [data-source-id="path:4"]').first();
        const start = await strokePoint(page, host, 0);
        await input.penHover(start);
        await expect(frame.locator('[data-point-target="attach"]')).toBeVisible();
        const beforeStroke = await sourceIds();
        await input.penStroke(
          Array.from({ length: 12 }, (_, i) => ({
            x: start.x + i * 6,
            y: start.y - i * 5 + Math.sin(i) * 3,
          })),
        );
        await expect
          .poll(source, { message: "The host point was not named" })
          .toMatch(/\\draw \(3\.37,8\.61\) coordinate \(p1\) -- \(7\.23,9\.29\);/);
        assert.match(await source(), /\\draw(?:\[[^\]]*\])?\s*\(p1\)/, "The stroke does not start at the named point");
        await page.keyboard.press("Escape");
        await editorReady(page);
        const strokeId = await newSourceId(beforeStroke);
        const attached = await source();

        // Moving the node moves the arrow end; the arrow's source keeps the reference; one undo restores all.
        // A press on the node's text edits the text, so the drag starts on the node's drawn border.
        await chooseTool(frame, input, "Lasso");
        const arrowEndBefore = (await ends(arrowId))[1];
        const grip = await strokePoint(page, frame.locator('svg path[data-source-id="path:2"]').first(), 0.5);
        const lift = { x: at(2, 8).x - at(2, 6).x, y: at(2, 8).y - at(2, 6).y };
        await drag(grip, { x: grip.x + lift.x, y: grip.y + lift.y });
        await expect.poll(source, { message: "The node did not move" }).toMatch(/\\node\[draw\] \(A\) at \(2,8\) \{A\};/);
        await editorReady(page);
        const arrowEndAfter = (await ends(arrowId))[1];
        assert.ok(
          (await onNode(arrowEndAfter)) && arrowEndAfter.y < arrowEndBefore.y - unit,
          `The arrow end did not follow the node: ${JSON.stringify({ arrowEndBefore, arrowEndAfter, unit })}`,
        );
        assert.match(await source(), /\(6,6\) -- \(A(?:\.[a-z ]+)?\);/, "Moving the node rewrote the arrow");
        await tap(undo);
        await expect.poll(source, { message: "One undo did not restore the node move" }).toBe(attached);
        await editorReady(page);

        // Moving the line moves its label.
        await input.touch([at(9, 8)]);
        const labelBefore = await centerOf(label);
        await drag(at(6, 3), at(6, 2));
        await expect.poll(source, { message: "The line did not move" }).toMatch(/\\draw \(5,2\) -- \(9,2\) node\[/);
        await editorReady(page);
        const labelAfter = await centerOf(label);
        assert.ok(
          Math.abs(labelAfter.y - (labelBefore.y + unit)) < 3 && Math.abs(labelAfter.x - labelBefore.x) < 3,
          `The label did not follow the line: ${JSON.stringify({ labelBefore, labelAfter, unit })}`,
        );
        await tap(undo);
        await expect.poll(source, { message: "One undo did not restore the line move" }).toBe(attached);
        await editorReady(page);

        // Moving the point under a held finger moves the stroke's start with it.
        await chooseTool(frame, input, "Pen");
        const clear = (await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0];
        const point = await strokePoint(page, host, 0);
        await input.fingerDown(clear);
        await drag(point, { x: point.x - 30, y: point.y + 30 });
        await input.fingerUp();
        await expect
          .poll(source, { message: "The held finger did not make the pen move the point" })
          .not.toContain("(3.37,8.61)");
        await editorReady(page);
        assert.match(await source(), /coordinate \(p1\) -- \(7\.23,9\.29\);/, "Moving the point lost its name");
        const hostStart = (await ends("path:4"))[0];
        const strokeStart = (await ends(strokeId))[0];
        assert.ok(
          Math.hypot(hostStart.x - strokeStart.x, hostStart.y - strokeStart.y) < 1.5,
          `The stroke did not follow the point: ${JSON.stringify({ hostStart, strokeStart })}`,
        );
        await tap(undo);
        await expect.poll(source, { message: "One undo did not restore the point move" }).toBe(attached);

        // The attachments are authored references, so they survive save and reopen.
        await load(attached);
        await fitDiagram(frame, input);
        const arrowEnd = (await ends(arrowId))[1];
        assert.ok(await onNode(arrowEnd), `After reopening, the arrow end is not at the node: ${JSON.stringify({ arrowEnd })}`);
        // The reopened figure fits differently, so the line's own midpoint is the reference.
        const [lineStart, lineEnd] = await ends("path:3");
        const lineMiddle = { x: (lineStart.x + lineEnd.x) / 2 + frameBox.x, y: (lineStart.y + lineEnd.y) / 2 + frameBox.y };
        const reopenedLabel = await centerOf(label);
        assert.ok(
          Math.hypot(reopenedLabel.x - lineMiddle.x, reopenedLabel.y - lineMiddle.y) < Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y) / 4,
          `After reopening, the label is not on the line: ${JSON.stringify({ reopenedLabel, lineMiddle })}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows what is stored, without editor sync state, after a stroke in ${tablet.name}`,
      async function () {
        const status = page.locator(".tikz-standalone-status");
        await expect(status).toBeInViewport({ ratio: 1 });
        await expect(status).toHaveText("New tikzpicture · not saved");
        const input = await TabletInput.attach(page);
        const viewport = (await editorFrame(page)
          .locator('[data-canvas-viewport="true"]')
          .boundingBox())!;
        await input.penStroke(waveAcross(viewport, 0.45, 0.4, 120));
        await expect(status).toHaveText("Recovery saved · not saved as file");
        await expect(status).toBeInViewport({ ratio: 1 });
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `places the curve refinement clear of its stroke wherever it is drawn, and Escape leaves the stroke as it was, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const railBox = (await frame.locator("[data-diagram-tools]").boundingBox())!;
        const result = curveRefinement(frame);
        const clear = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
          Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
          Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y);
        // The corners of the canvas the docked rail leaves free, in fractions of the viewport.
        const sideRail = railBox.height > railBox.width;
        const left = sideRail
          ? (railBox.x + railBox.width - viewport.x) / viewport.width + 0.03
          : 0.12;
        const bottom = sideRail
          ? 0.82
          : Math.min(0.82, (railBox.y - viewport.y) / viewport.height - 0.12);
        const corners = [
          [left, 0.12],
          [0.72, 0.12],
          [left, bottom],
          [0.72, bottom],
        ] as const;
        for (const [index, [fx, fy]] of corners.entries()) {
          await chooseTool(frame, input, "Pen");
          await input.penStroke(waveAcross(viewport, fx, fy, 110));
          // Each kept stroke stays drawn, so this one is the element numbered by its index once it renders.
          const idsNow = () =>
            frame
              .locator("svg [data-source-id]")
              .evaluateAll((nodes) => [
                ...new Set(nodes.map((node) => node.getAttribute("data-source-id")!)),
              ]);
          await expect.poll(async () => (await idsNow()).length).toBe(index + 1);
          const ids = await idsNow();
          const drawing = frame.locator(`svg [data-source-id="${ids[ids.length - 1]}"]`).first();
          const before = (await editorDebug(page)).source;
          await openSimplify(frame, input, drawing);
          const stroke = (await drawing.boundingBox())!;
          const popup = (await result.boundingBox())!;
          assert.ok(
            clear(popup, stroke),
            `The curve refinement covers a stroke drawn at (${fx.toFixed(2)}, ${fy.toFixed(2)})`,
          );
          assert.ok(
            clear(popup, (await frame.locator("[data-diagram-tools]").boundingBox())!),
            "The curve refinement covers the rail",
          );
          // Escape closes the refinement and takes no further action: the stroke stays as drawn.
          await page.keyboard.press("Escape");
          await expect(result).toHaveCount(0);
          await expect.poll(async () => (await editorDebug(page)).source, "Escape changed the source").toBe(before);
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps the curve refinement clear of its stroke, the rail, and Properties in every dock in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const rail = drawingToolbar(frame);
        const panel = frame.getByRole("complementary", { name: "Properties", exact: true });
        const result = curveRefinement(frame);
        type Box = { x: number; y: number; width: number; height: number };
        const clear = (a: Box, b: Box) =>
          Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
          Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y);
        // The canvas left after cutting each occupant away from the viewport edge it is nearest.
        const freeArea = (occupants: Box[]): Box => {
          let [left, top, right, bottom] = [
            viewport.x,
            viewport.y,
            viewport.x + viewport.width,
            viewport.y + viewport.height,
          ];
          for (const box of occupants) {
            const gaps = [
              box.x - left,
              right - box.x - box.width,
              box.y - top,
              bottom - box.y - box.height,
            ];
            const nearest = gaps.indexOf(Math.min(...gaps));
            if (nearest === 0) {
              left = box.x + box.width;
            }
            if (nearest === 1) {
              right = box.x;
            }
            if (nearest === 2) {
              top = box.y + box.height;
            }
            if (nearest === 3) {
              bottom = box.y;
            }
          }
          return { x: left, y: top, width: right - left, height: bottom - top };
        };
        const dockTargets = {
          bottom: { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height - 10 },
          right: { x: viewport.x + viewport.width - 10, y: viewport.y + viewport.height / 2 },
          top: { x: viewport.x + viewport.width / 2, y: viewport.y + 10 },
          left: { x: viewport.x + 10, y: viewport.y + viewport.height / 2 },
        };
        for (const [dock, target] of Object.entries(dockTargets)) {
          const from = await dockGripPoint(rail);
          await input.touch(
            Array.from({ length: 13 }, (_, i) => ({
              x: from.x + ((target.x - from.x) * i) / 12,
              y: from.y + ((target.y - from.y) * i) / 12,
            })),
          );
          await expect(rail).toHaveAttribute("data-dock", dock);
          for (const withPanel of [false, true]) {
            if (withPanel) {
              await input.touch([
                await stableCenter(documentPanelButton("Properties")),
              ]);
              await expect(panel).toBeVisible();
            }
            const occupants = [
              (await rail.boundingBox())!,
              ...(withPanel ? [(await panel.boundingBox())!] : []),
            ];
            const free = freeArea(occupants);
            for (const [fx, fy] of [
              [0.06, 0.08],
              [0.5, 0.7],
            ] as const) {
              const label = `${dock} dock${withPanel ? " with Properties" : ""}, stroke at (${fx}, ${fy})`;
              // The drawn paths; a preview the canvas draws during a refinement has no path: id.
              const ids = () =>
                frame
                  .locator('svg [data-source-id^="path:"]')
                  .evaluateAll((nodes) => [
                    ...new Set(nodes.map((node) => node.getAttribute("data-source-id")!)),
                  ]);
              const before = await ids();
              const points = waveAcross(free, fx, fy, Math.min(110, free.width * 0.4));
              await chooseTool(frame, input, "Pen");
              await input.penStroke(points);
              await expect
                .poll(async () => (await ids()).length, `${label}: the stroke did not render`)
                .toBe(before.length + 1);
              const added = (await ids()).find((id) => !before.includes(id))!;
              await openSimplify(frame, input, frame.locator(`svg [data-source-id="${added}"]`).first());
              // Where the pen went, in page coordinates like every box here.
              const xs = points.map((point) => point.x),
                ys = points.map((point) => point.y);
              const stroke = {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
              };
              const popup = (await result.boundingBox())!;
              assert.ok(clear(popup, stroke), `${label}: the curve refinement covers its stroke`);
              assert.ok(
                clear(popup, (await rail.boundingBox())!),
                `${label}: the curve refinement covers the rail`,
              );
              if (withPanel) {
                assert.ok(
                  clear(popup, (await panel.boundingBox())!),
                  `${label}: the curve refinement covers Properties`,
                );
              }
              await page.keyboard.press("Escape");
              await expect(result).toHaveCount(0);
            }
            if (withPanel) {
              await input.touch([
                await stableCenter(
                  panel.getByRole("button", { name: "Close properties", exact: true }),
                ),
              ]);
              await expect(panel).toHaveCount(0);
            }
          }
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows every recorded sample and every fitted anchor of the curve refinement on the canvas in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const result = curveRefinement(frame);
        const segments = async () =>
          ((await editorDebug(page)).source.match(/\.\. controls/g) ?? []).length;
        const before = await segments();
        await input.penStroke(waveAcross(viewport, 0.45, 0.4, 160));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        await openSimplify(frame, input, lastPath(frame));
        const drawn = async () => ({
          samples: await frame.getByTestId("freehand-raw-samples").locator("circle").count(),
          anchors: await frame.getByTestId("freehand-fitted-anchors").locator("circle").count(),
        });
        // The fitted curve the source holds has one anchor more than its Bézier segments.
        const written = async () => (await segments()) - before + 1;
        await expect
          .poll(async () => (await drawn()).anchors === (await written()) && (await written()) > 1, {
            message: "The canvas does not show the anchors of the curve the source holds",
          })
          .toBe(true);
        const samples = (await drawn()).samples;
        assert.ok(samples > (await written()), "The canvas shows fewer samples than anchors");
        await storyScreenshot(page, `freehand-samples-${tablet.name}`);
        // Moving the simplification slider refits the same samples; the canvas follows the new curve.
        const fitted = await written();
        await result.getByRole("slider", { name: "Simplification", exact: true }).fill("1.2");
        await expect
          .poll(async () => (await written()) !== fitted && (await drawn()).anchors === (await written()), {
            message: "After refitting, the canvas does not show the anchors of the new curve",
          })
          .toBe(true);
        assert.equal((await drawn()).samples, samples, "Refitting changed the recorded samples");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `smooths only the neighbours of a deleted curve point in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) .. controls (1,2) and (2,2) .. (3,0) .. controls (4,-2) and (5,-2) .. (6,0) .. controls (7,2) and (8,2) .. (9,0) .. controls (10,-2) and (11,-2) .. (12,0);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, curve, 0.1)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await input.touch([await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Edit Points", exact: true }))]);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const anchors = await frame
          .locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]')
          .evaluateAll((nodes) =>
            nodes
              .map((node) => {
                const box = node.getBoundingClientRect();
                return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
              })
              .sort((a, b) => a.x - b.x),
          );
        assert.equal(anchors.length, 5, `anchors: ${anchors.length}`);
        await input.penStroke([{ x: frameBox.x + anchors[2].x, y: frameBox.y + anchors[2].y }]);
        await expect(selectedPoints(frame)).toHaveCount(1);
        await input.touch([
          await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Delete", exact: true })),
        ]);
        await expect.poll(async () => (await editorDebug(page)).source).not.toMatch(/\(6,0\)/);
        const source = (await editorDebug(page)).source;
        // The segments that did not touch the deleted point keep their outer control points.
        assert.match(
          source,
          /\(0,0\) \.\. controls \(1,2\)/,
          `The first segment's outer control moved: ${source}`,
        );
        assert.match(
          source,
          /and \(11,-2\) \.\. \(12,0\)/,
          `The last segment's outer control moved: ${source}`,
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `selects a simplified stroke itself, not the envelope that keeps its original, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.penStroke(waveAcross(viewport, 0.45, 0.4, 160));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        await simplifyStroke(frame, input, lastPath(frame));
        // Start from an empty selection, then tap the simplified path.
        await input.touch([(await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0]]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        const ids = await frame
          .locator('svg [data-source-id^="path:"]')
          .evaluateAll((nodes) => [
            ...new Set(nodes.map((node) => node.getAttribute("data-source-id")!)),
          ]);
        const fitted = ids[ids.length - 1];
        await input.touch([
          await strokePoint(page, frame.locator(`svg [data-source-id="${fitted}"]`).first(), 0.5),
        ]);
        await expect
          .poll(async () => (await editorDebug(page)).selection, {
            message: "Tapping the simplified stroke selected its recovery envelope",
          })
          .toEqual([fitted]);
        await expect(frame.getByRole("button", { name: "Lock", exact: true })).toBeVisible();
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `refines a selected curve with Simplify, Simplify again, Cancel, Accept, and Restore original in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        // A long wavy stroke, so a fit has many anchors to shed.
        const wave = Array.from({ length: 60 }, (_, i) => ({
          x: viewport.x + viewport.width * 0.35 + i * 6,
          y: viewport.y + viewport.height * 0.45 + Math.sin(i / 4) * 30,
        }));
        await input.penStroke(wave);
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        await chooseTool(frame, input, "Lasso");
        // The drawing is the path inside the stroke's envelope scope.
        const ids = await frame
          .locator('svg [data-source-id^="path:"]')
          .evaluateAll((nodes) => [
            ...new Set(nodes.map((node) => node.getAttribute("data-source-id")!)),
          ]);
        const curve = frame.locator(`svg [data-source-id="${ids[ids.length - 1]}"]`).first();
        await input.touch([await strokePoint(page, curve, 0.3)]);
        await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
        // A tap that lands on an anchor selects that point; the curve's own actions are one tap away.
        const whole = frame.getByRole("button", { name: "Done", exact: true });
        if (await whole.isVisible()) {
          await input.touch([await stableCenter(whole)]);
        }
        // A drawn stroke is a polyline and a simplified one a Bézier curve; either has one anchor more than segments.
        const anchors = async () =>
          ((await editorDebug(page)).source.match(/\.\.\s+controls\b|--/g) ?? []).length + 1;
        const accepted = (await editorDebug(page)).source;
        const counts = [await anchors()];
        const refinement = frame.getByRole("dialog", { name: "Curve refinement" });
        const openRefinement = async () => {
          await input.touch([
            await stableCenter(frame.getByRole("button", { name: "Simplify", exact: true })),
          ]);
          await expect(refinement).toBeVisible();
        };
        // Simplify opens the same refinement on the curve, with its first pass previewed.
        await openRefinement();
        await expect(
          refinement.getByRole("slider", { name: "Simplification", exact: true }),
        ).toBeVisible();
        await expect
          .poll(anchors, { timeout: 30_000, message: "Simplify previewed no simpler curve" })
          .toBeLessThan(counts[0]);
        counts.push(await anchors());
        // Simplify again runs another pass on the preview; it is disabled once no pass is simpler.
        const again = refinement.getByRole("button", { name: "Simplify again", exact: true });
        for (let step = 0; step < 8 && (await again.isEnabled()); step++) {
          await input.touch([await stableCenter(again)]);
          await expect
            .poll(anchors, {
              timeout: 30_000,
              message: `Simplify again step ${step + 1} did not change the curve (anchors ${counts.join(" → ")})`,
            })
            .not.toBe(counts[counts.length - 1]);
          counts.push(await anchors());
        }
        await expect(again, `Simplify again still enabled after anchors ${counts.join(" → ")}`).toBeDisabled();
        assert.ok(
          counts.length >= 3,
          `Simplify could not be repeated: anchors ${counts.join(" → ")}`,
        );
        assert.ok(
          counts.every((count, index) => index === 0 || count < counts[index - 1]),
          `anchors ${counts.join(" → ")}`,
        );
        assert.ok(
          counts[counts.length - 1] >= 2,
          `Simplification collapsed the curve: ${counts.join(" → ")}`,
        );
        // Cancel returns the curve to the state before Simplify.
        await input.touch([
          await stableCenter(refinement.getByRole("button", { name: "Cancel", exact: true })),
        ]);
        await expect(refinement).toHaveCount(0);
        await expect
          .poll(async () => (await editorDebug(page)).source, {
            message: "Cancel left the simplified preview",
          })
          .toBe(accepted);
        // Accept commits the preview as one step that one Undo reverses.
        await openRefinement();
        await expect.poll(anchors, { timeout: 30_000 }).toBeLessThan(counts[0]);
        const previewed = await anchors();
        await input.touch([
          await stableCenter(refinement.getByRole("button", { name: "Accept", exact: true })),
        ]);
        await expect(refinement).toHaveCount(0);
        assert.equal(await anchors(), previewed, "Accept did not commit the previewed curve");
        await page.keyboard.press("Control+z");
        await expect
          .poll(async () => (await editorDebug(page)).source, {
            message: "One Undo did not reverse the accepted simplification",
          })
          .toBe(accepted);
        // The stroke kept its recorded original, so the refinement of a simplified curve offers it.
        await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
        await openRefinement();
        await input.touch([
          await stableCenter(refinement.getByRole("button", { name: "Accept", exact: true })),
        ]);
        await expect(refinement).toHaveCount(0);
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\.\. controls/);
        await openRefinement();
        await input.touch([
          await stableCenter(
            refinement.getByRole("button", { name: "Restore original", exact: true }),
          ),
        ]);
        await expect(refinement).toHaveCount(0);
        await expect
          .poll(
            async () => {
              const source = (await editorDebug(page)).source;
              return !/\.\. controls/.test(source) && (source.match(/--/g) ?? []).length > 5;
            },
            { message: "Restore original did not bring back the recorded stroke" },
          )
          .toBe(true);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `saves and applies an authored style by name after reopening in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw[red,line width=2pt,xshift=1cm] (0,0) -- (4,0);
        \draw (0,2) -- (4,2);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const first = frame.locator('svg [data-source-id="path:0"]').first();
        await input.penStroke([await strokePoint(page, first, 0.3)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await tap(documentPanelButton("Properties"));
        const properties = sidePanel(frame, "Properties");
        await properties.getByLabel("Style name", { exact: true }).fill("accent line");
        await tap(properties.getByRole("button", { name: "Save style" }));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/accent line\/\.style=\{red,\s*line width=2pt\}/);
        const saved = (await editorDebug(page)).source;
        assert.match(saved, /\\draw\[xshift=1cm,\s*accent line\] \(0,0\) -- \(4,0\)/);
        const second = frame.locator('svg [data-source-id="path:1"]').first();
        await input.penStroke([await strokePoint(page, second, 0.3)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
        await tap(properties.getByRole("button", { name: "Apply accent line" }));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw\[accent line\] \(0,2\)/);
        const source = (await editorDebug(page)).source;
        assert.match(source, /\\draw\[accent line\] \(0,2\) -- \(4,2\)/);
        await page.reload();
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, source);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await editorReady(page);
        const reopened = editorFrame(page);
        await expect(reopened.locator('svg [data-source-id="path:0"]').first()).toHaveAttribute("stroke", "#ff0000");
        await expect(reopened.locator('svg [data-source-id="path:1"]').first()).toHaveAttribute("stroke", "#ff0000");
        await expect.poll(async () => (await editorDebug(page)).source).toBe(source);
        await fitDiagram(reopened, input);
        await chooseTool(reopened, input, "Lasso");
        await input.penStroke([await strokePoint(page, reopened.locator('svg [data-source-id="path:1"]').first(), 0.3)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
        await tap(documentPanelButton("Properties"));
        await expect(sidePanel(reopened, "Properties").getByRole("button", { name: "Apply accent line" })).toBeVisible();
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `lists named styles from the preamble, figure, and picture body in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\tikzset{outer/.style={blue}}
        \begin{tikzpicture}[middle/.style={red}]
        \tikzset{inner/.style={green}}
        \draw (0,0) -- (4,0);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const path = frame.locator('svg [data-source-id^="path:"]').first();
        await input.penStroke([await strokePoint(page, path, 0.3)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toHaveLength(1);
        await input.touch([await stableCenter(documentPanelButton("Properties"))]);
        const properties = sidePanel(frame, "Properties");
        for (const name of ["outer", "middle", "inner"]) {
          await expect(properties.getByRole("button", { name: `Apply ${name}` })).toBeVisible();
        }
        await input.touch([await stableCenter(properties.getByRole("button", { name: "Apply outer" }))]);
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw\[outer\]/);
        await expect(path).toHaveAttribute("stroke", "#0000ff");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `fills a closed shape with one pen tap of the bucket, as one undo step, in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzpicture}
\draw (2,2) rectangle (6,5);
\draw (7,2) -- (9,2);
\end{tikzpicture}`;
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const source = async () => (await editorDebug(page)).source;
        await expect.poll(source).toBe(authored);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Fill");
        await tap(toolbarItem(frame, "Colour 2: blue!20"));
        const box = (await frame.locator('svg [data-source-id="path:0"]').first().boundingBox())!;
        await input.penStroke([{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]);
        const filled = String.raw`\begin{tikzpicture}
\draw[fill=blue!20] (2,2) rectangle (6,5);
\draw (7,2) -- (9,2);
\end{tikzpicture}`;
        await expect.poll(source, { message: "The tap did not fill the rectangle" }).toBe(filled);
        // The fill is a committed mark: it stays when the pen leaves and when another tool is chosen.
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.penHover({ x: viewport.x + viewport.width - 30, y: viewport.y + viewport.height - 30 });
        await chooseTool(frame, input, "Lasso");
        await expect.poll(async () => (await editorDebug(page)).tool).toBe("select");
        assert.equal(await source(), filled, "The fill left the source with the bucket");
        await tap(documentHistory("Undo"));
        await expect.poll(source).toBe(authored);
        await tap(documentHistory("Redo"));
        await expect.poll(source).toBe(filled);
        // A pen that hovers first shows the fill as a preview; its tap then commits the same single step.
        await tap(documentHistory("Undo"));
        await expect.poll(source).toBe(authored);
        await chooseTool(frame, input, "Fill");
        const inside = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await input.penHover({ x: inside.x - 6, y: inside.y });
        await input.penHover(inside);
        await expect.poll(source, { message: "The hover did not preview the fill" }).toBe(filled);
        await input.penStroke([inside]);
        await input.penHover({ x: viewport.x + viewport.width - 30, y: viewport.y + viewport.height - 30 });
        await chooseTool(frame, input, "Lasso");
        await expect.poll(async () => (await editorDebug(page)).tool).toBe("select");
        assert.equal(await source(), filled, "The previewed fill left the source with the bucket");
        await tap(documentHistory("Undo"));
        await expect.poll(source).toBe(authored);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `creates, renames, switches and deletes colour collections in Settings in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => {
          await input.touch([await stableCenter(locator)]);
        };
        // The colours of the active collection, as Settings saved them.
        const activeColors = async () => {
          const response = await page.request.get(`${url}api/preferences`);
          assert.equal(response.status(), 200);
          const saved = ((await response.json()) as Record<string, string>)["tikz-editor:settings"];
          if (!saved) return null;
          const picker = (JSON.parse(saved) as {
            settings: { colorPicker: { activeCollectionId: string; collections: { id: string; colors: string[] }[] } };
          }).settings.colorPicker;
          return picker.collections.find((entry) => entry.id === picker.activeCollectionId)!.colors;
        };
        const openColors = async () => {
          const dialog = await openSettings();
          await tap(dialog.getByTestId("settings-category-colors"));
          return dialog;
        };
        let dialog = await openColors();
        const collection = dialog.getByLabel("Collection", { exact: true });
        const names = () => collection.locator("option").allInnerTexts();
        assert.deepEqual(await names(), ["Default"]);
        // A new collection starts from the current colours and becomes the active one.
        await tap(dialog.getByRole("button", { name: "New collection" }));
        await dialog.getByLabel("Collection name", { exact: true }).fill("Roots");
        assert.deepEqual(await names(), ["Default", "Roots"]);
        assert.equal(await collection.locator("option:checked").innerText(), "Roots");
        await expect.poll(async () => (await activeColors())?.length ?? 0).toBeGreaterThan(1);
        const original = (await activeColors())!;
        await tap(dialog.getByRole("button", { name: "Remove" }).first());
        await expect.poll(activeColors).toEqual(original.slice(1));
        // Switching collections switches the active colours.
        await collection.selectOption({ label: "Default" });
        await expect.poll(activeColors).toEqual(original);
        await collection.selectOption({ label: "Roots" });
        await expect.poll(activeColors).toEqual(original.slice(1));
        // Collections and the active choice survive a reload.
        const rootsId = await collection.inputValue();
        await expect.poll(async () => {
          const response = await page.request.get(`${url}api/preferences`);
          assert.equal(response.status(), 200);
          const preferences = await response.json() as Record<string, string>;
          const saved = preferences["tikz-editor:settings"];
          if (!saved) return null;
          const colorPicker = (JSON.parse(saved) as {
            settings: { colorPicker: { activeCollectionId: string; collections: { id: string; colors: string[] }[] } };
          }).settings.colorPicker;
          return {
            active: colorPicker.activeCollectionId,
            colors: colorPicker.collections.find((entry) => entry.id === rootsId)?.colors,
          };
        }).toEqual({ active: rootsId, colors: original.slice(1) });
        await page.reload();
        await editorReady(page);
        dialog = await openColors();
        assert.deepEqual(await names(), ["Default", "Roots"]);
        assert.equal(await collection.locator("option:checked").innerText(), "Roots");
        // Deleting asks first, then returns to the remaining collection.
        await tap(dialog.getByRole("button", { name: "Delete collection" }));
        assert.deepEqual(await names(), ["Default", "Roots"], "Deleted without confirmation");
        await tap(dialog.getByRole("button", { name: "Delete Roots" }));
        await expect.poll(names).toEqual(["Default"]);
        await expect.poll(activeColors).toEqual(original);
        await expect(dialog.getByRole("button", { name: "Delete collection" })).toBeDisabled();
      },
    );
  }

  story({}, "loads stored settings that hold the retired toolbar items and saves them without it", async function () {
    const stored = {
      settings: {
        general: { uiFontSizePx: 11, colorScheme: "system", canvasInvert: false },
        colorPicker: {
          collections: [
            { id: "default", name: "Default", colors: ["black", "white"] },
            { id: "roots", name: "Roots", colors: ["red", "blue"] },
          ],
          activeCollectionId: "roots",
        },
        toolbar: { dock: "bottom", items: [{ kind: "tool", id: "select" }, { kind: "separator" }] },
      },
    };
    const put = await page.request.put(`${url}api/preferences`, {
      data: { key: "tikz-editor:settings", value: JSON.stringify(stored) },
    });
    assert.equal(put.status(), 204);
    await page.reload();
    await editorReady(page);
    const dialog = await openSettings();
    await dialog.getByTestId("settings-category-colors").click();
    await expect(dialog.getByLabel("Collection", { exact: true }).locator("option:checked")).toHaveText("Roots");
    await dialog.getByLabel("Collection", { exact: true }).selectOption({ label: "Default" });
    await expect
      .poll(async () => {
        const preferences = (await (await page.request.get(`${url}api/preferences`)).json()) as Record<string, string>;
        const settings = (JSON.parse(preferences["tikz-editor:settings"]) as {
          settings: { colorPicker: { activeCollectionId: string }; toolbar: Record<string, unknown> };
        }).settings;
        return { active: settings.colorPicker.activeCollectionId, items: "items" in settings.toolbar };
      })
      .toEqual({ active: "default", items: false });
  });

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `repeats an element from its long press in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (2,1) -- (8,3);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const line = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(line).toBeVisible();
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Lasso");
        await fitDiagram(frame, input);
        await input.longPress(await strokePoint(page, line, 0.5));
        await input.touch([
          await stableCenter(
            frame
              .getByRole("menu")
              .first()
              .getByRole("menuitem", { name: "Repeat...", exact: true }),
          ),
        ]);
        const repeat = frame.getByTestId("repeat-modal");
        await expect(repeat).toBeVisible();
        await frame.getByTestId("repeat-columns-input").fill("3");
        await input.touch([await stableCenter(frame.getByTestId("repeat-confirm-button"))]);
        await expect
          .poll(
            async () => ((await editorDebug(page)).source.match(/\\draw|\\foreach/g) ?? []).length,
          )
          .toBeGreaterThan(1);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `states geometry in figure coordinates, with no unit word, in Properties and Repeat in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (2,1) -- (8,3);
        \draw[step=1] (-6,-6) grid (-2,-2);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const [line, grid] = [
          frame.locator('svg [data-source-id="path:0"]').first(),
          frame.locator('svg [data-source-id="path:1"]').first(),
        ];
        await expect(line).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const panel = frame.getByRole("complementary", { name: "Properties", exact: true });
        // Figure coordinates are bare numbers in TikZ, so no unit word follows them.
        const unitWord = /\d\s*(cm|px)\b|\((cm|px|units)\)|\bunits\b/;
        await chooseTool(frame, input, "Lasso");
        await input.touch([await strokePoint(page, line, 0.5)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await input.touch([
          await stableCenter(documentPanelButton("Properties")),
        ]);
        await expect(panel).toBeVisible();
        await expect(panel.getByText("X shift", { exact: true })).toBeVisible();
        const lineText = await panel.innerText();
        assert.doesNotMatch(lineText, unitWord, `Line inspector: ${lineText.match(unitWord)?.[0]}`);
        // A shift of two figure coordinates is two centimetres in the default frame.
        const xshift = panel
          .locator('[class*="compactNumberField"]', { hasText: "X shift" })
          .locator("input");
        await xshift.fill("2");
        await xshift.press("Enter");
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/xshift=2cm/);
        await input.touch([await strokePoint(page, grid, 0.5)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
        await expect(panel.getByText("Step", { exact: false }).first()).toBeVisible();
        const gridText = await panel.innerText();
        assert.doesNotMatch(gridText, unitWord, `Grid inspector: ${gridText.match(unitWord)?.[0]}`);
        // In portrait the panel lies over the line; close it before reaching for the line.
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "Close properties", exact: true })),
        ]);
        await expect(panel).toHaveCount(0);
        await fitDiagram(frame, input);
        await input.longPress(await strokePoint(page, line, 0.5));
        await input.touch([
          await stableCenter(
            frame
              .getByRole("menu")
              .first()
              .getByRole("menuitem", { name: "Repeat...", exact: true }),
          ),
        ]);
        const repeat = frame.getByTestId("repeat-modal");
        await expect(repeat).toBeVisible();
        const repeatText = await repeat.innerText();
        assert.doesNotMatch(repeatText, unitWord, `Repeat: ${repeatText.match(unitWord)?.[0]}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows every drawing toolbar control without scrolling in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const rail = drawingToolbar(frame);
        await expect(rail).toBeVisible();
        const strip = rail.locator('[class*="embeddedTools"]');
        for (const theme of ["light", "dark"] as const) {
          if (theme === "dark") {
            await page.emulateMedia({ colorScheme: "dark" });
            await expect(frame.locator("html")).toHaveAttribute("data-color-scheme", "dark");
          }
          const overflow = await strip.evaluate((element) => ({
            vertical: element.scrollHeight - element.clientHeight,
            horizontal: element.scrollWidth - element.clientWidth,
          }));
          assert.deepEqual(overflow, { vertical: 0, horizontal: 0 });
          for (const name of ["Lasso", "Pen", "Eraser", "Shapes", "Text", "Fill", "Add colour"]) {
            await expect(rail.getByRole("button", { name, exact: true })).toBeInViewport({
              ratio: 1,
            });
          }
          const swatches = rail.getByRole("button", { name: /^Colour \d+: / });
          assert.ok((await swatches.count()) > 0);
          for (const swatch of await swatches.all()) {
            await expect(swatch).toBeInViewport({ ratio: 1 });
          }
          await storyScreenshot(page, `rail-${tablet.name}-${theme}`);
        }
      },
    );
  }

  /**
   * The page point of figure coordinates (x, y), read from the authored axes
   * `path:0` = (0,0) -- (10,0) and `path:1` = (0,0) -- (0,10).
   */
  async function figureAxes(frame: FrameLocator): Promise<(x: number, y: number) => Point> {
    const frameBox = await layoutBox(page.locator('iframe[title="TikZ visual editor"]'));
    const ends = async (id: string) =>
      frame
        .locator(`svg [data-source-id="${id}"]`)
        .first()
        .evaluate((path: SVGGeometryElement) => {
          const m = path.getScreenCTM()!;
          return [0, path.getTotalLength()].map((length) => {
            const p = path.getPointAtLength(length);
            return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
          });
        });
    const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
    return (x, y) => ({
      x: frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
      y: frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the pen marks on first contact and the source gains a path; a width chosen in the Pen's Active Tool Menu applies to the next stroke as it is drawn, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const pen = toolbarItem(frame, "Pen");
        await chooseTool(frame, input, "Lasso");
        await input.touch([await stableCenter(pen)]);
        await expect(pen).toHaveAttribute("aria-pressed", "true");
        await expect(activeToolMenu(frame)).toHaveCount(0);
        const area = await canvasFreeArea(frame);
        const box = { x: area.left, y: area.top, width: area.right - area.left, height: area.bottom - area.top };
        const preview = frame.locator('[data-tool-preview="freehand"]');
        const draws = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
        /** Draws a wave with the pen; returns the width of its mark in screen pixels, read before the pen lifts. */
        const stroke = async (fy: number): Promise<number> => {
          const points = waveAcross(box, 0.3, fy, 120);
          await input.penDown(points[0]);
          for (const point of points.slice(1, 4)) {
            await input.penMove(point);
          }
          await expect(preview, "The pen left no mark before it lifted").toHaveCount(1);
          const shown = await preview
            .locator("line, path")
            .first()
            .evaluate(
              (element: SVGGraphicsElement) =>
                parseFloat(getComputedStyle(element).strokeWidth) * element.getScreenCTM()!.a,
            );
          for (const point of points.slice(4)) {
            await input.penMove(point);
          }
          await input.penUp(points.at(-1)!);
          return shown;
        };
        const before = await draws();
        await stroke(0.25);
        await expect
          .poll(draws, { message: "The stroke added no path to the source" })
          .toBeGreaterThan(before);
        // A second tap on the active Pen opens its Active Tool Menu; a further tap closes it.
        await input.touch([await stableCenter(pen)]);
        const menu = activeToolMenu(frame);
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("slider", { name: "Width", exact: true })).toBeVisible();
        const width = menu.getByRole("spinbutton", { name: "Width value", exact: true });
        await width.fill("2");
        await width.press("Enter");
        await input.touch([await stableCenter(pen)]);
        await expect(menu).toHaveCount(0);
        const pixelsPerPoint = await frame
          .locator('[data-canvas-viewport="true"]')
          .evaluate((element) => element.querySelector<SVGSVGElement>("svg[viewBox]")!.getScreenCTM()!.a);
        const shown = await stroke(0.55);
        assert.ok(
          Math.abs(shown - 2 * pixelsPerPoint) <= 0.15 * 2 * pixelsPerPoint,
          `The mark is ${shown} px wide while the pen draws, not 2 pt (${2 * pixelsPerPoint} px)`,
        );
        await expect
          .poll(async () => ((await editorDebug(page)).source.match(/line width=2pt/g) ?? []).length, {
            message: "The next stroke does not carry the width chosen in the Active Tool Menu",
          })
          .toBe(1);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `line style, opacity, and smoothing chosen in the Pen's Active Tool Menu apply to the next stroke as it is drawn, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const pen = toolbarItem(frame, "Pen");
        await input.touch([await stableCenter(pen)]);
        await expect(pen).toHaveAttribute("aria-pressed", "true");
        const area = await canvasFreeArea(frame);
        const preview = frame.locator('[data-tool-preview="freehand"]');
        // A stroke's colour `{rgb,255:red,0;…}` holds semicolons, so a statement is its whole line.
        const statements = async () =>
          Array.from((await editorDebug(page)).source.matchAll(/^[ \t]*\\draw.*$/gm), (match) => match[0].trim());
        /** Draws a zigzag with the pen; returns the mark's dash pattern and opacity, read before the pen lifts, and the statement it wrote. */
        const zigzag = async (fy: number) => {
          const y = area.top + fy * (area.bottom - area.top);
          const points = Array.from({ length: 41 }, (_, i) => ({
            x: area.left + 0.2 * (area.right - area.left) + i * 0.015 * (area.right - area.left),
            y: y + (i % 2 === 0 ? -8 : 8),
          }));
          const before = await statements();
          await input.penDown(points[0]);
          for (const point of points.slice(1, 6)) {
            await input.penMove(point);
          }
          await expect(preview, "The pen left no mark before it lifted").toHaveCount(1);
          const shown = await preview
            .locator("line, path")
            .first()
            .evaluate((element: SVGGraphicsElement) => ({
              dashes: getComputedStyle(element).strokeDasharray,
              opacity: parseFloat(getComputedStyle(element).strokeOpacity),
            }));
          for (const point of points.slice(6)) {
            await input.penMove(point);
          }
          await input.penUp(points.at(-1)!);
          await expect
            .poll(async () => (await statements()).length, { message: "The stroke added no path to the source" })
            .toBe(before.length + 1);
          const written = (await statements()).find((statement) => !before.includes(statement))!;
          return { shown, written };
        };
        /** The summed second differences of a statement's written y coordinates, in points. */
        const roughness = (statement: string) => {
          const ys = Array.from(statement.matchAll(/\([-\d.e]+pt,([-\d.e]+)pt\)/g), (match) => Number(match[1]));
          return ys.slice(1, -1).reduce((sum, y, i) => sum + Math.abs(ys[i] - 2 * y + ys[i + 2]), 0);
        };
        const plain = await zigzag(0.25);
        assert.equal(plain.shown.dashes, "none", "The default pen draws a dashed mark");
        assert.doesNotMatch(plain.written, /opacity|dashed|dotted/, `The default stroke writes a style: ${plain.written}`);

        await input.touch([await stableCenter(pen)]);
        const menu = activeToolMenu(frame);
        await expect(menu).toBeVisible();
        await menu.getByRole("listbox", { name: "Line style" }).getByRole("option", { name: "Dashed", exact: true }).click();
        await menu.getByRole("slider", { name: "Opacity", exact: true }).fill("0.5");
        await menu.getByRole("slider", { name: "Smoothing", exact: true }).fill("1");
        await input.touch([await stableCenter(pen)]);
        await expect(menu).toHaveCount(0);

        const styled = await zigzag(0.6);
        assert.notEqual(styled.shown.dashes, "none", "The pen does not draw dashed while the stroke is drawn");
        assert.ok(Math.abs(styled.shown.opacity - 0.5) < 0.01, `The mark shows opacity ${styled.shown.opacity}, not 0.5`);
        assert.match(styled.written, /\bdashed\b/, `The stroke does not write the dashed style: ${styled.written}`);
        assert.match(styled.written, /draw opacity=0\.5\b/, `The stroke does not write opacity 0.5: ${styled.written}`);
        assert.ok(
          roughness(styled.written) < 0.5 * roughness(plain.written),
          `Smoothing does not smooth the written stroke: roughness ${roughness(styled.written)} against ${roughness(plain.written)} unsmoothed`,
        );
        assert.ok(
          (await statements()).includes(plain.written),
          "Options chosen after a stroke changed that earlier stroke",
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a Pen stroke writes its preset's xcolor expression, as a shape does, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (target: Locator) => input.touch([await stableCenter(target)]);
        await tap(toolbarItem(frame, "Pen"));
        await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
        const area = await canvasFreeArea(frame);
        const statements = async () =>
          Array.from((await editorDebug(page)).source.matchAll(/^[ \t]*\\draw.*$/gm), (match) => match[0].trim());
        const stroke = async (fy: number) => {
          const before = await statements();
          const y = area.top + fy * (area.bottom - area.top);
          await input.penStroke(
            Array.from({ length: 20 }, (_, i) => ({
              x: area.left + 0.2 * (area.right - area.left) + i * 0.02 * (area.right - area.left),
              y: y + (i % 2 === 0 ? -6 : 6),
            })),
          );
          await expect
            .poll(async () => (await statements()).length, { message: "The stroke added no path to the source" })
            .toBe(before.length + 1);
          return (await statements()).find((statement) => !before.includes(statement))!;
        };
        // The Pen's presets are xcolor expressions: black, blue, red (FR-020, FR-022, Principle I).
        const black = await stroke(0.2);
        assert.doesNotMatch(black, /rgb|draw=/, `The black preset writes a colour: ${black}`);

        const blue = drawingToolbar(frame).getByRole("button", { name: /^Colour 2: / });
        await tap(blue);
        assert.match(await stroke(0.45), /^\\draw\[draw=blue\b/, "The blue preset does not write draw=blue");

        await tap(blue);
        const popup = frame.getByRole("dialog", { name: "Colour options" });
        await expect(popup).toBeVisible();
        await popup.getByLabel("Exact xcolor", { exact: true }).fill("red!50!blue");
        await popup.getByRole("button", { name: "Apply exact color", exact: true }).click();
        await tap(blue);
        await expect(popup).toHaveCount(0);
        const mixed = await stroke(0.7);
        assert.match(mixed, /^\\draw\[draw=red!50!blue\b/, `The exact xcolor preset is not written as authored: ${mixed}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the Eraser's Active Tool Menu chooses Whole stroke and a size, and the next sweep removes every stroke within that size, in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzpicture}
\draw (-4,-4) -- (-4,4);
\draw (0,-4) -- (0,4);
\draw (4,-4) -- (4,4);
\end{tikzpicture}`;
        await author(authored);
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(3);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const eraser = toolbarItem(frame, "Eraser");
        await input.touch([await stableCenter(eraser)]);
        await input.touch([await stableCenter(eraser)]);
        const menu = activeToolMenu(frame);
        await expect(menu).toBeVisible();
        const mode = menu.getByRole("listbox", { name: "Erase" });
        await expect(mode.getByRole("option", { name: "Partial", exact: true })).toHaveAttribute("aria-selected", "true");
        await mode.getByRole("option", { name: "Whole stroke", exact: true }).click();
        await menu.getByRole("slider", { name: "Size", exact: true }).fill("60");
        await input.touch([await stableCenter(eraser)]);
        await expect(menu).toHaveCount(0);
        const middleOf = (id: string) =>
          strokePoint(page, frame.locator(`svg [data-source-id="${id}"]`).first(), 0.5);
        const [left, right] = [await middleOf("path:0"), await middleOf("path:2")];
        // The sweep crosses the left and middle lines and ends 20 px short of the right one:
        // inside the reach of a 60 px eraser (30 px radius), outside the default 20 px eraser's.
        const from = left.x - 20,
          to = right.x - 20;
        await input.penStroke(
          Array.from({ length: 16 }, (_, i) => ({ x: from + (i * (to - from)) / 15, y: left.y })),
        );
        await expect
          .poll(async () => (await editorDebug(page)).source, {
            message: "The Whole stroke sweep did not remove all three strokes within its size",
          })
          .toBe(String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the Shapes Active Tool Menu takes a circle or an arc by numbers for the chosen construction, in ${tablet.name}`,
      async function () {
        await author(String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const shapes = toolbarItem(frame, "Shapes");
        const menu = activeToolMenu(frame);
        await input.touch([await stableCenter(shapes)]);
        // Choosing a construction closes the menu; a second tap on Shapes opens it with that construction's numbers.
        const choose = async (construction: string) => {
          await input.touch([await stableCenter(shapes)]);
          await expect(menu).toBeVisible();
          await input.touch([await stableCenter(menu.getByRole("option", { name: construction, exact: true }))]);
          await expect(menu).toHaveCount(0);
          await input.touch([await stableCenter(shapes)]);
          await expect(menu).toBeVisible();
        };
        const enter = async (values: Record<string, string>, insert: string) => {
          for (const [label, value] of Object.entries(values)) {
            await menu.getByRole("textbox", { name: label, exact: true }).fill(value);
          }
          await input.touch([await stableCenter(menu.getByRole("button", { name: insert, exact: true }))]);
        };
        const fields = () => menu.getByRole("textbox").evaluateAll((boxes) => boxes.map((box) => box.getAttribute("aria-label")));
        const source = async () => (await editorDebug(page)).source;

        await choose("Circle");
        assert.deepEqual(await fields(), ["Centre X", "Centre Y", "Radius"]);
        await enter({ "Centre X": "1", "Centre Y": "2", Radius: "2" }, "Insert circle");
        await expect
          .poll(source, { message: "The circle entered by centre and radius is not in the source" })
          .toMatch(/\\draw \(1,2\) circle \(2(cm)?\);/);

        await choose("Arc");
        assert.deepEqual(await fields(), ["Centre X", "Centre Y", "Radius", "Start angle (°)", "End angle (°)"]);
        await storyScreenshot(page, `shapes-numeric-arc-${tablet.name}`);
        await enter({ "Centre X": "0", "Centre Y": "0", Radius: "2", "Start angle (°)": "0", "End angle (°)": "90" }, "Insert arc");
        await expect
          .poll(source, { message: "The arc entered by centre, radius, and angles is not in the source" })
          .toMatch(/\\draw \(2,0\) arc\[start angle=\{?0\}?, end angle=\{?90\}?, radius=\{?2(cm)?\}?\];/);

        // The arc through three points runs from the first point through the second to the third.
        await choose("Arc through three points");
        assert.deepEqual(await fields(), ["Point 1 X", "Point 1 Y", "Point 2 X", "Point 2 Y", "Point 3 X", "Point 3 Y"]);
        await enter(
          { "Point 1 X": "2", "Point 1 Y": "0", "Point 2 X": "0", "Point 2 Y": "2", "Point 3 X": "-2", "Point 3 Y": "0" },
          "Insert arc",
        );
        await expect
          .poll(source, { message: "The arc entered by three points is not in the source" })
          .toMatch(/\\draw \(2,0\) arc\[start angle=\{?0\}?, end angle=\{?180\}?, radius=\{?2(cm)?\}?\];/);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the eraser sweep removes the crossed parts of two strokes in one undo step, in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzpicture}
\draw (-4,-4) -- (-4,4);
\draw (0,-4) -- (0,4);
\draw (4,-4) -- (4,4);
\end{tikzpicture}`;
        await author(authored);
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(3);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Eraser");
        const middleOf = (id: string) =>
          strokePoint(page, frame.locator(`svg [data-source-id="${id}"]`).first(), 0.5);
        const [left, middle, right] = [await middleOf("path:0"), await middleOf("path:1"), await middleOf("path:2")];
        // One sweep along y = 0 crosses the left and middle lines and stops short of the right one.
        const from = left.x - 20,
          to = (middle.x + right.x) / 2;
        await input.penStroke(
          Array.from({ length: 16 }, (_, i) => ({ x: from + (i * (to - from)) / 15, y: left.y })),
        );
        const statements = async () =>
          Array.from((await editorDebug(page)).source.matchAll(/\\draw(?:\{[^}]*\}|[^;{])*;/g), (match) => match[0]);
        await expect
          .poll(async () => (await statements()).length, {
            message: "The sweep did not leave two pieces of each stroke it crossed",
          })
          .toBe(5);
        assert.ok(
          (await statements()).includes(String.raw`\draw (4,-4) -- (4,4);`),
          "The sweep changed the stroke it did not cross",
        );
        const erased = (await editorDebug(page)).source;
        await input.touch([await stableCenter(documentHistory("Undo"))]);
        await expect
          .poll(async () => (await editorDebug(page)).source, {
            message: "One Undo in the document bar did not restore both strokes",
          })
          .toBe(authored);
        await input.touch([await stableCenter(documentHistory("Redo"))]);
        await expect
          .poll(async () => (await editorDebug(page)).source, {
            message: "One Redo in the document bar did not repeat the whole sweep",
          })
          .toBe(erased);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the canvas layout measures its border without exposing its internal text in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await stableCenter(toolbarItem(frame, "Pen"))]);
        await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
        await chooseTool(frame, "mouse", "Eraser");
        await chooseTool(frame, input, "Pen");
        await editorReady(page);

        for (const name of ["Lasso", "Pen", "Eraser", "Shapes", "Text", "Fill", "Add colour"]) {
          await expect(toolbarItem(frame, name)).toBeVisible();
        }
        await expect(drawingToolbar(frame).getByRole("button", { name: /^Colour \d+: / })).toHaveCount(3);
        const body = frame.locator("body");
        const sizer = frame.locator(".flexlayout__border_sizer");
        await expect(sizer).toHaveCount(1);
        const size = await sizer.evaluate((element) => {
          const { width, height } = element.getBoundingClientRect();
          return { width, height };
        });
        assert.ok(size.width > 0 && size.height > 0, "FlexLayout must still be able to measure the border");
        const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
        assert.ok(canvas.width > 0 && canvas.height > 0, "The measured layout must hold the canvas");
        assert.deepEqual(
          {
            dom: (await body.innerText()).includes("FindBorderBarSize"),
            accessibility: (await body.ariaSnapshot()).includes("FindBorderBarSize"),
          },
          { dom: false, accessibility: false },
          "The layout library's measuring text is not a canvas surface",
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the drawing toolbar holds Lasso, Pen, Eraser, Shapes, Text, Fill, the active tool's presets, and Add colour, all as symbols, and nothing else, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Pen");
        const items = await drawingToolbar(frame)
          .locator(
            'button, input, select, textarea, [role="button"], [role="slider"], [role="option"], [tabindex]:not([tabindex="-1"])',
          )
          .evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return {
                name: element.getAttribute("aria-label") ?? "",
                words: (element as HTMLElement).innerText.trim(),
                width: box.width,
                height: box.height,
              };
            }),
          );
        const names = items.map((item) => item.name);
        const listed = names.join(", ");
        assert.deepEqual(
          names.slice(0, 6),
          ["Lasso", "Pen", "Eraser", "Shapes", "Text", "Fill"],
          `The toolbar holds ${listed}`,
        );
        assert.equal(names.at(-1), "Add colour", `The toolbar holds ${listed}`);
        const presets = names.slice(6, -1);
        assert.equal(presets.length, 3, `The Pen has not three presets: ${listed}`);
        for (const preset of presets) {
          assert.match(preset, /^Colour \d+: .+$/, `The toolbar holds ${listed}`);
        }
        for (const item of items) {
          assert.equal(item.words, "", `${item.name} shows the words "${item.words}"`);
          assert.ok(
            item.width >= 44 && item.height >= 44,
            `${item.name} has a ${item.width} × ${item.height} hit region`,
          );
        }
        await expect(toolbarItem(frame, "Lasso").locator("svg.lucide-lasso")).toHaveCount(1);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `each menu of the document bar opens under its own button and holds its commands, in ${tablet.name}`,
      async function () {
        // The lists of File, Export, and More opened at the trailing end of the bar, away from their
        // buttons (audit, "File, Export, and other menus are not attached to their buttons"; FR-002).
        // The document bar holds the title menu, Share and Export, and More (contracts/surfaces.md).
        await editorReady(page);
        const input = await TabletInput.attach(page);
        const names = (list: Locator) => list.getByRole("menuitem").allInnerTexts();
        const window = page.viewportSize()!;
        const menus = [
          ["title", ["New tikzpicture", "New tikzcd", "Open…", "Save", "Save As…"]],
          ["share", ["Copy TikZ", "PDF…", "SVG…", "PNG…"]],
          ["more", ["Settings…"]],
        ] as const;
        await expect(barMenu("title").button, "The title is not the file name").toHaveText("Unsaved Document");
        await expect(barMenu("share").button).toHaveAccessibleName("Share and Export");
        await expect(barMenu("more").button).toHaveAccessibleName("More");
        for (const [key, commands] of menus) {
          const menu = barMenu(key);
          await input.touch([await stableCenter(menu.button)]);
          await expect(menu.list, `A tap on the button of ${key} did not open its list`).toBeVisible();
          await expect(menu.button).toHaveAttribute("aria-expanded", "true");
          assert.deepEqual(await names(menu.list), [...commands], `The commands of ${key}`);
          const button = (await menu.button.boundingBox())!;
          const list = (await menu.list.boundingBox())!;
          assert.ok(
            list.y >= button.y + button.height && list.y - (button.y + button.height) <= 12,
            `The list of ${key} does not start under its button: ${JSON.stringify({ button, list })}`,
          );
          assert.ok(
            Math.abs(list.x - button.x) <= 1 || Math.abs(list.x + list.width - (button.x + button.width)) <= 1,
            `The list of ${key} shares no side with its button: ${JSON.stringify({ button, list })}`,
          );
          assert.ok(
            list.x >= 0 && list.x + list.width <= window.width && list.y + list.height <= window.height,
            `The list of ${key} leaves the window: ${JSON.stringify(list)}`,
          );
          for (const item of await menu.list.getByRole("menuitem").all()) {
            const box = (await item.boundingBox())!;
            assert.ok(box.height >= 44, `A command of ${key} is ${box.height} px high`);
          }
          await storyScreenshot(page, `document-bar-menu-${key}-${tablet.name}`);
          // A second tap on the button closes the list.
          await input.touch([await stableCenter(menu.button)]);
          await expect(menu.list, `A second tap on the button of ${key} did not close its list`).toHaveCount(0);
          await expect(menu.button).toHaveAttribute("aria-expanded", "false");
        }
        // Opening one menu closes the other.
        await input.touch([await stableCenter(barMenu("title").button)]);
        await input.touch([await stableCenter(barMenu("more").button)]);
        await expect(barMenu("more").list).toBeVisible();
        await expect(barMenu("title").list, "The title menu stayed open beside More").toHaveCount(0);
        // A choice closes the list.
        await input.touch([await stableCenter(barMenuItem("Settings…"))]);
        await expect(barMenu("more").list, "The choice left More open").toHaveCount(0);
        await expect(settingsDialog()).toBeVisible();
      },
    );
  }

  story(
    { viewport: { width: 800, height: 1024 } },
    "the canvas keeps its place while the status line changes, and the document bar is one row, at window widths from 560 to 800 px",
    async function () {
      // Development diagnostics run 43821818615, 768 px wide: the bar held "Saving recovery…" in one row and
      // "Recovery saved · not saved as file" in two, so the canvas moved 40 px under the pen after each stroke.
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await chooseTool(frame, input, "Pen");
      const status = page.locator(".tikz-standalone-status");
      const source = async () => (await editorDebug(page)).source;
      const widths = [560, 590, 620, 650, 680, 710, 740, 770, 800];
      const oneRow = async (width: number) => {
        const rows = await page
          .locator(".document-bar > .bar-menu > button, .document-bar > div:not(.bar-menu) > button, .document-bar > div > .bar-menu > button")
          .evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
        assert.equal(rows.length, 7, "The document bar does not hold its seven buttons");
        assert.equal(
          new Set(rows).size,
          1,
          `At ${width} px and "${await status.innerText()}" the buttons of the document bar are in rows at ${[...new Set(rows)]}`,
        );
      };
      for (const [index, width] of widths.entries()) {
        await page.setViewportSize({ width, height: 1024 });
        await oneRow(width);
        // Each change of the bar records the status line and the top of the canvas.
        await page.evaluate(`(() => {
          const seen = { tops: new Set(), texts: new Set() };
          const canvas = document.querySelector('iframe[title="TikZ visual editor"]');
          const line = document.querySelector(".tikz-standalone-status");
          const read = () => { seen.tops.add(Math.round(canvas.getBoundingClientRect().top)); seen.texts.add(line.textContent); };
          read();
          new MutationObserver(read).observe(document.querySelector(".document-bar"), { subtree: true, childList: true, characterData: true });
          window.__barWatch = seen;
        })()`);
        const before = await source();
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.penStroke(waveAcross(viewport, 0.3, 0.15 + index * 0.06, 100));
        await expect.poll(source, { message: `At ${width} px the stroke was not written` }).not.toBe(before);
        await expect(status).toHaveText("Recovery saved · not saved as file");
        await oneRow(width);
        if (width === 560 || width === 740) {
          await storyScreenshot(page, `document-bar-${width}-px`);
        }
        const seen = (await page.evaluate(
          "({ tops: [...window.__barWatch.tops], texts: [...window.__barWatch.texts] })",
        )) as { tops: number[]; texts: string[] };
        assert.ok(seen.texts.length > 1, `At ${width} px the status line did not change: ${seen.texts}`);
        assert.equal(seen.tops.length, 1, `At ${width} px the canvas moved between ${seen.tops} as the status line read ${seen.texts.join(" | ")}`);
      }
    },
  );

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a second tap on the Pen closes its Active Tool Menu; opening the title menu closes it, and opening it closes the title menu, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const pen = toolbarItem(frame, "Pen");
        const menu = activeToolMenu(frame);
        const file = barMenu("title");
        await chooseTool(frame, input, "Lasso");
        await input.touch([await stableCenter(pen)]);
        await expect(menu).toHaveCount(0);
        await input.touch([await stableCenter(pen)]);
        await expect(menu).toBeVisible();
        await input.touch([await stableCenter(pen)]);
        await expect(menu).toHaveCount(0);
        await input.touch([await stableCenter(pen)]);
        await expect(menu).toBeVisible();
        await input.touch([await stableCenter(file.button)]);
        await expect(file.list).toBeVisible();
        await expect(menu, "The Active Tool Menu stayed open beside the title menu").toHaveCount(0);
        await input.touch([await stableCenter(pen)]);
        await expect(menu).toBeVisible();
        await expect(file.list, "The title menu stayed open beside the Active Tool Menu").toHaveCount(0);
      },
    );
  }

  /** A figure with two axes from the origin to 10, three objects, and empty canvas round them. */
  const axesFigure = String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,4) circle (1);
\draw (6,4) circle (1);
\draw (2,7) -- (6,7);
\path[use as bounding box] (-2,-2) rectangle (12,12);
\end{tikzpicture}`;

  /** The first of `points` that is at least 80 px outside the open `menu`. */
  async function pointOutside(menu: Locator, points: Point[]): Promise<Point> {
    const box = await layoutBox(menu);
    const clear = 80;
    const free = points.find(
      (point) =>
        point.x < box.x - clear ||
        point.x > box.x + box.width + clear ||
        point.y < box.y - clear ||
        point.y > box.y + box.height + clear,
    );
    assert.ok(free, "The menu covers every empty point of the figure");
    return free;
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the pen tap that closes the Shapes Active Tool Menu places nothing, and a pen stroke that closes the Pen's menu is drawn, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const empty = [at(10, 10), at(-1, -1), at(10, -1)];
        const menu = activeToolMenu(frame);
        const paths = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
        await chooseTool(frame, input, "Shapes");
        await input.touch([await stableCenter(toolbarItem(frame, "Shapes"))]);
        await expect(menu).toBeVisible();
        await input.penStroke([await pointOutside(menu, empty)]);
        await expect(menu, "A tap on the canvas did not close the menu").toHaveCount(0);
        // The tap's own effect is complete before the next tap opens the menu again.
        await input.touch([await stableCenter(toolbarItem(frame, "Shapes"))]);
        await expect(menu).toBeVisible();
        expect(await paths(), "The tap that closed the menu also placed an object").toBe(5);
        await input.touch([await stableCenter(toolbarItem(frame, "Shapes"))]);
        await expect(menu).toHaveCount(0);
        // With no menu open the same press draws.
        const from = at(8, 9);
        await input.penStroke(Array.from({ length: 8 }, (_, i) => ({ x: from.x + i * 12, y: from.y })));
        await expect.poll(paths, { message: "A drag with Shapes drew nothing" }).toBe(6);
        // Ink marks on contact: the stroke that closes the Pen's menu is drawn.
        await chooseTool(frame, input, "Pen");
        await input.touch([await stableCenter(toolbarItem(frame, "Pen"))]);
        await expect(menu).toBeVisible();
        const start = await pointOutside(menu, empty);
        await input.penStroke(Array.from({ length: 8 }, (_, i) => ({ x: start.x + i * 5, y: start.y + (i % 2) * 6 })));
        await expect(menu, "A pen stroke on the canvas did not close the Pen's menu").toHaveCount(0);
        await expect.poll(paths, { message: "The stroke that closed the Pen's menu was not drawn" }).toBe(7);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the pen tap that closes the Lasso's Active Tool Menu keeps the selection, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const lasso = toolbarItem(frame, "Lasso");
        const menu = activeToolMenu(frame);
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([
          await strokePoint(page, frame.locator('svg [data-source-id="path:4"]').first(), 0.5),
        ]);
        await expect.poll(selection, { message: "A tap did not select the line" }).toEqual(["path:4"]);
        await input.touch([await stableCenter(lasso)]);
        await expect(menu).toBeVisible();
        // The selection strip sits above the line; these points are below it.
        const empty = [at(10, -1), at(-1, -1), at(11, 2)];
        await input.penStroke([await pointOutside(menu, empty)]);
        await expect(menu, "A tap on the canvas did not close the menu").toHaveCount(0);
        // The tap's own effect is complete before the next tap opens the menu again.
        await input.touch([await stableCenter(lasso)]);
        await expect(menu).toBeVisible();
        expect(await selection(), "The tap that closed the menu also cleared the selection").toEqual(["path:4"]);
        // A press on the selection strip is a press outside the menu.
        const more = frame.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "More", exact: true });
        await input.touch([await stableCenter(more)]);
        await expect(menu, "A press on the selection strip did not close the menu").toHaveCount(0);
        await expect(more).toHaveAttribute("aria-expanded", "true");
        await input.touch([await stableCenter(more)]);
        await expect(more).toHaveAttribute("aria-expanded", "false");
        // With no menu open the same tap clears the selection.
        await input.penStroke([empty[0]]);
        await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the press that closes the context menu keeps the selection, by pen, finger, and mouse, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        const line = frame.locator('svg [data-source-id="path:4"]').first();
        await expect(line).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const lasso = toolbarItem(frame, "Lasso");
        const toolMenu = activeToolMenu(frame);
        const menu = frame.getByRole("menu").first();
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        // The selection strip sits above the line; these points are below it.
        const empty = [at(10, -1), at(-1, -1), at(11, 2)];
        const contacts: [string, (point: Point) => Promise<void>][] = [
          ["pen", (point) => input.penStroke([point])],
          ["finger", (point) => input.touch([point])],
          ["mouse", (point) => page.mouse.click(point.x, point.y)],
        ];
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, line, 0.5)]);
        await expect.poll(selection, { message: "A tap did not select the line" }).toEqual(["path:4"]);
        for (const [contact, press] of contacts) {
          await input.longPress(await strokePoint(page, line, 0.5));
          await expect(menu, "A long press on the selected line opened no context menu").toBeVisible();
          await press(await pointOutside(menu, empty));
          await expect(menu, `A ${contact} press on the canvas did not close the context menu`).toHaveCount(0);
          // The press's own effect is complete before the next tap opens the Lasso's menu.
          await input.touch([await stableCenter(lasso)]);
          await expect(toolMenu).toBeVisible();
          expect(await selection(), `The ${contact} press that closed the context menu also changed the selection`).toEqual([
            "path:4",
          ]);
          await input.touch([await stableCenter(lasso)]);
          await expect(toolMenu).toHaveCount(0);
        }
        // With no menu open the same tap clears the selection.
        await input.penStroke([empty[0]]);
        await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a press on the canvas closes the title menu, Share and Export, and More and places nothing, and Escape closes them, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const empty = [at(10, 10), at(-1, -1), at(10, -1)];
        const shapes = toolbarItem(frame, "Shapes");
        const toolMenu = activeToolMenu(frame);
        const paths = async () => ((await editorDebug(page)).source.match(/\\draw/g) ?? []).length;
        const contacts: [string, (point: Point) => Promise<void>][] = [
          ["pen", (point) => input.penStroke([point])],
          ["finger", (point) => input.touch([point])],
          ["mouse", (point) => page.mouse.click(point.x, point.y)],
        ];
        await chooseTool(frame, input, "Shapes");
        for (const [name, key] of [["the title menu", "title"], ["Share and Export", "share"], ["More", "more"]] as const) {
          const shellMenu = barMenu(key);
          const open = () =>
            shellMenuChange(async () => {
              await input.touch([await stableCenter(shellMenu.button)]);
              await expect(shellMenu.list).toBeVisible();
            });
          for (const [contact, press] of contacts) {
            await open();
            const point = await pointOutside(shellMenu.list, empty);
            await shellMenuChange(async () => {
              await press(point);
              await expect(shellMenu.list, `A ${contact} press on the canvas did not close ${name}`).toHaveCount(0);
            });
            // The press's own effect is complete before the next tap opens the Shapes menu.
            await input.touch([await stableCenter(shapes)]);
            await expect(toolMenu).toBeVisible();
            expect(await paths(), `The ${contact} press that closed ${name} also placed an object`).toBe(5);
            await input.touch([await stableCenter(shapes)]);
            await expect(toolMenu).toHaveCount(0);
          }
          await open();
          await shellMenuChange(async () => {
            await page.keyboard.press("Escape");
            await expect(shellMenu.list, `Escape did not close ${name}`).toHaveCount(0);
          });
        }
        // With no menu open the same press draws.
        const from = at(8, 9);
        await input.penStroke(Array.from({ length: 8 }, (_, i) => ({ x: from.x + i * 12, y: from.y })));
        await expect.poll(paths, { message: "A drag with Shapes drew nothing" }).toBe(6);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the press that closes a Properties dropdown or the colour picker keeps the selection, by pen, finger, and mouse, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        const line = frame.locator('svg [data-source-id="path:4"]').first();
        await expect(line).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const lasso = toolbarItem(frame, "Lasso");
        const toolMenu = activeToolMenu(frame);
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        const contacts: [string, (point: Point) => Promise<void>][] = [
          ["pen", (point) => input.penStroke([point])],
          ["finger", (point) => input.touch([point])],
          ["mouse", (point) => page.mouse.click(point.x, point.y)],
        ];
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, line, 0.5)]);
        await expect.poll(selection, { message: "A tap did not select the line" }).toEqual(["path:4"]);
        await input.touch([await stableCenter(documentPanelButton("Properties"))]);
        const properties = sidePanel(frame, "Properties");
        await expect(properties).toBeVisible();
        // The canvas moves when Properties opens, so the figure is located after that.
        const at = await figureAxes(frame);
        const inside = (box: { x: number; y: number; width: number; height: number }, point: Point) =>
          point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height;
        const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
        const panel = await layoutBox(properties);
        // Empty points of the figure that the canvas shows and Properties does not cover.
        const empty = [at(-1, -1), at(10, -1), at(-1, 9), at(11, 2), at(9, 9), at(9, 6), at(11, 11), at(4, 1.5)].filter(
          (point) => inside(canvas, point) && !inside(panel, point),
        );
        const popups: [string, Locator, Locator][] = [
          [
            "the Path morphing dropdown",
            properties.locator('[aria-haspopup="listbox"][aria-label="Path morphing"]'),
            frame.getByRole("listbox", { name: "Path morphing" }),
          ],
          [
            "the colour picker",
            properties.locator('[aria-haspopup="dialog"][aria-label="Color"]'),
            frame.getByRole("group", { name: "Color", exact: true }),
          ],
        ];
        for (const [name, trigger, popup] of popups) {
          for (const [contact, press] of contacts) {
            await input.touch([await stableCenter(trigger)]);
            await expect(popup, `A tap on its field did not open ${name}`).toBeVisible();
            await press(await pointOutside(popup, empty));
            await expect(popup, `A ${contact} press on the canvas did not close ${name}`).toHaveCount(0);
            // The press's own effect is complete before the next tap opens the Lasso's menu.
            await input.touch([await stableCenter(lasso)]);
            await expect(toolMenu).toBeVisible();
            expect(await selection(), `The ${contact} press that closed ${name} also changed the selection`).toEqual([
              "path:4",
            ]);
            await input.touch([await stableCenter(lasso)]);
            await expect(toolMenu).toHaveCount(0);
          }
        }
        // With no popup open the same tap clears the selection.
        await input.penStroke([empty[0]]);
        await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a tap on another control of the shell closes the title menu, and the control still acts, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const file = barMenu("title");
        await input.touch([await stableCenter(file.button)]);
        await expect(file.list).toBeVisible();
        await input.touch([await stableCenter(documentPanelButton("Layers"))]);
        await expect(sidePanel(frame, "Layers"), "The tap on Layers did not open it").toBeVisible();
        await expect(file.list, "The title menu stayed open after a tap on Layers").toHaveCount(0);
      },
    );
  }

  story(
    { initialPage: "blank" },
    "a press in the Quiver view closes the title menu and places nothing",
    async function () {
      await page.goto(url);
      await editorReady(page);
      const file = barMenu("title");
      await file.button.click();
      await barMenuItem("New tikzcd").click();
      const quiver = page.locator('iframe[title="Quiver diagram editor"]');
      await expect(quiver).toBeVisible({ timeout: 30_000 });
      // A press on an empty cell of Quiver shows the focus point there; a second press on it makes a vertex.
      const focusPoint = page.frameLocator('iframe[title="Quiver diagram editor"]').locator(".focus-point");
      await expect(focusPoint).not.toHaveClass(/revealed/);
      await file.button.click();
      await expect(file.list).toBeVisible();
      const box = await layoutBox(quiver);
      const cell = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.75 };
      await page.mouse.click(cell.x, cell.y);
      await expect(file.list, "The title menu stayed open after a press in the Quiver view").toHaveCount(0);
      await expect(focusPoint, "The press that closed File also showed Quiver's focus point").not.toHaveClass(
        /revealed/,
      );
      // With no menu open, the same press shows the focus point: the press above was on an empty cell.
      await page.mouse.click(cell.x, cell.y);
      await expect(focusPoint, "A press on an empty cell did not show Quiver's focus point").toHaveClass(/revealed/);
    },
  );

  story(
    { initialPage: "blank" },
    "a press on a control of Quiver closes the title menu, and the control acts",
    async function () {
      await page.goto(url);
      await editorReady(page);
      const file = barMenu("title");
      await file.button.click();
      await barMenuItem("New tikzcd").click();
      await expect(page.locator('iframe[title="Quiver diagram editor"]')).toBeVisible({ timeout: 30_000 });
      const grid = page
        .frameLocator('iframe[title="Quiver diagram editor"]')
        .locator('button.action[data-name="hide-grid"]');
      await expect(grid.locator(".name")).toHaveText("Hide grid");
      await file.button.click();
      await expect(file.list).toBeVisible();
      await grid.click();
      await expect(file.list, "The title menu stayed open after a press on a control of Quiver").toHaveCount(0);
      await expect(grid.locator(".name"), "The control that took the closing press did not act").toHaveText(
        "Show grid",
      );
    },
  );

  story(
    { viewport: TABLET_VIEWPORTS[0] },
    "on the dark canvas, text in the default colour shows in the colour of a line in the default colour",
    async function () {
      await editorReady(page);
      await page.emulateMedia({ colorScheme: "dark" });
      const frame = editorFrame(page);
      await expect(frame.locator("html")).toHaveAttribute("data-color-scheme", "dark");
      const input = await TabletInput.attach(page);
      const source = async () => (await editorDebug(page)).source;
      const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
      const at = (x: number, y: number) => ({ x: canvas.x + canvas.width * x, y: canvas.y + canvas.height * y });
      await chooseTool(frame, input, "Pen");
      await input.penStroke([at(0.3, 0.3), at(0.4, 0.35), at(0.5, 0.3)]);
      await expect.poll(source, { message: "The pen drew no stroke" }).toMatch(/\\draw/);
      await chooseTool(frame, input, "Text");
      await input.penStroke([at(0.4, 0.5)]);
      await expect(frame.getByTestId("canvas-text-edit-textarea"), "The new text is not in edit").toBeFocused();
      await page.keyboard.type("x+y");
      await page.keyboard.press("Escape");
      // The source states no colour for the stroke or for the text: both have the default colour.
      await expect.poll(source).toMatch(/\\node at \([^)]*\) \{x\+y\};/);
      expect(await source(), "The stroke states a colour").toMatch(/\\draw \(/);
      const glyph = frame.locator('svg [data-text-renderer="mathjax"] path').first();
      // The stroke is the one drawn path that has a source identifier; the glyphs of the text have none.
      const stroke = frame.locator("svg path[data-source-id]").first();
      const lineColour = await stroke.evaluate((path) => getComputedStyle(path).stroke);
      expect(lineColour, "The line in the default colour is not light on the dark canvas").toBe("rgb(238, 238, 238)");
      await storyScreenshot(page, "dark-canvas-default-text");
      await expect
        .poll(() => glyph.evaluate((path) => getComputedStyle(path).fill), {
          message: "The text in the default colour does not show in the colour of the line",
        })
        .toBe(lineColour);
    },
  );

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a pen tap with Text places plain text in edit, and the keys typed next become that text, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const source = async () => (await editorDebug(page)).source;
        const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
        const at = (x: number, y: number) => ({ x: canvas.x + canvas.width * x, y: canvas.y + canvas.height * y });
        // A person types when the text box shows; keys sent before it has the keyboard do not reach it.
        const textBox = frame.getByTestId("canvas-text-edit-textarea");
        await chooseTool(frame, input, "Text");
        await input.penStroke([at(0.3, 0.3)]);
        await expect.poll(source, { message: "The tap placed no text" }).toMatch(/\\node/);
        await expect(textBox, "The new text is not in edit").toBeFocused();
        await page.keyboard.type("x+y");
        await expect
          .poll(source, { message: "The keys typed after the tap did not become the text" })
          .toMatch(/\{x\+y\};/);
        expect(await source(), "The text has a border or another option").toMatch(/\\node at \([^)]*\) \{x\+y\};/);
        // The tool's colour is the colour of the next text; a tap elsewhere ends the first text and starts the next.
        await input.touch([await stableCenter(toolbarItem(frame, "Colour 2: blue"))]);
        await input.penStroke([at(0.6, 0.6)]);
        await expect.poll(source, { message: "The second tap placed no text" }).toMatch(/\{node\};/);
        await expect(textBox, "The second text is not in edit").toBeFocused();
        await page.keyboard.type("z");
        await expect
          .poll(source, { message: "The second tap did not start a second text in the tool's colour" })
          .toMatch(/\\node\[text=blue\] at \([^)]*\) \{z\};/);
        // The first text was selected when the colour was tapped, so it took the colour, as text (FR-021).
        expect(await source(), "The first text is not the typed text in the tapped colour, without a border").toMatch(
          /\\node\[text=blue\] at \([^)]*\) \{x\+y\};/,
        );
        // Text placed on a line is a label of that line; it is in edit and in the Text tool's colour as well.
        await chooseShape(frame, input, "Line");
        const [from, to] = [at(0.3, 0.75), at(0.6, 0.75)];
        await input.penStroke([from, { x: (from.x + to.x) / 2, y: from.y }, to]);
        await expect.poll(source, { message: "The line was not drawn" }).toMatch(/\\draw \([^)]*\) -- \([^)]*\);/);
        await chooseTool(frame, input, "Text");
        // The tap is on the line as it is drawn: the lattice moved the line from the pen's path.
        await input.penStroke([await strokePoint(page, lastPath(frame), 0.5)]);
        await expect.poll(source, { message: "The tap on the line placed no label" }).toMatch(/ node\[/);
        await expect(textBox, "The label is not in edit").toBeFocused();
        await page.keyboard.type("w");
        await expect
          .poll(source, { message: "The label on the line is not in edit in the tool's colour" })
          .toMatch(/-- \([^)]*\) node\[midway,auto(?:=right)?,text=blue\] \{w\};/);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a text that gets no key leaves nothing in the diagram or in its history, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const source = async () => (await editorDebug(page)).source;
        const texts = async () => ((await source()).match(/\{[^{}]*\};/g) ?? []).join(" ");
        const textBox = frame.getByTestId("canvas-text-edit-textarea");
        await chooseTool(frame, input, "Text");
        // Escape with no key typed, for a text on empty canvas and for a label on a line.
        for (const [name, point] of [
          ["text", at(9, 9)],
          ["label on a line", at(5, 0)],
        ] as const) {
          await input.penStroke([point]);
          await expect(textBox, `The new ${name} is not in edit`).toBeFocused();
          await page.keyboard.press("Escape");
          await expect
            .poll(source, { message: `The ${name} that got no key stayed in the diagram after Escape` })
            .toBe(axesFigure);
        }
        // A tap elsewhere moves the text that got no key; the keys typed next go to the new place only.
        await input.penStroke([at(9, 9)]);
        await expect(textBox, "The new text is not in edit").toBeFocused();
        await input.penStroke([at(9, 6)]);
        await expect
          .poll(texts, { message: "A tap elsewhere did not leave exactly one text in edit" })
          .toBe("{node};");
        await expect(textBox, "The text at the second tap is not in edit").toBeFocused();
        await page.keyboard.type("z");
        await expect.poll(texts, { message: "The typed key did not become the one text" }).toBe("{z};");
        const typed = await source();
        // The typed text is one step of the history; the placements that got no key are no step.
        await input.touch([await stableCenter(documentHistory("Undo"))]);
        await expect
          .poll(source, { message: "One Undo after a typed text did not remove the text" })
          .toBe(axesFigure);
        await input.touch([await stableCenter(documentHistory("Redo"))]);
        await expect.poll(source, { message: "Redo did not bring the typed text back" }).toBe(typed);
        // A change of tool with no key typed.
        await chooseTool(frame, input, "Text");
        await input.penStroke([at(3, 9)]);
        await expect(textBox, "The new text is not in edit").toBeFocused();
        await chooseTool(frame, input, "Lasso");
        await expect
          .poll(source, { message: "The text that got no key stayed in the diagram after the tool changed" })
          .toBe(typed);
        await input.touch([await stableCenter(documentHistory("Undo"))]);
        await expect
          .poll(source, { message: "A text that got no key is a step of the history" })
          .toBe(axesFigure);
      },
    );

    story(
      { viewport: tablet },
      `a text whose edit ends with no character to show leaves the diagram, and no step of the history changes nothing, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const source = async () => (await editorDebug(page)).source;
        const textBox = frame.getByTestId("canvas-text-edit-textarea");
        await chooseTool(frame, input, "Text");
        // A first text is one step of the history: a later step that changes nothing shows at Undo.
        await input.penStroke([at(9, 9)]);
        await expect(textBox, "The first text is not in edit").toBeFocused();
        await page.keyboard.type("a");
        await expect.poll(source, { message: "The typed key did not become the first text" }).toMatch(/\{a\};/);
        await page.keyboard.press("Escape");
        const withFirst = await source();
        // A new text: typed, emptied, ended. A space alone shows nothing.
        await input.penStroke([at(9, 6)]);
        await expect(textBox, "The new text is not in edit").toBeFocused();
        await page.keyboard.type("z");
        await expect.poll(source, { message: "The typed key did not become the new text" }).toMatch(/\{z\};/);
        await page.keyboard.press("Backspace");
        await page.keyboard.type(" ");
        await page.keyboard.press("Escape");
        await expect
          .poll(source, { message: "The new text whose characters were all deleted stayed in the diagram" })
          .toBe(withFirst);
        // A new text that is emptied, and whose edit a tap elsewhere ends: the tap places the next text.
        await input.penStroke([at(9, 3)]);
        await expect(textBox, "The text to empty is not in edit").toBeFocused();
        await page.keyboard.type("y");
        await expect.poll(source, { message: "The typed key did not become the text to empty" }).toMatch(/\{y\};/);
        await page.keyboard.press("Backspace");
        await input.penStroke([at(5, 3)]);
        await expect(textBox, "The tap that ended the edit of the emptied text placed no text").toBeFocused();
        await page.keyboard.type("w");
        await expect.poll(source, { message: "The typed key did not become the next text" }).toMatch(/\{w\};/);
        await page.keyboard.press("Escape");
        const withSecond = await source();
        expect(
          withSecond.replace(/^.*\{w\};\n/mu, ""),
          "The emptied text stayed in the diagram when a tap ended its edit",
        ).toBe(withFirst);
        // A text of the diagram: opened by a double tap, emptied, ended.
        await chooseTool(frame, input, "Lasso");
        await input.doubleTap(at(9, 9));
        await expect(textBox, "The double tap did not put the first text in edit").toBeFocused();
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Escape");
        await expect
          .poll(source, { message: "The text whose characters were all deleted stayed in the diagram" })
          .toBe(withSecond.replace(/^.*\{a\};\n/mu, ""));
        // The removal of the first text is one step. Before it, the history holds the two texts that stay, one step each.
        await input.touch([await stableCenter(documentHistory("Undo"))]);
        await expect.poll(source, { message: "One Undo did not bring back the emptied text" }).toBe(withSecond);
        await input.touch([await stableCenter(documentHistory("Undo"))]);
        await expect
          .poll(source, { message: "A text that was typed and emptied left a step in the history" })
          .toBe(withFirst);
        await input.touch([await stableCenter(documentHistory("Undo"))]);
        await expect
          .poll(source, { message: "A text that was typed and emptied left a step in the history" })
          .toBe(axesFigure);
      },
    );

    story(
      { viewport: tablet },
      `while a text is in edit, the canvas shows no coordinate tooltip and no snap label, by pen and mouse, in ${tablet.name}`,
      async function () {
        await author(axesFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const textBox = frame.getByTestId("canvas-text-edit-textarea");
        const tooltip = frame.getByTestId("canvas-drag-tooltip");
        const snapLabel = frame.locator("[data-snap-target]");
        await chooseTool(frame, input, "Text");
        // The pen lifts and stays in hover range; the mouse stays where it clicked and moves a little.
        const contacts: [string, Point, (point: Point) => Promise<void>, (point: Point) => Promise<void>][] = [
          ["pen", at(5, 0), (point) => input.penStroke([point]), (point) => input.penHover(point)],
          [
            "mouse",
            at(4, 7),
            (point) => page.mouse.click(point.x, point.y),
            (point) => page.mouse.move(point.x + 2, point.y),
          ],
        ];
        for (const [contact, point, tap, stay] of contacts) {
          await tap(point);
          await expect(textBox, `The label placed by ${contact} is not in edit`).toBeFocused();
          await stay(point);
          await stay(point);
          await expect(tooltip, `A coordinate tooltip shows while the text placed by ${contact} is in edit`).toHaveCount(0);
          await expect(snapLabel, `A snap label shows while the text placed by ${contact} is in edit`).toHaveCount(0);
          await page.keyboard.type("w");
          await expect(tooltip, `A coordinate tooltip shows while the text placed by ${contact} is typed`).toHaveCount(0);
          // With no text in edit, the tool shows where the next text goes.
          await page.keyboard.press("Escape");
          await expect(textBox).toHaveCount(0);
          await stay(point);
          await expect(tooltip, `The Text tool shows no coordinates for the ${contact} after the edit ended`).toHaveCount(1);
        }
      },
    );
  }

  /** A stroke record with a field this build does not define, as an older build wrote it. */
  const unreadableInkRecord = encodeURIComponent(
    JSON.stringify({
      key: "k1",
      color: "black",
      intent: "geometry",
      samples: [
        { x: 2, y: 2, time: 0 },
        { x: 4, y: 4, time: 16 },
        { x: 6, y: 3, time: 32 },
      ],
    }),
  );
  const unreadableInkFigure = [
    String.raw`\begin{tikzpicture}`,
    String.raw`\draw (0,0) -- (10,0);`,
    String.raw`\draw (0,0) -- (0,10);`,
    `% workbench-ink:${unreadableInkRecord}`,
    String.raw`\begin{scope}`,
    String.raw`\draw (2,2) -- (4,4) -- (6,3);`,
    String.raw`\end{scope}`,
    "% workbench-ink-end:k1",
    String.raw`\path[use as bounding box] (-2,-2) rectangle (12,12);`,
    String.raw`\end{tikzpicture}`,
  ].join("\n");

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a stroke record the editor cannot read leaves its drawing on the canvas, is reported, and stays in the source, in ${tablet.name}`,
      async function () {
        await author(unreadableInkFigure);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const source = async () => (await editorDebug(page)).source;
        await expect
          .poll(
            async () =>
              [
                ...new Set(
                  await frame
                    .locator("svg path[data-source-id]")
                    .evaluateAll((paths) => paths.map((path) => path.getAttribute("data-source-id"))),
                ),
              ].sort(),
            { message: "The canvas does not show the two axes, the drawing of the record and the bounding box" },
          )
          // Statement 2 is the scope of the record; its drawing is statement 3.
          .toEqual(["path:0", "path:1", "path:3", "path:4"]);
        await expect(frame.getByTestId("canvas-warning-message"), "The unreadable record is not reported").toContainText(
          "1 stroke record cannot be read",
        );
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        // The drawing is an ordinary path: a Lasso tap selects it, and a new stroke is recorded beside it.
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([at(3, 3)]);
        await expect
          .poll(async () => (await editorDebug(page)).selection.length, { message: "A tap did not select the drawing" })
          .toBe(1);
        await chooseTool(frame, input, "Pen");
        await input.penStroke(Array.from({ length: 12 }, (_, i) => at(2 + i * 0.4, 7 + Math.sin(i) * 0.3)));
        await expect
          .poll(async () => ((await source()).match(/% workbench-ink:/g) ?? []).length, { message: "The new stroke was not recorded" })
          .toBe(2);
        expect(await source(), "The unreadable record left the source").toContain(`% workbench-ink:${unreadableInkRecord}`);
      },
    );
  }

  const textFigure = String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\node at (2,7) {plain};
\node[draw] at (6,7) {boxed};
\draw (2,4) -- (6,4);
\path[use as bounding box] (-2,-2) rectangle (12,12);
\end{tikzpicture}`;

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a colour tap colours the text of selected text and the lines of a selected shape, and draws no border around plain text, in ${tablet.name}`,
      async function () {
        await author(textFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const source = async () => (await editorDebug(page)).source;
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        const colour = async (subject: Point, id: string, preset: string) => {
          await input.penStroke([at(10, -1)]);
          await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
          await input.penStroke([subject]);
          await expect.poll(selection, { message: `A tap did not select ${id}` }).toEqual([id]);
          await input.touch([await stableCenter(toolbarItem(frame, preset))]);
        };
        await chooseTool(frame, input, "Lasso");
        await colour(at(2, 7), "path:2", "Colour 2: blue");
        await expect
          .poll(source, { message: "The plain text did not take the colour as its text colour, with no border" })
          .toContain(String.raw`\node[text=blue] at (2,7) {plain};`);
        await colour(at(6, 7), "path:3", "Colour 3: red");
        await expect
          .poll(source, { message: "The boxed text did not take the colour on its border and on its text" })
          .toMatch(/\\node\[(?=[^\]]*draw=red)(?=[^\]]*text=red)[^\]]*\] at \(6,7\) \{boxed\};/);
        await colour(at(4, 4), "path:4", "Colour 2: blue");
        await expect
          .poll(source, { message: "The line did not take the colour" })
          .toMatch(/\\draw\[[^\]]*blue[^\]]*\] \(2,4\) -- \(6,4\);/);
        expect(await source(), "The line, which shows no text, has a text colour").not.toMatch(/\\draw\[[^\]]*text=/);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `after a press on a button, the arrow keys, Escape, and Delete act on the selection, in ${tablet.name}`,
      async function () {
        // Issue #83: a button that took the keyboard focus at a press took the keys from the canvas.
        await author(textFigure);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const source = async () => (await editorDebug(page)).source;
        const selection = async () => (await editorDebug(page)).selection.length;
        const blueLines = async () => ((await source()).match(/\\draw\[[^\]]*blue[^\]]*\]/g) ?? []).length;
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const selectLine = async () => {
          await input.penStroke([at(10, -1)]);
          await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toBe(0);
          await input.penStroke([at(4, 4)]);
          await expect.poll(selection, { message: "A tap did not select the line" }).toBe(1);
        };
        await chooseTool(frame, input, "Lasso");

        // A colour of the bar, by touch.
        await selectLine();
        await input.touch([await stableCenter(toolbarItem(frame, "Colour 2: blue"))]);
        await expect.poll(blueLines, { message: "The line did not take the colour" }).toBe(1);
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(async () => /\\draw\[[^\]]*blue[^\]]*\] \(([\d.]+),4\) -- \(([\d.]+),4\);/.exec(await source())?.slice(1).map(Number), {
            message: "The arrow key after the colour tap did not move the line",
          })
          .toEqual([expect.closeTo(2.05, 3), expect.closeTo(6.05, 3)]);
        await page.keyboard.press("Escape");
        await expect.poll(selection, { message: "Escape after the colour tap did not clear the selection" }).toBe(0);

        // A button of the selection bar, by mouse.
        await selectLine();
        const duplicate = await stableCenter(strip.getByRole("button", { name: "Duplicate", exact: true }));
        await page.mouse.click(duplicate.x, duplicate.y);
        await expect.poll(blueLines, { message: "Duplicate made no second line" }).toBe(2);
        await page.keyboard.press("Delete");
        await expect.poll(blueLines, { message: "Delete after Duplicate did not remove the selected line" }).toBe(1);

        // An item of the More menu, by pen: the item is gone when the key comes.
        await selectLine();
        const ordered = await source();
        await input.penStroke([await stableCenter(strip.getByRole("button", { name: "More", exact: true }))]);
        await input.penStroke([await stableCenter(frame.getByRole("menuitem", { name: /^Reorder/ }))]);
        await input.penStroke([await stableCenter(frame.getByRole("menuitem", { name: "Bring to Front", exact: true }))]);
        await expect.poll(source, { message: "Bring to Front did not change the order" }).not.toBe(ordered);
        await page.keyboard.press("Delete");
        await expect.poll(blueLines, { message: "Delete after an item of More did not remove the selected line" }).toBe(0);

        // A control of the document bar, by mouse: the press is in the shell's window.
        await page.keyboard.press("Control+z");
        await expect.poll(blueLines, { message: "Undo did not return the line" }).toBe(1);
        await editorReady(page);
        await selectLine();
        const layers = await stableCenter(documentPanelButton("Layers"));
        await page.mouse.click(layers.x, layers.y);
        await expect(sidePanel(frame, "Layers")).toBeVisible();
        await page.keyboard.press("Delete");
        await expect.poll(blueLines, { message: "Delete after a press on Layers did not remove the selected line" }).toBe(0);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `the Lasso selects by tap, by Freehand, Rectangle, and Oval drag, and moves by a drag on the selection, in ${tablet.name}`,
      async function () {
        await author(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,4) circle (1);
\draw (6,4) circle (1);
\draw (2,7) -- (6,7);
\path[use as bounding box] (-2,-2) rectangle (12,12);
\end{tikzpicture}`);
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:4"]').first()).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const lasso = toolbarItem(frame, "Lasso");
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        await input.touch([await stableCenter(lasso)]);
        await expect(lasso).toHaveAttribute("aria-pressed", "true");
        // A tap selects the object under it.
        await input.penStroke([
          await strokePoint(page, frame.locator('svg [data-source-id="path:4"]').first(), 0.5),
        ]);
        await expect.poll(selection, { message: "A tap did not select the line" }).toEqual(["path:4"]);
        // The line's selection strip sits above it and, at the landscape fit, over the loop's start;
        // a tap on empty canvas clears both first.
        await input.penStroke([at(10, -1)]);
        await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
        // Freehand is the default shape: a loop round both circles.
        await input.penStroke([at(8, 5.5), at(0.5, 5.5), at(0.5, 2.5), at(8, 2.5), at(8, 5.4)]);
        await expect
          .poll(selection, { message: "The Freehand loop did not select both circles" })
          .toEqual(["path:2", "path:3"]);
        const drag = (from: Point, to: Point) =>
          input.penStroke(
            Array.from({ length: 8 }, (_, i) => ({
              x: from.x + ((to.x - from.x) * i) / 7,
              y: from.y + ((to.y - from.y) * i) / 7,
            })),
          );
        const chooseShape = async (shape: "Rectangle" | "Oval") => {
          await input.touch([await stableCenter(lasso)]);
          await input.touch([
            await stableCenter(activeToolMenu(frame).getByRole("option", { name: shape, exact: true })),
          ]);
          await expect(activeToolMenu(frame)).toHaveCount(0);
        };
        await chooseShape("Rectangle");
        // The selection's object menu sits beside it; a tap on empty canvas clears both first.
        await input.penStroke([at(10, 10)]);
        await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
        await drag(at(4.5, 2.5), at(7.8, 5.6));
        await expect
          .poll(selection, { message: "The Rectangle drag did not select the right circle" })
          .toEqual(["path:3"]);
        await chooseShape("Oval");
        // The oval inscribed in this drag's box holds the left circle.
        await drag(at(0.4, 2.4), at(3.6, 5.6));
        await expect
          .poll(selection, { message: "The Oval drag did not select the left circle" })
          .toEqual(["path:2"]);
        // A drag on the selection moves it: here by 2 along x.
        const grip = await strokePoint(page, frame.locator('svg [data-source-id="path:2"]').first(), 0.25);
        const [zero, two] = [at(0, 0), at(2, 0)];
        await drag(grip, { x: grip.x + two.x - zero.x, y: grip.y + two.y - zero.y });
        await expect
          .poll(async () => (await editorDebug(page)).source, {
            message: "A drag on the selection did not move it",
          })
          .toContain(String.raw`\draw (4,4) circle (1);`);
        assert.ok((await editorDebug(page)).source.includes(String.raw`\draw (6,4) circle (1);`));
        assert.deepEqual(await selection(), ["path:2"], "The move changed the selection");
      },
    );
  }

  /**
   * The accessible entries of a surface, read from its ARIA snapshot without the surface's own line:
   * one `role "name"` string per child, so a heading or a sentence shows as an entry of its own.
   */
  async function ariaEntries(surface: Locator): Promise<string[]> {
    return (await surface.ariaSnapshot())
      .split("\n")
      .slice(1)
      .map((line) => line.trim().replace(/^- /, "").replace(/ \[[^\]]*\]$/, "").replace(/:$/, ""))
      .filter((entry) => entry !== "separator");
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `each object menu holds exactly the commands of its selection, in ${tablet.name}`,
      async function () {
        await author(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (1,6) .. controls (2,8) and (4,8) .. (5,6) -- (7,7);
\draw (2,2) rectangle (5,4);
\draw (6.5,3) circle (0.5);
\path[use as bounding box] (-2,-2) rectangle (12,12);
\end{tikzpicture}`);
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:2"]').first();
        const rectangle = frame.locator('svg [data-source-id="path:3"]').first();
        await expect(rectangle).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        await chooseTool(frame, input, "Lasso");
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        // (10,-1) is empty canvas below every object, where no object menu reaches.
        const clear = async () => {
          await input.penStroke([at(10, -1)]);
          await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
        };
        const menu = frame.getByRole("toolbar", { name: "Selection", exact: true });
        // The object menu holds buttons only (contracts/surfaces.md, Object menu; FR-070): no heading
        // names the selection, and no other text.
        // Every command the menu shows applies: none is greyed out, and no launcher hides the
        // commands behind a second tap.
        const commands = async () => {
          await expect(menu).toBeVisible();
          for (const control of await menu.getByRole("button").all()) {
            await expect(control).toBeEnabled();
          }
          for (const name of ["Selection actions", "Curve actions", "More curve actions", "Point actions"]) {
            await expect(frame.getByRole("button", { name, exact: true })).toHaveCount(0);
          }
          return ariaEntries(menu);
        };
        const buttons = (...names: string[]) => names.map((name) => `button "${name}"`);

        // One curve: Edit Points, Simplify, Lock, Duplicate, More; no original stroke, so no Restore.
        await input.penStroke([await strokePoint(page, curve, 0.3)]);
        await expect.poll(selection).toEqual(["path:2"]);
        assert.deepEqual(
          await commands(),
          buttons("Edit Points", "Simplify", "Lock", "Duplicate", "More"),
          "The object menu of one curve",
        );
        // The figure has room above the curve, so the menu goes there (FR-050).
        const menuBox = (await menu.boundingBox())!;
        const curveBox = (await curve.boundingBox())!;
        // Every command shows; none is scrolled out of the menu.
        await expect.poll(() => menu.evaluate((element: HTMLElement) => element.scrollHeight <= element.clientHeight), {
          message: "The object menu of one curve hides commands below its edge",
        }).toBe(true);
        await storyScreenshot(page, `object-menu-curve-${tablet.name}`);
        assert.ok(
          menuBox.y + menuBox.height <= curveBox.y,
          `The object menu of one curve ends at ${menuBox.y + menuBox.height}, below the curve's top at ${curveBox.y}`,
        );

        // Points in Edit Points: of Smooth, Corner, Split, Delete, Done, only those that apply to the
        // joint at (5,6), in that order; Smooth applies to its corner, and Split, Delete, and Done to an
        // interior point.
        await input.touch([await stableCenter(menu.getByRole("button", { name: "Edit Points", exact: true }))]);
        const joint = at(5, 6);
        await input.penStroke([joint]);
        await expect(selectedPoints(frame)).toHaveCount(1);
        const pointCommands = await commands();
        const pointOrder = buttons("Smooth", "Corner", "Split", "Delete", "Done");
        assert.deepEqual(
          pointCommands,
          pointOrder.filter((entry) => pointCommands.includes(entry)),
          "The object menu of a point holds other entries than Smooth, Corner, Split, Delete, Done, or another order",
        );
        for (const entry of buttons("Smooth", "Split", "Delete", "Done")) {
          assert.ok(pointCommands.includes(entry), `The object menu of an interior point lacks ${entry}`);
        }
        await storyScreenshot(page, `object-menu-point-${tablet.name}`);
        // Done ends point editing: no point stays chosen, and the curve's own menu returns.
        await input.touch([await stableCenter(menu.getByRole("button", { name: "Done", exact: true }))]);
        await expect(selectedPoints(frame)).toHaveCount(0);
        assert.equal((await editorDebug(page)).handle, null, "Done leaves no point active");
        assert.deepEqual(
          await commands(),
          buttons("Edit Points", "Simplify", "Lock", "Duplicate", "More"),
          "The object menu of one curve after Done",
        );
        await clear();

        // One shape: Lock, Duplicate, More.
        await input.penStroke([await strokePoint(page, rectangle, 0.1)]);
        await expect.poll(selection).toEqual(["path:3"]);
        assert.deepEqual(await commands(), buttons("Lock", "Duplicate", "More"), "The object menu of one shape");
        // More holds Cut, Copy, Paste, Delete, Transform, Reorder, Repeat…, and nothing else.
        await input.touch([await stableCenter(menu.getByRole("button", { name: "More", exact: true }))]);
        const more = frame.getByRole("menu").first();
        await expect(more).toBeVisible();
        const moreEntries = await ariaEntries(more);
        const moreOrder = ["Cut", "Copy", "Paste", "Delete", "Transform", "Reorder", "Repeat…"];
        // A menu item's name is its label, then its keyboard shortcut when it has one.
        assert.deepEqual(
          moreEntries.map((entry) => moreOrder.find((label) => new RegExp(`^menuitem "${label}( [^"]+)?"$`).test(entry)) ?? entry),
          moreOrder,
          "More of the object menu",
        );
        await page.keyboard.press("Escape");
        await clear();

        // Several objects: Align, Distribute, Lock, Duplicate, More. Distribute spaces three or more objects,
        // so the lasso takes the curve, the rectangle, and the circle.
        await input.penStroke([at(0.5, 1.5), at(8, 1.5), at(8, 8.5), at(0.5, 8.5), at(0.5, 1.6)]);
        await expect.poll(selection).toEqual(["path:2", "path:3", "path:4"]);
        assert.deepEqual(
          await commands(),
          buttons("Align", "Distribute", "Lock", "Duplicate", "More"),
          "The object menu of several objects",
        );
      },
    );

    story(
      { viewport: tablet },
      `simplifies an authored curve with a straight segment and a named end, in ${tablet.name}`,
      async function () {
        await author(String.raw`\begin{tikzpicture}
\coordinate (a) at (9,3);
\draw[blue] (1,6) .. controls (2,7) and (3,7) .. (4,6) .. controls (5,5) and (6,5) .. (7,6) -- (a);
\path[use as bounding box] (-2,-2) rectangle (12,12);
\end{tikzpicture}`);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (target: Locator) => input.touch([await stableCenter(target)]);
        const currentSource = async () => (await editorDebug(page)).source;
        const curve = frame.locator('svg [data-source-id^="path:"]').first();
        await expect(curve).toBeAttached();
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, curve, 0.2)]);
        await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
        const menu = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const before = await currentSource();
        // Simplify is an object-menu command of every curve it can refit, authored ones included (FR-027).
        await tap(menu.getByRole("button", { name: "Simplify", exact: true }));
        const refinement = frame.getByRole("dialog", { name: "Curve refinement" });
        await expect(refinement).toBeVisible();
        await storyScreenshot(page, `simplify-authored-curve-${tablet.name}`);
        await tap(refinement.getByRole("button", { name: "Accept", exact: true }));
        await expect(refinement).toHaveCount(0);
        await expect.poll(currentSource).not.toBe(before);
        await storyScreenshot(page, `simplified-authored-curve-${tablet.name}`);
        const drawn = /\\draw\[blue\][^;]*;/.exec(await currentSource())?.[0] ?? "";
        const segments = (drawn.match(/\.\. controls|--/g) ?? []).length;
        assert.ok(segments >= 1 && segments < 3, `Simplify left ${segments} segments: ${drawn}`);
        // The refit keeps the draw options and the coordinates written at both ends, so the curve stays attached to (a).
        assert.match(drawn, /^\\draw\[blue\] \(1,6\) /, `Simplify rewrote the start: ${drawn}`);
        assert.match(drawn, / \(a\);$/, `Simplify detached the end from (a): ${drawn}`);
        // The wave refits to one curve, and the corner at (7,6) and the straight run to (a) stay as drawn.
        assert.match(drawn, /^\\draw\[blue\] \(1,6\) \.\. controls \([^)]+\) and \([^)]+\) \.\. \(7,6\) -- \(a\);$/,
          `Simplify did not keep the corner and the straight run: ${drawn}`);
      },
    );
  }

  /** Two animation frames of the canvas frame, after which a handled tap shows in its state. */
  const canvasSettled = (frame: FrameLocator) =>
    frame
      .locator("body")
      .evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

  /** The values of the drawing toolbar's presets, in order, read from their names "Colour n: value". */
  /** The active tool's preset colours, in toolbar order, read from each preset's name "Colour n: value". */
  async function presetValues(frame: FrameLocator): Promise<string[]> {
    const names = await drawingToolbar(frame)
      .getByRole("button", { name: /^Colour \d+: / })
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
    return names.map((name) => {
      const value = /^Colour \d+: (.+)$/.exec(name)?.[1];
      assert.ok(value, `A preset is named ${name}`);
      return value;
    });
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a colour preset colours the tool and the selection, and no word names the target; each tool shows its own presets, in ${tablet.name}`,
      async function () {
        await author(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (2,2) rectangle (5,4);
\path[use as bounding box] (-2,-2) rectangle (12,12);
\end{tikzpicture}`);
        const frame = editorFrame(page);
        const rectangle = frame.locator('svg [data-source-id="path:2"]').first();
        await expect(rectangle).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        const toolbar = drawingToolbar(frame);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const source = async () => (await editorDebug(page)).source;
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        const preset = (name: string) => toolbar.getByRole("button", { name, exact: true });
        // No word on the toolbar names what a preset colours (FR-021), and the toolbar takes no typed colour.
        const noWords = async (when: string) => {
          assert.equal((await toolbar.innerText()).trim(), "", `The drawing toolbar shows words ${when}`);
          await expect(toolbar.getByRole("textbox")).toHaveCount(0);
        };

        // Each tool shows its own presets (FR-020).
        await chooseTool(frame, input, "Lasso");
        assert.deepEqual(await presetValues(frame), ["black", "blue", "red"], "The Lasso's presets");
        await chooseTool(frame, input, "Fill");
        assert.deepEqual(await presetValues(frame), ["yellow!30", "blue!20", "red!20"], "The Fill's presets");

        // With a selection, a Lasso preset colours its stroke and a Fill preset fills it.
        await chooseTool(frame, input, "Lasso");
        await noWords("with nothing selected");
        await input.penStroke([await strokePoint(page, rectangle, 0.1)]);
        await expect.poll(selection).toEqual(["path:2"]);
        await noWords("with a selection");
        await tap(preset("Colour 3: red"));
        await expect
          .poll(source, { message: "A Lasso preset did not colour the selected rectangle's stroke" })
          .toMatch(/\\draw\[(draw=)?red\] \(2,2\) rectangle \(5,4\);/);
        await chooseTool(frame, input, "Fill");
        await tap(preset("Colour 2: blue!20"));
        await expect
          .poll(source, { message: "A Fill preset did not fill the selected rectangle" })
          .toMatch(/\\draw\[[^\]]*\bfill=blue!20\b[^\]]*\] \(2,2\) rectangle \(5,4\);/);

        // With nothing selected, a preset leaves every object as written and colours the next line drawn.
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([at(10, 10)]);
        await expect.poll(selection).toEqual([]);
        await chooseShape(frame, input, "Line");
        const written = await source();
        await tap(preset("Colour 2: blue"));
        await expect(preset("Colour 2: blue")).toHaveAttribute("aria-pressed", "true");
        await canvasSettled(frame);
        assert.equal(await source(), written, "A preset chosen with nothing selected changed the source");
        const [from, to] = [at(1, 8), at(6, 8)];
        await input.penStroke(
          Array.from({ length: 8 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / 7, y: from.y })),
        );
        await expect
          .poll(source, { message: "The line drawn after the preset is not blue" })
          .toMatch(/\\draw\[(draw=)?blue\] \(1,8\) -- \(6,8\);/);

        // At most 12 presets: every tool and Add colour stay in view, and only the chosen preset is pressed.
        await chooseTool(frame, input, "Pen");
        const presets = toolbar.getByRole("button", { name: /^Colour \d+: / });
        const options = frame.getByRole("dialog", { name: "Colour options", exact: true });
        const add = toolbarItem(frame, "Add colour");
        for (let count = 3; count < 12; count++) {
          await tap(add);
          await expect(presets).toHaveCount(count + 1);
          // A tap on the active preset, the new one, closes its colour options.
          await expect(options).toBeVisible();
          await tap(presets.nth(count));
          await expect(options).toHaveCount(0);
        }
        await expect(add, "Add colour is available at 12 presets").toBeDisabled();
        for (const name of ["Lasso", "Pen", "Eraser", "Shapes", "Text", "Fill", "Add colour"]) {
          await expect(toolbarItem(frame, name), `${name} is out of view at 12 presets`).toBeInViewport({ ratio: 1 });
        }
        await tap(presets.nth(4));
        await expect(presets.nth(4)).toHaveAttribute("aria-pressed", "true");
        assert.deepEqual(
          await presets.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-pressed"))),
          Array.from({ length: 12 }, (_, i) => String(i === 4)),
          "Another preset than the chosen one is pressed",
        );
      },
    );
  }

  story(
    { viewport: TABLET_VIEWPORTS[0] },
    "each tool's presets and its chosen preset survive a restart (data model, Tool presets[tool])",
    async function () {
      let frame = editorFrame(page);
      let input = await TabletInput.attach(page);
      const toolbar = () => drawingToolbar(frame);
      const presets = () => toolbar().getByRole("button", { name: /^Colour \d+: / });
      const options = () => frame.getByRole("dialog", { name: "Colour options", exact: true });
      const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
      const pressed = () => presets().evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-pressed")));
      const source = (await editorDebug(page)).source;

      // The Pen gains two presets and keeps the second one chosen; the Fill keeps its third.
      await chooseTool(frame, input, "Pen");
      for (const count of [4, 5]) {
        await tap(toolbarItem(frame, "Add colour"));
        await expect(presets()).toHaveCount(count);
        await tap(presets().nth(count - 1));
        await expect(options()).toHaveCount(0);
      }
      await tap(presets().nth(1));
      await expect(presets().nth(1)).toHaveAttribute("aria-pressed", "true");
      const pen = await presetValues(frame);
      assert.equal(pen.length, 5, `The Pen's presets before a restart: ${pen.join(", ")}`);
      await chooseTool(frame, input, "Fill");
      await tap(presets().nth(2));
      await expect(presets().nth(2)).toHaveAttribute("aria-pressed", "true");
      const fill = await presetValues(frame);
      assert.equal(fill.length, 3, `The Fill's presets before a restart: ${fill.join(", ")}`);
      // Presets are preferences: choosing and adding them leaves the figure's source as written.
      assert.equal((await editorDebug(page)).source, source, "A preset change entered the source");

      const configHome = workbench.configHome;
      await workbench.stop();
      workbench = await startWorkbench(process.env, configHome);
      url = workbench.url;
      await page.goto(url);
      await editorReady(page);
      frame = editorFrame(page);
      input = await TabletInput.attach(page);

      await chooseTool(frame, input, "Pen");
      assert.deepEqual(await presetValues(frame), pen, "The Pen's presets after a restart");
      assert.deepEqual(await pressed(), ["false", "true", "false", "false", "false"], "The Pen's chosen preset after a restart");
      await chooseTool(frame, input, "Fill");
      assert.deepEqual(await presetValues(frame), fill, "The Fill's presets after a restart");
      assert.deepEqual(await pressed(), ["false", "false", "true"], "The Fill's chosen preset after a restart");
      assert.equal((await editorDebug(page)).source, source, "The reopened source holds a preset");
      await storyScreenshot(page, "presets-after-restart");
    },
  );

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a locked selection survives a tap that misses; Edit Points dims and locks the rest, in ${tablet.name}`,
      async function () {
        await author(String.raw`\begin{tikzpicture}
\draw (0,0) -- (10,0);
\draw (0,0) -- (0,10);
\draw (1,6) .. controls (2,8) and (4,8) .. (5,6) -- (7,7);
\draw (2,2) rectangle (5,4);
\path[use as bounding box] (-2,-2) rectangle (12,12);
\end{tikzpicture}`);
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:2"]').first();
        const rectangle = frame.locator('svg [data-source-id="path:3"]').first();
        await expect(rectangle).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const at = await figureAxes(frame);
        await chooseTool(frame, input, "Lasso");
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const source = async () => (await editorDebug(page)).source;
        const selection = async () => [...(await editorDebug(page)).selection].sort();
        const menu = frame.getByRole("toolbar", { name: "Selection", exact: true });

        // A locked selection survives a tap that misses (FR-052); unlocked, the same tap clears it.
        await input.penStroke([await strokePoint(page, rectangle, 0.1)]);
        await expect.poll(selection).toEqual(["path:3"]);
        const lock = menu.getByRole("button", { name: "Lock", exact: true });
        await tap(lock);
        await expect(lock).toHaveAttribute("aria-pressed", "true");
        await input.penStroke([at(10, 10)]);
        await canvasSettled(frame);
        assert.deepEqual(await selection(), ["path:3"], "A tap that missed cleared the locked selection");
        await tap(lock);
        await expect(lock).toHaveAttribute("aria-pressed", "false");
        await input.penStroke([at(10, 10)]);
        await expect.poll(selection, { message: "A tap that missed kept the unlocked selection" }).toEqual([]);

        // Edit Points dims the rest of the figure and locks it (FR-053).
        await input.penStroke([await strokePoint(page, curve, 0.3)]);
        await expect.poll(selection).toEqual(["path:2"]);
        await tap(menu.getByRole("button", { name: "Edit Points", exact: true }));
        await expect(menu.getByRole("button", { name: "Done", exact: true })).toBeVisible();
        // The opacity an element is painted with: the product of its own and its ancestors' opacities.
        const paintedOpacity = (element: Locator) =>
          element.evaluate((node) => {
            let opacity = 1;
            for (let at: Element | null = node; at !== null; at = at.parentElement) {
              opacity *= Number(getComputedStyle(at).opacity);
            }
            return opacity;
          });
        await expect
          .poll(() => paintedOpacity(rectangle), { message: "Edit Points did not dim the rest of the figure" })
          .toBeLessThan(0.75);
        assert.equal(await paintedOpacity(curve), 1, "Edit Points dimmed the curve it edits");
        const written = await source();
        const grip = await strokePoint(page, rectangle, 0.1);
        await input.penStroke(Array.from({ length: 8 }, (_, i) => ({ x: grip.x + i * 10, y: grip.y })));
        await canvasSettled(frame);
        assert.equal(await source(), written, "A drag in Edit Points moved the dimmed rectangle");
        await input.penStroke([grip]);
        await canvasSettled(frame);
        assert.deepEqual(await selection(), ["path:2"], "A tap in Edit Points selected the dimmed rectangle");
        assert.equal(
          await frame.locator('[data-hover-highlight="path:3"]').count(),
          0,
          "The pen over the dimmed rectangle marks it as if it could take it",
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a second tap on the active preset opens the palette, wheel, opacity, hex, and the exact xcolor field, and red!50!blue stays as authored, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const toolbar = drawingToolbar(frame);
        const options = frame.getByRole("dialog", { name: "Colour options", exact: true });
        const first = toolbar.getByRole("button", { name: /^Colour 1: / });
        await chooseShape(frame, input, "Line");
        const toggleOptions = async (open: boolean) => {
          await tap(first);
          await (open ? expect(options).toBeVisible() : expect(options).toHaveCount(0));
        };
        // Each line goes one row lower on the free canvas; the result is the \draw statement it added.
        const area = await canvasFreeArea(frame);
        let row = 0;
        const drawLine = async (): Promise<string> => {
          const draws = async () =>
            (await editorDebug(page)).source
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.startsWith("\\draw"));
          const before = (await draws()).length;
          row += 1;
          const y = area.top + ((area.bottom - area.top) * row) / 6;
          const [left, right] = [area.left + (area.right - area.left) * 0.3, area.left + (area.right - area.left) * 0.7];
          await input.penStroke(Array.from({ length: 8 }, (_, i) => ({ x: left + ((right - left) * i) / 7, y })));
          await expect.poll(async () => (await draws()).length).toBe(before + 1);
          return (await draws()).at(-1)!;
        };

        // The colour options hold the palette, the wheel, Opacity, Hex, the exact xcolor field, and Edit.
        await toggleOptions(true);
        const palette = options.getByRole("group", { name: "Palette", exact: true });
        await expect(palette).toBeVisible();
        await expect(options.getByLabel("Colour wheel", { exact: true })).toBeVisible();
        await expect(options.getByRole("slider", { name: "Opacity", exact: true })).toBeVisible();
        const hex = options.getByRole("textbox", { name: "Hex", exact: true });
        const exact = options.getByRole("textbox", { name: "Exact xcolor", exact: true });
        await expect(hex).toBeVisible();
        await expect(exact).toBeVisible();
        const edit = options.getByRole("button", { name: "Edit", exact: true });
        await expect(edit).toBeVisible();
        // Edit shows the commands that reorder and remove the toolbar's colours; until then they are hidden.
        const removeColour = options.getByRole("button", { name: "Remove colour", exact: true });
        await expect(removeColour).toHaveCount(0);
        await tap(edit);
        await expect(options.getByRole("button", { name: "Move later", exact: true })).toBeVisible();
        await expect(removeColour).toBeVisible();
        await tap(edit);
        await expect(removeColour).toHaveCount(0);

        // The palette is the active collection of Settings › Colors, laid out in rows.
        const paletteColours = async () =>
          (await ariaEntries(palette)).map((entry) => /^button "(.+)"$/.exec(entry)?.[1] ?? entry);
        const initial = await paletteColours();
        assert.ok(initial.length > 1, `The palette holds ${initial.length} colours`);
        const swatches = palette.getByRole("button");
        const [one, two] = [await layoutBox(swatches.nth(0)), await layoutBox(swatches.nth(1))];
        assert.ok(Math.abs(one.y - two.y) < 2 && two.x > one.x, "The palette's colours are stacked, not in rows");
        await toggleOptions(false);
        const settingsColours = async (change: (settings: Locator) => Promise<void>) => {
          const settings = await openSettings();
          await tap(settings.getByTestId("settings-category-colors"));
          await change(settings);
          await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
          await expect(settings).toHaveCount(0);
        };
        await settingsColours(async (settings) => {
          await tap(settings.getByRole("button", { name: "New collection" }));
          await settings.getByLabel("Collection name", { exact: true }).fill("Roots");
          await tap(settings.getByRole("button", { name: "Remove" }).first());
        });
        await toggleOptions(true);
        await expect
          .poll(paletteColours, { message: "The palette did not follow a new collection with a colour removed" })
          .toEqual(initial.slice(1));
        await toggleOptions(false);
        await settingsColours((settings) =>
          settings.getByLabel("Collection", { exact: true }).selectOption({ label: "Default" }).then(() => undefined),
        );
        await toggleOptions(true);
        await expect
          .poll(paletteColours, { message: "The palette did not follow the switch back to Default" })
          .toEqual(initial);
        const stored = JSON.parse(
          ((await (await page.request.get(`${url}api/preferences`)).json()) as Record<string, string>)[
            "tikz-editor:settings"
          ],
        ) as { settings: { colorPicker: { collections: { id: string; colors: string[] }[] } } };
        assert.deepEqual(
          stored.settings.colorPicker.collections.find((collection) => collection.id === "default")?.colors,
          initial,
          "The palette is not the Default collection of Settings",
        );

        // An xcolor expression applied in the exact field becomes the preset and is written as authored.
        await exact.fill("red!50!blue");
        await exact.press("Enter");
        await expect(toolbar.getByRole("button", { name: "Colour 1: red!50!blue", exact: true })).toBeVisible();
        if (await options.isVisible()) await toggleOptions(false);
        assert.match(await drawLine(), /^\\draw\[(draw=)?red!50!blue\] /, "The line is not drawn in red!50!blue");
        // One typed, then dismissed by Escape, is discarded.
        await toggleOptions(true);
        await exact.fill("green!20");
        await exact.press("Escape");
        await expect(options).toHaveCount(0);
        await expect(toolbar.getByRole("button", { name: "Colour 1: red!50!blue", exact: true })).toBeVisible();

        // A wheel colour at full opacity is written as an rgb triple, never as HTML hex.
        await toggleOptions(true);
        const wheel = await layoutBox(options.getByLabel("Colour wheel", { exact: true }));
        await input.touch([{ x: wheel.x + wheel.width * 0.85, y: wheel.y + wheel.height * 0.5 }]);
        await expect(first).not.toHaveAccessibleName("Colour 1: red!50!blue");
        await toggleOptions(false);
        const wheelLine = await drawLine();
        assert.match(wheelLine, /\{?rgb,255:red,\d+;green,\d+;blue,\d+\}?/, wheelLine);
        assert.doesNotMatch(wheelLine, /#[0-9a-f]{3,8}/i, `A wheel colour is written as HTML hex: ${wheelLine}`);
        assert.doesNotMatch(wheelLine, /opacity/, `Full opacity is written: ${wheelLine}`);

        // A hex code at full opacity is written as its rgb triple, with no opacity.
        await toggleOptions(true);
        // The field puts the caret after its digits when it takes focus; a user selects them and types over them.
        await tap(hex);
        await hex.press("ControlOrMeta+a");
        await hex.pressSequentially("ff0000");
        await hex.press("Enter");
        if (await options.isVisible()) await toggleOptions(false);
        const hexLine = await drawLine();
        assert.match(hexLine, /\{?rgb,255:red,255;green,0;blue,0\}?/, hexLine);
        assert.doesNotMatch(hexLine, /#|opacity/, hexLine);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `draws three strokes, erases one by a sweep, lassoes the other two, moves them, and undoes the move, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const source = async () => (await editorDebug(page)).source;
        const area = await canvasFreeArea(frame);
        const point = (fx: number, fy: number) => ({
          x: area.left + (area.right - area.left) * fx,
          y: area.top + (area.bottom - area.top) * fy,
        });
        await chooseTool(frame, input, "Pen");
        // Three upright strokes; each one's text is the drawing it added to the source. Its record lines
        // such as \begin{scope} repeat between strokes, so only the \draw lines identify it.
        const strokes: string[] = [];
        for (const fx of [0.3, 0.5, 0.7]) {
          const before = await source();
          await input.penStroke(
            Array.from({ length: 12 }, (_, i) => point(fx + Math.sin(i) * 0.004, 0.3 + (i * 0.3) / 11)),
          );
          await expect.poll(source, { message: "A pen stroke changed nothing" }).not.toBe(before);
          const kept = new Set(before.split("\n"));
          const drawn = (await source()).split("\n").filter((line) => !kept.has(line) && line.startsWith("\\draw"));
          assert.equal(drawn.length, 1, "A pen stroke did not add exactly one drawing");
          strokes.push(drawn[0]);
        }
        // A sweep across the first stroke only.
        await chooseTool(frame, input, "Eraser");
        const sweptFrom = await source();
        await input.penStroke(Array.from({ length: 10 }, (_, i) => point(0.2 + (i * 0.2) / 9, 0.45)));
        await expect.poll(source, { message: "The sweep erased nothing" }).not.toBe(sweptFrom);
        const erased = await source();
        assert.ok(!erased.includes(strokes[0]), "The sweep left the first stroke whole");
        assert.ok(
          erased.includes(strokes[1]) && erased.includes(strokes[2]),
          "The sweep changed a stroke it did not cross",
        );
        // A Freehand lasso round the other two, then a drag on one of them moves both.
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([point(0.42, 0.22), point(0.8, 0.22), point(0.8, 0.68), point(0.42, 0.68), point(0.42, 0.23)]);
        await expect
          .poll(async () => (await editorDebug(page)).selection.length, {
            message: "The lasso did not select the two strokes",
          })
          .toBe(2);
        const [first] = (await editorDebug(page)).selection;
        const grip = await strokePoint(page, frame.locator(`svg [data-source-id="${first}"]`).first(), 0.5);
        const shift = (area.right - area.left) * 0.08;
        await input.penStroke(
          Array.from({ length: 8 }, (_, i) => ({ x: grip.x + (shift * i) / 7, y: grip.y })),
        );
        await expect.poll(source, { message: "A drag on the selection did not move it" }).not.toBe(erased);
        const moved = await source();
        assert.ok(
          !moved.includes(strokes[1]) && !moved.includes(strokes[2]),
          "The drag did not move both selected strokes",
        );
        await input.touch([await stableCenter(documentHistory("Undo"))]);
        await expect
          .poll(source, { message: "One Undo did not return the strokes to where they were" })
          .toBe(erased);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `draws a dark canvas with a black stroke legible on it in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (0,0) -- (4,0);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await editorReady(page);
        await page.emulateMedia({ colorScheme: "dark" });
        const frame = editorFrame(page);
        await expect.poll(async () => {
          const backgrounds = await Promise.all([
            frame.locator('[data-canvas-viewport="true"]').evaluate((element) => getComputedStyle(element).backgroundColor),
            frame.locator('[class*="svgLayer"]').first().evaluate((element) => getComputedStyle(element).backgroundColor),
          ]);
          return backgrounds.map((background) => {
            const channels = background.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
            return channels.length === 3 && Math.max(...channels) < 90 ? "dark" : background;
          });
        }).toEqual(["dark", "dark"]);
        const drawn = await frame.locator('svg [data-source-id^="path:"]').first().evaluate((element) => getComputedStyle(element).stroke);
        const strokeChannels = drawn.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
        assert.ok(strokeChannels.length === 3 && Math.min(...strokeChannels) > 180, `A black stroke is not legible: ${drawn}, attribute ${await frame.locator('svg [data-source-id^="path:"]').first().getAttribute("stroke")}`);
        await storyScreenshot(page, `dark-canvas-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `names no key in the context menu a long press opens in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw[blue] (0,0) circle (2cm);\end{tikzpicture}`);
        const frame = editorFrame(page);
        const circle = frame.locator("circle[data-source-id]");
        await expect(circle).toBeAttached();
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Lasso");
        // The startup view depends on the canvas size at mount; the user fits the figure through the zoom popup.
        await fitDiagram(frame, input);
        await expect(circle).toBeInViewport();
        await input.longPress(
          await strokePoint(page, frame.locator("circle[data-source-id]").first(), 0.5),
        );
        const menu = frame.getByRole("menu").first();
        await expect(menu).toBeVisible();
        const items = (await menu.locator("button").allInnerTexts()).map((text) =>
          text.trim().replace(/\s+/g, " "),
        );
        assert.ok(items.includes("Delete"), items.join(" | "));
        for (const item of items) {
          assert.doesNotMatch(item, /Ctrl|Cmd|⌘|⇧|Shift|Alt|⌥|Esc\b|Escape|⌫/, item);
          assert.doesNotMatch(item, /^(.+) \1$/, `${item} repeats its key name`);
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `offers only settings that act in the embedded editor in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: ReturnType<typeof frame.getByRole>) => {
          await input.touch([await stableCenter(locator)]);
        };
        const dialog = await openSettings();
        assert.deepEqual(await dialog.locator("nav button").allInnerTexts(), [
          "Appearance",
          "Canvas",
          "Colors",
          "Keyboard shortcuts",
        ]);
        await tap(dialog.getByTestId("settings-category-canvas"));
        const labels = await dialog
          .locator('label[for^="setting-"]')
          .evaluateAll((nodes) => nodes.map((node) => node.childNodes[0].textContent!.trim()));
        assert.deepEqual(labels, [
          "Grid Size",
          "Grid Opacity",
          "Edit Handle Size",
          "Hold to move a point",
          "Smooth surviving points",
          "Zoom Speed",
          "Toolbar Position",
          "Generated Source Indent",
        ]);
        await dialog.getByLabel("Toolbar Position", { exact: true }).selectOption("right");
        await expect(frame.locator("[data-diagram-tools]")).toHaveAttribute("data-dock", "right");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows only labels, values, and button names on option surfaces in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        // The text an author reads on a surface, outside `outside`, in document order: the text
        // nodes of each element joined, since React writes one label as several nodes.
        const texts = (surface: Locator, outside = "option, nav") =>
          surface.evaluate((root, outside) => {
            const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const runs: { parent: Element; text: string }[] = [];
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const parent = node.parentElement!;
              if (parent.closest(outside)) continue;
              const last = runs.at(-1);
              if (last?.parent === parent) last.text += node.textContent;
              else runs.push({ parent, text: node.textContent! });
            }
            return runs.map((run) => run.text.trim()).filter(Boolean);
          }, outside);
        // Inkscape's snapping popover lists the rules by name only (docs/prior-art/instructional-text.md, item 1).
        const snap = frame.getByRole("button", { name: "Snapping rules", exact: true });
        const snapping = frame.getByRole("dialog", { name: "Tool options" });
        await tap(snap);
        await expect(snapping).toBeVisible();
        assert.deepEqual(await texts(snapping), ["Snapping", "Lattice", "Objects", "Alignment", "Angle"]);
        await expect(snapping.locator("[aria-description]")).toHaveCount(0);
        await tap(snap);
        await expect(snapping).toHaveCount(0);
        // The Shapes menu's circle numbers with lattice lock on: field labels and the insert button,
        // beside the construction families (data-model Tool).
        await setSnapRule(frame, input, "Lattice", true);
        await chooseShape(frame, input, "Circle");
        const shapesMenu = activeToolMenu(frame);
        await tap(toolbarItem(frame, "Shapes"));
        await expect(shapesMenu).toBeVisible();
        assert.deepEqual(await texts(shapesMenu, "option, nav, [role=group]"), [
          "Centre X",
          "Centre Y",
          "Radius",
          "Insert circle",
        ]);
        await tap(toolbarItem(frame, "Shapes"));
        await expect(shapesMenu).toHaveCount(0);
        // Settings rows carry a label and, for a slider, its value in a user unit (item 5).
        const settings = settingsDialog();
        await openSettings();
        await tap(settings.getByTestId("settings-category-canvas"));
        assert.deepEqual(await texts(settings), [
          "Settings",
          "Canvas",
          "Grid Size",
          "Grid Opacity",
          "70%",
          "Edit Handle Size",
          "Hold to move a point",
          "450 ms",
          "Smooth surviving points",
          "Zoom Speed",
          "Toolbar Position",
          "Generated Source Indent",
        ]);
        // VS Code prompts for the keys only once recording starts (item 6).
        await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
        await settings.getByRole("searchbox", { name: "Find command", exact: true }).fill("Insert: Line");
        const row = settings.getByRole("list", { name: "Commands", exact: true }).getByRole("listitem");
        assert.deepEqual(await texts(settings, "option, nav, li"), [
          "Settings",
          "Keyboard shortcuts",
          "Find command",
          "Record keys",
          "Reset all shortcuts",
        ]);
        assert.deepEqual(await texts(row), ["Insert: Line", "L"]);
        await tap(row.getByRole("button"));
        assert.deepEqual(await texts(row), ["Insert: Line", "Press the new shortcut"]);
        await page.keyboard.press("Escape");
        assert.deepEqual(await texts(row), ["Insert: Line", "L"]);
        await expect(settings).toBeVisible();
        await tap(row.getByRole("button"));
        await page.keyboard.press("Control+Alt+l");
        assert.deepEqual(await texts(row), ["Insert: Line", "Ctrl+Alt+L"]);
        await storyScreenshot(page, `option-surface-text-${tablet.name}`);
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        // The curve refinement names its sliders and its buttons (item 8); its values are figure coordinates, with no unit word.
        await chooseTool(frame, input, "Pen");
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.penStroke(waveAcross(viewport, 0.45, 0.4, 160));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        await openSimplify(frame, input, lastPath(frame));
        assert.deepEqual(await texts(curveRefinement(frame)), [
          "Curve refinement",
          "Smoothing",
          "Simplification",
          "Simplify again",
          "Accept",
          "Cancel",
          "Restore original",
        ]);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `selects every element from the empty-canvas long press in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (0,0) circle (1cm);\draw (3,0) -- (5,1);\end{tikzpicture}`);
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(2);
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Lasso");
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.longPress({
          x: viewport.x + viewport.width * 0.85,
          y: viewport.y + viewport.height * 0.2,
        });
        const menu = frame.getByRole("menu").first();
        await expect(menu.getByRole("menuitem", { name: "Paste", exact: true })).toBeVisible();
        await input.touch([
          await stableCenter(menu.getByRole("menuitem", { name: "Select All", exact: true })),
        ]);
        const debug = await editorDebug(page);
        assert.deepEqual(
          [...debug.selection].sort(),
          [...new Set(debug.scene!.elements.map((element) => element.sourceRef.sourceId))].sort(),
        );
        assert.equal(debug.selection.length, 2);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `sets, persists, removes and resets command shortcuts in Settings in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const settings = settingsDialog();
        const openShortcuts = async () => {
          await openSettings();
          await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
          await settings.getByRole("searchbox", { name: "Find command", exact: true }).fill("Insert: Line");
        };
        // The shipped default acts before we replace it.
        await chooseTool(frame, input, "Lasso");
        await page.keyboard.press("l");
        await expect.poll(async () => (await editorDebug(page)).tool).toBe("addLine");
        await openShortcuts();
        const row = settings.getByRole("list", { name: "Commands", exact: true }).getByRole("listitem");
        const rowMenu = async (item: string) => {
          await input.longPress(await stableCenter(row.getByRole("button")));
          await tap(settings.getByRole("menu").getByRole("menuitem", { name: item, exact: true }));
        };
        await tap(row.getByRole("button"));
        await page.keyboard.press("Control+Alt+l");
        await expect(row).toContainText("Ctrl+Alt+L");
        await storyScreenshot(page, `keyboard-shortcuts-${tablet.name}`);
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await chooseTool(frame, input, "Lasso");
        await page.keyboard.press("l");
        assert.equal((await editorDebug(page)).tool, "select", "The replaced shortcut still ran");
        await page.keyboard.press("Control+Alt+l");
        await expect.poll(async () => (await editorDebug(page)).tool).toBe("addLine");
        await page.reload();
        await editorReady(page);
        await chooseTool(frame, input, "Lasso");
        await page.keyboard.press("Control+Alt+l");
        await expect.poll(async () => (await editorDebug(page)).tool).toBe("addLine");
        await openShortcuts();
        await tap(row.getByRole("button"));
        await page.keyboard.press("Control+z");
        await expect(settings.getByRole("alert")).toContainText("Edit: Undo");
        await page.keyboard.press("Escape");
        await expect(row).toContainText("Ctrl+Alt+L");
        await rowMenu("Remove Shortcut");
        await expect(row.locator("kbd")).toHaveCount(0);
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await chooseTool(frame, input, "Lasso");
        await page.keyboard.press("Control+Alt+l");
        await page.keyboard.press("l");
        assert.equal((await editorDebug(page)).tool, "select", "A removed shortcut still ran");
        await openShortcuts();
        await rowMenu("Reset Shortcut");
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await chooseTool(frame, input, "Lasso");
        await page.keyboard.press("l");
        await expect.poll(async () => (await editorDebug(page)).tool).toBe("addLine");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `lists each command under its menu and moves a shortcut to another command with a warning in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\node at (2,1) {$x^2$};\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const settings = settingsDialog();
        const search = settings.getByRole("searchbox", { name: "Find command", exact: true });
        const rows = settings.getByRole("list", { name: "Commands", exact: true }).getByRole("listitem");
        // Each row reads its command name, then its keys.
        const rowTexts = () =>
          rows.evaluateAll((items) =>
            items.map((item) =>
              [...item.querySelectorAll("button *")]
                .filter((node) => node.children.length === 0)
                .map((node) => node.textContent!.trim())
                .filter(Boolean),
            ),
          );
        const row = (name: string) =>
          rows.filter({ has: settingsFrame().getByText(name, { exact: true }) }).getByRole("button");
        const keysOf = async (name: string) => {
          await search.fill(name);
          const entry = (await rowTexts()).find((texts) => texts[0] === name);
          assert.ok(entry, `No row is named ${name}`);
          return entry.slice(1);
        };
        await openSettings();
        await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
        // VS Code prefixes each command with its category; the category here is the command's menu.
        const all = await rowTexts();
        const names = all.map((texts) => texts[0]);
        for (const name of ["Align: Left", "Insert: Grid", "View: Grid", "Insert: Equation"]) {
          assert.ok(names.includes(name), `${name} is missing: ${names.join(", ")}`);
        }
        for (const name of names) assert.match(name, /^[A-Z][^:]*: \S/, `${name} has no menu`);
        assert.equal(new Set(names).size, names.length, "Two rows share a name");
        const defaults = all.flatMap((texts) => texts.slice(1));
        assert.deepEqual(
          defaults.filter((keys, index) => defaults.indexOf(keys) !== index),
          [],
          "Two commands share a default shortcut",
        );
        assert.deepEqual(await keysOf("Node: Edit Equation"), [], "Edit Equation has a default shortcut");
        await expect(settings.getByRole("button", { name: /^(Set|Clear|Reset) shortcut for / })).toHaveCount(0);
        // The search field finds a command by name.
        await search.fill("left");
        assert.ok((await rowTexts()).some((texts) => texts[0] === "Align: Left"), "Typing left did not find Align: Left");
        // A press on the row records; keys that another command has move with a warning, as GNOME moves them.
        await tap(row("Align: Left"));
        assert.deepEqual((await rowTexts()).find((texts) => texts[0] === "Align: Left"), ["Align: Left", "Press the new shortcut"]);
        await page.keyboard.press("Control+Shift+E");
        await expect(settings.getByRole("alert")).toHaveText(
          "Ctrl+Shift+E is used by Insert: Equation. It will be removed from there.",
        );
        await page.keyboard.press("Enter");
        await expect(settings.getByRole("alert")).toHaveCount(0);
        assert.deepEqual(await keysOf("Align: Left"), ["Ctrl+Shift+E"]);
        assert.deepEqual(await keysOf("Insert: Equation"), []);
        // The search field finds a command by the keys pressed while it records keys.
        await search.fill("");
        await tap(settings.getByRole("button", { name: "Record keys", exact: true }));
        await search.press("Control+Shift+E");
        await expect(search).toHaveValue("Ctrl+Shift+E");
        assert.deepEqual(await rowTexts(), [["Align: Left", "Ctrl+Shift+E"]]);
        await tap(settings.getByRole("button", { name: "Record keys", exact: true }));
        // Moving one of two keys leaves the other with its command.
        assert.deepEqual(await keysOf("View: Zoom In"), ["Ctrl+=", "Ctrl+Shift+="]);
        await search.fill("Align: Left");
        await tap(row("Align: Left"));
        await page.keyboard.press("Control+Shift+=");
        await expect(settings.getByRole("alert")).toHaveText(
          "Ctrl+Shift+= is used by View: Zoom In. It will be removed from there.",
        );
        await page.keyboard.press("Enter");
        assert.deepEqual(await keysOf("Align: Left"), ["Ctrl+Shift+="]);
        assert.deepEqual(await keysOf("View: Zoom In"), ["Ctrl+="]);
        // Escape cancels a pending move.
        await search.fill("Insert: Grid");
        await tap(row("Insert: Grid"));
        await page.keyboard.press("Control+z");
        await expect(settings.getByRole("alert")).toHaveText(
          "Ctrl+Z is used by Edit: Undo. It will be removed from there.",
        );
        await page.keyboard.press("Escape");
        await expect(settings.getByRole("alert")).toHaveCount(0);
        assert.deepEqual(await keysOf("Insert: Grid"), []);
        assert.deepEqual(await keysOf("Edit: Undo"), ["Ctrl+Z"]);
        // The row menu, by long press or right-click, removes or resets the row's keys.
        const menu = settings.getByRole("menu");
        const menuItems = () => menu.getByRole("menuitem").allInnerTexts();
        await search.fill("Align: Left");
        await input.longPress(await stableCenter(row("Align: Left")));
        assert.deepEqual(await menuItems(), ["Remove Shortcut", "Reset Shortcut"]);
        await tap(menu.getByRole("menuitem", { name: "Remove Shortcut", exact: true }));
        await expect(menu).toHaveCount(0);
        assert.deepEqual(await keysOf("Align: Left"), []);
        await search.fill("Insert: Equation");
        await row("Insert: Equation").click({ button: "right" });
        assert.deepEqual(await menuItems(), ["Remove Shortcut", "Reset Shortcut"]);
        await expect(menu.getByRole("menuitem", { name: "Remove Shortcut", exact: true })).toBeDisabled();
        await tap(menu.getByRole("menuitem", { name: "Reset Shortcut", exact: true }));
        assert.deepEqual(await keysOf("Insert: Equation"), ["Ctrl+Shift+E"]);
        await row("Insert: Equation").click({ button: "right" });
        assert.deepEqual(await menuItems(), ["Remove Shortcut"]);
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(settings).toBeVisible();
        // A double tap on an equation opens its editor, as a double-click opens an equation in Word.
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.doubleTap(await stableCenter(frame.locator('svg [data-source-id="path:0"]').first()));
        await expect(frame.getByRole("button", { name: "Close equation editor", exact: true })).toBeVisible();
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `persists canvas aids and grid controls after reload in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await tap(zoomControl(frame));
        const popup = frame.getByRole("dialog", { name: "Tool options" });
        for (const aid of ["Grid", "Rulers", "Ruler guides"]) {
          const control = popup.getByRole("button", { name: aid, exact: true });
          await tap(control);
          await expect(control).toHaveAttribute("aria-pressed", "false");
        }
        await tap(zoomControl(frame));
        const settings = await openSettings();
        await tap(settings.getByRole("button", { name: "Canvas", exact: true }));
        await settings.getByLabel("Grid Size", { exact: true }).selectOption("coarse");
        await settings.getByLabel("Grid Opacity", { exact: true }).fill("42");
        await settings.getByLabel("Edit Handle Size", { exact: true }).selectOption("11");
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await setSnapRule(frame, input, "Lattice", false);
        await setSnapRule(frame, input, "Objects", false);
        await setSnapRule(frame, input, "Alignment", false);
        await setSnapRule(frame, input, "Angle", true);
        await page.reload();
        await editorReady(page);
        const reopened = editorFrame(page);
        const reopenedRules = reopened.getByRole("button", { name: "Snapping rules", exact: true });
        await tap(reopenedRules);
        const snapPopup = reopened.getByRole("dialog", { name: "Tool options" });
        for (const rule of ["Lattice", "Objects", "Alignment"]) {
          await expect(snapPopup.getByRole("button", { name: rule, exact: true })).toHaveAttribute("aria-pressed", "false");
        }
        await expect(snapPopup.getByRole("button", { name: "Angle", exact: true })).toHaveAttribute("aria-pressed", "true");
        await tap(reopenedRules);
        await tap(zoomControl(reopened));
        const reopenedPopup = reopened.getByRole("dialog", { name: "Tool options" });
        for (const aid of ["Grid", "Rulers", "Ruler guides"]) {
          await expect(reopenedPopup.getByRole("button", { name: aid, exact: true })).toHaveAttribute("aria-pressed", "false");
        }
        await tap(zoomControl(reopened));
        const reopenedSettings = await openSettings();
        await tap(reopenedSettings.getByRole("button", { name: "Canvas", exact: true }));
        await expect(reopenedSettings.getByLabel("Grid Size", { exact: true })).toHaveValue("coarse");
        await expect(reopenedSettings.getByLabel("Grid Opacity", { exact: true })).toHaveValue("42");
        await expect(reopenedSettings.getByLabel("Edit Handle Size", { exact: true })).toHaveValue("11");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps typing native when Settings has a single-letter shortcut in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const settings = settingsDialog();
        await openSettings();
        await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
        const search = settings.getByRole("searchbox", { name: "Find command", exact: true });
        await search.fill("File: Settings");
        await tap(settings.getByRole("list", { name: "Commands", exact: true }).getByRole("button"));
        await page.keyboard.press("q");
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await expect(settings).toHaveCount(0);
        await page.keyboard.press("q");
        await expect(settings).toBeVisible({ timeout: 30_000 });
        await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
        await search.fill("");
        await search.press("q");
        await expect(search).toHaveValue("q");
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await chooseTool(frame, input, "Lasso");
        await tap(documentPanelButton("Properties"));
        const mode = frame
          .getByRole("complementary", { name: "Properties", exact: true })
          .locator("select")
          .first();
        await expect(mode).toBeVisible();
        await mode.press("q");
        await expect(settings).toHaveCount(0);
        await mode.press("ArrowDown");
        await expect(mode).toHaveValue("fixed");
        assert.equal(
          (await editorDebug(page)).tool,
          "select",
          "Native select typing switched drawing tools",
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `runs a configured canvas-owned simplification command in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const settings = await openSettings();
        await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
        await settings
          .getByRole("searchbox", { name: "Find command", exact: true })
          .fill("Path: Simplify Path");
        await tap(settings.getByRole("list", { name: "Commands", exact: true }).getByRole("button"));
        await page.keyboard.press("Control+Alt+p");
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await chooseTool(frame, input, "Pen");
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.penStroke(
          Array.from({ length: 60 }, (_, i) => ({
            x: viewport.x + viewport.width * 0.35 + i * 6,
            y: viewport.y + viewport.height * 0.45 + Math.sin(i / 4) * 30,
          })),
        );
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        await chooseTool(frame, input, "Lasso");
        const ids = await frame
          .locator('svg [data-source-id^="path:"]')
          .evaluateAll((nodes) => [
            ...new Set(nodes.map((node) => node.getAttribute("data-source-id")!)),
          ]);
        const curve = frame.locator(`svg [data-source-id="${ids[ids.length - 1]}"]`).first();
        const selectCurve = async () => {
          await fitDiagram(frame, input);
          await input.touch([await strokePoint(page, curve, 0.3)]);
          const whole = frame.getByRole("button", { name: "Done", exact: true });
          if (await whole.isVisible()) {
            await tap(whole);
          }
        };
        await selectCurve();
        const before = (await editorDebug(page)).source;
        // A drawn stroke is a polyline and a simplified one a Bézier curve.
        const anchors = async () =>
          ((await editorDebug(page)).source.match(/\.\.\s+controls\b|--/g) ?? []).length;
        const count = await anchors();
        await tap(frame.getByRole("button", { name: "Simplify", exact: true }));
        await expect.poll(anchors, { timeout: 30_000 }).toBeLessThan(count);
        const refinement = frame.getByRole("dialog", { name: "Curve refinement" });
        await tap(refinement.getByRole("button", { name: "Cancel", exact: true }));
        await expect.poll(async () => (await editorDebug(page)).source).toBe(before);
        await expect
          .poll(async () => (await editorDebug(page)).selection)
          .toEqual([ids[ids.length - 1]]);
        await expect(frame.getByRole("button", { name: "Simplify", exact: true })).toBeVisible();
        assert.equal(await anchors(), count, "Reaching the keyboard baseline changed the curve");
        await page.keyboard.press("Control+Alt+p");
        await expect(
          refinement,
          "The configured command did not open the curve refinement",
        ).toBeVisible();
        await expect
          .poll(anchors, {
            timeout: 30_000,
            message: "The configured command did not reach the canvas simplifier",
          })
          .toBeLessThan(count);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `uses configured Undo, Delete and previously unassigned Layers shortcuts in ${tablet.name}`,
      async function () {
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const source = String.raw`\begin{tikzpicture}\draw (-4,-2) -- (4,2);\end{tikzpicture}`;
        await pasteCode(page, source);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.touch([
          await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.5),
        ]);
        await page.keyboard.press("Delete");
        await expect.poll(async () => (await editorDebug(page)).source).not.toContain("\\draw");
        await page.keyboard.press("Control+z");
        await expect.poll(async () => (await editorDebug(page)).source).toBe(source);
        const settings = await openSettings();
        await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
        const commandRow = settings.getByRole("list", { name: "Commands", exact: true }).getByRole("button");
        for (const [name, shortcut] of [
          ["Edit: Delete", "Control+Alt+d"],
          ["Edit: Undo", "Control+Alt+u"],
          ["View: Layers Panel", "Control+Alt+j"],
        ]) {
          await settings.getByRole("searchbox", { name: "Find command", exact: true }).fill(name);
          await tap(commandRow);
          await page.keyboard.press(shortcut);
        }
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await fitDiagram(frame, input);
        await input.touch([
          await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.5),
        ]);
        await page.keyboard.press("Delete");
        assert.equal(
          (await editorDebug(page)).source,
          source,
          "The old canvas Delete binding remained active",
        );
        await page.keyboard.press("Control+Alt+d");
        await expect.poll(async () => (await editorDebug(page)).source).not.toContain("\\draw");
        await page.keyboard.press("Control+z");
        assert.doesNotMatch(
          (await editorDebug(page)).source,
          /\\draw/,
          "The old canvas Undo binding remained active",
        );
        await page.keyboard.press("Control+Alt+u");
        await expect.poll(async () => (await editorDebug(page)).source).toBe(source);
        await page.keyboard.press("Control+Alt+j");
        await expect(sidePanel(frame, "Layers")).toBeVisible();
        await tap(frame.getByRole("button", { name: "Close layers", exact: true }));
        await openSettings();
        await tap(settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }));
        await settings.getByRole("searchbox", { name: "Find command", exact: true }).fill("View: Layers Panel");
        await tap(commandRow);
        await page.keyboard.press("ArrowLeft");
        await tap(settings.getByRole("button", { name: "Close settings", exact: true }));
        await fitDiagram(frame, input);
        await input.touch([
          await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.5),
        ]);
        await page.keyboard.press("Control+Alt+j");
        await expect(sidePanel(frame, "Layers")).toHaveCount(0);
        await page.keyboard.press("ArrowLeft");
        await expect(sidePanel(frame, "Layers")).toBeVisible();
        assert.equal(
          (await editorDebug(page)).source,
          source,
          "The assigned arrow key still nudged the selected line",
        );
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `constrains pen drawing and moving through a touch toggle in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await setSnapRule(frame, input, "Lattice", false);
        await chooseShape(frame, input, "Line");
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const from = {
          x: viewport.x + viewport.width * 0.55,
          y: viewport.y + viewport.height * 0.4,
        };
        const draw = () =>
          input.penStroke([
            from,
            { x: from.x + 60, y: from.y + 17.5 },
            { x: from.x + 120, y: from.y + 35 },
          ]);
        const points = async () => {
          const path = (await editorDebug(page)).scene?.elements.find(
            (element) => element.kind === "Path",
          );
          const points = path?.commands?.flatMap((command) => (command.to ? [command.to] : []));
          assert.ok(points && points.length >= 2, "The drawn path has no editable geometry");
          return points;
        };
        const angle = async () => {
          const p = await points();
          return Math.abs(
            (Math.atan2(p[p.length - 1].y - p[0].y, p[p.length - 1].x - p[0].x) * 180) / Math.PI,
          );
        };
        await draw();
        assert.ok(
          Math.abs((await angle()) - 15) > 0.5,
          "The free baseline was already angle constrained",
        );
        await tap(documentHistory("Undo"));
        await expect(frame.locator('svg [data-source-id^="path:"]')).toHaveCount(0);
        await setSnapRule(frame, input, "Angle", true);
        await draw();
        assert.ok(
          Math.abs((await angle()) - 15) < 0.1,
          `The constrained line was at ${await angle()} degrees`,
        );
        await tap(documentHistory("Undo"));
        await chooseShape(frame, input, "Rectangle");
        await input.penStroke([
          from,
          { x: from.x + 55, y: from.y + 22.5 },
          { x: from.x + 110, y: from.y + 45 },
        ]);
        const square = await points();
        const width = Math.max(...square.map((p) => p.x)) - Math.min(...square.map((p) => p.x));
        const height = Math.max(...square.map((p) => p.y)) - Math.min(...square.map((p) => p.y));
        assert.ok(
          width > 10 && Math.abs(width - height) < 0.4,
          `The constrained rectangle was ${width} by ${height}`,
        );
        await chooseTool(frame, input, "Lasso");
        await fitDiagram(frame, input);
        const shape = frame.locator('svg [data-source-id="path:0"]').first();
        const drag = async () => {
          const start = await strokePoint(page, shape, 0.18);
          await input.penStroke([
            start,
            { x: start.x + 40, y: start.y + 11 },
            { x: start.x + 80, y: start.y + 22 },
          ]);
        };
        const before = (await points())[0];
        await drag();
        const constrained = (await points())[0];
        assert.ok(constrained.x > before.x + 1, "The constrained move did not move the shape");
        assert.ok(
          Math.abs(constrained.y - before.y) < 0.1,
          `The constrained move changed its other axis: ${JSON.stringify({ before, constrained, source: (await editorDebug(page)).source })}`,
        );
        await setSnapRule(frame, input, "Angle", false);
        await fitDiagram(frame, input);
        await drag();
        const free = (await points())[0];
        assert.ok(
          free.x > constrained.x + 1 && Math.abs(free.y - constrained.y) > 1,
          "The free baseline could not move diagonally",
        );
      },
    );

    story(
      { viewport: tablet },
      `edits figure bounds in scaled lattice units in ${tablet.name}`,
      async function () {
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}[x=2cm,y=0.5cm]
        \draw (0,0) rectangle (4,6);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await expect(frame.locator('svg [data-source-id="path:0"]').first()).toBeAttached();
        await tap(documentPanelButton("Properties"));
        const panel = sidePanel(frame, "Properties");
        await expect(panel.getByText("Figure Bounds", { exact: true })).toBeVisible();
        await panel.locator("select").selectOption("fixed");
        const field = (name: string) =>
          panel.locator('[class*="compactNumberField"]', { hasText: name }).locator("input");
        assert.ok(
          Math.abs(Number(await field("Width").inputValue()) - 4) < 0.05,
          "Automatic width was converted to centimetres instead of lattice units",
        );
        assert.ok(
          Math.abs(Number(await field("Height").inputValue()) - 6) < 0.05,
          "Automatic height was converted to centimetres instead of lattice units",
        );
        const figureBounds = panel
          .locator("section")
          .filter({ has: frame.getByText("Figure Bounds", { exact: true }) });
        assert.doesNotMatch(await figureBounds.innerText(), /\bcm\b|\bpx\b/);
        await field("Width").fill("6");
        await field("Width").press("Enter");
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toMatch(/\\useasboundingbox/);
        const bounds =
          /\\useasboundingbox \(([-\d.]+),([-\d.]+)\) rectangle \(([-\d.]+),([-\d.]+)\)/.exec(
            (await editorDebug(page)).source,
          );
        assert.ok(bounds, "Fixed bounds were not written into TikZ");
        assert.ok(
          Math.abs(Number(bounds[3]) - Number(bounds[1]) - 6) < 0.02,
          "The width was not written as six lattice steps",
        );
        await storyScreenshot(page, `figure-bounds-units-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows the physical size of one lattice step from the figure's own options in Properties in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const panel = sidePanel(frame, "Properties");
        // The lattice step Properties shows, with nothing selected, after the figure's options are set to `options`.
        const latticeStep = async (options: string) => {
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await pasteCode(page, String.raw`\begin{tikzpicture}${options}
          \draw (0,0) -- (3,2);
          \end{tikzpicture}`);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await expect(frame.locator('svg [data-source-id="path:0"]').first()).toBeAttached();
          await tap(documentPanelButton("Properties"));
          await expect(panel).toBeVisible();
          const step = {
            x: await panel.getByRole("group", { name: "Lattice step X", exact: true }).innerText(),
            y: await panel.getByRole("group", { name: "Lattice step Y", exact: true }).innerText(),
          };
          await tap(panel.getByRole("button", { name: "Close properties", exact: true }));
          await expect(panel).toHaveCount(0);
          return { x: step.x.replace(/\s+/g, " "), y: step.y.replace(/\s+/g, " ") };
        };
        assert.deepEqual(
          await latticeStep(""),
          { x: "X 1 cm", y: "Y 1 cm" },
          "The default lattice step is not one centimetre",
        );
        assert.deepEqual(
          await latticeStep("[x=2cm,y=2cm]"),
          { x: "X 2 cm", y: "Y 2 cm" },
          "The step size does not follow the figure's x and y options",
        );
        assert.deepEqual(
          await latticeStep("[scale=0.5]"),
          { x: "X 0.5 cm", y: "Y 0.5 cm" },
          "The step size does not follow the figure's scale option",
        );
        assert.deepEqual(
          await latticeStep("[x=2cm,y=0.5cm]"),
          { x: "X 2 cm", y: "Y 0.5 cm" },
          "Unequal x and y units are not shown per axis",
        );
        await tap(documentPanelButton("Properties"));
        await expect(panel).toBeVisible();
        await storyScreenshot(page, `lattice-step-size-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `lands a placed line's ends and a dragged Bézier control point on whole lattice points in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (0,0) -- (10,0);
        \draw (0,0) -- (0,10);
        \draw (2,4) .. controls (4,7) and (6,7) .. (8,4);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:2"]').first();
        await expect(curve).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const ends = async (id: string) =>
          frame
            .locator(`svg [data-source-id="${id}"]`)
            .first()
            .evaluate((path: SVGGeometryElement) => {
              const m = path.getScreenCTM()!;
              return [0, path.getTotalLength()].map((length) => {
                const p = path.getPointAtLength(length);
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              });
            });
        const [[origin, xTen], [, yTen]] = [await ends("path:0"), await ends("path:1")];
        const at = (x: number, y: number) => ({
          x:
            frameBox.x + origin.x + ((xTen.x - origin.x) * x) / 10 + ((yTen.x - origin.x) * y) / 10,
          y:
            frameBox.y + origin.y + ((xTen.y - origin.y) * x) / 10 + ((yTen.y - origin.y) * y) / 10,
        });
        await expect(snapToggle(frame)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        const numbers = (line: string) =>
          [...line.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        const sourceLines = async () =>
          (await editorDebug(page)).source.split("\n").map((line) => line.trim());
        // A line placed between two off-lattice pen positions, away from every object point and
        // alignment guide, is written on whole lattice points.
        await chooseShape(frame, input, "Line");
        await input.penStroke([at(1.3, 1.6), at(2.4, 2.1), at(3.6, 2.4)]);
        await expect.poll(async () => (await sourceLines()).filter((line) => line.startsWith("\\draw")).length).toBe(4);
        const placed = (await sourceLines()).filter((line) => line.startsWith("\\draw")).at(-1)!;
        assert.deepEqual(
          numbers(placed),
          [1, 2, 4, 2],
          `The placed line's ends are not the nearest whole lattice points: ${placed}`,
        );
        // A Bézier control point dragged to an off-lattice pen position lands on a whole lattice point.
        await chooseTool(frame, input, "Lasso");
        // The placed line stays selected, with its controls near the curve; clear it on empty canvas first.
        // The lattice point (9,9) is clear of every object, of the object menu, and of the canvas corners.
        await input.touch([at(9, 9)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        await input.penStroke([await strokePoint(page, curve, 0.5)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:2"]);
        // Control handles show next to a point chosen in Edit Points: choose the start (2,4) to reach (4,7).
        await input.touch([await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Edit Points", exact: true }))]);
        const anchors = frame.locator('rect[data-handle-kind="move-handle"][data-source-id="path:2"]');
        await expect(anchors).toHaveCount(2);
        const start = (await Promise.all((await anchors.all()).map((anchor) => stableCenter(anchor)))).sort(
          (a, b) => a.x - b.x,
        )[0];
        await input.penStroke([start]);
        await expect(selectedPoints(frame)).toHaveCount(1);
        const controls = frame.locator('circle[data-handle-kind="move-handle"][data-source-id="path:2"]');
        await expect(controls).toHaveCount(1);
        const firstControl = await stableCenter(controls.first());
        const to = at(3.4, 8.6);
        await input.penDown(firstControl);
        for (let i = 1; i <= 8; i++) {
          await input.penMove({
            x: firstControl.x + ((to.x - firstControl.x) * i) / 8,
            y: firstControl.y + ((to.y - firstControl.y) * i) / 8,
          });
        }
        await input.penUp(to);
        await expect
          .poll(async () => (await sourceLines()).find((line) => line.includes(".. controls")))
          .not.toMatch(/controls \(4,7\)/);
        const dragged = (await sourceLines()).find((line) => line.includes(".. controls"))!;
        assert.deepEqual(
          numbers(dragged),
          [2, 4, 3, 9, 6, 7, 8, 4],
          `The dragged control point is not on the nearest whole lattice point: ${dragged}`,
        );
        await storyScreenshot(page, `lattice-whole-points-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `Layers then Properties: one panel at a time; a second tap closes each, in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const layers = frame.getByRole("complementary", { name: "Layers", exact: true });
        const properties = frame.getByRole("complementary", { name: "Properties", exact: true });
        const code = page.locator(".cm-content");
        // Each panel is its own: its title and its close button, with no tab to the other panel.
        const ownPanel = async (panel: Locator, title: "Layers" | "Properties") => {
          await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
          await expect(panel.getByRole("button", { name: `Close ${title.toLowerCase()}`, exact: true })).toBeVisible();
          await expect(panel.getByRole("tab")).toHaveCount(0);
        };
        const pressed = async (open: "Layers" | "Properties" | null) => {
          for (const name of ["Layers", "Properties"] as const) {
            await expect(documentPanelButton(name)).toHaveAttribute("aria-pressed", String(name === open));
          }
        };

        await tap(documentPanelButton("Layers"));
        await expect(layers).toBeVisible();
        await ownPanel(layers, "Layers");
        await pressed("Layers");
        await storyScreenshot(page, `layers-panel-${tablet.name}`);

        // Scenario 1: Properties replaces Layers.
        await tap(documentPanelButton("Properties"));
        await expect(properties).toBeVisible();
        await expect(layers).toHaveCount(0);
        await ownPanel(properties, "Properties");
        await pressed("Properties");

        // The panel's own close button closes it, and the bar follows.
        await tap(properties.getByRole("button", { name: "Close properties", exact: true }));
        await expect(properties).toHaveCount(0);
        await pressed(null);

        // Scenario 2: a second tap on the bar button closes its panel.
        for (const [name, panel] of [["Layers", layers], ["Properties", properties]] as const) {
          await tap(documentPanelButton(name));
          await expect(panel).toBeVisible();
          await tap(documentPanelButton(name));
          await expect(panel).toHaveCount(0);
          await pressed(null);
        }

        // Code is in the same one-panel state (data-model Panel `open`).
        await tap(documentPanelButton("Layers"));
        await expect(layers).toBeVisible();
        await tap(page.getByRole("button", { name: "Code: left sidebar", exact: true }));
        await expect(code).toBeVisible();
        await expect(layers).toHaveCount(0);
        await pressed(null);
        await tap(documentPanelButton("Properties"));
        await expect(properties).toBeVisible();
        await expect(code).toBeHidden();
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `Properties shows the figure with nothing selected and the object after a selection, in ${tablet.name}`,
      async function () {
        await author(String.raw`\begin{tikzpicture}
\draw (0,0) -- (4,2);
\path[use as bounding box] (-2,-2) rectangle (8,6);
\end{tikzpicture}`);
        const frame = editorFrame(page);
        const line = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(line).toBeAttached();
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await fitDiagram(frame, input);
        const properties = frame.getByRole("complementary", { name: "Properties", exact: true });
        const selection = async () => [...(await editorDebug(page)).selection];
        // The figure's attributes: its scale, lattice step, and bounds (FR-060a).
        const showsFigure = async () => {
          await expect(properties.getByLabel("X scale", { exact: true })).toBeVisible();
          await expect(properties.getByText("Figure Bounds", { exact: true })).toBeVisible();
          await expect(properties.getByText("New strokes", { exact: true })).toHaveCount(0);
        };

        await tap(documentPanelButton("Properties"));
        await expect(properties).toBeVisible();
        await showsFigure();

        // With a drawing tool chosen and nothing selected, Properties still shows the figure;
        // the tool's options live in its Active Tool Menu.
        await chooseTool(frame, input, "Pen");
        await showsFigure();

        // A selection replaces the figure with the object.
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, line, 0.5)]);
        await expect.poll(selection, { message: "A tap did not select the line" }).toEqual(["path:0"]);
        await expect(properties.getByText(/^Selected /u)).toBeVisible();
        await expect(properties.getByText("Figure Bounds", { exact: true })).toHaveCount(0);
        await storyScreenshot(page, `properties-object-${tablet.name}`);

        // A tap on empty canvas, above and left of the line and clear of the panel, clears the selection; the figure returns.
        const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
        await input.penStroke([{ x: canvas.x + canvas.width * 0.15, y: canvas.y + canvas.height * 0.15 }]);
        await expect.poll(selection, { message: "A tap on empty canvas kept the selection" }).toEqual([]);
        await showsFigure();

        // No other surface holds the figure's attributes.
        await barMenu("title").button.click();
        await expect(page.getByRole("button", { name: "Document Properties…", exact: true })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.keyboard.press("Control+Shift+D");
        await expect(frame.getByTestId("document-properties")).toHaveCount(0);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `closes each popover on a second press of its button, and keeps one popover open, in ${tablet.name}`,
      async function () {
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        const options = frame.getByRole("dialog", {
          name: /^(Tool options|Active Tool Menu|Colour options)$/,
        });
        const snap = frame.getByRole("button", { name: "Snapping rules", exact: true });
        const color = drawingToolbar(frame).getByRole("button", { name: /^Colour 1: / });
        for (const trigger of [
          snap,
          zoomControl(frame),
          toolbarItem(frame, "Shapes"),
          toolbarItem(frame, "Text"),
          color,
        ]) {
          // A tool's first tap activates it and a preset's first tap chooses it; the next tap opens its popover.
          if ((await trigger.getAttribute("aria-pressed")) === "false") {
            await tap(trigger);
            await expect(trigger).toHaveAttribute("aria-pressed", "true");
          }
          await tap(trigger);
          await expect(trigger).toHaveAttribute("aria-expanded", "true");
          await expect(options).toHaveCount(1);
          await tap(trigger);
          await expect(trigger).toHaveAttribute("aria-expanded", "false");
          await expect(options).toHaveCount(0);
        }
        await tap(snap);
        await tap(color);
        await expect(snap).toHaveAttribute("aria-expanded", "false");
        await expect(color).toHaveAttribute("aria-expanded", "true");
        await expect(options).toHaveCount(1);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `offers touch-sized floating Properties controls with no tabs in ${tablet.name}`,
      async function () {
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const source = String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (4,6);
\end{tikzpicture}`;
        await pasteCode(page, source);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await chooseTool(frame, input, "Lasso");
        await fitDiagram(frame, input);
        const panel = frame.getByRole("complementary", { name: "Properties", exact: true });
        // The figure's Properties hold X scale, Y scale, and the bounds Mode (FR-060a); a rectangle's hold more.
        const checkControls = async (baseline: number) => {
          const controls = panel.locator(
            'button,input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),select,textarea',
          );
          // The panel opens after the tap; count its controls once they are shown.
          await expect(panel).toBeVisible();
          await expect.poll(async () => (await controls.filter({ visible: true }).count()) >= baseline).toBe(true);
          let checked = 0;
          for (const control of await controls.all()) {
            if (!(await control.isVisible())) {
              continue;
            }
            await stableCenter(control);
            const box = (await control.boundingBox())!;
            assert.ok(
              box.width >= 44 && box.height >= 44,
              `${await control.evaluate((element) => element.outerHTML)} is ${box.width}×${box.height}, below a finger target`,
            );
            checked++;
          }
          assert.ok(checked >= baseline, `The panel showed ${checked} controls, fewer than ${baseline}`);
          const body = panel.locator(".embed-inspector-content");
          assert.ok(
            await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
            "Properties controls overflow horizontally",
          );
        };
        await tap(documentPanelButton("Properties"));
        await checkControls(3);
        await expect(panel.getByRole("tab")).toHaveCount(0);
        await tap(panel.getByRole("button", { name: "Close properties", exact: true }));
        await input.touch([
          await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.06),
        ]);
        await tap(documentPanelButton("Properties"));
        await checkControls(4);
        assert.equal(
          (await editorDebug(page)).source,
          source,
          "Reaching the controls changed the drawing",
        );
        await storyScreenshot(page, `floating-properties-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `offers touch-sized Repeat dialog controls in ${tablet.name}`,
      async function () {
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (-4,-2) -- (4,2);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => input.touch([await stableCenter(locator)]);
        await chooseTool(frame, input, "Lasso");
        await fitDiagram(frame, input);
        await input.longPress(
          await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.5),
        );
        await tap(
          frame.getByRole("menu").first().getByRole("menuitem", { name: "Repeat...", exact: true }),
        );
        const repeat = frame.getByTestId("repeat-modal");
        await expect(repeat).toBeVisible();
        for (const control of await repeat.locator("button,input").all()) {
          await stableCenter(control);
          const box = (await control.boundingBox())!;
          assert.ok(
            box.width >= 44 && box.height >= 44,
            `Repeat control is ${box.width}×${box.height}, below a finger target`,
          );
        }
        await storyScreenshot(page, `repeat-touch-${tablet.name}`);
        await tap(repeat.getByRole("button", { name: "Close repeat dialog", exact: true }));
        await expect(repeat).toHaveCount(0);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `inserts, deletes, and opens layers through touch routes in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (0,0) circle (2cm);\end{tikzpicture}`);
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(1);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;

        await chooseShape(frame, input, "Line");
        assert.equal((await editorDebug(page)).tool, "addLine");
        const from = {
          x: viewport.x + viewport.width * 0.7,
          y: viewport.y + viewport.height * 0.3,
        };
        await input.penStroke([
          from,
          { x: from.x + 40, y: from.y + 30 },
          { x: from.x + 80, y: from.y + 60 },
        ]);
        await expect(frame.locator("[data-source-id]")).toHaveCount(2);
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toMatch(/\\draw[^;]*--[^;]*;/);

        await chooseTool(frame, input, "Lasso");
        // The inserted line stays selected and its control may cover the circle; tap empty canvas to dismiss it.
        await input.touch([(await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0]]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        await fitDiagram(frame, input);
        await input.longPress(
          await strokePoint(page, frame.locator("circle[data-source-id]").first(), 0.5),
        );
        await input.touch([
          await stableCenter(
            frame.getByRole("menu").first().getByRole("menuitem", { name: "Delete", exact: true }),
          ),
        ]);
        await expect(frame.locator("circle[data-source-id]")).toHaveCount(0);
        assert.doesNotMatch((await editorDebug(page)).source, /circle/);

        await input.touch([
          await stableCenter(documentPanelButton("Layers")),
        ]);
        const panel = sidePanel(frame, "Layers");
        await expect(panel.getByRole("heading", { name: "Layers", exact: true })).toBeVisible();
        await expect(panel.getByText("Line", { exact: true })).toBeVisible();
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `creates, renames, fills, hides, locks, orders and deletes TikZ scope layers by touch in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (-14,-18) -- (-2,-12);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator("svg [data-source-id]")).toHaveCount(1);
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => {
          await input.touch([await stableCenter(locator)]);
        };
        const source = async () => (await editorDebug(page)).source;
        await tap(documentPanelButton("Layers"));
        const panel = sidePanel(frame, "Layers");
        const layers = () =>
          panel
            .getByRole("group", { name: / layer$/ })
            .evaluateAll((groups) =>
              groups.map((group) => group.getAttribute("aria-label")!.replace(/ layer$/, "")),
            );
        // A new layer is a named scope; layers are listed front first.
        await tap(panel.getByRole("button", { name: "New layer", exact: true }));
        await tap(panel.getByRole("button", { name: "New layer", exact: true }));
        await expect
          .poll(source)
          .toMatch(
            /\\begin\{scope\}\[name=Layer 1\][^]*\\end\{scope\}[^]*\\begin\{scope\}\[name=Layer 2\]/,
          );
        await expect.poll(layers).toEqual(["Layer 2", "Layer 1"]);
        for (const button of await panel
          .getByRole("group", { name: / layer$/ })
          .getByRole("button")
          .all()) {
          const box = (await button.boundingBox())!;
          assert.ok(
            box.width >= 44 && box.height >= 44,
            `${await button.getAttribute("aria-label")} is ${box.width}x${box.height} px, under a fingertip`,
          );
        }
        // Renaming writes the scope's name.
        await tap(panel.getByRole("button", { name: "Rename Layer 1", exact: true }));
        await panel.getByRole("textbox", { name: "Layer name" }).fill("Ground");
        await page.keyboard.press("Enter");
        await expect.poll(source).toMatch(/\\begin\{scope\}\[name=Ground\]/);
        // The selected line moves into the layer's scope.
        await tap(panel.getByRole("button", { name: "Line", exact: true }));
        await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
        await tap(panel.getByRole("button", { name: "Move selection to Ground", exact: true }));
        await expect
          .poll(source)
          .toMatch(
            /\\begin\{scope\}\[name=Ground\]\s*\\draw \(-14,-18\) -- \(-2,-12\);\s*\\end\{scope\}/,
          );
        assert.equal((await source()).match(/\\draw/g)!.length, 1);
        await expect(async () => {
          const child = await layoutBox(panel.getByRole("button", { name: "Line", exact: true }));
          const parent = await layoutBox(
            panel.getByRole("button", { name: "Ground Layer", exact: true }),
          );
          expect(child.x, "The layer child is indented to the right of its parent").toBeGreaterThan(
            parent.x,
          );
        }).toPass({ timeout: 5_000 });
        const line = frame.locator("svg [data-source-id]").first();
        // Hiding takes the line off the canvas and leaves the source as it is; showing brings it back (data-model Layer).
        const layered = await source();
        await tap(panel.getByRole("button", { name: "Hide Ground", exact: true }));
        await expect(frame.locator("svg [data-source-id]")).toHaveCount(0);
        assert.equal(await source(), layered);
        await tap(panel.getByRole("button", { name: "Show Ground", exact: true }));
        await expect(frame.locator("svg [data-source-id]")).toHaveCount(1);
        assert.equal(await source(), layered);
        // The pen drags the line of an unlocked layer, and not of a locked one.
        await chooseTool(frame, input, "Lasso");
        // With the panel open, the fitted view keeps the line in the canvas left of it.
        await fitDiagram(frame, input);
        const drag = async () => {
          const from = await strokePoint(page, line, 0.5);
          await input.penDown(from);
          for (let step = 1; step <= 12; step++) {
            await input.penMove({ x: from.x + step * 5, y: from.y - step * 3 });
          }
          await input.penUp({ x: from.x + 60, y: from.y - 36 });
        };
        await drag();
        // A press on an object in a layer takes the object, not the whole layer.
        await expect
          .poll(source, "The pen did not drag an unlocked line")
          .not.toMatch(/\\draw \(-14,-18\) -- \(-2,-12\);/);
        assert.match(
          await source(),
          /\\begin\{scope\}\[name=Ground\]\s*\\draw/,
          "The drag moved the layer instead of its line",
        );
        // The selected line's control stays off the open panel.
        const aside = (await panel.boundingBox())!;
        for (const control of [
          frame.getByRole("button", { name: "Lock", exact: true }),
          frame.getByRole("button", { name: "Edit Points", exact: true }),
        ]) {
          const box = (await control.boundingBox())!;
          assert.ok(
            box.x + box.width <= aside.x ||
              box.x >= aside.x + aside.width ||
              box.y + box.height <= aside.y ||
              box.y >= aside.y + aside.height,
            `${control} at ${JSON.stringify(box)} covers the Layers panel at ${JSON.stringify(aside)}`,
          );
        }
        await tap(documentHistory("Undo"));
        await expect.poll(source).toMatch(/\\draw \(-14,-18\) -- \(-2,-12\);/);
        await tap(panel.getByRole("button", { name: "Lock Ground", exact: true }));
        await expect(
          panel.getByRole("button", { name: "Unlock Ground", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await drag();
        assert.match(
          await source(),
          /\\draw \(-14,-18\) -- \(-2,-12\);/,
          "A locked layer's line moved",
        );
        await tap(panel.getByRole("button", { name: "Unlock Ground", exact: true }));
        // Raising puts the layer in front: later in the source, first in the list.
        await tap(panel.getByRole("button", { name: "Raise Ground", exact: true }));
        await expect.poll(layers).toEqual(["Ground", "Layer 2"]);
        assert.match(await source(), /\[name=Layer 2\][^]*\[name=Ground\]/);
        // Deleting asks first, then removes the scope.
        await tap(panel.getByRole("button", { name: "Delete Layer 2", exact: true }));
        assert.match(await source(), /name=Layer 2/, "Deleted without confirmation");
        await tap(
          panel.getByRole("button", { name: "Delete Layer 2 and its objects", exact: true }),
        );
        await expect.poll(source).not.toMatch(/Layer 2/);
        await expect.poll(layers).toEqual(["Ground"]);
        await storyScreenshot(page, `layers-${tablet.name}`);
        await tap(panel.getByRole("button", { name: "Close layers", exact: true }));
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps selection actions usable beside Layers when the selection fills the canvas in ${tablet.name}`,
      async function () {
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \begin{scope}[name=Long foreground layer]
        \draw (-100,-100) rectangle (100,100);
        \end{scope}
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await input.touch([
          await stableCenter(
            documentPanelButton("Layers"),
          ),
        ]);
        const panel = sidePanel(frame, "Layers");
        const title = panel.getByRole("button", {
          name: "Long foreground layer Layer",
          exact: true,
        });
        // A long name may ellipsize; the type badge must remain legible.
        const badge = title.getByText("Layer", { exact: true });
        await expect(badge).toBeVisible();
        assert.ok(
          await badge.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const parent = node.parentElement!.getBoundingClientRect();
            return box.left >= parent.left && box.right <= parent.right;
          }),
          "The Layer badge is clipped by the title",
        );
        await chooseTool(frame, input, "Lasso");
        const zoom = zoomControl(frame);
        await input.touch([await stableCenter(zoom)]);
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "200%", exact: true })),
        ]);
        await input.touch([await stableCenter(zoom)]);
        await input.touch([
          await stableCenter(panel.getByRole("button", { name: "Rectangle", exact: true })),
        ]);
        const actions = frame.getByRole("button", { name: "More", exact: true });
        await expect(actions).toBeInViewport({ ratio: 1 });
        const control = (await actions.boundingBox())!;
        const aside = (await panel.boundingBox())!;
        assert.ok(control.width >= 44 && control.height >= 44);
        assert.ok(
          control.x + control.width <= aside.x ||
            control.x >= aside.x + aside.width ||
            control.y + control.height <= aside.y ||
            control.y >= aside.y + aside.height,
          "The selection strip overlaps Layers",
        );
        await input.touch([await stableCenter(actions)]);
        await expect(frame.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
        await page.screenshot({ path: `test-results/workbench/layers-cramped-${tablet.name}.png` });
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `refuses to move a coordinate into a layer drawn after the line that uses it in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \coordinate (a) at (-10,-14);
        \draw (a) -- (-4,-16);
        \begin{scope}[name=Front]
        \end{scope}
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator("svg [data-source-id]").first()).toBeAttached();
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => {
          await input.touch([await stableCenter(locator)]);
        };
        const source = async () => (await editorDebug(page)).source;
        await tap(
          documentPanelButton("Layers"),
        );
        const panel = sidePanel(frame, "Layers");
        const before = await source();
        await tap(panel.getByRole("button", { name: "Coordinate", exact: true }));
        await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
        await tap(panel.getByRole("button", { name: "Move selection to Front", exact: true }));
        await expect(frame.getByTestId("canvas-warning-message")).toContainText("out of order");
        assert.equal(await source(), before, "The coordinate moved after the line that uses it");
        // The line itself may join the later layer.
        await tap(panel.getByRole("button", { name: "Line", exact: true }));
        await tap(panel.getByRole("button", { name: "Move selection to Front", exact: true }));
        await expect
          .poll(source)
          .toMatch(/\\begin\{scope\}\[name=Front\]\s*\\draw \(a\) -- \(-4,-16\);\s*\\end\{scope\}/);
        await tap(panel.getByRole("button", { name: "Close layers", exact: true }));
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps panels and the curve refinement clear of the drawing rail in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const rail = drawingToolbar(frame);
        const overlap = async (locator: ReturnType<typeof frame.locator>) => {
          const [a, b] = [(await rail.boundingBox())!, (await locator.boundingBox())!];
          return (
            Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
            Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
          );
        };
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await chooseTool(frame, input, "Pen");
        await input.penStroke(waveAcross(viewport, 0.45, 0.4, 120));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        await openSimplify(frame, input, lastPath(frame));
        const result = curveRefinement(frame);
        assert.equal(await overlap(result), 0, "The curve refinement covers the rail");
        await input.touch([
          await stableCenter(result.getByRole("button", { name: "Cancel", exact: true })),
        ]);
        await input.touch([
          await stableCenter(documentPanelButton("Properties")),
        ]);
        const panel = frame.getByRole("complementary", { name: "Properties", exact: true });
        await expect(panel).toBeVisible();
        assert.equal(await overlap(panel), 0, "The properties panel covers the rail");
        await storyScreenshot(page, `placement-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `opens Properties as a side panel in landscape and a bottom sheet in portrait, clear of the selected object, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (-1,-1) rectangle (1,1);
        \draw (6,-8) rectangle (9,-5);
        \path[use as bounding box] (-10,-10) rectangle (10,10);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const corner = frame.locator('svg [data-source-id="path:1"]').first();
        await expect(corner).toBeVisible();
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => {
          await input.touch([await stableCenter(locator)]);
        };
        await fitDiagram(frame, input);
        const rail = drawingToolbar(frame);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, corner, 0.1)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
        await tap(documentPanelButton("Properties"));
        const panel = frame.getByRole("complementary", { name: "Properties", exact: true });
        await expect(panel).toBeVisible();
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
          Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        const clearOfSubject = async (what: string) => {
          await expect(async () => {
            expect(
              overlap(await layoutBox(panel), await layoutBox(corner)),
              `${what} covers the selected rectangle`,
            ).toBe(0);
          }).toPass({ timeout: 5_000 });
          const box = (await corner.boundingBox())!;
          assert.ok(
            box.x >= viewport.x &&
              box.y >= viewport.y &&
              box.x + box.width <= viewport.x + viewport.width &&
              box.y + box.height <= viewport.y + viewport.height,
            `${what} pushed the selected rectangle off the canvas`,
          );
          assert.equal(
            overlap((await rail.boundingBox())!, box),
            0,
            `The rail covers the selected rectangle beside ${what}`,
          );
        };
        const box = (await panel.boundingBox())!;
        if (tablet.name === "landscape") {
          assert.ok(
            box.x > viewport.x + viewport.width / 2 && box.height > box.width,
            `Properties is not a side panel: ${JSON.stringify(box)}`,
          );
          await clearOfSubject("the side panel");
        } else {
          assert.ok(
            box.width > viewport.width * 0.9 &&
              box.height < viewport.height * 0.5 &&
              box.y > viewport.y + viewport.height / 2,
            `Properties is not a shallow bottom sheet: ${JSON.stringify({ box, viewport })}`,
          );
          assert.equal(
            overlap(box, (await rail.boundingBox())!),
            0,
            "The bottom sheet covers the dock",
          );
          await clearOfSubject("the bottom sheet");
          const expand = panel.getByRole("button", { name: "Expand properties", exact: true });
          await expect(expand).toHaveAttribute("aria-expanded", "false");
          await tap(expand);
          await expect(expand).toHaveAttribute("aria-expanded", "true");
          await expect(async () => {
            expect((await layoutBox(panel)).height).toBeGreaterThan(viewport.height * 0.6);
          }).toPass({ timeout: 5_000 });
          await tap(expand);
          await expect(async () => {
            expect((await layoutBox(panel)).height).toBeLessThan(viewport.height * 0.5);
          }).toPass({ timeout: 5_000 });
        }
        await storyScreenshot(page, `properties-space-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps the selected object and Properties above the on-screen keyboard in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (-1,-1) rectangle (1,1);
        \draw (6,-8) rectangle (9,-5);
        \path[use as bounding box] (-10,-10) rectangle (10,10);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const corner = frame.locator('svg [data-source-id="path:1"]').first();
        await expect(corner).toBeVisible();
        const input = await TabletInput.attach(page);
        const tap = async (locator: Locator) => {
          await input.touch([await stableCenter(locator)]);
        };
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, corner, 0.1)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
        await tap(documentPanelButton("Properties"));
        const panel = frame.getByRole("complementary", { name: "Properties", exact: true });
        await tap(panel.getByRole("spinbutton", { name: "X shift", exact: true }));
        const scale = (await editorDebug(page)).viewport.scale;
        // iPadOS reports the keyboard as a shorter visual viewport over an unchanged layout.
        const keyboardTop = Math.round(tablet.height * 0.58);
        const reportVisibleHeight = (height: number) =>
          page.evaluate((visible) => {
            Object.defineProperty(window.visualViewport!, "height", {
              configurable: true,
              value: visible,
            });
            window.visualViewport!.dispatchEvent(new Event("resize"));
          }, height);
        await reportVisibleHeight(keyboardTop);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await expect(async () => {
          const box = await layoutBox(corner);
          expect(box.y + box.height, "The keyboard covers the selected rectangle").toBeLessThanOrEqual(
            keyboardTop,
          );
        }).toPass({ timeout: 5_000 });
        assert.ok(
          (await corner.boundingBox())!.y >= viewport.y,
          "The selected rectangle left the top of the canvas",
        );
        const panelBottom = async () => {
          const box = await layoutBox(panel);
          return box.y + box.height;
        };
        if (tablet.name === "portrait") {
          await expect(async () => {
            expect(await panelBottom(), "The keyboard covers the bottom sheet").toBeLessThanOrEqual(
              keyboardTop,
            );
          }).toPass({ timeout: 5_000 });
        }
        const field = (await panel
          .getByRole("spinbutton", { name: "X shift", exact: true })
          .boundingBox())!;
        assert.ok(
          field.y + field.height <= keyboardTop,
          "The keyboard covers the focused Properties field",
        );
        const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
          Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        await expect(async () => {
          expect(
            overlap(await layoutBox(panel), await layoutBox(corner)),
            "The raised panel covers the selected rectangle",
          ).toBe(0);
        }).toPass({ timeout: 5_000 });
        const control = frame.getByRole("toolbar", { name: "Selection", exact: true });
        assert.equal(
          overlap((await control.boundingBox())!, (await panel.boundingBox())!),
          0,
          "The selection control covers the raised panel",
        );
        assert.equal(
          (await editorDebug(page)).viewport.scale,
          scale,
          "The keyboard changed the zoom",
        );
        await storyScreenshot(page, `properties-keyboard-${tablet.name}`);
        await reportVisibleHeight(tablet.height);
        if (tablet.name === "portrait") {
          await expect(async () => {
            expect(
              await panelBottom(),
              "The bottom sheet stays raised after the keyboard closes",
            ).toBeGreaterThan(keyboardTop);
          }).toPass({ timeout: 5_000 });
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `moves the dock by a drag from its grip to each screen edge, and by no other drag, with drop zones that hold no words, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const rail = drawingToolbar(frame);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const gripPoint = () => dockGripPoint(rail);
        const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) =>
          input.touch(
            Array.from({ length: 13 }, (_, i) => ({
              x: from.x + ((to.x - from.x) * i) / 12,
              y: from.y + ((to.y - from.y) * i) / 12,
            })),
          );
        const storedDock = async () => {
          const response = await page.request.get(`${url}api/preferences`);
          assert.equal(response.status(), 200);
          const saved = ((await response.json()) as Record<string, string>)["tikz-editor:settings"];
          return saved
            ? (JSON.parse(saved) as { settings: { toolbar: { dock: string } } }).settings.toolbar.dock
            : null;
        };
        const clearOfRulers = async () => {
          const railBox = (await rail.boundingBox())!;
          for (const ruler of ["canvas-top-ruler", "canvas-left-ruler"]) {
            const box = (await frame.getByTestId(ruler).boundingBox())!;
            const overlapX =
              Math.min(railBox.x + railBox.width, box.x + box.width) - Math.max(railBox.x, box.x);
            const overlapY =
              Math.min(railBox.y + railBox.height, box.y + box.height) - Math.max(railBox.y, box.y);
            assert.ok(overlapX <= 0 || overlapY <= 0, `The rail covers ${ruler}`);
          }
        };
        const edges = {
          right: { x: viewport.x + viewport.width - 10, y: viewport.y + viewport.height / 2 },
          top: { x: viewport.x + viewport.width / 2, y: viewport.y + 10 },
          left: { x: viewport.x + 10, y: viewport.y + viewport.height / 2 },
          bottom: { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height - 10 },
        };
        await expect(rail).toHaveAttribute("data-dock", "bottom");
        // A drag that starts on a tool or on the toolbar's edge is not a dock drag (FR-010).
        await drag(await stableCenter(toolbarItem(frame, "Lasso")), edges.right);
        await expect(rail).toHaveAttribute("data-dock", "bottom");
        const railBox = await layoutBox(rail);
        await drag({ x: railBox.x + railBox.width / 2, y: railBox.y + 3 }, edges.right);
        await expect(rail).toHaveAttribute("data-dock", "bottom");
        for (const [dock, target] of Object.entries(edges)) {
          await drag(await gripPoint(), target);
          await expect(rail).toHaveAttribute("data-dock", dock);
          await expect.poll(storedDock).toBe(dock);
          await clearOfRulers();
        }
        // While a drag runs, each screen edge shows a drop zone, and no zone holds a word.
        const from = await gripPoint();
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2, { steps: 6 });
        const zones = frame.locator("[data-dock-target]");
        await expect(zones).toHaveCount(4);
        assert.deepEqual(
          (await zones.allTextContents()).map((text) => text.trim()),
          ["", "", "", ""],
        );
        await page.mouse.move(edges.right.x, edges.right.y, { steps: 6 });
        await page.mouse.up();
        await expect(rail).toHaveAttribute("data-dock", "right");
        await expect(zones).toHaveCount(0);
      },
    );

    story(
      { viewport: tablet },
      `copies and pastes an element through long presses in ${tablet.name}`,
      async function () {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (0,0) circle (2cm);\end{tikzpicture}`);
        const frame = editorFrame(page);
        await expect(frame.locator("circle[data-source-id]")).toHaveCount(1);
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Lasso");
        await fitDiagram(frame, input);
        await input.longPress(
          await strokePoint(page, frame.locator("circle[data-source-id]").first(), 0.5),
        );
        await input.touch([
          await stableCenter(
            frame.getByRole("menu").first().getByRole("menuitem", { name: "Copy", exact: true }),
          ),
        ]);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.longPress({
          x: viewport.x + viewport.width * 0.85,
          y: viewport.y + viewport.height * 0.2,
        });
        await input.touch([
          await stableCenter(
            frame.getByRole("menu").first().getByRole("menuitem", { name: "Paste", exact: true }),
          ),
        ]);
        await expect
          .poll(async () => ((await editorDebug(page)).source.match(/circle/g) ?? []).length)
          .toBe(2);
      },
    );

    story(
      { viewport: tablet },
      `starts a new tikzpicture or tikzcd by touch in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const input = await TabletInput.attach(page);
        const tap = async (locator: ReturnType<typeof page.locator>) => {
          await input.touch([await stableCenter(locator)]);
        };
        for (const kind of ["tikzcd", "tikzpicture"] as const) {
          await tap(barMenu("title").button);
          await tap(barMenuItem(`New ${kind}`));
          await expect(
            page.getByRole("dialog", { name: "Save changes?" }),
            "An untouched new diagram has no changes to save",
          ).toHaveCount(0);
          await expect(
            page.locator(
              kind === "tikzcd"
                ? 'iframe[title="Quiver diagram editor"]'
                : 'iframe[title="TikZ visual editor"]',
            ),
          ).toBeVisible({ timeout: 30_000 });
          await expect(page.locator(".tikz-standalone-status")).toHaveText(
            `New ${kind} · not saved`,
          );
          await editorReady(page);
        }
      },
    );
  }

  story(
    { viewport: { width: 768, height: 1024 } },
    "names no key in the tooltips a hovering pen shows on the drawing toolbar",
    async function () {
      await editorReady(page);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const rail = drawingToolbar(frame);
      for (const name of ["Lasso", "Pen", "Eraser", "Shapes", "Text", "Fill"]) {
        const box = (await rail.getByRole("button", { name, exact: true }).boundingBox())!;
        await input.penHover({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
        const tooltip = frame.getByRole("tooltip");
        await expect(tooltip).toBeVisible();
        assert.doesNotMatch(
          await tooltip.innerText(),
          /\([A-Z]\)|Ctrl|Cmd|Shift|Alt|Esc/,
          `${name} tooltip`,
        );
        await input.penHover({ x: 2, y: 2 });
      }
    },
  );

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `reverses a path from its long-press menu in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (-4,-2) -- (4,2);\end{tikzpicture}`);
        const frame = editorFrame(page);
        const line = frame.locator("[data-source-id]").first();
        await expect(line).toBeVisible();
        const input = await TabletInput.attach(page);
        await chooseTool(frame, input, "Lasso");
        await fitDiagram(frame, input);
        await input.longPress(await strokePoint(page, line, 0.5));
        const menu = frame.getByRole("menu").first();
        await input.touch([await stableCenter(menu.getByRole("menuitem", { name: /^Path/ }))]);
        await input.touch([
          await stableCenter(frame.getByRole("menuitem", { name: "Reverse Path", exact: true })),
        ]);
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toMatch(/\(4,2\) -- \(-4,-2\)/);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `erases only the swept part of each stroke a pen sweep crosses, as one undo step, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}
\draw (-6,-4) -- (-6,4);
\draw (-2,-4) -- (-2,4);
\draw (2,-4) .. controls (4,-4) and (0,4) .. (2,4);
\draw (6,-4) -- (6,4);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(4);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "Eraser", exact: true })),
        ]);
        const strokes = await frame.locator("[data-source-id]").evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }),
        );
        const [left, , curve, right] = [...strokes].sort((a, b) => a.x - b.x);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        // One sweep along y = 0 crosses both left lines and the curve, and stops short of the right line.
        const y = frameBox.y + left.y;
        const from = frameBox.x + left.x - 20,
          to = frameBox.x + (curve.x + right.x) / 2;
        await input.penStroke(
          Array.from({ length: 16 }, (_, i) => ({ x: from + (i * (to - from)) / 15, y })),
        );
        const statements = async () =>
          Array.from((await editorDebug(page)).source.matchAll(/\\draw(?:\{[^}]*\}|[^;{])*;/g), (match) => match[0]);
        await expect
          .poll(async () => (await statements()).length, {
            message: "The sweep did not leave two pieces of each stroke it crossed",
          })
          .toBe(7);
        const points = (statement: string) =>
          [...statement.matchAll(/\((-?[\d.]+),\s*(-?[\d.]+)\)/g)].map((match) => ({
            x: Number(match[1]),
            y: Number(match[2]),
          }));
        const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
        const drawn = await statements();
        for (const x of [-6, -2]) {
          const pieces = drawn
            .filter(
              (text) =>
                !text.includes("controls") && points(text).every((point) => near(point.x, x)),
            )
            .map((text) =>
              points(text)
                .map((point) => point.y)
                .sort((a, b) => a - b),
            );
          assert.equal(
            pieces.length,
            2,
            `The line at x = ${x} is not two pieces: ${drawn.join(" ")}`,
          );
          const [lower, upper] = pieces.sort((a, b) => a[0] - b[0]);
          assert.ok(
            near(lower[0], -4) && lower[1] < 0 && lower[1] > -1,
            `The lower piece of x = ${x} is ${lower}`,
          );
          assert.ok(
            near(upper[1], 4) && upper[0] > 0 && upper[0] < 1,
            `The upper piece of x = ${x} is ${upper}`,
          );
        }
        const curvePieces = drawn.filter((text) => text.includes("controls")).map(points);
        assert.equal(curvePieces.length, 2, `The curve is not two pieces: ${drawn.join(" ")}`);
        const [first, second] = curvePieces.sort((a, b) => a[0].y - b[0].y);
        assert.ok(
          near(first[0].x, 2) &&
            near(first[0].y, -4) &&
            first.at(-1)!.y < 0 &&
            first.at(-1)!.y > -1,
          `The first curve piece is ${JSON.stringify(first)}`,
        );
        assert.ok(
          near(second.at(-1)!.x, 2) &&
            near(second.at(-1)!.y, 4) &&
            second[0].y > 0 &&
            second[0].y < 1,
          `The second curve piece is ${JSON.stringify(second)}`,
        );
        assert.ok(
          drawn.includes(String.raw`\draw (6,-4) -- (6,4);`),
          "The sweep changed the stroke it did not cross",
        );
        // The whole sweep is one undo step.
        await input.touch([
          await stableCenter(
            documentHistory("Undo"),
          ),
        ]);
        await expect.poll(async () => (await editorDebug(page)).source).toBe(authored);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `erases only the swept part of a circle, an ellipse, an arc path, and a rectangle, each sweep one undo step, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}
\draw (-4,0) circle (2);
\draw (2,0) ellipse (3 and 1.5);
\draw (-6,-6) -- (-3,-6) arc[start angle=180, end angle=0, radius=2] -- (4,-6);
\draw (-6,3) rectangle (-2,5);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(4);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "Eraser", exact: true })),
        ]);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const statements = async () =>
          Array.from((await editorDebug(page)).source.matchAll(/\\draw(?:\{[^}]*\}|[^;{])*;/g), (match) => match[0]);
        // Each shape's top point is the top centre of its box; a short vertical sweep crosses only that point.
        const sweepTop = async (statement: string) => {
          await editorReady(page);
          const index = (await statements()).indexOf(statement);
          const box = await frame
            .locator("[data-source-id]")
            .nth(index)
            .evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return { x: rect.x + rect.width / 2, y: rect.y };
            });
          const x = frameBox.x + box.x,
            top = frameBox.y + box.y;
          await input.penStroke(
            Array.from({ length: 11 }, (_, i) => ({ x, y: top - 25 + i * 5 })),
          );
        };
        const number = String.raw`(-?\d+(?:\.\d+)?)`;
        const arcOf = (statement: string) => {
          const match = new RegExp(
            String.raw`\(${number},\s*${number}\)\s*arc\s*\[start angle=${number},\s*end angle=${number},\s*(?:radius=${number}|x radius=${number},\s*y radius=${number})\]`,
          ).exec(statement);
          assert.ok(match, `No arc in ${statement}`);
          const [x, y, start, end, radius, xRadius, yRadius] = match.slice(1).map(Number);
          return { x, y, start, end, rx: match[5] ? radius : xRadius, ry: match[5] ? radius : yRadius };
        };
        const radians = (degrees: number) => (degrees * Math.PI) / 180;
        // The remaining arc of a closed curve centred at `centre`: its radii, its start on the curve, and a small gap around the top.
        const assertOpenedAtTop = (
          statement: string,
          centre: { x: number; y: number },
          rx: number,
          ry: number,
        ) => {
          const arc = arcOf(statement);
          assert.ok(
            Math.abs(arc.rx - rx) < 0.01 && Math.abs(arc.ry - ry) < 0.01,
            `Radii changed: ${statement}`,
          );
          assert.ok(
            Math.abs(arc.x - (centre.x + rx * Math.cos(radians(arc.start)))) < 0.02 &&
              Math.abs(arc.y - (centre.y + ry * Math.sin(radians(arc.start)))) < 0.02,
            `The arc does not start on the authored curve: ${statement}`,
          );
          const gap = 360 - Math.abs(arc.end - arc.start);
          assert.ok(gap > 2 && gap < 40, `The erased gap is ${gap} degrees: ${statement}`);
          assert.ok(
            Math.sin(radians((arc.start + arc.end) / 2)) < -0.99,
            `The gap is not at the top: ${statement}`,
          );
        };

        const [circle, ellipse, arcPath, rectangle] = await statements();
        await sweepTop(circle);
        await expect
          .poll(async () => (await statements()).includes(circle), {
            message: "The sweep left the circle unchanged",
          })
          .toBe(false);
        let drawn = await statements();
        assert.equal(drawn.length, 4, `The circle is not one remaining arc: ${drawn.join(" ")}`);
        assertOpenedAtTop(drawn[0], { x: -4, y: 0 }, 2, 2);
        assert.deepEqual(drawn.slice(1), [ellipse, arcPath, rectangle]);

        await sweepTop(ellipse);
        await expect.poll(async () => (await statements()).includes(ellipse)).toBe(false);
        drawn = await statements();
        assert.equal(drawn.length, 4, `The ellipse is not one remaining arc: ${drawn.join(" ")}`);
        assertOpenedAtTop(drawn[1], { x: 2, y: 0 }, 3, 1.5);

        await sweepTop(arcPath);
        await expect.poll(async () => (await statements()).includes(arcPath)).toBe(false);
        drawn = await statements();
        assert.equal(drawn.length, 5, `The arc path is not two pieces: ${drawn.join(" ")}`);
        const [before, after] = drawn.slice(2, 4);
        assert.match(
          before,
          /^\\draw \(-6,-6\) -- \(-3,-6\) arc\s*\[start angle=180, end angle=[\d.]+, radius=2\];$/,
        );
        const beforeArc = arcOf(before);
        assert.ok(beforeArc.end > 91 && beforeArc.end < 110, `The first piece ends at ${beforeArc.end}`);
        assert.match(after, /arc\s*\[start angle=[\d.]+, end angle=0, radius=2\] -- \(4,-6\);$/);
        const afterArc = arcOf(after);
        assert.ok(afterArc.start > 70 && afterArc.start < 89, `The second piece starts at ${afterArc.start}`);
        assert.ok(
          Math.abs(afterArc.x - (-1 + 2 * Math.cos(radians(afterArc.start)))) < 0.02 &&
            Math.abs(afterArc.y - (-6 + 2 * Math.sin(radians(afterArc.start)))) < 0.02,
          `The second piece does not start on the authored arc: ${after}`,
        );

        const beforeRectangleSweep = (await editorDebug(page)).source;
        await sweepTop(rectangle);
        await expect.poll(async () => (await statements()).includes(rectangle)).toBe(false);
        drawn = await statements();
        assert.equal(drawn.length, 5, `The rectangle is not one open outline: ${drawn.join(" ")}`);
        const outline = [...drawn[4].matchAll(new RegExp(String.raw`\(${number},\s*${number}\)`, "g"))].map(
          (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
        );
        assert.doesNotMatch(drawn[4], /rectangle|cycle|controls|arc/);
        assert.equal(outline.length, 6, `The outline is ${drawn[4]}`);
        const ends = [outline[0], outline[5]].sort((a, b) => a.x - b.x);
        assert.ok(
          ends.every((point) => Math.abs(point.y - 5) < 0.01) &&
            ends[0].x > -5 &&
            ends[0].x < -4 &&
            ends[1].x > -4 &&
            ends[1].x < -3,
          `The outline does not open around the top centre: ${drawn[4]}`,
        );
        assert.deepEqual(
          outline
            .slice(1, 5)
            .map((point) => `${point.x},${point.y}`)
            .sort(),
          ["-2,3", "-2,5", "-6,3", "-6,5"],
        );
        // One sweep is one undo step.
        await input.touch([
          await stableCenter(
            documentHistory("Undo"),
          ),
        ]);
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toBe(beforeRectangleSweep);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `shows a tapped element's source in the code pane, even one opened afterward, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const code = page.getByRole("button", { name: "Code: left sidebar", exact: true });
        await code.click();
        const authored = String.raw`\begin{tikzpicture}
\draw (2,8) -- (12,14);
\draw (8,-6) circle (3cm);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(2);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        // The source lines the code pane's selection highlight spans, as the author sees them.
        const codeSelection = () =>
          page.locator(".cm-editor").evaluate((editor) => {
            const highlights = [...editor.querySelectorAll(".cm-selectionBackground")].map((node) =>
              node.getBoundingClientRect(),
            );
            return [...editor.querySelectorAll(".cm-line")]
              .filter((line) => {
                const text = document.createRange();
                text.selectNodeContents(line);
                const box = text.getBoundingClientRect();
                return (
                  box.width > 0 &&
                  highlights.some(
                    (mark) =>
                      mark.top < box.bottom &&
                      mark.bottom > box.top &&
                      mark.left <= box.left + 1 &&
                      mark.right >= box.right - 1,
                  )
                );
              })
              .map((line) => line.textContent)
              .join("\n");
          });
        await chooseTool(frame, input, "Lasso");
        await input.touch([
          await strokePoint(page, frame.locator("circle[data-source-id]").first(), 0.5),
        ]);
        await expect
          .poll(codeSelection, { message: "touch tap on the circle" })
          .toBe(String.raw`\draw (8,-6) circle (3cm);`);
        await editorReady(page);
        const linePoint = await strokePoint(page, frame.locator("path[data-source-id]").first(), 0.25);
        const lineId = await frame.locator("path[data-source-id]").first().getAttribute("data-source-id");
        const pick = await page.evaluate(({ point, targetId }) => {
          const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="TikZ visual editor"]')!;
          const box = iframe.getBoundingClientRect();
          const doc = iframe.contentDocument!;
          const center = doc.elementFromPoint(point.x - box.left, point.y - box.top)?.outerHTML.slice(0, 200);
          for (let radius = 0; radius <= 8; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                const element = doc.elementFromPoint(point.x - box.left + dx, point.y - box.top + dy);
                if (element?.getAttribute("data-hit-region-target-id") === targetId) {
                  return { point: { x: point.x + dx, y: point.y + dy }, center };
                }
              }
            }
          }
          return { point: null, center };
        }, { point: linePoint, targetId: lineId });
        assert.ok(pick.point, `Line has no hit region near its stroke: ${pick.center}`);
        await input.penStroke([pick.point, pick.point]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([lineId]);
        await expect
          .poll(codeSelection, { message: "pen tap on the line" })
          .toBe(String.raw`\draw (2,8) -- (12,14);`);
        assert.equal((await editorDebug(page)).source, authored);
        await code.click();
        await expect(page.locator(".cm-content")).toBeHidden();
        await input.touch([
          await strokePoint(page, frame.locator("circle[data-source-id]").first(), 0.5),
        ]);
        await code.click();
        await expect
          .poll(codeSelection, { message: "circle tapped while the code pane was closed" })
          .toBe(String.raw`\draw (8,-6) circle (3cm);`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps the selection strip off a neighbouring line when no place holds all its actions in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        // The line's bounds reach down beside the circle, so only a short place beside the circle is free.
        const authored = String.raw`\begin{tikzpicture}
\draw (2,-4) -- (12,14);
\draw (8,-6) circle (3cm);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        const frame = editorFrame(page);
        await expect(frame.locator("[data-source-id]")).toHaveCount(2);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const circle = frame.locator("circle[data-source-id]").first();
        const line = frame.locator("path[data-source-id]").first();
        const circleId = await circle.getAttribute("data-source-id");
        const lineId = await line.getAttribute("data-source-id");
        await input.touch([await strokePoint(page, circle, 0.5)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([circleId]);
        await editorReady(page);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const stripBox = (await strip.boundingBox())!;
        const covered = [];
        for (const fraction of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
          const point = await strokePoint(page, line, fraction);
          if (
            point.x >= stripBox.x &&
            point.x <= stripBox.x + stripBox.width &&
            point.y >= stripBox.y &&
            point.y <= stripBox.y + stripBox.height
          ) {
            covered.push(fraction);
          }
        }
        await page.screenshot({
          path: `test-results/workbench/selection-strip-beside-neighbour-${tablet.name}.png`,
        });
        assert.deepEqual(covered, [], "The selection strip covers these fractions of the line");
        // The strip still offers the selection's actions: the lock is in view and works.
        const lock = strip.getByRole("button", { name: "Lock", exact: true });
        await expect(lock).toBeInViewport({ ratio: 1 });
        await input.touch([await stableCenter(lock)]);
        await expect(lock).toHaveAttribute("aria-pressed", "true");
        await input.touch([await stableCenter(lock)]);
        await expect(lock).toHaveAttribute("aria-pressed", "false");
        // The pen picks the neighbour directly, without clearing the selection first.
        await input.penStroke([
          await strokePoint(page, line, 0.25),
          await strokePoint(page, line, 0.25),
        ]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([lineId]);
        assert.equal((await editorDebug(page)).source, authored);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `places a selected curve's control off the curve and clear of the rail in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (-6,-3) .. controls (-2,4) and (2,-4) .. (6,3);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator("[data-source-id]").first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const intersects = (
          a: { x: number; y: number; width: number; height: number },
          b: typeof a,
        ) =>
          Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
          Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
        for (const contact of ["touch", "pen"] as const) {
          const frameBox = (await page
            .locator('iframe[title="TikZ visual editor"]')
            .boundingBox())!;
          // The curve's stroke, as 101 points on the page.
          const stroke = (
            await curve.evaluate((path: SVGGeometryElement) =>
              Array.from({ length: 101 }, (_, index) => {
                const at = path.getPointAtLength((path.getTotalLength() * index) / 100);
                const matrix = path.getScreenCTM()!;
                return {
                  x: at.x * matrix.a + at.y * matrix.c + matrix.e,
                  y: at.x * matrix.b + at.y * matrix.d + matrix.f,
                };
              }),
            )
          ).map((point) => ({ x: frameBox.x + point.x, y: frameBox.y + point.y }));
          const tapAt = stroke[20]!;
          if (contact === "touch") {
            await input.touch([tapAt]);
          } else {
            await input.penStroke([tapAt]);
          }
          const control = frame.getByRole("toolbar", { name: "Selection", exact: true });
          await expect(control).toBeVisible();
          await storyScreenshot(page, `curve-control-placed-${contact}-${tablet.name}`);
          const controlBox = (await control.boundingBox())!;
          const covered = stroke.filter(
            (point) =>
              point.x >= controlBox.x &&
              point.x <= controlBox.x + controlBox.width &&
              point.y >= controlBox.y &&
              point.y <= controlBox.y + controlBox.height,
          );
          assert.deepEqual(covered, [], `${contact}: the curve control covers the curve`);
          assert.ok(
            !intersects(controlBox, (await frame.locator("[data-diagram-tools]").boundingBox())!),
            `${contact}: the curve control covers the rail`,
          );
          await input.touch([(await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0]]);
          await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ["touch", "pen"] as const) {
      story(
        { viewport: tablet },
        `highlights, locks, and keeps a curve selected by ${contact} in ${tablet.name}`,
        async function () {
          await editorReady(page);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await pasteCode(page, String.raw`\begin{tikzpicture}
          \draw (2,-2) .. controls (5,6) and (9,-6) .. (12,2);
          \draw (-6,14) -- (-2,18);
          \end{tikzpicture}`);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          const frame = editorFrame(page);
          await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeVisible();
          const input = await TabletInput.attach(page);
          await fitDiagram(frame, input);
          const frameBox = (await page
            .locator('iframe[title="TikZ visual editor"]')
            .boundingBox())!;
          const tap = async (point: { x: number; y: number }) =>
            contact === "touch" ? input.touch([point]) : input.penStroke([point]);
          const onCurve = async (fraction: number) => {
            const point = await frame
              .locator('svg [data-source-id="path:0"]')
              .first()
              .evaluate((path: SVGGeometryElement, at) => {
                const p = path.getPointAtLength(path.getTotalLength() * at);
                const m = path.getScreenCTM()!;
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
              }, fraction);
            return { x: frameBox.x + point.x, y: frameBox.y + point.y };
          };
          await chooseTool(frame, input, "Lasso");
          await tap(await onCurve(0.3));
          await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
          await expect(frame.locator('[data-selection-highlight="path:0"]')).toBeVisible();
          const lock = frame.getByRole("button", { name: "Lock", exact: true });
          await expect(lock).toHaveAttribute("aria-pressed", "false");
          await storyScreenshot(page, `curve-selected-${contact}-${tablet.name}`);
          await input.touch([await stableCenter(lock)]);
          await expect(lock).toHaveAttribute("aria-pressed", "true");
          await storyScreenshot(page, `curve-locked-${contact}-${tablet.name}`);
          await tap((await emptyCanvasGesture(frame))[0]);
          // The other line is separated from the curve and its floating control.
          await tap(
            await strokePoint(page, frame.locator('svg [data-source-id="path:1"]').first(), 0.99),
          );
          await expect(lock).toHaveAttribute("aria-pressed", "true");
          assert.deepEqual(
            (await editorDebug(page)).selection,
            ["path:0"],
            "A locked curve stays selected",
          );
          const anchor = frame
            .locator('[data-handle-kind="move-handle"][data-source-id="path:0"]')
            .first();
          // In Selecting, a tap on a point of the curve is a tap on the curve.
          await tap(await settledCenter(anchor));
          await expect(lock).toHaveAttribute("aria-pressed", "true");
          assert.deepEqual((await editorDebug(page)).selection, ["path:0"]);
          const before = (await editorDebug(page)).viewport;
          await input.touch(await emptyCanvasGesture(frame));
          assert.notDeepEqual(
            (await editorDebug(page)).viewport,
            before,
            "Finger pan still works on a locked curve",
          );
          await expect(lock).toHaveAttribute("aria-pressed", "true");
          assert.deepEqual((await editorDebug(page)).selection, ["path:0"]);
          await input.touch([await stableCenter(lock)]);
          await expect(lock).toHaveAttribute("aria-pressed", "false");
          // Positive baseline: that same line is selectable once the curve is unlocked.
          await tap(
            await strokePoint(page, frame.locator('svg [data-source-id="path:1"]').first(), 0.99),
          );
          await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:1"]);
          await tap((await emptyCanvasGesture(frame))[0]);
          await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        },
      );
    }
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `edits a point on a styled curve from its control in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw[red, thick] (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.touch([await strokePoint(page, curve, 0.2)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await expect(
          frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Edit Points", exact: true }),
        ).toBeVisible();
        await input.touch([await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Edit Points", exact: true }))]);
        const frameBox = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
        const middle = await frame
          .locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]')
          .evaluateAll(
            (nodes) =>
              nodes
                .map((node) => {
                  const box = node.getBoundingClientRect();
                  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                })
                .sort((a, b) => a.x - b.x)[1],
          );
        await input.touch([{ x: frameBox.x + middle.x, y: frameBox.y + middle.y }]);
        await input.touch([
          await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Corner", exact: true })),
        ]);
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .not.toMatch(/\(5,4\) \.\. \(6,0\) \.\. controls \(7,-4\)/);
        assert.match((await editorDebug(page)).source, /\\draw\[red, thick\]/);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `gives a selected rectangle the shape control, not the curve control, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}\draw (2,-2) rectangle (8,2);\end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const rectangle = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(rectangle).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.touch([await strokePoint(page, rectangle, 0.1)]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        // One shape: Lock, Duplicate, More (contracts/surfaces.md, Object menu).
        await expect.poll(() => strip.getByRole("button").allInnerTexts()).toEqual(["Lock", "Duplicate", "More"]);
        await expect(strip.getByRole("button", { name: "Edit Points", exact: true })).toHaveCount(0);
        await expect(strip.getByRole("button", { name: "Simplify", exact: true })).toHaveCount(0);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `leaves point editing with Escape and keeps the curve ready to edit in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}
\draw (1,1) .. controls (2,4) and (4,4) .. (5,1) .. controls (6,-2) and (8,-2) .. (9,1);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await input.penStroke([await strokePoint(page, curve, 0.3)]);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        await expect(strip.getByRole("button", { name: "Edit Points", exact: true })).toBeVisible();
        await input.penStroke([await stableCenter(strip.getByRole("button", { name: "Edit Points", exact: true }))]);
        const anchor = frame.locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]').nth(1);
        const anchorBox = (await anchor.boundingBox())!;
        await input.penHover({ x: anchorBox.x + anchorBox.width / 2 + 9, y: anchorBox.y + anchorBox.height / 2 });
        await expect(anchor).toHaveAttribute("style", /fill: var\(--accent\)/);
        await input.penStroke([{ x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 }]);
        await expect(selectedPoints(frame)).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await expect(strip.getByRole("button", { name: "Edit Points", exact: true })).toBeVisible();
        await input.penStroke([await stableCenter(strip.getByRole("button", { name: "Edit Points", exact: true }))]);
        await expect(strip.getByRole("button", { name: "Done", exact: true })).toBeVisible();
        assert.equal((await editorDebug(page)).source, authored);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `moves the touched point with a pen drag in point editing, as one undo step, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page
          .getByRole("button", { name: "Code: left sidebar", exact: true })
          .click();
        const authored = String.raw`\begin{tikzpicture}
\draw (1,1) .. controls (2,4) and (4,4) .. (5,1) .. controls (6,-2) and (8,-2) .. (9,1);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page
          .getByRole("button", { name: "Code: left sidebar", exact: true })
          .click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([
          await strokePoint(
            page,
            frame.locator('svg [data-source-id="path:0"]').first(),
            0.3,
          ),
        ]);
        const strip = frame.getByRole("toolbar", {
          name: "Selection",
          exact: true,
        });
        await input.penStroke([
          await stableCenter(
            strip.getByRole("button", { name: "Edit Points", exact: true }),
          ),
        ]);
        await expect(
          strip.getByRole("button", { name: "Done", exact: true }),
        ).toBeVisible();
        const anchor = frame
          .locator(
            'rect[data-handle-kind="move-handle"][data-source-id="path:0"]',
          )
          .nth(1);
        const center = async () => {
          const box = (await anchor.boundingBox())!;
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        };
        const from = await center();
        await input.penDown(from);
        for (let i = 1; i <= 10; i++)
          await input.penMove({ x: from.x, y: from.y - i * 6 });
        await input.penUp({ x: from.x, y: from.y - 60 });
        await expect
          .poll(async () => (await editorDebug(page)).source, {
            message: "The drag did not move the point",
          })
          .not.toBe(authored);
        const moved = (await editorDebug(page)).source;
        const anchors = [...moved.matchAll(/\((-?[\d.]+),\s*(-?[\d.]+)\)/g)]
          .filter((_, i) => i % 3 === 0)
          .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
        assert.deepEqual(
          [anchors[0], anchors[2]],
          [
            { x: 1, y: 1 },
            { x: 9, y: 1 },
          ],
          moved,
        );
        assert.ok(anchors[1].y > 1 && Math.abs(anchors[1].x - 5) < 0.01, moved);
        // The session stays in point editing with the moved point as its scope.
        await expect(selectedPoints(frame)).toHaveCount(1);
        await expect(
          strip.getByRole("button", { name: "Done", exact: true }),
        ).toBeVisible();
        assert.deepEqual((await editorDebug(page)).selection, ["path:0"]);
        // A tap on the selected point takes it out of the scope and moves nothing.
        await input.penStroke([await center()]);
        await expect(selectedPoints(frame)).toHaveCount(0);
        assert.equal((await editorDebug(page)).source, moved);
        await input.touch([
          await stableCenter(
            documentHistory("Undo"),
          ),
        ]);
        await expect
          .poll(async () => (await editorDebug(page)).source)
          .toBe(authored);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `edits a locked curve point and subset, misses, undoes, and keeps editing in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}
\draw (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0) .. controls (11,4) and (13,4) .. (14,0) .. controls (15,-4) and (17,-4) .. (18,0);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await input.penStroke([await strokePoint(page, curve, 0.15)]);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const action = (name: string) => strip.getByRole("button", { name, exact: true });
        await input.penStroke([await stableCenter(action("Lock"))]);
        await expect(action("Lock")).toHaveAttribute("aria-pressed", "true");
        await input.penStroke([await stableCenter(action("Edit Points"))]);
        const anchors = frame.locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]');
        await expect(anchors).toHaveCount(5);
        const pointAt = async (index: number) => {
          const boxes = await anchors.evaluateAll((nodes) => nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }).sort((a, b) => a.x - b.x));
          const iframe = (await page.locator('iframe[title="TikZ visual editor"]').boundingBox())!;
          return { x: iframe.x + boxes[index].x, y: iframe.y + boxes[index].y };
        };
        await input.penStroke([await pointAt(1)]);
        await expect(selectedPoints(frame)).toHaveCount(1);
        await expect(frame.locator('circle[data-handle-kind="move-handle"][data-source-id="path:0"]')).toHaveCount(2);
        await input.penStroke([await stableCenter(action("Corner"))]);
        await expect.poll(async () => (await editorDebug(page)).source).not.toBe(authored);
        await input.penStroke([(await emptyCanvasGesture(frame))[0]]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        await input.penStroke([await stableCenter(documentHistory("Undo"))]);
        await expect.poll(async () => (await editorDebug(page)).source).toBe(authored);
        await editorReady(page);
        // The step changed the cornered point, which stays selected (FR-054).
        await expect(selectedPoints(frame)).toHaveCount(1);
        await input.penStroke([await pointAt(2)]);
        await expect(selectedPoints(frame)).toHaveCount(2);
        await input.penStroke([await stableCenter(action("Delete"))]);
        await expect.poll(async () => (await editorDebug(page)).source).not.toBe(authored);
        await input.penStroke([await stableCenter(documentHistory("Undo"))]);
        await expect.poll(async () => (await editorDebug(page)).source).toBe(authored);
        await editorReady(page);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
        // The Undo restored the two deleted points, which stay selected (FR-054); a tap adds a third.
        await expect(selectedPoints(frame)).toHaveCount(2);
        await input.penStroke([await pointAt(3)]);
        await expect(selectedPoints(frame)).toHaveCount(3);
        await input.penStroke([await stableCenter(action("Done"))]);
        await expect(action("Edit Points")).toBeVisible();
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `selects what Undo and Redo changed, and nothing when a step or a Code edit removes the selection, in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,2);
\draw (4,0) -- (6,2);
\end{tikzpicture}`;
        await author(authored);
        const frame = editorFrame(page);
        const rectangle = frame.locator('svg [data-source-id="path:0"]').first();
        const line = frame.locator('svg [data-source-id="path:1"]').first();
        await expect(line).toBeAttached();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const selection = async () => [...(await editorDebug(page)).selection];
        const source = async () => (await editorDebug(page)).source;
        const history = async (name: "Undo" | "Redo", after: string) => {
          await input.penStroke([await stableCenter(documentHistory(name))]);
          await expect.poll(source).toBe(after);
          await editorReady(page);
        };
        const tapEmptyCanvas = async () => input.penStroke(await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]));

        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, rectangle, 0.1)]);
        await expect.poll(selection).toEqual(["path:0"]);
        await input.penStroke([await stableCenter(strip.getByRole("button", { name: "More", exact: true }))]);
        await input.penStroke([await stableCenter(frame.getByRole("menuitem", { name: /^Transform/ }))]);
        await input.penStroke([await stableCenter(frame.getByRole("menu").last().getByRole("menuitem", { name: "Rotate Right 90°", exact: true }))]);
        await expect.poll(source).toMatch(/rotate/);
        const rotated = await source();
        await input.penStroke([await strokePoint(page, line, 0.5)]);
        await expect.poll(selection).toEqual(["path:1"]);
        // Undo and Redo select the rectangle that the step changed, whatever was selected before (FR-054).
        await history("Undo", authored);
        await expect.poll(selection).toEqual(["path:0"]);
        await tapEmptyCanvas();
        await expect.poll(selection).toEqual([]);
        await history("Redo", rotated);
        await expect.poll(selection).toEqual(["path:0"]);

        // Undo of a drawn stroke leaves nothing selected, though the stroke was selected.
        await chooseTool(frame, input, "Pen");
        await input.penStroke(await emptyCanvasGesture(frame, Array.from({ length: 16 }, (_, i) => ({ x: -i * 6, y: i * 2 + Math.sin(i) * 3 }))));
        await expect.poll(async () => (await source()).match(/\\draw/gu)?.length).toBe(3);
        const stroked = await source();
        // The stroke is the one rendered object besides the rectangle and the line.
        const drawn = frame.locator('svg [data-source-id]:not([data-source-id="path:0"]):not([data-source-id="path:1"])').first();
        await expect(drawn).toBeAttached();
        const strokeId = (await drawn.getAttribute("data-source-id"))!;
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([await strokePoint(page, drawn, 0.5)]);
        await expect.poll(selection).toEqual([strokeId]);
        await history("Undo", rotated);
        await expect.poll(selection).toEqual([]);
        await history("Redo", stroked);
        await expect.poll(selection).toEqual([strokeId]);

        // A Code edit that removes the selected object leaves nothing selected, and Properties shows the figure (FR-060a).
        await input.penStroke([await strokePoint(page, line, 0.5)]);
        await expect.poll(selection).toEqual(["path:1"]);
        const properties = sidePanel(frame, "Properties");
        if (!(await properties.isVisible())) await input.touch([await stableCenter(documentPanelButton("Properties"))]);
        await expect(properties.getByText(/^Selected /u)).toBeVisible();
        await author(stroked.replace("\\draw (4,0) -- (6,2);\n", ""));
        await expect.poll(selection).toEqual([]);
        await storyScreenshot(page, `selection-after-code-edit-${tablet.name}`);
        if (!(await properties.isVisible())) await input.touch([await stableCenter(documentPanelButton("Properties"))]);
        await expect(properties.getByText("Figure Bounds", { exact: true })).toBeVisible();
        await storyScreenshot(page, `selection-after-history-${tablet.name}`);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `aligns and distributes three selected objects as separate undo steps in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzpicture}
\draw (2,2) circle (1);
\draw (5,4) circle (1);
\draw (10,3) circle (1);
\end{tikzpicture}`;
        await pasteCode(page, authored);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const boxes = await Promise.all([0, 1, 2].map((index) => frame.locator(`svg [data-source-id="path:${index}"]`).first().boundingBox()));
        const left = Math.min(...boxes.map((box) => box!.x)) - 12;
        const right = Math.max(...boxes.map((box) => box!.x + box!.width)) + 12;
        const top = Math.min(...boxes.map((box) => box!.y)) - 12;
        const bottom = Math.max(...boxes.map((box) => box!.y + box!.height)) + 12;
        await chooseTool(frame, input, "Lasso");
        await input.penStroke([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top + 1 }]);
        const selected = async () => [...(await editorDebug(page)).selection].sort();
        await expect.poll(selected).toEqual(["path:0", "path:1", "path:2"]);
        await chooseTool(frame, input, "Lasso");
        await input.touch([await stableCenter(documentPanelButton("Properties"))]);
        const properties = frame.getByRole("complementary", { name: "Properties", exact: true });
        await expect(properties.getByText("3 selected objects", { exact: true })).toBeVisible();
        await expect(properties.getByText("Selected objects", { exact: true })).toBeVisible();
        await input.touch([await stableCenter(documentPanelButton("Properties"))]);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const source = async () => (await editorDebug(page)).source;
        // Undo selects the circles that the step moved (FR-054).
        const command = async (group: string, name: string, moved: string[]) => {
          await input.penStroke([await stableCenter(strip.getByRole("button", { name: group, exact: true }))]);
          await input.penStroke([await stableCenter(frame.getByRole("menu").last().getByRole("menuitem", { name, exact: true }))]);
          await expect.poll(source).not.toBe(authored);
          await input.penStroke([await stableCenter(documentHistory("Undo"))]);
          await expect.poll(source).toBe(authored);
          await editorReady(page);
          await expect.poll(selected).toEqual(moved);
        };
        await command("Align", "Left", ["path:1", "path:2"]);
        await input.penStroke([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top + 1 }]);
        await expect.poll(selected).toEqual(["path:0", "path:1", "path:2"]);
        await command("Distribute", "Horizontal", ["path:1"]);
        await input.penStroke([(await emptyCanvasGesture(frame))[0]]);
        await expect.poll(selected).toEqual([]);
        await input.penStroke([await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.15)]);
        await expect.poll(selected).toEqual(["path:0"]);
        await input.penStroke([await stableCenter(strip.getByRole("button", { name: "More", exact: true }))]);
        await input.penStroke([await stableCenter(frame.getByRole("menuitem", { name: /^Reorder/ }))]);
        await input.penStroke([await stableCenter(frame.getByRole("menuitem", { name: "Bring to Front", exact: true }))]);
        await expect.poll(source).not.toBe(authored);
        const ordered = await source();
        assert.ok(ordered.indexOf("(2,2) circle") > ordered.indexOf("(10,3) circle"), ordered);
        await input.penStroke([await stableCenter(documentHistory("Undo"))]);
        await expect.poll(source).toBe(authored);
        await editorReady(page);
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ["touch", "pen"] as const) {
      story(
        { viewport: tablet },
        `deletes a chosen subset of a curve's points by ${contact} in ${tablet.name}`,
        async function () {
          await editorReady(page);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await pasteCode(page, String.raw`\begin{tikzpicture}
          \draw (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0) .. controls (11,4) and (13,4) .. (14,0) .. controls (15,-4) and (17,-4) .. (18,0);
          \end{tikzpicture}`);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          const frame = editorFrame(page);
          const curve = frame.locator('svg [data-source-id="path:0"]').first();
          await expect(curve).toBeVisible();
          const input = await TabletInput.attach(page);
          await fitDiagram(frame, input);
          const frameBox = (await page
            .locator('iframe[title="TikZ visual editor"]')
            .boundingBox())!;
          const tap = async (point: { x: number; y: number }) =>
            contact === "touch" ? input.touch([point]) : input.penStroke([point]);
          await chooseTool(frame, input, "Lasso");
          const onCurve = await curve.evaluate((path: SVGGeometryElement) => {
            const p = path.getPointAtLength(path.getTotalLength() * 0.15);
            const m = path.getScreenCTM()!;
            return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
          });
          await tap({ x: frameBox.x + onCurve.x, y: frameBox.y + onCurve.y });
          await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
          await input.touch([
            await stableCenter(frame.getByRole("button", { name: "Edit Points", exact: true })),
          ]);
          await expect(frame.getByRole("button", { name: "Done", exact: true })).toBeVisible();
          await storyScreenshot(page, `curve-actions-${contact}-${tablet.name}`);
          const anchors = frame.locator(
            'rect[data-handle-kind="move-handle"][data-source-id="path:0"]',
          );
          const points = await anchors.evaluateAll((nodes) =>
            nodes
              .map((node) => {
                const box = node.getBoundingClientRect();
                return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
              })
              .sort((a, b) => a.x - b.x),
          );
          assert.ok(points.length >= 5, `anchors: ${points.length}`);
          for (const point of [points[1], points[2]]) {
            await tap({ x: frameBox.x + point.x, y: frameBox.y + point.y });
          }
          await expect(selectedPoints(frame)).toHaveCount(2);
          await input.touch([
            await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Delete", exact: true })),
          ]);
          await expect
            .poll(
              async () => ((await editorDebug(page)).source.match(/\.\. controls/g) ?? []).length,
            )
            .toBe(2);
          assert.match((await editorDebug(page)).source, /\(2,0\)[\s\S]*\(14,0\)[\s\S]*\(18,0\)/);
          assert.doesNotMatch((await editorDebug(page)).source, /\(6,0\)|\(10,0\)/);
        },
      );
    }
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `starts with the origin visible and clear of the rail, before and after the code pane opens, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const origin = frame.locator("text", { hasText: "(0,0)" }).first();
        const rail = drawingToolbar(frame);
        for (const moment of ["at startup", "after the code pane opens"]) {
          if (moment !== "at startup") {
            await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
            await expect(page.locator(".cm-content")).toBeVisible();
          }
          const [label, railBox] = [await settledCenter(origin), (await rail.boundingBox())!];
          const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
          assert.ok(
            label.x > viewport.x &&
              label.x < viewport.x + viewport.width &&
              label.y > viewport.y &&
              label.y < viewport.y + viewport.height,
            `origin ${moment} is off the canvas`,
          );
          const underRail =
            label.x >= railBox.x &&
            label.x <= railBox.x + railBox.width &&
            label.y >= railBox.y &&
            label.y <= railBox.y + railBox.height;
          assert.ok(!underRail, `origin ${moment} is under the rail`);
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    for (const contact of ["touch", "pen"] as const) {
      story(
        { viewport: tablet },
        `edits a curve point from the curve's own control by ${contact} in ${tablet.name}`,
        async function () {
          await editorReady(page);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          await pasteCode(page, String.raw`\begin{tikzpicture}
          \draw (2,0) .. controls (3,4) and (5,4) .. (6,0) .. controls (7,-4) and (9,-4) .. (10,0) .. controls (11,4) and (13,4) .. (14,0);
          \end{tikzpicture}`);
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
          const frame = editorFrame(page);
          const curve = frame.locator('svg [data-source-id="path:0"]').first();
          await expect(curve).toBeVisible();
          const input = await TabletInput.attach(page);
          await fitDiagram(frame, input);
          const tap = async (point: { x: number; y: number }) =>
            contact === "touch" ? input.touch([point]) : input.penStroke([point]);
          await chooseTool(frame, input, "Lasso");
          await tap(await strokePoint(page, curve, 0.15));
          await expect.poll(async () => (await editorDebug(page)).selection).toEqual(["path:0"]);
          await tap(await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Edit Points", exact: true })));
          const pointAt = async (x: number) => {
            const frameBox = (await page
              .locator('iframe[title="TikZ visual editor"]')
              .boundingBox())!;
            // Anchors are the square handles; round ones are control points.
            const anchors = await frame
              .locator('rect[data-handle-kind="move-handle"][data-source-id="path:0"]')
              .evaluateAll((nodes) =>
                nodes
                  .map((node) => {
                    const box = node.getBoundingClientRect();
                    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                  })
                  .sort((a, b) => a.x - b.x),
              );
            return { x: frameBox.x + anchors[x].x, y: frameBox.y + anchors[x].y };
          };
          await tap(await pointAt(1));
          await expect(selectedPoints(frame)).toHaveCount(1);
          for (const name of ["Corner", "Smooth", "Delete", "Split"]) {
            await expect(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name, exact: true })).toBeVisible();
          }
          await storyScreenshot(page, `point-selected-${contact}-${tablet.name}`);
          await expect(
            frame.getByRole("button", { name: "Point actions", exact: true }),
          ).toHaveCount(0);
          await input.longPress(await pointAt(1));
          await expect(frame.getByRole("menu")).toHaveCount(0);
          await expect(
            frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Corner", exact: true }),
          ).toBeVisible();
          const before = (await editorDebug(page)).source;
          await input.touch([
            await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Corner", exact: true })),
          ]);
          await expect.poll(async () => (await editorDebug(page)).source).not.toBe(before);
          assert.match((await editorDebug(page)).source, /\(6,0\)/);
          // The point stays chosen after a point command.
          await expect(selectedPoints(frame)).toHaveCount(1);
          await input.touch([
            await stableCenter(frame.getByRole("toolbar", { name: "Selection", exact: true }).getByRole("button", { name: "Delete", exact: true })),
          ]);
          await expect.poll(async () => (await editorDebug(page)).source).not.toMatch(/\(6,0\)/);
        },
      );
    }
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `a double tap on a curve enters point editing, a double tap on the curve there adds a point, and a double tap off the curve leaves, in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (2,0) .. controls (6,8) and (10,8) .. (14,0);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        const curve = frame.locator('svg [data-source-id="path:0"]').first();
        await expect(curve).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Lasso");
        const menu = frame.getByRole("toolbar", { name: "Selection", exact: true });
        const segments = async () => ((await editorDebug(page)).source.match(/\.\. controls/g) ?? []).length;
        const penTap = async (point: Point) => input.penStroke([point]);
        // Each contact adds its point at its own place: a double tap on a point that is already there adds none.
        const contacts: [(point: Point) => Promise<void>, number][] = [
          [(point) => input.doubleTap(point), 0.6],
          [
            async (point) => {
              await penTap(point);
              await new Promise((resolve) => setTimeout(resolve, 80));
              await penTap(point);
            },
            0.4,
          ],
        ];
        for (const [doubleTap, along] of contacts) {
          const before = await segments();
          // The first tap selects the curve; the second makes the pair a double tap, which opens its points.
          await doubleTap(await strokePoint(page, curve, 0.25));
          await expect(menu.getByRole("button", { name: "Done", exact: true })).toBeVisible();
          assert.deepEqual((await editorDebug(page)).selection, ["path:0"]);
          assert.equal(await segments(), before, "the double tap that opens the points of a curve added a point to it");
          // In point editing a double tap on the curve adds a point there, as a double-click does in Inkscape's node tool.
          await doubleTap(await strokePoint(page, curve, along));
          await expect.poll(segments).toBe(before + 1);
          await expect(menu.getByRole("button", { name: "Done", exact: true })).toBeVisible();
          // A double tap off the curve leaves point editing and keeps the curve selected.
          await doubleTap((await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0]);
          await expect(menu.getByRole("button", { name: "Edit Points", exact: true })).toBeVisible();
          assert.deepEqual((await editorDebug(page)).selection, ["path:0"]);
        }
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps an original stroke as an editable curve whose points are counted in ${tablet.name}`,
      async function () {
        await editorReady(page);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        const viewport = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.penStroke(waveAcross(viewport, 0.45, 0.4, 120));
        await expect.poll(async () => (await editorDebug(page)).source).toMatch(/\\draw/);
        // The source has the stroke before the canvas has drawn it.
        await expect(frame.locator("svg [data-source-id]").first()).toBeAttached();
        const drawn = await frame
          .locator("svg [data-source-id]")
          .evaluateAll((nodes) => [
            ...new Set(nodes.map((node) => node.getAttribute("data-source-id"))),
          ]);
        assert.equal(drawn.length, 1);
        // A lasso selects the whole curve: a tap on so dense a stroke lands on one of its points.
        const box = (await frame.locator(`svg [data-source-id="${drawn[0]}"]`).first().boundingBox())!;
        const pad = 24;
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "Lasso", exact: true })),
        ]);
        await input.penStroke([
          { x: box.x - pad, y: box.y - pad },
          { x: box.x + box.width + pad, y: box.y - pad },
          { x: box.x + box.width + pad, y: box.y + box.height + pad },
          { x: box.x - pad, y: box.y + box.height + pad },
          { x: box.x - pad, y: box.y - pad + 1 },
        ]);
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([drawn[0]]);
        await chooseTool(frame, input, "Lasso");
        const anchors = frame.locator(
          `rect[data-handle-kind="move-handle"][data-source-id="${drawn[0]}"]`,
        );
        await expect(anchors.first()).toBeVisible();
        const count = await anchors.count();
        assert.equal(
          count,
          ((await editorDebug(page)).source.match(/--|\.\. controls/g) ?? []).length + 1,
        );
      },
    );

    story(
      { viewport: tablet },
      `reaches edit commands by pen from the selection control in ${tablet.name}`,
      async function () {
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, String.raw`\begin{tikzpicture}
        \draw (4,-2) circle (2cm);
        \draw (10,-4) rectangle (14,0);
        \end{tikzpicture}`);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const frame = editorFrame(page);
        await expect(frame.locator('svg [data-source-id="path:1"]').first()).toBeVisible();
        const input = await TabletInput.attach(page);
        await fitDiagram(frame, input);
        const penTap = async (point: { x: number; y: number }) => input.penStroke([point]);
        await penTap(
          await stableCenter(toolbarItem(frame, "Lasso")),
        );
        await penTap(
          await strokePoint(page, frame.locator('svg [data-source-id="path:0"]').first(), 0.5),
        );
        await penTap(
          await stableCenter(frame.getByRole("button", { name: "More", exact: true })),
        );
        // More holds Cut, Copy, Paste, and Delete; Duplicate is on the Object menu itself (contracts/surfaces.md).
        const menu = frame.getByRole("menu").first();
        for (const name of ["Cut", "Copy", "Paste", "Delete"]) {
          await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
        }
        await penTap(await stableCenter(menu.getByRole("menuitem", { name: "Copy", exact: true })));
        await expect(menu).toHaveCount(0);
        const strip = frame.getByRole("toolbar", { name: "Selection", exact: true });
        await penTap(await stableCenter(strip.getByRole("button", { name: "Duplicate", exact: true })));
        const circles = async () => [...(await editorDebug(page)).source.matchAll(/circle/g)].length;
        await expect.poll(circles).toBe(2);
        await penTap(await stableCenter(strip.getByRole("button", { name: "More", exact: true })));
        await penTap(await stableCenter(menu.getByRole("menuitem", { name: "Delete", exact: true })));
        await expect.poll(circles).toBe(1);
      },
    );
  }

  it("copies the final drawing immediately after switching to rendered view", async function () {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("before drawing"));
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    const canvas = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.4 + 90, canvas.y + canvas.height / 2 + 25, {
      steps: 12,
    });
    const render = (await page
      .getByRole("button", { name: "Preview: right sidebar", exact: true })
      .boundingBox())!;
    const share = (await barMenu("share").button.boundingBox())!;
    await page.mouse.up();
    // Use the observed button positions: locator stability waits can let the
    // editor's throttled change notification arrive before this rapid sequence.
    await page.mouse.click(render.x + render.width / 2, render.y + render.height / 2);
    await page.mouse.click(share.x + share.width / 2, share.y + share.height / 2);
    await page.evaluate(() => {
      [...document.querySelectorAll<HTMLElement>('.document-bar [role="menuitem"]')]
        .find((item) => item.textContent?.trim() === "Copy TikZ")!
        .click();
    });
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("workbench-ink:");
    const authored = String.raw`\begin{tikzpicture}\draw[red] (0,0) rectangle (4,3);\end{tikzpicture}`;
    await pasteCode(page, authored);
    await copyTikz();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(authored);
  });

  it("copies the completed Quiver edit immediately after switching to rendered view", async function () {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await pasteCode(page, String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`);
    const frame = page.frameLocator('iframe[title="Quiver diagram editor"]');
    await frame.locator(".vertex").nth(1).click();
    await frame.locator(".label-input").evaluate(async (input: HTMLInputElement) => {
      input.value = "ClipboardFinal";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const shell = window.parent.document;
      const buttons = [...shell.querySelectorAll("button")];
      buttons.find((button) => button.getAttribute("aria-label") === "Preview: right sidebar")!.click();
      // The list of Share and Export is in the page one task after the press on its button.
      buttons.find((button) => button.getAttribute("aria-label") === "Share and Export")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      [...shell.querySelectorAll<HTMLElement>('.document-bar [role="menuitem"]')]
        .find((item) => item.textContent?.trim() === "Copy TikZ")!
        .click();
    });
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("ClipboardFinal");
    const newer = String.raw`\begin{tikzcd}NewerAuthored \arrow[r] & Source\end{tikzcd}`;
    await pasteCode(page, newer);
    await copyTikz();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(newer);
  });

  story(
    {},
    "matches compiled geometry for filled primitives and transformed curves",
    async function () {
      const examples = [
        String.raw`\begin{tikzpicture}\fill[blue] (0,0) rectangle (3,2);\fill[red] (4,1) circle (.5cm);\end{tikzpicture}`,
        String.raw`\begin{tikzpicture}\begin{scope}[rotate=25]\fill[blue] (0,0) ellipse (2cm and 1cm);\end{scope}\fill[red] (3,1) rectangle (4,2);\end{tikzpicture}`,
      ];
      for (const authored of examples) {
        await page.goto(url);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await author(authored);
        const visualSvg = (await canvasSnapshot()).svg;
        await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
        await expect(page.locator(".tikz-view-status")).toContainText("Up to date", {
          timeout: 40000,
        });
        const compiledUri = await page.locator(".tikz-figure-viewer-source").getAttribute("src");
        assert.ok(compiledUri !== null);
        const difference = await page.evaluate(
          async ({ visualSvg, compiledUri }) => {
            const masks: number[][] = [];
            const aspectRatios: number[] = [];
            for (const uri of [
              `data:image/svg+xml;charset=utf-8,${encodeURIComponent(visualSvg)}`,
              compiledUri,
            ]) {
              const image = new Image();
              image.src = uri;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 512;
              const context = canvas.getContext("2d")!;
              const scale = Math.min(512 / image.naturalWidth, 512 / image.naturalHeight);
              context.drawImage(
                image,
                0,
                0,
                image.naturalWidth * scale,
                image.naturalHeight * scale,
              );
              const pixels = context.getImageData(0, 0, 512, 512).data;
              const mask = Array.from({ length: 512 * 512 }, (_, i) => {
                const r = pixels[i * 4],
                  g = pixels[i * 4 + 1],
                  b = pixels[i * 4 + 2];
                return pixels[i * 4 + 3] < 128
                  ? 0
                  : r > 150 && g < 80 && b < 80
                    ? 1
                    : b > 150 && r < 80 && g < 80
                      ? 2
                      : 0;
              });
              const occupied = mask.flatMap((value, i) => (value ? [i] : []));
              if (occupied.length === 0) {
                throw new Error("The rendered diagram has no expected coloured geometry");
              }
              let left = 511,
                right = 0,
                top = 511,
                bottom = 0;
              for (const i of occupied) {
                left = Math.min(left, i % 512);
                right = Math.max(right, i % 512);
                top = Math.min(top, Math.floor(i / 512));
                bottom = Math.max(bottom, Math.floor(i / 512));
              }
              aspectRatios.push((right - left) / (bottom - top));
              masks.push(
                Array.from({ length: 128 * 128 }, (_, i) => {
                  const x = Math.round(left + ((i % 128) * (right - left)) / 127);
                  const y = Math.round(top + (Math.floor(i / 128) * (bottom - top)) / 127);
                  return mask[y * 512 + x];
                }),
              );
            }
            const [visual, compiled] = masks;
            return {
              shape: visual.filter((value, i) => value !== compiled[i]).length / visual.length,
              aspect: Math.abs(aspectRatios[0] / aspectRatios[1] - 1),
            };
          },
          { visualSvg, compiledUri },
        );
        assert.ok(
          difference.shape < 0.03,
          `Visual and compiled coloured geometry differ at ${difference.shape * 100}% of normalized pixels`,
        );
        assert.ok(
          difference.aspect < 0.03,
          `Visual and compiled aspect ratios differ by ${difference.aspect * 100}%`,
        );
      }
    },
  );

  story(
    {},
    "keeps each representative trace as drawn, and simplifies and restores it within its error",
    async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const cdp = await context.newCDPSession(page);
      const viewport = frame.locator('[data-canvas-viewport="true"]');
      const restore = frame.getByRole("button", { name: "Restore Original Stroke", exact: true });
      const currentSource = async () => (await editorDebug(page)).source;
      // The whole width goes to the canvas.
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      // The corpus measures the fitter on the drawn samples, so no snap moves a stroke's ends.
      await setSnapRule(frame, input, "Lattice", false);
      await setSnapRule(frame, input, "Objects", false);
      await frame.locator("body").evaluate(() => {
        window.receivedPen = [];
        for (const kind of ["pointerdown", "pointermove", "pointerup"]) {
          window.addEventListener(
            kind,
            (event) => {
              const pointer = event as PointerEvent;
              if (pointer.pointerType !== "pen") {
                return;
              }
              const coalesced = pointer.getCoalescedEvents();
              for (const sample of coalesced.length ? coalesced : [pointer]) {
                window.receivedPen.push({
                  time: sample.timeStamp,
                  pressure: sample.pressure,
                  tiltX: sample.tiltX,
                  tiltY: sample.tiltY,
                });
              }
            },
            true,
          );
        }
      });
      for (const trace of geometryTraces) {
        await author(String.raw`\begin{tikzpicture}
% corpus authored comment
\end{tikzpicture}`);
        // 100% is the printed size, 96/72 px to the point. A view of 200% puts a few screen pixels on each
        // point and the whole trace, at most 140 pt across, on the canvas.
        const zoom = zoomControl(frame);
        await input.touch([await stableCenter(zoom)]);
        await input.touch([
          await stableCenter(frame.getByRole("button", { name: "200%", exact: true })),
        ]);
        await input.touch([await stableCenter(zoom)]);
        await expect(frame.getByRole("dialog", { name: "Tool options" })).toHaveCount(0);
        // A tap on empty canvas clears the selection, so each trace starts with none.
        await chooseTool(frame, input, "Lasso");
        await input.touch(await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]));
        await expect.poll(async () => (await editorDebug(page)).selection).toEqual([]);
        await chooseTool(frame, input, "Pen");
        await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
        // Screen pixels per point of the figure, from the canvas's own drawing surface.
        const pixelsPerPoint = await viewport.evaluate(
          (element) => element.querySelector<SVGSVGElement>("svg[viewBox]")!.getScreenCTM()!.a,
        );
        // The free canvas is the part above the floating rail.
        const box = (await viewport.boundingBox())!;
        const free = { x: box.x, y: box.y, width: box.width, height: (await drawingToolbar(frame).boundingBox())!.y - box.y };
        const xs = trace.points.map(([x]) => x),
          ys = trace.points.map(([, y]) => y);
        const middle = {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        };
        // The trace drawn about the canvas centre at the figure's scale; screen y runs down.
        const screen = trace.points.map(([x, y]) => ({
          x: free.x + free.width / 2 + (x - middle.x) * pixelsPerPoint,
          y: free.y + free.height / 2 - (y - middle.y) * pixelsPerPoint,
        }));
        assert.ok(
          pixelsPerPoint >= 1.5 &&
            screen.every(
              ({ x, y }) =>
                x > free.x && x < free.x + free.width && y > free.y && y < free.y + free.height,
            ),
          `${trace.name} at ${pixelsPerPoint} px/pt does not fit the free canvas ${JSON.stringify(free)}`,
        );
        await frame.locator("body").evaluate(() => {
          window.receivedPen.length = 0;
        });
        for (const [index, point] of screen.entries()) {
          await cdp.send("Input.dispatchMouseEvent", {
            type: index === 0 ? "mousePressed" : "mouseMoved",
            ...point,
            button: "left",
            buttons: 1,
            clickCount: index === 0 ? 1 : 0,
            pointerType: "pen",
            force: 0.4 + 0.1 * Math.sin(index),
            tiltX: 12,
            tiltY: -8,
          });
        }
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...screen.at(-1)!,
          button: "left",
          buttons: 0,
          clickCount: 1,
          pointerType: "pen",
        });
        await expect.poll(currentSource).toMatch(/workbench-ink-end:/);
        // A stroke stays as drawn (FR-025): its drawing is the recorded samples joined by straight segments.
        const drawn = await currentSource();
        const ink = (await canvasSnapshot()).originalInk;
        assert.equal(ink.length, 1, trace.name);
        const stroke = ink[0].stroke;
        // Every pen event's channels, in order, are in the record.
        assert.deepEqual(
          stroke.samples.map(({ time, pressure, tiltX, tiltY }) => ({ time, pressure, tiltX, tiltY })),
          await frame.locator("body").evaluate(() => window.receivedPen),
          trace.name,
        );
        // The recorded samples are the corpus trace, moved to where the pen drew it.
        const [first] = stroke.samples;
        for (const [index, [x, y]] of trace.points.entries()) {
          const sample = stroke.samples[index];
          assert.ok(
            Math.abs(sample.x - first.x - (x - trace.points[0][0])) < 0.5 &&
              Math.abs(sample.y - first.y - (y - trace.points[0][1])) < 0.5,
            `${trace.name}: sample ${index} at (${sample.x}, ${sample.y}) is off the trace`,
          );
        }
        const drawing = recordedDrawing(drawn);
        assert.deepEqual(
          [...drawing.matchAll(/\(([-\d.e]+)pt,([-\d.e]+)pt\)/g)].map(([, x, y]) => [
            Number(x),
            Number(y),
          ]),
          stroke.samples.map(({ x, y }) => [x, y]),
          `${trace.name} is drawn as ${drawing}`,
        );
        assert.doesNotMatch(drawing, / controls /, trace.name);
        // Simplify refits the stroke (FR-027); the accepted curve stays within the trace's error of the samples.
        const curve = frame.locator(`svg [data-source-id="${ink[0].sourceIds[0]}"]`).first();
        await simplifyStroke(frame, input, curve);
        const accepted = await canvasSnapshot();
        assert.equal(accepted.originalInk.length, 1, trace.name);
        const error = await page.evaluate(
          ({ svg, points, viewBox }) => {
            const holder = document.createElement("div");
            holder.style.cssText = "position:fixed;left:0;top:0;visibility:hidden";
            holder.innerHTML = svg;
            document.body.append(holder);
            const root = holder.querySelector("svg")!;
            const inverse = root.getScreenCTM()!.inverse();
            const rendered: { x: number; y: number }[] = [];
            for (const element of root.querySelectorAll<SVGGeometryElement>(
              "path,circle,ellipse,rect,line,polyline,polygon",
            )) {
              if (element.closest("defs")) {
                continue;
              }
              const length = element.getTotalLength();
              const transform = inverse.multiply(element.getScreenCTM()!);
              for (let d = 0; d <= length; d += 0.4) {
                rendered.push(element.getPointAtLength(d).matrixTransform(transform));
              }
              rendered.push(element.getPointAtLength(length).matrixTransform(transform));
            }
            holder.remove();
            const raw = points.map(([x, y]) => ({ x, y: 2 * viewBox.y + viewBox.height - y }));
            const inputError = Math.max(
              ...raw.map((p) => Math.min(...rendered.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))),
            );
            const outputError = Math.max(
              ...rendered.map((p) =>
                Math.min(
                  ...raw.slice(1).map((b, i) => {
                    const a = raw[i],
                      dx = b.x - a.x,
                      dy = b.y - a.y;
                    const t = Math.max(
                      0,
                      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
                    );
                    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
                  }),
                ),
              ),
            );
            return Math.max(inputError, outputError);
          },
          {
            svg: accepted.svg,
            points: stroke.samples.map(({ x, y }): [number, number] => [x, y]),
            viewBox: accepted.viewBox,
          },
        );
        assert.ok(
          error <= trace.error + 0.3,
          `${trace.name}: bidirectional geometric error ${error} exceeds ${trace.error} for samples ${JSON.stringify(stroke.samples.map(({ x, y }) => [x, y]))} simplified to ${recordedDrawing(accepted.source)}`,
        );
        // Restore Original Stroke returns the source as drawn.
        await chooseTool(frame, input, "Lasso");
        const simplified = frame
          .locator(`svg [data-source-id="${accepted.originalInk[0].sourceIds[0]}"]`)
          .first();
        await input.touch([await strokePoint(page, simplified, 0.3)]);
        // A tap that lands on an anchor of a short stroke selects that point; Done returns to the stroke.
        const whole = frame.getByRole("button", { name: "Done", exact: true });
        if (await whole.isVisible()) {
          await input.touch([await stableCenter(whole)]);
        }
        await input.touch([await stableCenter(restore)]);
        await expect.poll(currentSource, { message: trace.name }).toBe(drawn);
      }
    },
  );

  it("rejects a source notification from the right frame but the wrong session", async function () {
    await page.addInitScript(() => {
      window.addEventListener("message", (event) => {
        const message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (message?.event === "loaded") {
          (window as unknown as { editorLoad: { revision: number } }).editorLoad = message;
        }
      });
    });
    await page.reload();
    await editorReady(page);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    const authored = await page
      .locator(".cm-content .cm-line")
      .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n"));
    const loaded = await page.evaluate(
      () => (window as unknown as { editorLoad: { revision: number } }).editorLoad,
    );
    await page.frames()[1].evaluate(({ revision }) => {
      window.parent.postMessage(
        JSON.stringify({
          event: "change",
          sessionId: crypto.randomUUID(),
          revision,
          source: String.raw`\begin{tikzpicture}\draw (0,0) rectangle (3,2);\end{tikzpicture}`,
        }),
        location.origin,
      );
    }, loaded);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      await page
        .locator(".cm-content .cm-line")
        .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")),
      authored,
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await copyTikz();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(authored);
    assert.equal(
      await page
        .locator(".cm-content .cm-line")
        .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")),
      authored,
    );
  });

  story(
    { initialPage: "blank" },
    "starts cold and edits math-labelled geometry without external assets",
    async function () {
      const external: string[] = [];
      await context.route("**/*", (route) => {
        if (new URL(route.request().url()).origin === new URL(url).origin) {
          return route.continue();
        }
        external.push(route.request().url());
        return route.abort();
      });
      await page.goto(url);
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      await editorReady(page);
      await pasteCode(page, String.raw`\begin{tikzpicture}
      \node at (0,0) {$x^2$};
      \draw[blue] (0,0) rectangle (2,1);
      \end{tikzpicture}`);
      const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
      await expect(frame.locator('[data-canvas-viewport="true"]')).toBeVisible();
      await expect.poll(() => frame.locator("[data-source-id]").count()).toBeGreaterThan(1);
      await editorReady(page);
      await chooseTool(frame, "mouse", "Pen");
      const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.55 + 90, box.y + box.height * 0.3 + 25, {
        steps: 12,
      });
      await page.mouse.up();
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await copyTikz();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toMatch(/workbench-ink:/);
      await expect(frame.locator("[data-source-id]")).not.toHaveCount(0);
      assert.deepEqual(external, []);
    },
  );

  it("keeps authored source when a notification names a load operation", async function () {
    const sourcePane = page.locator(".cm-content");
    await pasteCode(page, String.raw`\begin{tikzpicture}
    \draw (0,0) circle (1cm);
    \end{tikzpicture}`);
    await editorReady(page);
    const authored = await sourcePane.innerText();
    await page.evaluate(() => {
      const editor = document.querySelector<HTMLIFrameElement>("iframe")!;
      editor.contentWindow!.postMessage(
        {
          event: "load",
          revision: 2,
          source: String.raw`\begin{tikzpicture}\draw (0,0) rectangle (2,1);\end{tikzpicture}`,
        },
        location.origin,
      );
    });
    // The old bridge throttles source notifications by 250 ms. Observe beyond
    // that delivery window, then use the canvas again to catch hidden mutation.
    await page.waitForTimeout(600);
    assert.equal(await sourcePane.innerText(), authored);
    const frame = editorFrame(page);
    await documentPanelButton("Properties").click();
    await expect(frame.getByRole("complementary", { name: "Properties" })).toBeVisible();
    await frame.getByRole("button", { name: "Close properties", exact: true }).click();
    await expect(frame.getByRole("complementary", { name: "Properties" })).toHaveCount(0);
    // Properties closed the Code panel: one panel is open at a time (FR-060).
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await expect(sourcePane).toBeVisible();
    assert.equal(await sourcePane.innerText(), authored);
  });

  story({}, "keeps the drawing when another frame sends an explicit load command", async function () {
    await author(circleFigure);
    const accepted = await canvasSnapshot();
    await page.evaluate(async () => {
      const sibling = document.createElement("iframe");
      sibling.name = "unrelated-frame";
      sibling.src = "about:blank";
      const loaded = new Promise((resolve) =>
        sibling.addEventListener("load", resolve, { once: true }),
      );
      document.body.append(sibling);
      await loaded;
    });
    const sibling = page.frame({ name: "unrelated-frame" })!;
    await sibling.evaluate(({ sessionId, revision }) => {
      parent.document
        .querySelector<HTMLIFrameElement>('iframe[title="TikZ visual editor"]')!
        .contentWindow!.postMessage(
          {
            action: "load",
            sessionId,
            revision: revision + 1,
            requestId: crypto.randomUUID(),
            fileName: "fixture.tikz",
            autosave: 0,
            source: String.raw`\begin{tikzpicture}\draw (0,0) rectangle (2,1);\end{tikzpicture}`,
          },
          parent.location.origin,
        );
    }, accepted);
    const retained = await canvasSnapshot();
    assert.equal(retained.source, accepted.source);
    assert.equal(retained.svg, accepted.svg);
    await expect.poll(storedSource).toBe(circleFigure);
  });

  story(
    { viewport: { width: 768, height: 1024 } },
    "opens a tablet canvas, shows Code and Properties one at a time, and copies the source",
    async function () {
      await editorReady(page);
      const sourcePane = page.locator(".cm-content");
      await expect(sourcePane).toBeHidden();
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      const source = String.raw`\begin{tikzpicture}
% Keep this authored comment.
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;
      await pasteCode(page, source);
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      const frame = editorFrame(page);
      await documentPanelButton("Properties").click();
      await expect(frame.getByRole("complementary", { name: "Properties" })).toBeVisible();
      await page.screenshot({ path: "test-results/workbench/tablet-properties.png" });
      await expect(sourcePane).toBeHidden();
      // Code and Properties are panels, one open at a time (FR-060).
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      assert.equal(await sourcePane.innerText(), source);
      await expect(frame.getByRole("complementary", { name: "Properties" }), "Properties stayed open beside Code").toHaveCount(0);
      await documentPanelButton("Properties").click();
      await expect(frame.getByRole("complementary", { name: "Properties" })).toBeVisible();
      await expect(sourcePane, "Code stayed open beside Properties").toBeHidden();
      await frame.getByRole("button", { name: "Close properties", exact: true }).click();
      await expect(frame.getByRole("complementary", { name: "Properties" })).toHaveCount(0);
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const writes: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET") {
          writes.push(request.url());
        }
      });
      await copyTikz();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
      // Copy TikZ writes no file of the document. The panels opened above write the preferences and the
      // view state a moment after, and a page reports its console to the launch log; none is the document.
      assert.deepEqual(
        writes.filter((url) => !/\/api\/(preferences|view-state|log)$/.test(new URL(url).pathname)),
        [],
      );
      await sourcePane.press("Control+z");
      await expect(sourcePane).not.toHaveText(source);
    },
  );

  story({}, "returns a revision-matched drawing of the authored source", async function () {
    const initial = await canvasSession();
    const source = String.raw`\begin{tikzpicture}
% preserve authored bytes
\draw[red] (0,0) rectangle (3,2);
\end{tikzpicture}`;
    await author(source);
    const result = await canvasSnapshot();
    assert.equal(result.source, source);
    // A Code edit replaces the source in the canvas's session (research R3).
    assert.equal(result.revision, initial.revision);
    assert.equal(result.revision, (await canvasSession()).revision);
    assert.ok(result.localBounds, "The accepted drawing includes its local placement bounds");
    assert.ok(Math.abs(result.localBounds.maxX - result.localBounds.minX - 85.358) < 1);
    assert.ok(Math.abs(result.localBounds.maxY - result.localBounds.minY - 56.906) < 1);
    const drawing = await page.evaluate((svg) => {
      const document = new DOMParser().parseFromString(svg, "image/svg+xml");
      return {
        paths: [...document.querySelectorAll("path")].map((path) => path.getAttribute("d")),
        errors: document.querySelectorAll("parsererror").length,
      };
    }, result.svg);
    assert.equal(drawing.errors, 0);
    assert.ok(
      drawing.paths.some((path) => path !== null && path.includes("85.358")),
      "The exported view must contain the authored 3cm rectangle",
    );
    await page.screenshot({ path: "test-results/workbench/canvas-snapshot.png" });
  });

  story({}, "replies consistently when a completed snapshot request is repeated", async function () {
    await author(circleFigure);
    const accepted = await canvasSnapshot();
    await page.evaluate((id) => {
      delete window.canvasProtocol.snapshots[id];
    }, accepted.requestId);
    await postCanvasCommand({
      action: "snapshot",
      sessionId: accepted.sessionId,
      revision: accepted.revision,
      requestId: accepted.requestId,
      source: accepted.source,
    });
    assert.deepEqual(await canvasSnapshotReply(accepted.requestId), accepted);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await copyTikz();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(accepted.source);
  });

  story({}, "retains the current drawing when a load of no newer revision arrives from the shell", async function () {
    await author(String.raw`\begin{tikzpicture}
\draw[red] (0,0) rectangle (3,2);
\end{tikzpicture}`);
    const accepted = await canvasSnapshot();
    await postCanvasCommand({
      action: "load",
      sessionId: accepted.sessionId,
      revision: accepted.revision,
      requestId: randomUUID(),
      fileName: "fixture.tikz",
      autosave: 0,
      source: String.raw`\begin{tikzpicture}\draw (0,0) circle (1cm);\end{tikzpicture}`,
    });
    const retained = await canvasSnapshot();
    assert.equal(retained.source, accepted.source);
    assert.equal(retained.svg, accepted.svg);
  });

  story(
    {},
    "keeps exported clipping local to each independently edited diagram",
    async function () {
      const exports: string[] = [];
      for (const source of [
        String.raw`\begin{tikzpicture}\clip (0,0) circle (.5);\fill[red] (-1,-1) rectangle (1,1);\end{tikzpicture}`,
        String.raw`\begin{tikzpicture}\clip (0,0) rectangle (1,1);\fill[blue] (-1,-1) rectangle (1,1);\end{tikzpicture}`,
      ]) {
        await page.goto(url);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await author(source);
        const accepted = await canvasSnapshot();
        assert.equal(accepted.source, source);
        exports.push(accepted.svg);
      }
      await page.goto(`${url}svg-viewer.html`);
      for (const svg of exports) {
        await page.getByLabel("Exported SVG", { exact: true }).fill(svg);
        await page.getByRole("button", { name: "Append diagram" }).click();
      }
      const owners = await page.locator("figure").evaluateAll((figures) =>
        figures.map((figure) => {
          const clipped = figure.querySelector("[clip-path]")!;
          const reference = /^url\(#(.+)\)$/.exec(clipped.getAttribute("clip-path")!)![1];
          return document.getElementById(reference)!.closest("figure") === figure;
        }),
      );
      assert.deepEqual(owners, [true, true]);
    },
  );

  story(
    { resources: "standalone/public" },
    "exports an image resource that renders outside its document while offline",
    async function () {
      await author(String.raw`\begin{tikzpicture}
\node[inner sep=0pt] at (0,0) {\includegraphics[width=4cm]{image-resource.svg}};
\end{tikzpicture}`);
      const exported = await canvasSnapshot();
      await page.goto(`${url}svg-viewer.html`);
      await context.setOffline(true);
      await page.getByLabel("Exported SVG", { exact: true }).fill(exported.svg);
      await page.getByRole("button", { name: "Append diagram" }).click();
      const href = await page.locator("figure image").getAttribute("href");
      assert.ok(
        href !== null && href.startsWith("data:image/svg+xml;base64,"),
        "The export must own the image bytes",
      );
      const loaded = await page.evaluate(async (data) => {
        const image = new Image();
        image.src = data!;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, href);
      assert.deepEqual(loaded, [120, 60]);
    },
  );

  story(
    {},
    "retains pen samples when the drawing rail fits a stroke",
    async function () {
      await author(circleFigure);
      const frame = editorFrame(page);
      await chooseTool(frame, "mouse", "Pen");
      const viewport = frame.locator('[data-canvas-viewport="true"]');
      await viewport.scrollIntoViewIfNeeded();
      const bounds = (await viewport.boundingBox())!;
      const cdp = await context.newCDPSession(page);
      const x = bounds.x + bounds.width * 0.35,
        y = bounds.y + bounds.height * 0.5;
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
        pointerType: "pen",
        force: 0.4,
        tiltX: 12,
        tiltY: -8,
      });
      for (let i = 1; i <= 20; i++) {
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: x + i * 6,
          y: y + Math.sin(i) * 2,
          button: "left",
          buttons: 1,
          pointerType: "pen",
          force: 0.4 + i / 100,
          tiltX: 12,
          tiltY: -8,
        });
      }
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: x + 120,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
        pointerType: "pen",
      });
      await expect.poll(storedSource).toMatch(/workbench-ink:/);
      const snapshot = await canvasSnapshot();
      assert.equal(snapshot.originalInk.length, 1);
      const samples = snapshot.originalInk[0].stroke.samples;
      assert.ok(samples.length >= 22);
      assert.ok(
        samples.some(
          (sample) => sample.pressure !== undefined && Math.abs(sample.pressure - 0.5) < 0.01,
        ),
      );
      assert.ok(samples.some((sample) => sample.tiltX === 12 && sample.tiltY === -8));
    },
  );

  it("keeps a handwritten loop as drawn ink, with every pen sample", async function () {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const frame = editorFrame(page);
    const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    const x = box.x + box.width * 0.4,
      y = box.y + box.height * 0.55;
    await frame.locator("body").evaluate(() => {
      const received: { time: number; pressure: number }[] = [];
      (window as unknown as { receivedPen: typeof received }).receivedPen = received;
      for (const kind of ["pointerdown", "pointermove", "pointerup"]) {
        window.addEventListener(
          kind,
          (event) => {
            const pointer = event as PointerEvent;
            if (pointer.pointerType !== "pen") {
              return;
            }
            const coalesced = pointer.getCoalescedEvents();
            for (const sample of coalesced.length ? coalesced : [pointer]) {
              received.push({ time: sample.timeStamp, pressure: sample.pressure });
            }
          },
          true,
        );
      }
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: x + 35,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "pen",
      force: 0.5,
    });
    for (let i = 1; i <= 40; i++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: x + 35 * Math.cos((i * Math.PI) / 20),
        y: y + 35 * Math.sin((i * Math.PI) / 20),
        button: "left",
        buttons: 1,
        pointerType: "pen",
        force: 0.5,
      });
    }
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: x + 35,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "pen",
    });
    await copyTikz();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("workbench-ink-end:");
    const source = await page.evaluate(() => navigator.clipboard.readText());
    const record = /% workbench-ink:([^\r\n]+)/.exec(source);
    assert.ok(record);
    // The record names the readings once and holds one row of values for each sample.
    const packed = JSON.parse(decodeURIComponent(record[1])).samples as { fields: string[]; rows: (number | null)[][] };
    const original = {
      samples: packed.rows.map((row) => Object.fromEntries(packed.fields.map((field, index) => [field, row[index]]))),
    };
    assert.ok(original.samples.length >= 42);
    const received = await frame
      .locator("body")
      .evaluate(
        () =>
          (window as unknown as { receivedPen: { time: number; pressure: number }[] }).receivedPen,
      );
    assert.deepEqual(
      original.samples.map((sample) => ({
        time: sample.time,
        pressure: sample.pressure,
      })),
      received,
      "Stored originals retain every delivered pen sample in order",
    );
    assert.equal(
      (source.match(/ circle /g) ?? []).length,
      0,
      "The handwritten loop must not become a circle",
    );
  });

  story(
    {},
    "preserves a short pen stroke even when interpretation has no fit",
    async function () {
      await author(circleFigure);
      const frame = editorFrame(page);
      await chooseTool(frame, "mouse", "Pen");
      const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const x = box.x + box.width * 0.3,
        y = box.y + box.height * 0.55;
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
        pointerType: "pen",
        force: 0.5,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: x + 3,
        y: y + 2,
        button: "left",
        buttons: 1,
        pointerType: "pen",
        force: 0.6,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: x + 3,
        y: y + 2,
        button: "left",
        buttons: 0,
        clickCount: 1,
        pointerType: "pen",
      });
      await expect.poll(storedSource).toMatch(/workbench-ink:/);
      const result = await canvasSnapshot();
      assert.equal(result.originalInk.length, 1);
      assert.ok(result.originalInk[0].stroke.samples.length >= 3);
      assert.ok(result.svg.includes(`data-source-id="${result.originalInk[0].sourceIds[0]}"`));
      await expect(toolbarItem(frame, "Pen")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    },
  );

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `keeps palm contact out of pen drawing and supports finger pan and pinch afterward in ${tablet.name}`,
      async function () {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await author(circleFigure);
        const frame = editorFrame(page);
        await chooseTool(frame, "mouse", "Pen");
        const input = await TabletInput.attach(page);
        const viewport = frame.locator('[data-canvas-viewport="true"]');
        await viewport.scrollIntoViewIfNeeded();
        const box = (await viewport.boundingBox())!;
        const x = box.x + box.width * 0.3,
          y = box.y + box.height * 0.55;
        await input.penDown({ x, y });
        for (let i = 1; i <= 20; i++) {
          if (i === 5) {
            await input.palm({ x: x + 160, y: y + 50 }, "touchStart");
          }
          if (i === 10) {
            await input.palm({ x: x + 180, y: y + 70 }, "touchMove");
          }
          await input.penMove({ x: x + i * 5, y });
        }
        await input.palm({ x: x + 180, y: y + 70 }, "touchEnd");
        await input.penUp({ x: x + 100, y });
        await copyTikz();
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toMatch(/workbench-ink:/);
        await fitDiagram(frame, input);
        const drawn = await canvasSnapshot();
        assert.equal(drawn.originalInk.length, 1);
        assert.ok(
          drawn.originalInk[0].stroke.samples.length >= 22,
          "Palm contact must not replace the pen drag",
        );
        await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
        await input.touch([
          { x, y },
          { x: x + 55, y: y + 35 },
        ]);
        const panned = await canvasSnapshot();
        assert.equal(panned.source, drawn.source);
        assert.notDeepEqual(panned.state.viewport, drawn.state.viewport);
        await fitDiagram(frame, input);
        const beforePinch = await canvasSnapshot();
        await input.pinch({ x: x + 40, y }, 80, 140);
        const pinched = await canvasSnapshot();
        assert.equal(pinched.source, drawn.source);
        assert.ok(pinched.state.viewport.scale > beforePinch.state.viewport.scale);
        await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
        await storyScreenshot(page, `palm-pan-pinch-${tablet.name}`);
      },
    );
  }

  story(
    { resources: "standalone/public" },
    "cancels a resource-pending snapshot and continues with a newer drawing",
    async function () {
      let release!: () => void;
      const delayed = new Promise<void>((resolve) => {
        release = resolve;
      });
      let exporting = false;
      await page.route("**/image-resource.svg", async (route) => {
        if (route.request().resourceType() === "fetch") {
          exporting = true;
        }
        await delayed;
        await route.continue();
      });
      await author(
        String.raw`\begin{tikzpicture}\node at (0,0) {\includegraphics[width=4cm]{image-resource.svg}};\end{tikzpicture}`,
      );
      const pending = await requestCanvasSnapshot();
      await expect.poll(() => exporting).toBe(true);
      assert.equal(
        await page.evaluate((id) => id in window.canvasProtocol.snapshots, pending),
        false,
        "The snapshot waits for its image resource",
      );
      await postCanvasCommand({
        action: "cancel",
        ...(await canvasSession()),
        requestId: randomUUID(),
        targetRequestId: pending,
      });
      const cancelled = await canvasSnapshotReply(pending);
      assert.ok(
        cancelled.status === "failed" && cancelled.error === "cancelled",
        JSON.stringify(cancelled),
      );
      const next = String.raw`\begin{tikzpicture}\draw[red] (0,0) rectangle (3,2);\end{tikzpicture}`;
      await author(next);
      release();
      const accepted = await canvasSnapshot();
      assert.equal(accepted.source, next);
      assert.ok(accepted.svg.includes("85.358"));
      assert.ok(!accepted.svg.includes("<image"));
    },
  );

  it("keeps file ownership in the standalone host", async function () {
    await expect(
      page
        .frameLocator('iframe[title="TikZ visual editor"]')
        .getByRole("menuitem", { name: "File", exact: true }),
    ).toBeHidden();
    await expect(barMenu("title").button).toBeVisible();
  });

/** CSS px per figure centimetre at printed size: 96 CSS px per inch (FR-041). */
  const PRINTED_PX_PER_CM = 96 / 2.54;
  /** The canvas scale at printed size: the canvas draws in TeX points, 72.27 to the inch. */
  const PRINTED_SCALE = 96 / 72.27;

  /**
   * The part of the canvas, in page coordinates, that the dock leaves: the canvas viewport
   * less the dock on the edge it is docked to.
   */
  async function canvasFreeArea(
    frame: FrameLocator,
  ): Promise<{ left: number; top: number; right: number; bottom: number }> {
    const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
    const dock = await layoutBox(frame.locator("[data-diagram-tools]"));
    const area = { left: canvas.x, top: canvas.y, right: canvas.x + canvas.width, bottom: canvas.y + canvas.height };
    const gaps = {
      bottom: area.bottom - dock.y,
      top: dock.y + dock.height - area.top,
      left: dock.x + dock.width - area.left,
      right: area.right - dock.x,
    };
    const docked = (Object.keys(gaps) as (keyof typeof gaps)[]).reduce((nearest, side) =>
      gaps[side] < gaps[nearest] ? side : nearest,
    );
    if (docked === "bottom") area.bottom = dock.y;
    if (docked === "top") area.top = dock.y + dock.height;
    if (docked === "left") area.left = dock.x + dock.width;
    if (docked === "right") area.right = dock.x;
    return area;
  }

  /** Each labelled tick of a ruler, in page coordinates: its label and its position along the ruler. */
  async function rulerLabels(
    frame: FrameLocator,
    testId: "canvas-top-ruler" | "canvas-left-ruler",
  ): Promise<{ label: string; position: number }[]> {
    const offset = (await layoutBox(page.locator('iframe[title="TikZ visual editor"]')));
    const ticks = await frame.getByTestId(testId).evaluate((svg: SVGSVGElement) =>
      [...svg.querySelectorAll(":scope > g")].flatMap((group) => {
        const label = group.querySelector("text")?.textContent ?? null;
        const m = (group as SVGGElement).getScreenCTM()!;
        return label === null ? [] : [{ label, x: m.e, y: m.f }];
      }),
    );
    return ticks.map(({ label, x, y }) => ({
      label,
      position: testId === "canvas-top-ruler" ? offset.x + x : offset.y + y,
    }));
  }

  /** The page position of a figure point, in centimetres, read from the labelled ticks of both rulers. */
  async function figurePoint(frame: FrameLocator, x: number, y: number): Promise<Point> {
    const along = async (testId: "canvas-top-ruler" | "canvas-left-ruler", value: number) => {
      const ticks = (await rulerLabels(frame, testId)).map((tick) => ({
        value: Number(tick.label),
        position: tick.position,
      }));
      assert.ok(ticks.length >= 2, `${testId} has fewer than two labels`);
      const [a, b] = ticks;
      return a.position + ((value - a.value) * (b.position - a.position)) / (b.value - a.value);
    };
    return { x: await along("canvas-top-ruler", x), y: await along("canvas-left-ruler", y) };
  }

  /** The canvas transform that the canvas shows. */
  async function shownTransform(frame: FrameLocator): Promise<{ scale: string; x: string; y: string }> {
    const view = frame.locator("[data-canvas-scale]");
    const [scale, x, y] = await Promise.all(
      ["data-canvas-scale", "data-canvas-translate-x", "data-canvas-translate-y"].map(
        async (name) => (await view.getAttribute(name))!,
      ),
    );
    return { scale, x, y };
  }

  /** The zoom that the canvas shows, as a whole percentage of printed size. */
  const shownZoom = async (frame: FrameLocator) =>
    Math.round((Number((await shownTransform(frame)).scale) / PRINTED_SCALE) * 100);

  story(
    { document: String.raw`\begin{tikzpicture}
\draw[blue] (0,0) rectangle (12,3);
\end{tikzpicture}
` },
    "a figure with content opens fitted with the 44 px margin and reopens at its last view",
    async function () {
      const frame = editorFrame(page);
      const content = frame.locator('[data-canvas-viewport="true"] [data-source-id="path:0"]').first();
      await expect(content).toBeVisible();
      // A figure four times wider than high is fitted across the canvas: 44 px from its left and
      // right edges, and at least 44 px clear of its top and of the dock (research R8).
      const fitted = async (): Promise<string> => {
        const area = await canvasFreeArea(frame);
        const box = await layoutBox(content);
        const margins = {
          left: box.x - area.left,
          right: area.right - (box.x + box.width),
          top: box.y - area.top,
          bottom: area.bottom - (box.y + box.height),
        };
        const fit =
          Math.abs(margins.left - 44) <= 3 && Math.abs(margins.right - 44) <= 3 &&
          margins.top >= 41 && margins.bottom >= 41;
        return fit ? "fitted" : JSON.stringify(margins);
      };
      await expect.poll(fitted, { timeout: 10_000 }).toBe("fitted");

      // While the view is fitted, a change of window size fits it again.
      await page.setViewportSize({ width: 1000, height: 700 });
      await expect.poll(fitted, { timeout: 10_000 }).toBe("fitted");

      // A zoom ends the fit: a later change of window size keeps the scale.
      const canvas = (await layoutBox(frame.locator('[data-canvas-viewport="true"]')));
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 3);
      const before = (await shownTransform(frame)).scale;
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -180);
      await page.keyboard.up("Control");
      await expect.poll(async () => (await shownTransform(frame)).scale).not.toBe(before);
      await settledCenter(content);
      const zoomed = (await shownTransform(frame)).scale;
      await page.setViewportSize({ width: 1100, height: 720 });
      await expect.poll(async () => (await shownTransform(frame)).scale).toBe(zoomed);
      await settledCenter(content);
      const shown = await placeOnCanvas(frame, content);

      // After a restart the file opens at the view it was left in, and the file holds no view.
      const configHome = workbench.configHome;
      await workbench.stop();
      workbench = await startWorkbench(process.env, configHome, undefined, documentPath);
      url = workbench.url;
      await page.goto(url);
      await editorReady(page);
      await expect(content).toBeVisible();
      await expect.poll(async () => (await shownTransform(frame)).scale).toBe(zoomed);
      await expect(async () => {
        const after = await placeOnCanvas(frame, content);
        const keys = ["x", "y", "width", "height"] as const;
        expect(Math.max(...keys.map((key) => Math.abs(after[key] - shown[key])))).toBeLessThan(1);
      }).toPass({ timeout: 5_000 });
      assert.equal(
        await readFile(documentPath!, "utf8"),
        String.raw`\begin{tikzpicture}
\draw[blue] (0,0) rectangle (12,3);
\end{tikzpicture}
`,
      );
    },
  );

  story(
    {},
    "an empty figure opens at 100 % with the origin centred and the axes visible; Normal Size makes 1 cm of the figure 96 / 2.54 CSS px; the ruler labels and the status line read figure coordinates, with no pixel unit",
    async function () {
      const frame = editorFrame(page);
      await expect.poll(() => shownZoom(frame)).toBe(100);
      const area = await canvasFreeArea(frame);
      const origin = await figurePoint(frame, 0, 0);
      assert.ok(
        Math.abs(origin.x - (area.left + area.right) / 2) <= 2 &&
          Math.abs(origin.y - (area.top + area.bottom) / 2) <= 2,
        `The origin ${JSON.stringify(origin)} is not centred in ${JSON.stringify(area)}`,
      );
      const originLabel = frame.locator('[data-canvas-viewport="true"]').getByText("(0,0)", { exact: true });
      await expect(originLabel).toBeVisible();

      // Normal Size after a zoom: one centimetre of the figure is 96 / 2.54 CSS px.
      await author(String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}`);
      const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 3);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -180);
      await page.keyboard.up("Control");
      await expect.poll(() => shownZoom(frame)).not.toBe(100);
      // A press on the document bar, so the key goes to the shell.
      await page.locator(".document-bar").click({ position: { x: 3, y: 3 } });
      await page.keyboard.press("Control+0");
      await expect.poll(() => shownZoom(frame)).toBe(100);
      const segment = frame.locator('[data-canvas-viewport="true"] [data-source-id="path:0"]').first();
      await expect
        .poll(() =>
          segment.evaluate((path: SVGGeometryElement) => {
            const m = path.getScreenCTM()!;
            const [start, end] = [0, path.getTotalLength()].map((length) => {
              const p = path.getPointAtLength(length);
              return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
            });
            return Math.round(Math.hypot(end.x - start.x, end.y - start.y) * 10) / 10;
          }),
        )
        .toBe(Math.round(PRINTED_PX_PER_CM * 10) / 10);

      // The ruler labels are figure numbers, without a unit, one centimetre apart in figure units.
      for (const testId of ["canvas-top-ruler", "canvas-left-ruler"] as const) {
        const labels = await rulerLabels(frame, testId);
        assert.ok(labels.length >= 2, `${testId} has fewer than two labels`);
        for (const { label } of labels) assert.match(label, /^-?\d+(\.\d+)?$/);
        const [a, b] = labels;
        const perCm = (b.position - a.position) / (Number(b.label) - Number(a.label));
        assert.ok(
          Math.abs(Math.abs(perCm) - PRINTED_PX_PER_CM) <= 0.5,
          `${testId} labels are ${perCm} px per figure unit at 100 %`,
        );
      }

      // The status line reads the pointer in figure coordinates, without a unit.
      const input = await TabletInput.attach(page);
      await input.penHover(await figurePoint(frame, 1, 0));
      const status = frame.getByRole("status", { name: "Pointer position", exact: true });
      await expect(status).toBeVisible();
      await expect(status).not.toContainText("px");
      await expect(status).toHaveText(/^\s*\(?\s*1\s*,?\s+0\s*\)?\s*$/);
    },
  );

  story({}, "the pen over (1, 2) makes the status line 'Pointer position' read 1 and 2 and nothing else", async function () {
    const frame = editorFrame(page);
    await expect.poll(() => shownZoom(frame)).toBe(100);
    const input = await TabletInput.attach(page);
    await input.penHover(await figurePoint(frame, 1, 2));
    const status = frame.getByRole("status", { name: "Pointer position", exact: true });
    await expect(status).toBeVisible();
    await expect
      .poll(async () => {
        const text = await status.innerText();
        return /^[\s(),]*$/.test(text.replace(/-?\d+(\.\d+)?/g, "")) ? text.match(/-?\d+(\.\d+)?/g) : text;
      })
      .toEqual(["1", "2"]);
  });

  story(
    {},
    "the zoom readout opens Zoom to Fit, Zoom to Selection, Normal Size, and 10–1000 %; zooming changes neither source nor selection; Snap toggles and Snapping rules opens Lattice, Objects, Alignment, Angle",
    async function () {
      await author(String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\draw (3,0) circle (0.5);
\end{tikzpicture}`);
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const canvas = await layoutBox(frame.locator('[data-canvas-viewport="true"]'));
      // The readout at the canvas's lower trailing corner, Zoom out and Zoom in beside it.
      const readout = frame.getByRole("button", { name: /^Zoom: \d+ %$/ });
      await expect(readout).toHaveAccessibleName("Zoom: 100 %");
      const readoutBox = await layoutBox(readout);
      assert.ok(
        canvas.x + canvas.width - (readoutBox.x + readoutBox.width) < 120 &&
          canvas.y + canvas.height - (readoutBox.y + readoutBox.height) < 120,
        "The zoom readout is not at the canvas's lower trailing corner",
      );
      await input.touch([await stableCenter(frame.getByRole("button", { name: "Zoom in", exact: true }))]);
      await expect(readout).not.toHaveAccessibleName("Zoom: 100 %");
      await input.touch([await stableCenter(frame.getByRole("button", { name: "Zoom out", exact: true }))]);
      await expect(readout).toHaveAccessibleName("Zoom: 100 %");

      // Select the rectangle with the Lasso.
      await chooseTool(frame, input, "Lasso");
      const corners = await Promise.all(
        [[-0.3, -0.3], [2.3, -0.3], [2.3, 1.3], [-0.3, 1.3], [-0.3, -0.2]].map(([x, y]) => figurePoint(frame, x, y)),
      );
      await input.penStroke(corners);
      const selection = async () => [...(await editorDebug(page)).selection].sort();
      await expect.poll(selection).toEqual(["path:0"]);
      const source = (await editorDebug(page)).source;

      const menuItems = [
        "Zoom to Fit",
        "Zoom to Selection",
        "Normal Size",
        ...[10, 20, 50, 100, 200, 500, 1000].map((percent) => `${percent} %`),
      ];
      for (const item of menuItems) {
        await input.touch([await stableCenter(readout)]);
        const menu = frame.getByRole("menu", { name: "Zoom" });
        await expect(menu.getByRole("menuitem")).toHaveText(menuItems);
        await input.touch([await stableCenter(menu.getByRole("menuitem", { name: item, exact: true }))]);
        await expect(menu).toHaveCount(0);
        if (item.endsWith(" %")) await expect(readout).toHaveAccessibleName(`Zoom: ${item}`);
        if (item === "Normal Size") await expect(readout).toHaveAccessibleName("Zoom: 100 %");
        assert.equal((await editorDebug(page)).source, source, `${item} changed the source`);
        assert.deepEqual(await selection(), ["path:0"], `${item} changed the selection`);
      }

      // Snap at the lower leading corner toggles; Snapping rules opens the four rules.
      const snap = frame.getByRole("button", { name: "Snap", exact: true });
      const snapBox = await layoutBox(snap);
      assert.ok(
        snapBox.x - canvas.x < 120 && canvas.y + canvas.height - (snapBox.y + snapBox.height) < 120,
        "Snap is not at the canvas's lower leading corner",
      );
      const pressed = await snap.getAttribute("aria-pressed");
      await input.touch([await stableCenter(snap)]);
      await expect(snap).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");
      await input.touch([await stableCenter(frame.getByRole("button", { name: "Snapping rules", exact: true }))]);
      const rules = frame.getByRole("dialog").filter({ has: frame.getByRole("button", { name: "Lattice", exact: true }) });
      for (const rule of ["Lattice", "Objects", "Alignment", "Angle"]) {
        await expect(rules.getByRole("button", { name: rule, exact: true })).toHaveAttribute("aria-pressed", /true|false/);
      }
    },
  );

    story({}, "restores its accepted tool and viewport in a fresh editor session", async function () {
    await author(circleFigure);
    const frame = editorFrame(page);
    await chooseTool(frame, "mouse", "Pen");
    const viewport = frame.locator('[data-canvas-viewport="true"]');
    await viewport.scrollIntoViewIfNeeded();
    const box = (await viewport.boundingBox())!;
    const originalScale = await frame
      .locator("[data-canvas-scale]")
      .getAttribute("data-canvas-scale");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -180);
    await page.keyboard.up("Control");
    await expect(frame.locator("[data-canvas-scale]")).not.toHaveAttribute(
      "data-canvas-scale",
      originalScale!,
    );
    const saved = await canvasSnapshot();
    assert.equal(saved.state.tool, "addFreehand");
    const displayedCircle = frame.locator(
      '[data-canvas-viewport="true"] circle[data-source-id="path:0"]',
    );
    await expect(displayedCircle).toBeVisible();
    const before = await placeOnCanvas(frame, displayedCircle);
    await page.reload();
    await editorReady(page);
    const restored = await canvasSnapshot();
    assert.equal(restored.source, saved.source);
    assert.deepEqual(restored.state, saved.state);
    await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
    assert.equal(
      await frame.locator("[data-canvas-scale]").getAttribute("data-canvas-scale"),
      String(saved.state.viewport.scale),
    );
    await expect(async () => {
      const after = await placeOnCanvas(frame, displayedCircle);
      const keys = ["x", "y", "width", "height"] as const;
      expect(
        Math.max(...keys.map((key) => Math.abs(after[key] - before[key]))),
        "The restored circle is drawn where it was saved",
      ).toBeLessThan(1);
    }).toPass({ timeout: 5_000 });
  });

  story(
    { resources: "standalone/public" },
    "carries one drawing through drawing, a stale load, undo, redo, a cancelled snapshot, and a reopened session",
    async function () {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      let gate: Promise<void> | null = null;
      let exporting = false;
      await page.route("**/image-resource.svg", async (route) => {
        if (gate !== null) {
          exporting ||= route.request().resourceType() === "fetch";
          await gate;
        }
        await route.continue();
      });
      const authored = String.raw`\begin{tikzpicture}
% a comment the editor must keep
\pgfmathsetmacro{\side}{2}
\foreach \k in {0,1,2} { \draw[blue] (\k,0) rectangle ++(\side/2,1); }
\node at (5,0) {\includegraphics[width=1cm]{image-resource.svg}};
\end{tikzpicture}`;
      const frame = editorFrame(page);
      const strokes = (source: string) => (source.match(/^[ \t]*% workbench-ink:/gm) ?? []).length;
      // A bowed stroke; it stays as drawn, one history step.
      const draw = async (across: number, down: number) => {
        const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const x = bounds.x + bounds.width * across;
        const y = bounds.y + bounds.height * down;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 1; step <= 12; step++) {
          await page.mouse.move(
            x + (100 * step) / 12,
            y + (30 * step) / 12 - 40 * Math.sin((Math.PI * step) / 12),
          );
        }
        await page.mouse.up();
      };
      const undo = () => documentHistory("Undo").click();
      const redo = () => documentHistory("Redo").click();

      const initial = await canvasSession();
      await author(authored);
      const loaded = await canvasSnapshot();
      assert.equal(loaded.source, authored);
      // A Code edit replaces the source in the canvas's session (research R3).
      assert.equal(loaded.revision, initial.revision);

      // A drawn stroke reaches the source pane; every authored line stays as written.
      await chooseTool(frame, "mouse", "Pen");
      await draw(0.2, 0.25);
      await expect.poll(storedSource).toMatch(/workbench-ink-end:/);
      const drawn = await storedSource();
      assert.equal(strokes(drawn), 1);
      for (const line of authored.split("\n")) {
        assert.ok(drawn.includes(line), `The drawn source lost the authored line ${line}:\n${drawn}`);
      }
      const accepted = await canvasSnapshot();
      assert.equal(accepted.source, drawn);
      assert.equal(accepted.revision, loaded.revision);
      assert.notEqual(accepted.svg, loaded.svg, "The snapshot does not show the drawn stroke");

      // A load of no newer revision than the session's does not replace the drawing.
      await postCanvasCommand({
        action: "load",
        sessionId: accepted.sessionId,
        revision: accepted.revision,
        requestId: randomUUID(),
        fileName: "fixture.tikz",
        autosave: 0,
        source: String.raw`\begin{tikzpicture}\draw (0,0) circle (1cm);\end{tikzpicture}`,
      });
      const retained = await canvasSnapshot();
      assert.equal(retained.source, drawn);
      assert.equal(retained.svg, accepted.svg);

      // One Undo returns the authored bytes; one Redo returns the stroke.
      await undo();
      await expect.poll(storedSource).toBe(authored);
      assert.equal((await canvasSnapshot()).svg, loaded.svg);
      await redo();
      await expect.poll(storedSource).toBe(drawn);
      await copyTikz();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(drawn);
      const redone = await canvasSnapshot();
      assert.equal(redone.source, drawn);
      assert.equal(redone.svg, accepted.svg);

      // A snapshot cancelled while its image is pending leaves the drawing ready for the next request.
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = await requestCanvasSnapshot();
      await expect.poll(() => exporting).toBe(true);
      await postCanvasCommand({
        action: "cancel",
        ...(await canvasSession()),
        requestId: randomUUID(),
        targetRequestId: pending,
      });
      const cancelled = await canvasSnapshotReply(pending);
      assert.ok(
        cancelled.status === "failed" && cancelled.error === "cancelled",
        JSON.stringify(cancelled),
      );
      release();
      gate = null;
      const saved = await canvasSnapshot();
      assert.equal(saved.source, drawn);
      assert.equal(saved.svg, accepted.svg);
      assert.equal(saved.state.tool, "addFreehand");

      // The reopened document shows the same drawing in the same editor state and goes on editing.
      await page.reload();
      await editorReady(page);
      const code = page.getByRole("button", { name: "Code: left sidebar", exact: true });
      if ((await code.getAttribute("aria-pressed")) === "false") {
        await code.click();
      }
      const restored = await canvasSnapshot();
      assert.equal(restored.source, drawn);
      assert.deepEqual(restored.state, saved.state);
      assert.equal(restored.svg, saved.svg);
      await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
      await draw(0.2, 0.45);
      await expect.poll(async () => strokes(await storedSource())).toBe(2);
      const continued = await canvasSnapshot();
      assert.equal(continued.source, await storedSource());
      assert.ok(
        continued.source.includes(drawn.slice(0, drawn.lastIndexOf("\\end{tikzpicture}"))),
        `The first stroke changed:\n${continued.source}`,
      );
      assert.notEqual(continued.svg, saved.svg, "The snapshot does not show the second stroke");
      await undo();
      await expect.poll(storedSource).toBe(drawn);
    },
  );

  story(
    {},
    "writes a drawn stroke's record on whole lines directly after the authored lines",
    async function () {
      await author(circleFigure);
      const frame = editorFrame(page);
      await expect.poll(storedSource).toBe(circleFigure);
      const authored = circleFigure;
      const body = authored.slice(0, authored.lastIndexOf("\\end{tikzpicture}"));
      assert.ok(body.endsWith(";\n"), "The fixture's last authored line ends before the closing line");
      await chooseTool(frame, "mouse", "Pen");
      const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.25);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.2 + 100, bounds.y + bounds.height * 0.25 + 30, {
        steps: 12,
      });
      await page.mouse.up();
      await expect.poll(storedSource).toMatch(/% workbench-ink-end:/);
      const drawn = await storedSource();
      const record = drawn.slice(body.length, drawn.lastIndexOf("\\end{tikzpicture}"));
      assert.ok(drawn.startsWith(body), `The authored lines changed:\n${drawn}`);
      // The record's lines are the opening record, the scope, its drawing, and the closing record: none blank, none indented.
      const lines = record.split("\n");
      assert.equal(lines.pop(), "", "The record ends its last line");
      assert.deepEqual(
        lines.filter((line) => line === "" || /^[ \t]/.test(line)),
        [],
        `The record has a blank or indented line:\n${record}`,
      );
      assert.match(lines[0], /^% workbench-ink:/);
      assert.equal(lines[1], "\\begin{scope}");
      assert.match(lines[lines.length - 1], /^% workbench-ink-end:/);
    },
  );

  story(
    {},
    "simplifies the newly drawn stroke instead of identical drawing text in a later figure",
    async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const restore = frame.getByRole("button", { name: "Restore Original Stroke", exact: true });
      const currentSource = async () => (await editorDebug(page)).source;
      const tap = async (target: Locator) => input.touch([await stableCenter(target)]);
      const first = String.raw`\begin{tikzpicture}
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;
      const second = String.raw`\begin{tikzpicture}
\draw[red] (0,0) rectangle (3,2);
\end{tikzpicture}`;
      // One gesture in the same view of the first figure, so both drawings record the same samples; Simplify refits it.
      const draw = async () => {
        await fitDiagram(frame, input);
        await chooseTool(frame, input, "Pen");
        const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        const start = { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height * 0.6 };
        await input.penStroke(
          Array.from({ length: 16 }, (_, i) => ({
            x: start.x + (110 * i) / 15,
            y: start.y + (25 * i) / 15,
          })),
        );
        await expect.poll(currentSource).toMatch(/workbench-ink-end:/);
        await simplifyStroke(frame, input, lastPath(frame));
        // The stroke stays selected, so its object menu offers its original.
        await expect(restore).toBeVisible();
      };
      await author(`${first}\n${second}`);
      await tap(frame.getByRole("button", { name: "Figure 1", exact: true }));
      await draw();
      const fittedSource = await currentSource();
      await tap(restore);
      await expect.poll(currentSource).not.toBe(fittedSource);
      const raw = await canvasSnapshot();
      const originalDrawing = recordedDrawing(raw.source);
      // The later figure carries the recorded drawing's text without its record.
      const duplicateFigure = second.replace(
        "\\end{tikzpicture}",
        `${originalDrawing}\n\\end{tikzpicture}`,
      );
      const duplicateSource = `${first}\n${duplicateFigure}`;
      await author(duplicateSource);
      await tap(frame.getByRole("button", { name: "Figure 2", exact: true }));
      const laterBeforeDraw = await canvasSnapshot();
      assert.equal(laterBeforeDraw.state.activeFigureId, "figure:1");
      await tap(frame.getByRole("button", { name: "Figure 1", exact: true }));
      await draw();
      const fitted = await canvasSnapshot();
      assert.equal(fitted.state.activeFigureId, "figure:0");
      // The later figure stays byte for byte.
      assert.equal(
        fitted.source.slice(
          fitted.source.indexOf("\\end{tikzpicture}") + "\\end{tikzpicture}".length,
        ),
        `\n${duplicateFigure}`,
      );
      assert.equal(fitted.originalInk.length, 1);
      assert.notEqual(fitted.originalInk[0].stroke.key, raw.originalInk[0].stroke.key);
      assert.deepEqual(
        fitted.originalInk[0].stroke.samples.map(({ x, y }) => [x, y]),
        raw.originalInk[0].stroke.samples.map(({ x, y }) => [x, y]),
      );
      const fittedDrawing = recordedDrawing(fitted.source);
      assert.notEqual(fittedDrawing, originalDrawing);
      await frame.locator('[data-canvas-viewport="true"]').press("Control+z");
      await expect
        .poll(currentSource)
        .toBe(fitted.source.replace(fittedDrawing, originalDrawing));
      const restored = await canvasSnapshot();
      assert.equal(recordedDrawing(restored.source), originalDrawing);
      assert.deepEqual(restored.originalInk, fitted.originalInk);
      await frame.locator('[data-canvas-viewport="true"]').press("Control+Shift+z");
      await expect.poll(currentSource).toBe(fitted.source);
      const drawing = frame
        .locator(`svg [data-source-id="${fitted.originalInk[0].sourceIds[0]}"]`)
        .first();
      await input.touch([await strokePoint(page, drawing, 0.3)]);
      await tap(restore);
      await expect.poll(currentSource).toBe(restored.source);
      await tap(frame.getByRole("button", { name: "Figure 2", exact: true }));
      const other = await canvasSnapshot();
      assert.equal(other.state.activeFigureId, "figure:1");
      assert.deepEqual(other.originalInk, []);
      assert.deepEqual(
        await paintedGeometry(other.svg),
        await paintedGeometry(laterBeforeDraw.svg),
      );
    },
  );

  story(
    {},
    "refits translucent ink from the canvas with its colour and opacity before and after reopening",
    async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      const restore = frame.getByRole("button", { name: "Restore Original Stroke", exact: true });
      const refinement = frame.getByRole("dialog", { name: "Curve refinement" });
      const currentSource = async () => (await editorDebug(page)).source;
      const tap = async (target: Locator) => input.touch([await stableCenter(target)]);
      const selectStroke = async () => {
        const [entry] = (await canvasSnapshot()).originalInk;
        const drawing = frame.locator(`svg [data-source-id="${entry.sourceIds[0]}"]`).first();
        await input.touch([await strokePoint(page, drawing, 0.5)]);
        // A tap that lands on an anchor selects that point; Done returns to the stroke.
        const whole = frame.getByRole("button", { name: "Done", exact: true });
        if (await whole.isVisible()) {
          await tap(whole);
        }
      };
      // Simplify refits the selected stroke from its recorded ink; Accept writes the refit (FR-027).
      const simplify = async () => {
        const before = await currentSource();
        await tap(frame.getByRole("button", { name: "Simplify", exact: true }));
        await expect(refinement).toBeVisible();
        await tap(refinement.getByRole("button", { name: "Accept", exact: true }));
        await expect(refinement).toHaveCount(0);
        await expect.poll(currentSource).not.toBe(before);
      };
      await author(circleFigure);
      // New strokes take #112233 at half opacity, from the Pen's first preset.
      await chooseTool(frame, input, "Pen");
      const colour = drawingToolbar(frame).getByRole("button", { name: /^Colour 1: / });
      await tap(colour);
      const popup = frame.getByRole("dialog", { name: "Colour options" });
      const hex = popup.getByRole("textbox", { name: "Hex", exact: true });
      // The field puts the caret after its digits when it takes focus; a user selects them and types over them.
      await tap(hex);
      await hex.press("ControlOrMeta+a");
      await hex.pressSequentially("112233");
      const opacity = popup.getByRole("slider", { name: "Opacity" });
      await opacity.focus();
      for (let step = 0; step < 50; step++) {
        await opacity.press("ArrowLeft");
      }
      await expect(opacity).toHaveAttribute("aria-valuenow", "0.5");
      await tap(colour);
      await expect(popup).toHaveCount(0);
      const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const start = { x: bounds.x + bounds.width * 0.3, y: bounds.y + bounds.height * 0.3 };
      await input.penStroke(
        Array.from({ length: 20 }, (_, i) => ({
          x: start.x + i * 8,
          y: start.y + Math.sin(i) * 0.5,
        })),
      );
      // The Pen keeps the stroke as drawn, with its recorded ink (FR-025).
      await expect.poll(async () => (await canvasSnapshot()).originalInk.length).toBe(1);
      const raw = await currentSource();
      const [record] = (await canvasSnapshot()).originalInk;
      assert.equal(record.stroke.color, "rgba(17,34,51,0.5)");
      await chooseTool(frame, input, "Lasso");
      await selectStroke();
      await simplify();
      const refitted = await currentSource();
      const refit = recordedDrawing(refitted);
      assert.match(refit, /draw opacity=0\.5/, `The refit loses the ink's opacity: ${refit}`);
      assert.match(refit, /\.\. controls/, `Simplify did not refit the ink as a curve: ${refit}`);
      // Restore and Simplify repeat exactly from the same record.
      await selectStroke();
      await tap(restore);
      await expect.poll(currentSource).toBe(raw);
      await simplify();
      await expect
        .poll(currentSource, { message: "Simplify refits the same ink differently" })
        .toBe(refitted);
      // The record survives a reopened session and still drives restore and refit.
      await expect.poll(storedSource).toBe(refitted);
      await page.reload();
      await editorReady(page);
      const reopened = await canvasSnapshot();
      assert.equal(reopened.source, refitted);
      assert.deepEqual(
        reopened.originalInk.map(({ stroke }) => stroke),
        [record.stroke],
      );
      await chooseTool(frame, input, "Lasso");
      await selectStroke();
      await tap(restore);
      await expect.poll(currentSource).toBe(raw);
      await simplify();
      await expect.poll(currentSource).toBe(refitted);
    },
  );

  it("copies a just-finished canvas edit before the throttled source notification", async function () {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const frame = page.frameLocator('iframe[title="TikZ visual editor"]');
    const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 3 + 110, box.y + box.height / 2 + 25, { steps: 12 });
    await page.mouse.up();
    await copyTikz();
    await expect(page.locator(".cm-content")).toContainText("workbench-ink:");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("workbench-ink-end:");
    // The copy is the editor's complete current source, not the host pane's throttled copy of it.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, (await editorDebug(page)).source);
  });

  for (const width of [1280, 768]) {
    story(
      { viewport: { width, height: 1024 } },
      `edits a Quiver diagram and retains source and selection across views at ${width}px`,
      async function () {
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        const authored = String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`;
        await pasteCode(page, authored);
        await expect(
          page.getByRole("button", { name: "Quiver: right sidebar", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await editorReady(page);
        await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
        await expect(page.locator(".tikz-view-status")).toContainText("Up to date", {
          timeout: 30000,
        });
        assert.equal(await page.locator(".cm-content").innerText(), authored);
        await page.getByRole("button", { name: "Quiver: right sidebar", exact: true }).click();
        if (width === 768) {
          await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        }
        const frame = page.frameLocator('iframe[title="Quiver diagram editor"]');
        await frame.locator(".vertex").nth(1).click();
        await frame.locator(".label-input").fill("C");
        await expect(page.locator(".cm-content")).toContainText("C");
        await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
        await expect(page.locator(".tikz-view-status")).toContainText("Up to date", {
          timeout: 30000,
        });
        await page.screenshot({ path: `test-results/workbench/quiver-render-${width}.png` });
        await page.getByRole("button", { name: "Quiver: right sidebar", exact: true }).click();
        await expect(frame.locator(".label-input")).toHaveValue("C");
        await frame.locator(".label-input").press("Control+z");
        await expect(frame.locator(".vertex").nth(1)).toContainText("B");
      },
    );
  }

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `carries one Quiver diagram through two relabelled vertices, a TeX compile, view switches, and the whole history in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`;
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, authored);
        await expect(page.getByRole("button", { name: "Quiver: right sidebar", exact: true })).toHaveAttribute("aria-pressed", "true");
        const code = () => page.locator(".cm-content").innerText();
        const frame = page.frameLocator('iframe[title="Quiver diagram editor"]');
        const input = await TabletInput.attach(page);
        const vertex = (index: number) => frame.locator(".vertex").nth(index);
        await expect(vertex(1)).toContainText("B");
        const relabel = async (index: number, label: string) => {
          await input.touch([await stableCenter(vertex(index))]);
          await frame.locator(".label-input").fill(label);
          await expect.poll(code).toContain(label);
          return code();
        };
        const first = await relabel(1, "C");
        const second = await relabel(0, "D");
        assert.match(second, /^\\begin\{tikzcd\}\s*D & C\s*\\arrow\["f", from=1-1, to=1-2\]\s*\\end\{tikzcd\}$/);

        // TeX compiles the edited diagram, and the edit survives the view switches.
        await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
        await expect(page.locator(".tikz-view-status")).toContainText("Up to date", { timeout: 40000 });
        assert.equal(await code(), second);
        await page.getByRole("button", { name: "Quiver: right sidebar", exact: true }).click();
        await expect(vertex(0)).toContainText("D");
        await expect(vertex(1)).toContainText("C");

        // The document bar's Undo walks back to the authored bytes, and its Redo walks forward to
        // the final source.
        const bar = page.locator(".document-bar");
        const press = async (name: "Undo" | "Redo", message: string, restored: (text: string) => boolean) => {
          await input.touch([await stableCenter(bar.getByRole("button", { name, exact: true }))]);
          await expect.poll(async () => restored(await code()), { message }).toBe(true);
        };
        await press("Undo", "Undo did not restore the first relabel", (text) => text === first);
        await press("Undo", "Undo did not restore the authored bytes", (text) => text === authored);
        await expect(vertex(1)).toContainText("B");
        await press("Redo", "Redo did not restore the first relabel", (text) => text === first);
        await press("Redo", "Redo did not restore the second relabel", (text) => text === second);
        await expect(vertex(0)).toContainText("D");
      },
    );
  }

  const renderSwitchAuthored = String.raw`\begin{tikzpicture}
% Retain this comment and the authored macro even if the canvas does not interpret it.
\pgfmathsetmacro{\unused}{3+4}
\draw[blue] (0,0) circle (1cm);
\end{tikzpicture}`;

  async function authorAndRender(width: number, height: number): Promise<void> {
    await editorReady(page);
    await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
    await pasteCode(page, renderSwitchAuthored);
    await editorReady(page);
    await page.getByRole("button", { name: "Preview: right sidebar", exact: true }).click();
    await expect(page.locator(".tikz-view-status")).toContainText("Up to date", { timeout: 40000 });
    assert.equal(await page.locator(".cm-content").innerText(), renderSwitchAuthored);
    await page.screenshot({ path: `test-results/workbench/rendered-${width}x${height}.png` });
    await page.getByRole("button", { name: "Canvas: right sidebar", exact: true }).click();
  }

  story(
    { viewport: { width: 1280, height: 1024 } },
    "retains authored source and its drawing tool through rendered-view switches with a desktop mouse",
    async function () {
      await authorAndRender(1280, 1024);
      const viewport = editorFrame(page).locator('[data-canvas-viewport="true"]');
      const bounds = (await viewport.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 3, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 3 + 100, bounds.y + bounds.height / 2 + 25, {
        steps: 16,
      });
      await page.mouse.up();
      await expect(page.locator(".cm-content")).toContainText("workbench-ink:");
      await viewport.press("Control+z");
      await expect.poll(() => page.locator(".cm-content").innerText()).toBe(renderSwitchAuthored);
    },
  );

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `retains authored source and its drawing tool through rendered-view switches by pen in ${tablet.name}`,
      async function () {
        await authorAndRender(tablet.width, tablet.height);
        const frame = editorFrame(page);
        const input = await TabletInput.attach(page);
        await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
        const bounds = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
        await input.penStroke(waveAcross(bounds, 0.45, 0.5, 100));
        await expect(page.locator(".cm-content")).toContainText("workbench-ink:");
        await expect(toolbarItem(frame, "Pen")).toHaveAttribute("aria-pressed", "true");
        // The stroke is one step of the document's history (FR-012b): one Undo returns the authored source.
        await documentHistory("Undo").click();
        await expect.poll(() => page.locator(".cm-content").innerText()).toBe(renderSwitchAuthored);
      },
    );
  }

  story(
    { viewport: { width: 1024, height: 768 } },
    "keeps an earlier pen stroke in view when a second stroke is drawn at the smallest zoom",
    async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await chooseTool(frame, input, "Pen");
      const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const stage = frame.locator("[data-canvas-scale]");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down("Control");
      let scale = await stage.getAttribute("data-canvas-scale");
      for (;;) {
        await page.mouse.wheel(0, 240);
        await editorReady(page);
        const next = await stage.getAttribute("data-canvas-scale");
        if (next === scale) break;
        scale = next;
      }
      await page.keyboard.up("Control");
      const wave = (left: number, top: number): Point[] =>
        Array.from({ length: 20 }, (_, i) => ({
          x: box.x + left + i * 12,
          y: box.y + top + 30 * Math.sin(i / 3),
        }));
      const strokes = frame.locator('[data-canvas-viewport="true"] path[data-source-id]');
      await input.penStroke(wave(150, 200));
      await expect(strokes).toHaveCount(1);
      await input.penStroke(wave(500, 450));
      await expect(strokes).toHaveCount(2);
      assert.equal((await editorDebug(page)).source.match(/% workbench-ink-end:/g)?.length, 2);
      // The first stroke is no longer selected, so only its own paint shows it. A line is painted
      // at least one device pixel wide at every zoom, as pdf.js paints the lines of a PDF
      // (`getScaleForStroking`, src/display/canvas.js) and as Inkscape's Visible Hairlines mode does.
      const paintedWidths = await strokes.evaluateAll((paths) =>
        paths.map((path) => {
          const matrix = (path as SVGGraphicsElement).getScreenCTM()!;
          return parseFloat(getComputedStyle(path).strokeWidth) * Math.hypot(matrix.a, matrix.b);
        }),
      );
      for (const width of paintedWidths) {
        assert.ok(width >= 0.99, `a stroke is painted ${width} px wide`);
      }
    },
  );

  story(
    { viewport: { width: 1024, height: 768 } },
    "Delete removes a pen stroke with its record and keeps the canvas, and Undo returns both",
    async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await chooseTool(frame, input, "Pen");
      const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const wave = (left: number, top: number): Point[] =>
        Array.from({ length: 20 }, (_, i) => ({
          x: box.x + left + i * 12,
          y: box.y + top + 30 * Math.sin(i / 3),
        }));
      const strokes = frame.locator('[data-canvas-viewport="true"] path[data-source-id]');
      await input.penStroke(wave(150, 200));
      await expect(strokes).toHaveCount(1);
      await input.penStroke(wave(500, 450));
      await expect(strokes).toHaveCount(2);
      const drawn = (await editorDebug(page)).source;
      const count = (source: string, text: string) => source.split(text).length - 1;
      await chooseTool(frame, input, "Lasso");
      await input.touch([await strokePoint(page, strokes.first(), 0.5)]);
      await page.keyboard.press("Delete");
      await expect.poll(async () => count((await editorDebug(page)).source, "\\draw")).toBe(1);
      const deleted = (await editorDebug(page)).source;
      for (const part of ["% workbench-ink:", "% workbench-ink-end:", "\\begin{scope}", "\\end{scope}"]) {
        assert.equal(count(deleted, part), 1, `occurrences of ${part} after Delete`);
      }
      // The canvas paints the stroke that remains.
      await expect(strokes).toHaveCount(1);
      await page.locator(".document-bar").getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(async () => (await editorDebug(page)).source).toBe(drawn);
      await expect(strokes).toHaveCount(2);
      // A record whose drawing is removed in the Code panel does not stop the canvas.
      const emptied = drawn.replace(/^\\draw [^\n]*\n/m, "");
      assert.equal(count(emptied, "\\draw"), 1);
      await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
      await pasteCode(page, emptied);
      await expect(strokes).toHaveCount(1);
    },
  );

  story(
    { viewport: { width: 1024, height: 768 } },
    "a drag that starts on the ink of a selected pen stroke moves the stroke",
    async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await chooseTool(frame, input, "Pen");
      const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      // Samples 6 px apart: every part of the ink is within reach of a point of the stroke.
      const wave: Point[] = Array.from({ length: 40 }, (_, i) => ({
        x: box.x + 150 + i * 6,
        y: box.y + 250 + 30 * Math.sin(i / 6),
      }));
      const stroke = frame.locator('[data-canvas-viewport="true"] path[data-source-id]');
      await input.penStroke(wave);
      await expect(stroke).toHaveCount(1);
      await chooseTool(frame, input, "Lasso");
      await input.touch([await strokePoint(page, stroke, 0.5)]);
      await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
      const extent = () =>
        stroke.evaluate((path) => {
          const { x, y, width, height } = path.getBoundingClientRect();
          return { x, y, width, height };
        });
      const before = await extent();
      const grip = await strokePoint(page, stroke, 0.25);
      await input.penStroke(
        Array.from({ length: 13 }, (_, i) => ({ x: grip.x + (120 * i) / 12, y: grip.y + (150 * i) / 12 })),
      );
      await expect.poll(async () => (await extent()).y, { message: "the drag changed nothing" }).not.toBe(before.y);
      const after = await extent();
      // A moved stroke keeps its extent. A stroke with one point pulled away grows by the drag.
      assert.ok(
        Math.abs(after.width - before.width) < 1 && Math.abs(after.height - before.height) < 1,
        `the extent of the stroke changed from ${before.width} × ${before.height} to ${after.width} × ${after.height}`,
      );
      // Snap rounds the move to the grid, so the displacement is within one grid step of the drag.
      assert.ok(Math.abs(after.x - before.x - 120) < 40 && Math.abs(after.y - before.y - 150) < 40);
      await expect(frame.getByRole("button", { name: "Edit Points", exact: true })).toBeVisible();
      // A finger held by the other hand is the move modifier: the same drag then moves one point.
      const point = await strokePoint(page, stroke, 0.25);
      await input.fingerDown({ x: box.x + box.width - 60, y: box.y + box.height - 60 });
      await input.penDown(point);
      for (let i = 1; i <= 12; i++) await input.penMove({ x: point.x, y: point.y + i * 10 });
      await input.penUp({ x: point.x, y: point.y + 120 });
      await input.fingerUp();
      await expect
        .poll(async () => (await extent()).height - after.height, {
          message: "the pen drag under a held finger did not pull one point out of the stroke",
        })
        .toBeGreaterThan(40);
    },
  );

  story(
    { viewport: { width: 1024, height: 768 } },
    "a pen held still on a point of a selected pen stroke moves that point",
    async function () {
      const frame = editorFrame(page);
      const input = await TabletInput.attach(page);
      await chooseTool(frame, input, "Pen");
      const box = (await frame.locator('[data-canvas-viewport="true"]').boundingBox())!;
      const wave: Point[] = Array.from({ length: 40 }, (_, i) => ({
        x: box.x + 150 + i * 6,
        y: box.y + 250 + 30 * Math.sin(i / 6),
      }));
      const stroke = frame.locator('[data-canvas-viewport="true"] path[data-source-id]');
      await input.penStroke(wave);
      await expect(stroke).toHaveCount(1);
      await chooseTool(frame, input, "Lasso");
      await input.touch([await strokePoint(page, stroke, 0.5)]);
      await expect.poll(async () => (await editorDebug(page)).selection.length).toBe(1);
      const extent = () =>
        stroke.evaluate((path) => {
          const { x, y, width, height } = path.getBoundingClientRect();
          return { x, y, width, height };
        });
      const before = await extent();
      // The lowest part of the wave: a point pulled down from there makes the stroke taller and moves no edge but the bottom.
      const point = await strokePoint(page, stroke, 0.25);
      await input.penDown(point);
      // Past the default of "Hold to move a point" (450 ms).
      await new Promise((resolve) => setTimeout(resolve, 900));
      await expect(
        frame.locator('[data-point-target="move"]'),
        "the pen held on a point of the selected stroke did not take hold of that point",
      ).toHaveCount(1);
      for (let i = 1; i <= 12; i++) await input.penMove({ x: point.x, y: point.y + i * 10 });
      await input.penUp({ x: point.x, y: point.y + 120 });
      await expect
        .poll(async () => (await extent()).height - before.height, {
          message: "the pen held on a point and then dragged did not pull that point out of the stroke",
        })
        .toBeGreaterThan(40);
      const after = await extent();
      assert.ok(
        Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1 && Math.abs(after.width - before.width) < 1,
        `the stroke moved or changed width: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      );
      await expect(selectedPoints(frame)).toHaveCount(1);
      // A drag with no hold still moves the stroke.
      await page.locator(".document-bar").getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(async () => (await extent()).height).toBe(before.height);
      await input.touch([(await emptyCanvasGesture(frame, [{ x: 0, y: 0 }]))[0]]);
      await input.touch([await strokePoint(page, stroke, 0.5)]);
      await expect(frame.getByRole("button", { name: "Edit Points", exact: true })).toBeVisible();
      const grip = await strokePoint(page, stroke, 0.25);
      await input.penStroke(Array.from({ length: 13 }, (_, i) => ({ x: grip.x, y: grip.y + i * 10 })));
      await expect.poll(async () => (await extent()).y - before.y).toBeGreaterThan(80);
      assert.ok(Math.abs((await extent()).height - before.height) < 1);
    },
  );

  for (const tablet of TABLET_VIEWPORTS) {
    story(
      { viewport: tablet },
      `recovers an untitled authored diagram after a server interruption in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzpicture}
% retain authored source through an interruption
\draw (1,2) -- (4,5);
\end{tikzpicture}`;
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, authored);
        await expect(page.locator(".tikz-standalone-status")).toContainText("Recovery saved");
        const persistentHome = workbench.configHome;
        await page.goto("about:blank");
        await workbench.stop();
        workbench = await startWorkbench(process.env, persistentHome);
        url = workbench.url;
        await page.goto(url);
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await expect.poll(() => page.locator(".cm-line").evaluateAll((lines) => lines.map((line) => line.textContent).join("\n"))).toBe(authored);
        await expect(page.frameLocator('iframe[title="TikZ visual editor"]').locator("path[data-source-id]")).toHaveCount(1);
        await expect(page.locator(".tikz-standalone-status")).toContainText("Recovery saved");
      },
    );

    story(
      { viewport: tablet },
      `a start on a view-state file of an older build shows the file and the reason, and keeps the draft, in ${tablet.name}`,
      async function () {
        const authored = String.raw`\begin{tikzpicture}
% a draft that an unreadable state file must not cost
\draw (1,2) -- (4,5);
\end{tikzpicture}`;
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await pasteCode(page, authored);
        await expect(page.locator(".tikz-standalone-status")).toContainText("Recovery saved");
        const home = workbench.configHome;
        const stateDirectory = join(home, "visual-tikz-editor");
        const viewStateFile = join(stateDirectory, "view-state.json");
        // A pan makes the page report its view, and the host then writes the view of this draft.
        const input = await TabletInput.attach(page);
        await input.touch(await emptyCanvasGesture(editorFrame(page)));
        await expect.poll(() => readdir(stateDirectory)).toContain("view-state.json");
        await page.goto("about:blank");
        await workbench.stop();
        // An entry of an older build has no `locked` and no `hidden` (issue #80).
        const written = z.record(z.string(), z.record(z.string(), z.json())).parse(JSON.parse(await readFile(viewStateFile, "utf8")));
        const older = JSON.stringify(
          Object.fromEntries(
            Object.entries(written).map(([key, view]) => [
              key,
              Object.fromEntries(Object.entries(view).filter(([field]) => field !== "locked" && field !== "hidden")),
            ]),
          ),
        );
        await writeFile(viewStateFile, older);
        const recovery = await readFile(join(stateDirectory, "recovery.json"), "utf8");

        workbench = await startWorkbench(process.env, home);
        url = workbench.url;
        await page.goto(url);
        const failure = page.getByRole("alert");
        await expect(failure, "the window does not name the file that cannot be read").toContainText(viewStateFile);
        await expect(failure, "the window does not name the field that the file lacks").toContainText("locked");
        await expect(page.locator('iframe[title="TikZ visual editor"]')).toHaveCount(0);
        assert.equal(await readFile(viewStateFile, "utf8"), older, "the start changed the file that it cannot read");
        assert.equal(await readFile(join(stateDirectory, "recovery.json"), "utf8"), recovery, "the start changed the draft");

        // The person moves the file away, as the window says; the next start opens the draft.
        await page.goto("about:blank");
        await workbench.stop();
        await rename(viewStateFile, `${viewStateFile}.moved`);
        workbench = await startWorkbench(process.env, home);
        url = workbench.url;
        await page.goto(url);
        await editorReady(page);
        await page.getByRole("button", { name: "Code: left sidebar", exact: true }).click();
        await expect.poll(() => page.locator(".cm-line").evaluateAll((lines) => lines.map((line) => line.textContent).join("\n"))).toBe(authored);
      },
    );
  }
});
