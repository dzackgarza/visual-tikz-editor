/**
 * Line coverage of the repository's own sources (src/, standalone/) over the whole
 * test suite, written to coverage/lcov.info for diff-cover.
 *
 * Two V8 coverage sources feed one monocart-coverage-reports report, following the
 * "Node.js V8 Coverage" and "Playwright" sections of its README
 * (https://github.com/cenfun/monocart-coverage-reports#readme):
 * - Node: mocha and the tsx-transpiled specs run under NODE_V8_COVERAGE with
 *   --enable-source-maps, so each coverage file carries the source-map cache that
 *   maps transpiled code back to the .ts files the specs import.
 * - Browser: every story page records V8 coverage of the standalone page's Vite
 *   chunks (test/tablet.ts, TIKZ_WORKBENCH_V8_COVERAGE), mapped back through the
 *   .map files `vite build` writes next to each chunk.
 * The standalone server itself runs under Bun, which writes no V8 coverage; the
 * lines of standalone/server.ts are not in this report.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCR } from "monocart-coverage-reports";

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, "standalone", "dist");

const nodeCoverageDir = await mkdtemp(path.join(tmpdir(), "tikz-workbench-v8-node-"));
const browserCoverageDir = await mkdtemp(path.join(tmpdir(), "tikz-workbench-v8-browser-"));

const suite = spawnSync("bun", ["run", "test"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_V8_COVERAGE: nodeCoverageDir,
    NODE_OPTIONS: "--enable-source-maps",
    TIKZ_WORKBENCH_V8_COVERAGE: browserCoverageDir,
  },
});
// The report covers whatever ran; the suite's own status is returned after it is written.

/** A source path from either coverage source, relative to the repository root. */
function repoRelative(source) {
  const absolute = source.startsWith("file:") ? fileURLToPath(source) : source;
  return path.isAbsolute(absolute) ? path.relative(repoRoot, absolute) : absolute;
}

const report = MCR({
  name: "tikz-workbench",
  outputDir: "coverage",
  reports: ["console-summary"],
  lcov: true,
  clean: true,
  baseDir: repoRoot,
  entryFilter(entry) {
    const url = new URL(entry.url);
    if (url.protocol === "file:") {
      const file = fileURLToPath(url);
      return file.startsWith(`${repoRoot}${path.sep}`) && !file.includes(`${path.sep}node_modules${path.sep}`);
    }
    return url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js");
  },
  // The story servers have stopped by now; read each chunk's map from the build on disk
  // and name its sources relative to the repository, as the Node entries are.
  async sourceMapResolver(url) {
    const mapPath = path.join(distRoot, new URL(url).pathname);
    const map = JSON.parse(await readFile(mapPath, "utf8"));
    map.sources = map.sources.map((source) =>
      path.relative(repoRoot, path.resolve(path.dirname(mapPath), source)),
    );
    return map;
  },
  sourcePath: repoRelative,
  sourceFilter(sourcePath) {
    return /^(src|standalone)\//u.test(repoRelative(sourcePath));
  },
});

await report.addFromDir(nodeCoverageDir);
for (const file of await readdir(browserCoverageDir)) {
  await report.add(JSON.parse(await readFile(path.join(browserCoverageDir, file), "utf8")));
}
await report.generate();
process.exit(suite.status ?? 1);
