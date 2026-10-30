# Visual TikZ Editor — standalone workbench commands.
# Bun owns the package build; the pinned vendor scripts rebuild editor assets.
# QC delegates to ~/ai-review-ci/justfiles/bun.just: `test-commit` and `test-push`
# run from the git hooks, `test-ci` runs in the Development diagnostics workflow
# on every push, and `ambient` runs on the daily schedule. The workbench suite
# (`bun run test`) runs inside `test-ci`; `_ci-environment` provisions its runner.

ai_review_ci_schema_version := "1"
ai_review_ci_profile := "bun"
ai_review_ci_ref := "main"
ai_review_ci_release_channel := "main"
ai_review_ci_workflow_template_version := "1"
ai_review_ci_local_delegation := "global-justfile"
ai_review_ci_default_branch := "main"

# Show available commands.
default:
    @just --list

# Start a new diagram, or open an existing TikZ file.
[no-cd]
run file="": build
    bun run "{{justfile_directory()}}/standalone/server.ts" "{{file}}"

# Sync node_modules from the lockfile.
[private]
install:
    bun install

# Build the standalone browser page.
build: install
    bun run build

# Build a Linux desktop package with an application entry and icon.
package:
    bun run package

# Sync the desktop app and menu entry for this user.
install-desktop: package
    bash scripts/install-desktop.sh

[private]
build-desktop-assets: build
    bun build --compile standalone/server.ts --outfile "src-tauri/binaries/workbench-host-${TAURI_ENV_TARGET_TRIPLE}"

# Commit gate: syntax and type checks through the global QC justfile.
test-commit:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-commit

# Push gate: the commit checks plus the logic tests and the workbench browser suite.
test-push:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-push

# CI gate: the push checks under coverage plus the policy-sensitive gates.
test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci

# Scheduled whole-tree audit.
ambient:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . ambient

# Provision a bare Ubuntu CI runner for the workbench suite: the locked Playwright
# chromium, a display and dialog stack for the file stories, the TeX render toolchain,
# and the hermetic render fixture as the runner's ~/.pandoc data tree. Refuses to run
# outside CI because it writes ~/.pandoc and installs system packages.
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
        pdf2svg texlive-latex-base texlive-pictures texlive-latex-extra
    mkdir -p "$HOME/.pandoc"
    cp -R test/fixtures/tikz-data/filters test/fixtures/tikz-data/templates "$HOME/.pandoc/"
    kpsewhich standalone.cls tikz.sty tikz-cd.sty amsmath.sty amssymb.sty import.sty graphicx.sty >/dev/null

# Rebuild the pinned TikZ Editor assets.
update-tikz-editor-vendor:
    bun run scripts/update-tikz-editor-vendor.mjs

# Materialize the tikz-editor fork for editing in .cache/tikz-editor.
tikz-editor-checkout:
    bun run scripts/tikz-editor-dev.mjs checkout

# Rebuild the editor assets on every save in the fork checkout.
tikz-editor-watch:
    bun run scripts/tikz-editor-dev.mjs watch

# Typecheck the fork checkout and write its changes to ZETTLR.patch.
tikz-editor-patch:
    bun run scripts/tikz-editor-dev.mjs patch

# Rebuild the pinned Quiver assets.
update-quiver-vendor:
    bun run scripts/update-quiver-vendor.mjs
