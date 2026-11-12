# Development

This document is for contributors. The [README](../README.md) covers installation and use.

## Layout

| Path | Content |
| --- | --- |
| `src/` | The Vue workbench component and the typed host interface (`src/host.ts`) |
| `standalone/` | The standalone app: the local Bun server (`server.ts`), its page, and the embedding test pages |
| `src-tauri/` | The desktop shell, which bundles the server and the built page into a Debian package |
| `vendor/tikz-editor/` | The pinned TikZ Editor fork: the maintained patch, the embed adapter, and the built assets |
| `vendor/quiver/` | The pinned Quiver fork and its built assets |
| `test/` | Logic specs, Mocha browser stories, the tablet gesture helpers (`tablet.ts`), and the TeX render fixture |
| `scripts/` | Vendor rebuilds, the fork edit loop, coverage, desktop install, and release assets |
| `docs/` | User and contributor documentation, research notes, and the product guidance record |

## Build and run

```sh
bun install --frozen-lockfile
just build                      # the standalone page in standalone/dist
just run [file.tikz]            # build, then serve the editor on 127.0.0.1
CARGO_BUILD_JOBS=2 just package # the Debian package in src-tauri/target/release/bundle/deb/
just install-desktop            # package, then install it for this user
```

`just package` runs `just build-desktop-assets` first, which compiles `standalone/server.ts` into the sidecar binary that the desktop shell starts. `CARGO_BUILD_JOBS=2` keeps the Rust build within the memory of a small machine.

## Tests

| Command | What it runs |
| --- | --- |
| `bun run test:logic` | The fork's Vitest specs, in the fork checkout `.cache/tikz-editor` (made on first use) |
| `bun run test:browser --grep '<story>'` | Matching Mocha browser stories, in Playwright Chromium |
| `just test-commit` | The syntax check of staged files; the pre-commit hook runs it |
| `just test-push` | The syntax check of outgoing commits; the pre-push hook runs it |
| `just test-ci` | The commit check, the logic tests and the browser suite under coverage, diff coverage, and the lint and debt checks |

The quality gates come from [ai-review-ci](https://github.com/dzackgarza/ai-review-ci) (`~/ai-review-ci/justfiles/bun.just`). The **Development diagnostics** workflow (`.github/workflows/development.yml`) runs `just test-ci` on every push. Its `_ci-environment` recipe provisions a fresh Ubuntu runner: Playwright Chromium, Xvfb, dbus, Zenity, xdotool, ImageMagick, and the TeX tools. It installs the render fixture `test/fixtures/tikz-data` as the runner's `~/.pandoc`, so the CI render stories use the fixture's filter and template. The run on a revision is that revision's qualification record:

```sh
gh run list --workflow development.yml --branch main --limit 1
```

Each push starts a run on a runner queue that other repositories share. Commit as you work and push when the work is complete.

A failed story keeps its Playwright trace as `test-results/workbench/failed-<time>-<story>.zip`, beside the screenshot of every story. The run retains `test-results/` as its `test-results-<run>-<attempt>` artifact, so a story that fails only on the runner is read from its trace:

```sh
gh run download <run-id> --pattern 'test-results-*'
bunx playwright show-trace test-results-*/workbench/failed-*.zip
```

`bun run coverage` (`scripts/coverage.mjs`) runs the suite with V8 coverage for Mocha and for every story page, and merges both into `coverage/lcov.info`. `standalone/server.ts` runs under Bun, which reports coverage only inside `bun test` ([oven-sh/bun#17867](https://github.com/oven-sh/bun/issues/17867)), so the report omits it.

### Writing a browser story

- A story drives the real page with pen, touch, and mouse events through the helpers in `test/tablet.ts`. Each story runs in portrait and in landscape.
- A defect gets a failing story before its repair.
- Seven combined-session stories carry one drawing through a whole session: drawing, history, view switches, saving, export, and reopening. A new feature adds its step to the session story it belongs to.
- Tap a control with `stableCenter`, which scrolls the control into view after its box settles. In the frame after a tool or colour choice, read a position with `settledCenter`.
- Read a layout box inside `expect(...).toPass()` with `layoutBox`. An element that re-renders has no box for a moment; `expect.poll` stops at that error, and `toPass` retries.
- The place of a floating control depends on font metrics, and the CI runner has other fonts than a desktop. Run a story about a floating control under a fontconfig file that holds only Liberation, and again only DejaVu: `FONTCONFIG_FILE=<conf> bun run test:browser --grep '<story>'`.
- The native file stories (`test/workbench-files.spec.ts`) drive a real GTK file dialog, which queries every mount. A FUSE mount that does not answer `stat -f` stalls the dialog, and these stories then fail at the window search or at the save. Check the mounts before you read such a failure as a defect.

## The vendored editors

`vendor/tikz-editor/PROVENANCE.toml` pins the upstream commit of [TikZ Editor](https://github.com/DominikPeters/tikz-editor). `vendor/tikz-editor/ZETTLR.patch` is the maintained change to upstream source, and `vendor/tikz-editor/src/` holds the built assets, so a build needs no network. [`vendor/tikz-editor/README-ZETTLR.md`](../vendor/tikz-editor/README-ZETTLR.md) states what the fork changes and what upstream owns.

To change the fork:

```sh
just tikz-editor-checkout   # the pinned commit with the patch applied, in .cache/tikz-editor
just tikz-editor-watch      # rebuild vendor/tikz-editor/src on each save
just tikz-editor-patch      # typecheck, then write the checkout's changes to ZETTLR.patch
just update-tikz-editor-vendor  # rebuild the assets from upstream and the patch, to prove the patch
```

Commit the patch and the rebuilt assets together. `just update-quiver-vendor` rebuilds Quiver's assets; [`vendor/quiver/README-ZETTLR.md`](../vendor/quiver/README-ZETTLR.md) states its contract.

## Releases

A head of `main` that changes the product and has a green Development diagnostics run gets a release named `workbench-<short sha>`. Build its assets from a clean checkout of that head:

```sh
CARGO_BUILD_JOBS=2 just release-assets <run-id>
```

The recipe builds the package, checks that the run is a successful run of `HEAD`, and writes `.cache/release/<sha>/assets`:

| File | Content |
| --- | --- |
| `standalone-workbench.tar.gz` | The source tree at the revision, with the built page |
| `visual-tikz-editor_<version>_amd64.deb` | The Debian package |
| `qualification.tar.gz` | The revision, the run's log and record, and its artifacts |
| `SHA256SUMS` | Checksums of the three files |

Publish them with the run in the notes:

```sh
gh release create workbench-<short sha> --target <sha> --title "Standalone workbench <short sha>" --notes-file notes.md .cache/release/<sha>/assets/*
```
