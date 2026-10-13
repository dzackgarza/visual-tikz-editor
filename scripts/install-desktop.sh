#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$repo"
version=$(bun -p 'require("./package.json").version')
packages=("$repo/src-tauri/target/release/bundle/deb/Visual TikZ Editor_${version}_"*.deb)
if [[ ${#packages[@]} -ne 1 || ! -f ${packages[0]} ]]; then
  printf 'Expected one built Visual TikZ Editor package for version %s\n' "$version" >&2
  exit 1
fi
package=${packages[0]}

data_home=${XDG_DATA_HOME:-$HOME/.local/share}
if [[ $data_home != /* ]]; then
  printf 'XDG_DATA_HOME must be an absolute path: %s\n' "$data_home" >&2
  exit 1
fi

app_dir="$data_home/visual-tikz-editor"
desktop_file="$data_home/applications/visual-tikz-editor.desktop"
icon_file="$data_home/icons/hicolor/512x512/apps/visual-tikz-editor.png"
marker="$app_dir/.managed-by-visual-tikz-editor"
if [[ -L $app_dir || ( -e $app_dir && ! -f $marker ) ]]; then
  printf 'Preserving unmanaged application directory: %s\n' "$app_dir" >&2
  exit 1
fi
if [[ -L $desktop_file ]] || { [[ -e $desktop_file ]] && ! grep -Fqx "Exec=\"$app_dir/bin/visual-tikz-editor\" %F" "$desktop_file"; }; then
  printf 'Preserving unmanaged desktop entry: %s\n' "$desktop_file" >&2
  exit 1
fi
if [[ -L $icon_file || ( -e $icon_file && ! -f $marker ) ]]; then
  printf 'Preserving unmanaged icon: %s\n' "$icon_file" >&2
  exit 1
fi

install -d "$data_home" "$(dirname -- "$desktop_file")" "$(dirname -- "$icon_file")"
staging=$(mktemp -d "$data_home/.visual-tikz-editor.XXXXXX")
trap 'trash "$staging"' EXIT
install -d "$staging/package" "$staging/app/bin" "$staging/app/lib"
ar p "$package" data.tar.gz | tar -xz -C "$staging/package"
install -m 0755 "$staging/package/usr/bin/visual-tikz-editor" "$staging/app/bin/visual-tikz-editor"
install -m 0755 "$staging/package/usr/bin/workbench-host" "$staging/app/bin/workbench-host"
cp -a "$staging/package/usr/lib/Visual TikZ Editor" "$staging/app/lib/Visual TikZ Editor"
printf 'visual-tikz-editor\n' > "$staging/app/.managed-by-visual-tikz-editor"
cp "$staging/package/usr/share/applications/Visual TikZ Editor.desktop" "$staging/visual-tikz-editor.desktop"
desktop-file-edit --set-key=Exec --set-value="\"$app_dir/bin/visual-tikz-editor\" %F" "$staging/visual-tikz-editor.desktop"
desktop-file-validate "$staging/visual-tikz-editor.desktop"

if [[ -e $app_dir ]]; then
  mv "$app_dir" "$staging/previous"
fi
if ! mv "$staging/app" "$app_dir"; then
  if [[ -e $staging/previous ]]; then mv "$staging/previous" "$app_dir"; fi
  exit 1
fi
install -m 0644 "$staging/package/usr/share/icons/hicolor/512x512/apps/visual-tikz-editor.png" "$icon_file"
install -m 0644 "$staging/visual-tikz-editor.desktop" "$desktop_file"
update-desktop-database "$(dirname -- "$desktop_file")"
printf 'Installed Visual TikZ Editor: %s\n' "$desktop_file"
