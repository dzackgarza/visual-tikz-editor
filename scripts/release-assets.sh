#!/usr/bin/env bash
# Usage: release-assets.sh <run-id>
# Writes the release assets of HEAD to .cache/release/<sha>/assets and prints that directory.
# <run-id> must be a green Development diagnostics run of HEAD, and the tree must be clean;
# `just release-assets` builds the page and the Debian package at HEAD first.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <development-diagnostics-run-id>\n' "$0" >&2
  exit 2
fi
run=$1

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$repo"
sha=$(git rev-parse HEAD)
if [[ -n $(git status --porcelain) ]]; then
  printf 'The working tree has changes; release assets come from a clean HEAD (%s)\n' "$sha" >&2
  exit 1
fi
record=$(gh run view "$run" --json headSha,conclusion --jq '.headSha + " " + .conclusion')
if [[ $record != "$sha success" ]]; then
  printf 'Run %s is "%s"; it must be a successful run of %s\n' "$run" "$record" "$sha" >&2
  exit 1
fi

version=$(bun -p 'require("./package.json").version')
package="src-tauri/target/release/bundle/deb/Visual TikZ Editor_${version}_amd64.deb"
stage="$repo/.cache/release/$sha"
if [[ -e $stage ]]; then
  printf 'Release stage already exists: %s\n' "$stage" >&2
  exit 1
fi
mkdir -p "$stage/assets" "$stage/qualification"

git archive --format=tar --prefix=visual-tikz-editor/ HEAD > "$stage/source.tar"
tar --transform 's,^,visual-tikz-editor/,' -rf "$stage/source.tar" standalone/dist
gzip -n -c "$stage/source.tar" > "$stage/assets/standalone-workbench.tar.gz"
cp "$package" "$stage/assets/visual-tikz-editor_${version}_amd64.deb"

printf '%s\n' "$sha" > "$stage/qualification/revision.txt"
gh run view "$run" --log > "$stage/qualification/development-diagnostics-$run.log"
gh run view "$run" --json url,headSha,conclusion,createdAt,updatedAt > "$stage/qualification/development-diagnostics-$run.json"
gh run download "$run" -D "$stage/qualification/ci-artifacts"
tar -C "$stage" -czf "$stage/assets/qualification.tar.gz" qualification

(cd "$stage/assets" && sha256sum standalone-workbench.tar.gz "visual-tikz-editor_${version}_amd64.deb" qualification.tar.gz > SHA256SUMS)
printf '%s\n' "$stage/assets"
