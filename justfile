# Visual TikZ Editor — standalone workbench commands.
# Bun owns the package build; the pinned vendor scripts rebuild editor assets.

# Show available commands.
default:
    @just --list

# Start a new diagram, or open an existing TikZ file.
[no-cd]
run file="": build
    bun run "{{justfile_directory()}}/standalone/server.ts" "{{file}}"

# Build the standalone browser page.
build:
    bun run build

# Build a Linux desktop package with an application entry and icon.
package:
    bunx tauri build --bundles deb

# Sync the desktop app and menu entry for this user.
install-desktop: package
    bash scripts/install-desktop.sh

[private]
build-desktop-assets: build
    bun build --compile standalone/server.ts --outfile "src-tauri/binaries/workbench-host-${TAURI_ENV_TARGET_TRIPLE}"

# Check the TypeScript and Vue source.
test-commit:
    bun run typecheck

# Run the workbench tests.
test-push:
    bun run test

# Run the workbench tests.
test:
    bun run test

# Rebuild the pinned TikZ Editor assets.
update-tikz-editor-vendor:
    bun run scripts/update-tikz-editor-vendor.mjs

# Rebuild the pinned Quiver assets.
update-quiver-vendor:
    bun run scripts/update-quiver-vendor.mjs
