ai_review_ci_schema_version := "1"
ai_review_ci_profile := "bun"
ai_review_ci_ref := "main"
ai_review_ci_release_channel := "main"
ai_review_ci_workflow_template_version := "1"
ai_review_ci_local_delegation := "global-justfile"
ai_review_ci_default_branch := "main"

[doc("Show available commands.")]
default:
    @just --list

[doc("Start a new diagram, or open an existing TikZ file.")]
[no-cd]
run file="": build
    bun run "{{justfile_directory()}}/standalone/server.ts" "{{file}}"

[doc("Sync node_modules from the lockfile.")]
[private]
install:
    bun install

[doc("Build the standalone browser page.")]
build: install
    bun run build

[doc("Build a Linux desktop package with an application entry and icon.")]
package:
    bun run package

[doc("Run the stories of the desktop package: the built application in WebKitGTK, by WebDriver.")]
test-desktop: package
    bun run test:desktop

[doc("Sync the desktop app and menu entry for this user.")]
install-desktop: package
    bash scripts/install-desktop.sh

[doc("Write the release assets of HEAD, qualified by a green Development diagnostics run.")]
release-assets run: test-desktop
    bash scripts/release-assets.sh "{{run}}"

[private]
build-desktop-assets: build
    bun build --compile standalone/server.ts --outfile "src-tauri/binaries/workbench-host-${TAURI_ENV_TARGET_TRIPLE}"

[doc("Commit gate: the syntax check of staged files, through the global QC justfile.")]
test-commit:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-commit

[doc("Push gate: the syntax check of outgoing commits.")]
test-push:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-push

[doc("CI gate: the commit check, the whole suite under coverage, and the lint and debt checks.")]
test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci

[doc("Scheduled whole-tree audit.")]
ambient:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . ambient

[doc("Provision a bare Ubuntu CI runner for the workbench suite: the locked Playwright")]
[private]
_ci-environment:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "${CI:-}" != "true" ]; then
        echo "_ci-environment provisions a CI runner only (CI=true); it writes ~/.pandoc and system packages." >&2
        exit 1
    fi
    if [ -e "$HOME/.pandoc" ]; then
        echo "$HOME/.pandoc already exists; the runner's render tree must come from test/fixtures/tikz-data." >&2
        exit 1
    fi
    bun install --frozen-lockfile
    bunx playwright install --with-deps chromium
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        xvfb dbus-x11 zenity xdotool imagemagick \
        pdf2svg librsvg2-bin poppler-utils texlive-latex-base texlive-pictures texlive-latex-extra
    mkdir -p "$HOME/.pandoc"
    cp -R test/fixtures/tikz-data/filters test/fixtures/tikz-data/templates "$HOME/.pandoc/"
    kpsewhich standalone.cls tikz.sty tikz-cd.sty amsmath.sty amssymb.sty import.sty graphicx.sty >/dev/null

[doc("Rebuild the pinned TikZ Editor assets.")]
update-tikz-editor-vendor:
    bun run scripts/update-tikz-editor-vendor.mjs

[doc("Materialize the tikz-editor fork for editing in .cache/tikz-editor.")]
tikz-editor-checkout:
    bun run scripts/tikz-editor-dev.mjs checkout

[doc("Rebuild the editor assets on every save in the fork checkout.")]
tikz-editor-watch:
    bun run scripts/tikz-editor-dev.mjs watch

[doc("Typecheck the fork checkout and its embed, then write its changes to ZETTLR.patch.")]
tikz-editor-patch:
    bun run scripts/tikz-editor-dev.mjs patch

[doc("Rebuild the pinned Quiver assets.")]
update-quiver-vendor:
    bun run scripts/update-quiver-vendor.mjs
