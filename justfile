# Visual TikZ Editor — standalone workbench commands.
# Bun owns the package build; the pinned vendor scripts rebuild editor assets.

# Show available commands.
default:
    @just --list

# Open a TikZ or tikz-cd file in the standalone editor.
[no-cd]
run file:
    bun run "{{justfile_directory()}}/standalone/server.ts" "{{file}}"

# Build the standalone browser page.
build:
    bun run build

# Check the TypeScript and Vue source.
test-commit:
    bun run typecheck

# Run the workbench tests.
test-push:
    bun test test

# Run the workbench tests.
test:
    bun test test

# Rebuild the pinned TikZ Editor assets.
update-tikz-editor-vendor:
    bun run scripts/update-tikz-editor-vendor.mjs

# Rebuild the pinned Quiver assets.
update-quiver-vendor:
    bun run scripts/update-quiver-vendor.mjs
