/**
 * The standalone host for one diagram. It builds the workbench page with Vite,
 * then serves the page, pinned editor pages, document commands, optional TeX
 * compilation and the Quiver macro projection on 127.0.0.1.
 *
 * Usage: bun run standalone/server.ts [file.tikz|file.tikzcd]
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import {
  renderTikz,
  resolveTikzDataDir,
  resolveTikzTemplatePath,
  type TikzRenderRequest,
} from "../src/tikz-render";

const input = Bun.argv[2];
const DIAGRAM_EXTENSIONS = new Set([".tikz", ".tikzcd"]);
const NEW_DIAGRAM = "\\begin{tikzpicture}\n\n\\end{tikzpicture}\n";
if (input !== undefined && input !== "" && !DIAGRAM_EXTENSIONS.has(path.extname(input))) {
  throw new Error("Usage: bun run standalone/server.ts [file.tikz|file.tikzcd]");
}

let documentPath = input === undefined || input === "" ? null : await realpath(input);
let untitledSource = NEW_DIAGRAM;
const packageRoot = path.resolve(import.meta.dir, "..");
const pageRoot = path.join(import.meta.dir, "dist");
const home = os.homedir();
const untitledPath = path.join(home, "Untitled.tikz");
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);

await build({ configFile: path.join(packageRoot, "vite.config.ts"), logLevel: "warn" });

function revisionOf(source: string): string {
  return `"${createHash("sha256").update(source).digest("hex")}"`;
}

/** Serve `relative` from `root`; a path that resolves outside `root` is not found. */
async function serveUnder(root: string, relative: string): Promise<Response> {
  const requested = path.resolve(root, `.${relative}`);
  if (!requested.startsWith(`${root}${path.sep}`))
    return new Response("Not found", { status: 404 });
  let actual: string;
  try {
    actual = await realpath(requested);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!actual.startsWith(`${root}${path.sep}`)) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(actual));
}

async function currentSource(): Promise<string> {
  return documentPath === null ? untitledSource : await readFile(documentPath, "utf8");
}

function documentResponse(source: string): Response {
  return new Response(source, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      etag: revisionOf(source),
      "x-document-path": documentPath ?? untitledPath,
      "x-document-saved": String(documentPath !== null),
    },
  });
}

async function handleDocument(request: Request): Promise<Response> {
  if (request.method === "GET") return documentResponse(await currentSource());
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
  if (documentPath === null) return new Response("Save the new diagram as a file", { status: 409 });
  const current = await currentSource();
  const expected = request.headers.get("if-match");
  if (expected === null) return new Response("File revision required", { status: 428 });
  if (expected !== revisionOf(current))
    return new Response("The file changed on disk", { status: 412 });
  const next = await request.text();
  await writeFile(documentPath, next, "utf8");
  return new Response(null, { status: 204, headers: { etag: revisionOf(next) } });
}

async function selectFile(mode: "open" | "save"): Promise<string | null> {
  const args = ["zenity", "--file-selection"];
  if (mode === "save") args.push("--save", `--filename=${documentPath ?? untitledPath}`);
  const dialog = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [status, output, error] = await Promise.all([
    dialog.exited,
    new Response(dialog.stdout).text(),
    new Response(dialog.stderr).text(),
  ]);
  if (status === 1 && error.trim() === "") return null;
  if (status !== 0) throw new Error(`File dialog failed: ${error.trim()}`);
  const selected = output.trim();
  if (!DIAGRAM_EXTENSIONS.has(path.extname(selected))) {
    throw new Error("Choose a .tikz or .tikzcd file");
  }
  return selected;
}

async function handleOpen(): Promise<Response> {
  const selected = await selectFile("open");
  if (selected === null) return new Response(null, { status: 204 });
  const resolved = await realpath(selected);
  const source = await readFile(resolved, "utf8");
  documentPath = resolved;
  return documentResponse(source);
}

async function handleSaveAs(request: Request): Promise<Response> {
  const selected = await selectFile("save");
  if (selected === null) return new Response(null, { status: 204 });
  if (existsSync(selected)) {
    const question = Bun.spawn(
      ["zenity", "--question", `--text=Replace ${path.basename(selected)}?`],
      { stdout: "ignore", stderr: "pipe" },
    );
    const status = await question.exited;
    if (status === 1) return new Response(null, { status: 204 });
    if (status !== 0) throw new Error("Replace confirmation failed");
  }
  const next = await request.text();
  await writeFile(selected, next, "utf8");
  documentPath = await realpath(selected);
  return documentResponse(next);
}

async function handleRender(request: Request): Promise<Response> {
  const body = (await request.json()) as TikzRenderRequest;
  const config = {
    tikzAssetDir: resolveTikzDataDir("", home),
    templatePath: resolveTikzTemplatePath(home),
    cacheDir: path.join(home, ".cache", "tikz-workbench"),
    env: process.env,
  };
  // The page edits exactly one diagram: relative inputs resolve from its location.
  return Response.json(
    await renderTikz({ ...body, docPath: documentPath ?? untitledPath }, config),
  );
}

async function handleQuiverMacros(): Promise<Response> {
  // A standalone figure has no host document or project macro definitions.
  return Response.json({ macros: {}, unsupported: [] });
}

async function handleImage(relative: string): Promise<Response> {
  if (!IMAGE_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
    return new Response("Unsupported image format", { status: 415 });
  }
  return await serveUnder(path.dirname(documentPath ?? untitledPath), relative);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  // Bun's documented 10-second default is shorter than renderTikz's 30-second TeX limit.
  // https://bun.com/docs/runtime/http/server#idleTimeout
  idleTimeout: 40,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/document") return await handleDocument(request);
    if (pathname === "/api/new" && request.method === "POST") {
      documentPath = null;
      untitledSource = NEW_DIAGRAM;
      return documentResponse(untitledSource);
    }
    if (pathname === "/api/open" && request.method === "POST") return await handleOpen();
    if (pathname === "/api/save-as" && request.method === "POST")
      return await handleSaveAs(request);
    if (pathname === "/api/render" && request.method === "POST") return await handleRender(request);
    if (pathname === "/api/quiver-macros" && request.method === "GET")
      return await handleQuiverMacros();
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (pathname.startsWith("/tikz-image/")) {
      return await handleImage(`/${decodeURIComponent(pathname.slice("/tikz-image/".length))}`);
    }
    if (pathname.startsWith("/tikz-editor/")) {
      return await serveUnder(
        path.join(packageRoot, "vendor", "tikz-editor", "src"),
        pathname.slice("/tikz-editor".length),
      );
    }
    if (pathname.startsWith("/quiver/")) {
      return await serveUnder(
        path.join(packageRoot, "vendor", "quiver", "src"),
        pathname.slice("/quiver".length),
      );
    }
    return await serveUnder(pageRoot, pathname === "/" ? "/index.html" : pathname);
  },
});

console.log(`TikZ workbench: http://127.0.0.1:${server.port}/`);
