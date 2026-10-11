#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$repo"
version=$(bun -p 'require("./package.json").version')
package="$repo/src-tauri/target/release/bundle/deb/Visual TikZ Editor_${version}_amd64.deb"
test -f "$package"

bin_dir="$HOME/.local/bin"
resource_dir="$HOME/.local/lib/Visual TikZ Editor"
desktop_file="$HOME/.local/share/applications/visual-tikz-editor.desktop"
icon_file="$HOME/.local/share/icons/hicolor/512x512/apps/visual-tikz-editor.png"
for destination in "$bin_dir/visual-tikz-editor" "$bin_dir/workbench-host" "$resource_dir" "$desktop_file" "$icon_file"; do
  if test -e "$destination"; then
    printf 'Preserving existing path: %s\n' "$destination" >&2
    exit 1
  fi
done

staging=$(mktemp -d)
trap 'trash "$staging"' EXIT
ar p "$package" data.tar.gz | tar -xz -C "$staging"

install -d "$bin_dir" "$(dirname -- "$resource_dir")" "$(dirname -- "$desktop_file")" "$(dirname -- "$icon_file")"
install -m 0755 "$staging/usr/bin/visual-tikz-editor" "$bin_dir/visual-tikz-editor"
install -m 0755 "$staging/usr/bin/workbench-host" "$bin_dir/workbench-host"
cp -a "$staging/usr/lib/Visual TikZ Editor" "$resource_dir"
install -m 0644 "$staging/usr/share/icons/hicolor/512x512/apps/visual-tikz-editor.png" "$icon_file"
sed "s|Exec=visual-tikz-editor|Exec=$bin_dir/visual-tikz-editor|" \
  "$staging/usr/share/applications/Visual TikZ Editor.desktop" > "$staging/visual-tikz-editor.desktop"
desktop-file-validate "$staging/visual-tikz-editor.desktop"
install -m 0644 "$staging/visual-tikz-editor.desktop" "$desktop_file"
printf 'Installed Visual TikZ Editor: %s\n' "$desktop_file"
