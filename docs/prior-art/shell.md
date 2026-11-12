# Standalone shell

Audit of the standalone shell against established desktop document-editor conventions ([#22](https://github.com/dzackgarza/visual-tikz-editor/issues/22), part of [#17](https://github.com/dzackgarza/visual-tikz-editor/issues/17)). The shell is the document bar, its menus, the theme, the view rail, the window title, messages, and the dialogs around one document. The specification at the end replaces every earlier rule about these surfaces. Where [the interaction model](../interaction-model.md) disagrees, this document holds; [#25](https://github.com/dzackgarza/visual-tikz-editor/issues/25) rewrites the model and its stories. The status line belongs to [#21](https://github.com/dzackgarza/visual-tikz-editor/issues/21), zoom defaults to [#23](https://github.com/dzackgarza/visual-tikz-editor/issues/23), and settings to [#24](https://github.com/dzackgarza/visual-tikz-editor/issues/24).

## The shell today

Captured in the installed desktop app at 1600×1000 with a fresh profile and a figure of a circle, an arrow, and the node `$x^2$`.

| State | Screenshot |
| --- | --- |
| Document bar and Canvas view | ![The document bar over the Canvas view](images/shell-current.png) |
| File and Export menus both open | ![Both menus open at the right edge](images/shell-menus-open.png) |
| Quiver view for a tikzpicture | ![Quiver error panel and a three-line status](images/shell-quiver-error.png) |
| New dialog | ![The New dialog over an empty window](images/shell-new-dialog.png) |

Source: `standalone/StandaloneApp.vue`, `standalone/server.ts`, `src/preview-modes.ts`, `src/ui/TikzWorkbench.vue`, and `src-tauri/src/main.rs` in this repository.

- **Document bar.** One row holds the file name, the status text, the view status, a File menu, an Export menu, a "Copy source" button, and a theme button (`StandaloneApp.vue:3-27`).
- **Menus.** File and Export are `<details>` elements. Both lists open at the right edge of the bar (`position: absolute; right: 12px`, `:680-692`), not under their titles. Both can be open at once and then overlap the view rail. Escape and a click outside leave a menu open; the click outside also reaches the canvas and draws a stroke. A menu closes only on a choice inside it (`:140-145`).
- **Menu items.** File: "New tikzpicture or tikzcd…", "Open…", "Save", "Save As…", and "Exit" (desktop only). Export: "PDF", "SVG", "PNG"; each opens a save dialog but has no ellipsis. No item shows a shortcut and no menu has separators (`:7-24`).
- **Shortcuts.** Ctrl+S saves; Ctrl+=, Ctrl+−, Ctrl+0 zoom the Canvas view. No other shell command has a shortcut (`:510-523`).
- **Theme.** A plain button reads "Dark theme" or "Light theme", the theme it switches to. The theme is a stored preference; the first paint reads a `localStorage` key that nothing writes, then the server preference replaces it (`:26,245-247,390,531-535`). The system appearance (`prefers-color-scheme`) has no effect.
- **Views.** The rail always offers Code, Preview, Canvas, and Quiver (`:131-137`), with the glyphs "</>", "◉", "◇", "⤧". Each view has a `supports` test (`preview-modes.ts:46-79`), but the rail ignores it: Quiver for a tikzpicture and Canvas for a tikzcd open a panel "… cannot edit this diagram" with "Copy error" (`TikzWorkbench.vue:70-75`). The rail names differ from the views' own labels "TeX render", "Quiver canvas", and "Drawing canvas".
- **Window title.** Fixed at "Visual TikZ Editor" (`main.rs:29-30`); no file name and no unsaved marker. The desktop window has no native menu bar.
- **Messages.** An error replaces the status text in the same grey (`:252-253,318-319`). The Quiver error above grows the status to three lines and moves every control in the bar; closing the view leaves the message. "Copy source" and Export give no confirmation (`:492-508,539-547`).
- **Save conflict.** When the file changed on disk, the server keeps the editor text as a recovery draft and answers 412 (`server.ts:178-184`). The status reads "The file changed on disk; recovery draft saved". A later Save sends the same revision (`StandaloneApp.vue:466-479`, `server.ts:179`) and shows the same status; only Save As, Open, or New leave the state. No choice compares or overwrites.
- **New and start-up.** File > New opens a modal dialog: "New tikzpicture or tikzcd", "Choose a diagram type.", "tikzpicture", "tikzcd", "Open existing…", and "Cancel" only when a document is open. Escape and a click on the backdrop leave it open. While it is open every view unmounts and the window behind it is empty (`:39-51`). A launch with no file opens this dialog (`:370`).
- **Save changes dialog.** "Save changes?" with Cancel, Discard, and Save; Escape cancels (`:28-38`). This matches the convention below.

## Prior art

### Captured on this host

| Application | Evidence | What the shell audit takes from it |
| --- | --- | --- |
| Inkscape 1.4.4 | [window](images/inkscape-1.4.4.png); `/usr/share/inkscape/ui/menus.ui`; `/usr/share/inkscape/keys/inkscape.xml`; `xprop` title on a private display | A menu bar File, Edit, View, Layer, Object, Path, Text, Filters, Extensions, Help. File: New, New from Template…, Open…, Open Recent, Save, Save As…, Save a Copy…, Revert, Import…, Export…, Print…, Document Properties…, Close, Quit. Edit starts Undo, Redo, Undo History…, Cut, Copy, Paste. Shortcuts: New Ctrl+N, Open Ctrl+O, Save Ctrl+S, Save As Ctrl+Shift+S, Close Ctrl+W, Quit Ctrl+Q, Undo Ctrl+Z, Redo Ctrl+Shift+Z and Ctrl+Y, Document Properties Ctrl+Shift+D, Group Ctrl+G, Ungroup Ctrl+Shift+G, Preferences Ctrl+Shift+P. Window title "ref.svg - Inkscape", and "\*ref.svg - Inkscape" after one edit. |
| Ipe 7.2.30 | [window](images/ipe-7.2.30.png); `xprop` title | A menu bar; Document properties is in the Edit menu. A launch with no file opens an untitled document titled "Ipe [unsaved]", and "Ipe \*[unsaved]" after one edit. |
| Xournal++ 1.3.8 | [window](images/xournalpp-1.3.8.png); `xprop` title | A menu bar. A launch with no file opens an untitled document titled "Unsaved Document - Xournal++". Edit > Preferences has "Theme Variant", default "Use system default" (survey section 8). |

### Documented behaviour

| Question | Convention | Sources |
| --- | --- | --- |
| Where a menu opens | Under the element that opened it: "the menus that pull down from the menubars commonly found at the top of many desktop application windows"; a pull-down button shows its menu from the button; GTK places the popup below the button | [APG Menu and Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/); [HIG Pull-down buttons](https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons); survey section 9 |
| Moving between menus | While a menu is open, the pointer over another title closes the open menu and opens that one | APG menubar example `menubar-navigation.js` at [0f765e4](https://github.com/w3c/aria-practices/blob/0f765e4dc33e966026114ac12a8380db1de3b787/content/patterns/menubar/examples/js/menubar-navigation.js) `onMenuitemPointerover` (709-723); [GTK 4.16.0 `gtkpopovermenubar.c`](https://gitlab.gnome.org/GNOME/gtk/-/blob/4.16.0/gtk/gtkpopovermenubar.c) `item_enter_cb` and `set_active_item` (133-199) |
| Closing a menu | "Escape: Close the menu that contains focus and return focus to the element or context" that opened it; Enter on an item "activates the item and closes the menu"; "After people choose an item in a pull-down button's menu, the menu closes"; a press on the title of the open menu closes it (`onMenuitemClick`, 690-707); a press outside the menu bar closes every menu (`onBackgroundPointerdown`, 725-729) | APG Menu and Menubar; HIG Pull-down buttons; APG menubar example at 0f765e4 |
| What a press outside does | Only the dismissal: "When a popover is active, interactions with other views are normally disabled until the popover is dismissed"; "Clicking outside the popover area or pressing Esc will dismiss the popover" | [UIKit `passthroughViews`](https://developer.apple.com/documentation/uikit/uipopoverpresentationcontroller/passthroughviews); [GTK 4 `gtk_popover_set_autohide`](https://docs.gtk.org/gtk4/method.Popover.set_autohide.html) |
| Shortcut labels | The shortcut is the last child of the item, aligned to its trailing end | [GTK 4.16.0 `gtkmodelbutton.c`](https://gitlab.gnome.org/GNOME/gtk/-/blob/4.16.0/gtk/gtkmodelbutton.c) (851-859): the `accelerator` label with `GTK_ALIGN_END` |
| Opening a menu from the keyboard | Enter, Space, or Down Arrow "opens the menu and places focus on the first menu item" | [APG Menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) |
| Menu groups | "To help people visually distinguish such groups, use a separator" | [HIG Menus](https://developer.apple.com/design/human-interface-guidelines/menus) |
| Ellipsis | "Append an ellipsis to a menu item's label when the action requires more information before it can complete" | HIG Menus |
| File menu contents | New, Open, Open Recent ("don't display file paths"), Close ("Closes the current window or document"), Save, then export; Export belongs in the File menu. Inkscape File › Close, Ctrl+W (`menus.ui:102-103`, `keys/inkscape.xml:142`) | [HIG The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar); Inkscape menus |
| Settings item | HIG: "Settings…" with an ellipsis. Inkscape: Edit › "P_references", no ellipsis (`menus.ui:354`), Ctrl+Shift+P (`keys/inkscape.xml:82`) | HIG The menu bar; Inkscape menus |
| Show and hide items | Inkscape View › Show/Hide toggles each bar and the rulers with a boolean action, which GTK draws as a check item (`menus.ui:550-575`) | Inkscape menus |
| Stacking order | Inkscape Object menu: "Raise to _Top", "_Raise", "_Lower", "Lower to _Bottom" (`menus.ui:873-891`), Home, Page Up, Page Down, End (`keys/inkscape.xml:282-285`) | Inkscape menus |
| Unavailable menu bar items | "If a menu bar item isn't actionable, disable the action instead of hiding it from the menu" | HIG The menu bar |
| Edit menu contents | "The Edit menu lets people make changes to content in the current document … and provides commands for interacting with the Clipboard"; it starts Undo, Redo | HIG The menu bar; Inkscape menus |
| View menu | "The View menu lets people customize the appearance of all an app's windows"; "Provide a View menu even if your app supports only a subset of the standard view functions" | HIG The menu bar |
| Quit | "Quit YourAppName" in the app menu (macOS); "\_Quit", Ctrl+Q (Inkscape) | HIG The menu bar; Inkscape menus |
| Help and About | GNOME primary menus end with Preferences, Keyboard Shortcuts, Help, and About; "Every primary menu should include" About | [GNOME HIG Menus](https://developer.gnome.org/hig/patterns/controls/menus.html) |
| Figure settings | A Document Properties dialog: Inkscape File > Document Properties… (Ctrl+Shift+D); Ipe Edit > Document properties | Inkscape and Ipe menus |
| Theme | "Avoid offering an app-specific appearance setting … they may think your app is broken because it doesn't respond to their systemwide appearance choice"; no checked app puts a theme button in a toolbar; overrides sit in Preferences with the system as default (Xournal++, Notability, OneNote) | [HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode); survey section 8 |
| Views valid for the document | VS Code shows the editor-title button "Open Preview to the Side" only when `editorLangId` is Markdown (`markdown.showPreviewToSide`, `when: editorLangId =~ /^(markdown\|…)$/`) | [`extensions/markdown-language-features/package.json`](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/package.json) |
| Window title | File name, app name, and an unsaved marker: "\*ref.svg - Inkscape", "Ipe \*[unsaved]" | Captures |
| Untitled window title | Inkscape "New document %d" (`document.cpp:705` at dcaf3e7d9e); Ipe "[unsaved]"; Xournal++ "Unsaved Document - Xournal++", with no unsaved marker, since the document has no file (`Control.cpp:1974-1975,1991` at [v1.3.8](https://github.com/xournalpp/xournalpp/blob/v1.3.8/src/core/control/Control.cpp)) | Captures; Inkscape and Xournal++ sources |
| Start-up without a file | An untitled document of the default kind, with no chooser | Ipe and Xournal++ captures |
| Ongoing conditions | Banners "communicate persistent states" as "a strip along the top of a view" with one title and an optional button; examples "Working offline" and a read-only document | [GNOME HIG Banners](https://developer.gnome.org/hig/patterns/feedback/banners.html) |
| Single events | Toasts show "messages and actions in the context of using an app", are "always transient and user dismissible", and suit single occurrences | [GNOME HIG Toasts](https://developer.gnome.org/hig/patterns/feedback/toasts.html) |
| Save conflict | A failed save shows the error notification "Failed to save '{0}': The content of the file is newer. Please compare your version with the file contents or overwrite the content of the file with your changes.", with the actions Compare and Overwrite (129-132). Compare opens "{0} (in file) ↔ {1} (in {2}) - Resolve save conflict" (247-263), whose toolbar has two actions: accept the local changes, which saves with `ignoreModifiedSince`, and revert them (`acceptOrRevertLocalChangesCommand`, 418-449). A later Save sends the etag of the last read or write again (`lastResolvedFileStat.etag`; a failed save does not change it) and fails the same way | VS Code at 10cda960 [`textFileSaveErrorHandler.ts`](https://github.com/microsoft/vscode/blob/10cda960cfa7f133ab9dedcb01adff0b900c2186/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.ts), [`textFileEditorModel.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/textfile/common/textFileEditorModel.ts) |
| Modal dialogs | "Escape: Closes the dialog"; "When a dialog closes, focus returns to the element that invoked the dialog unless either: The invoking element no longer exists. Then, focus is set on another element that provides logical work flow." | [APG Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) |
| Focus after a menu choice | Enter on a menu item "Activates the menu item … Closes the menu. Sets focus on the menu button." | [APG Actions menu button example](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-actions/) |

Not verified from a primary source: how long a GNOME toast stays; the GNOME window title for a modified document; how GoodNotes and Notability title or close menus.

## Departures

| Control | Today | Convention | Departure |
| --- | --- | --- | --- |
| Menu placement | Both lists at the right edge of the bar | Under the menu title | Detached menus |
| Menu closing | Only a choice closes a menu; two can be open | Escape, a choice, a click outside, or another menu closes it; one at a time | No dismissal |
| Click outside an open menu | Reaches the canvas and draws | Closes the menu only | Click passes through |
| Menu set | File and Export menus, a Copy source button | File, Edit, View, Object, Help; Export and Copy inside menus | Commands spread across bar controls |
| Shortcut labels and separators | None | Shortcuts shown on items; groups separated | Missing |
| Ellipsis | "PDF", "SVG", "PNG" open a dialog without "…" | Ellipsis when more input follows | Missing ellipsis |
| "Exit" | "Exit", no shortcut | "Quit", Ctrl+Q | Name and shortcut |
| Shortcuts | Save, zoom, and Document Properties only | New, Open, Save As, Close, Quit, Undo, Redo, Document Properties, Group | Missing |
| Close | None | File › Close, Ctrl+W (HIG, Inkscape) | Missing |
| Theme | Toolbar button, stored preference, system ignored | Follow the system | Repaired |
| Views offered | All four, always | Only views valid for the document | Error panels on demand |
| View names | Rail and view labels differ; glyphs | One name per view | Two names |
| Window title | File name, app name, unsaved marker; an untitled document shows "Untitled.tikz - Visual TikZ Editor" | Untitled: "Unsaved Document - Xournal++" | The untitled title names a file that does not exist |
| Error display | Replaces status, wraps to three lines, moves the bar | Banner for a state, toast for an event | Layout shift; no distinction |
| Confirmation | None for Copy source and Export | Toast | Silent |
| Save conflict | Status text; Save keeps failing | Compare, then Overwrite or Revert in the compare view | No way to end the conflict |
| New | Modal kind chooser, workspace unmounted | New per kind in the menu | Repaired |
| Start-up without a file | Kind chooser | Untitled document of the default kind | Repaired |
| Dialog dismissal | New dialog ignores Escape | Escape closes; focus returns | Repaired |

## Specification

1. **Menu bar.** The document bar holds a menu bar: File, Edit, View, Object, Help. It is one implementation in the desktop and browser builds and follows the WAI-ARIA menubar pattern. A menu opens directly under its title. One menu is open at a time; while a menu is open, the pointer over another title moves to that menu, as in the APG menubar example and GTK. A choice, Escape, a press on the title of the open menu, or a press outside closes the menu (APG menubar example). A press outside does nothing else, as UIKit and GTK popovers take the dismissing press. Escape returns focus to the title. Items show their shortcut at the trailing end, as GTK menu items do; groups are separated, and an item that asks for more input ends in "…" (HIG Menus). The Export menu and the Copy source button leave the bar. At the trailing end of the document bar, Layers and Properties are buttons that open those inspectors, where HIG Toolbars puts "buttons that open nearby inspectors" ([drawing-dock specification](drawing-dock.md) item 2).
2. **File menu.** New tikzpicture (Ctrl+N), New tikzcd; Open… (Ctrl+O), Open Recent (file names, not paths); Save (Ctrl+S), Save As… (Ctrl+Shift+S), Export (PDF…, SVG…, PNG…); Document Properties… (Ctrl+Shift+D); Close (Ctrl+W), which closes the window as HIG The menu bar and Inkscape's File › Close do, and Quit (Ctrl+Q). Close and Quit are desktop only: a page cannot close a browser tab that the user opened ("Scripts may not close windows that were not opened by script", [MDN `Window.close()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/close)).
3. **Edit menu.** Undo (Ctrl+Z), Redo (Ctrl+Shift+Z, Ctrl+Y); Cut, Copy, Paste, Delete, Select All; Copy TikZ Source; Settings… (Ctrl+Shift+P). Inkscape and Xournal++ put their preferences in the Edit menu, and Inkscape gives them Ctrl+Shift+P; the name and the ellipsis are HIG's "Settings…". Each editing command goes to the focused view: the Code view, the Canvas, or Quiver.
4. **View menu.** The views, as check items; Properties and Layers, as check items, as Inkscape's View › Show/Hide toggles its bars ([panels specification](panels.md) item 1); the zoom commands and canvas aids of the [zoom specification](zoom-and-view.md) item 5. Menu items carry no word "Panel", as [panels specification](panels.md) item 4 names them.
5. **Object menu.** Group (Ctrl+G), Ungroup (Ctrl+Shift+G); Raise to Top (Home), Raise (Page Up), Lower (Page Down), Lower to Bottom (End), with Inkscape's names and keys. Raise and Lower are also in the Layers header; Raise to Top and Lower to Bottom are only here ([panels specification](panels.md) item 9).
6. **Help menu.** Keyboard Shortcuts, which lists every shortcut above; About Visual TikZ Editor.
7. **Views by document.** The rail offers only the views whose `supports` test holds for the document, as VS Code shows "Open Preview to the Side" only for a Markdown editor: Quiver for a tikzcd, Canvas for a tikzpicture, Code and Preview for both. The View menu lists all four and disables the views the document does not support, as HIG The menu bar says to disable, not hide, a menu bar item. Each view has one name in the rail, the View menu, and the view itself: Code, Preview, Canvas, Quiver. These names are the project's own. Rail buttons use icons from the icon set the canvas already uses, with the name as tooltip and accessible label.
8. **Theme.** The standalone interface follows the system appearance (`prefers-color-scheme`) and changes when the system changes, as HIG Dark Mode asks. No control in the app sets the theme, and no preference stores it. The embedded editor takes its host's theme through the `colorScheme` load setting, so it matches the host window around it.
9. **Window title.** "figure.tikz - Visual TikZ Editor", with a leading "\*" while there are unsaved changes, as in Inkscape. The browser build sets the page title the same way. An untitled document is titled "Unsaved Document - Visual TikZ Editor", with no "\*", as in Xournal++: it has no file, so it is always unsaved. The document bar shows the same name as the title.
10. **Messages.** The document bar is one row of fixed height; no message changes its height or moves its controls. A persistent state (the file changed on disk, the renderer is unavailable) shows as a banner at the top of the workspace with one title and at most one button, and leaves when the state ends (GNOME Banners). A single event shows as a toast (GNOME Toasts): "Copied TikZ source", "Exported figure.pdf", or the failed command and its reason. These texts are the project's own. Where the status text sits belongs to #21.
11. **Save conflict.** A Save that finds the file changed on disk fails and leaves the file unchanged. The conflict is a persistent state, so it shows as a banner with VS Code's title "Failed to save 'figure.tikz': The content of the file is newer." and one button, Compare. Compare shows the file text against the editor text, as VS Code's "Resolve save conflict" editor does, with VS Code's two actions: Overwrite, which writes the editor text over the file, and Revert, which replaces the editor text with the file text. Either action ends the conflict and removes the banner. A later Save fails the same way while the conflict lasts, as in VS Code.
12. **New and start-up.** File > New tikzpicture and New tikzcd create the document directly. A launch with no file opens an untitled tikzpicture, as Ipe and Xournal++ open an untitled document. Every dialog (Save changes, Document Properties) closes on Escape, returns focus to the control that opened it, and leaves the workspace mounted behind it (APG Dialog). A menu item no longer exists once its menu closes, so focus goes to the menu's title, where the APG menu button example sets focus after a choice.

## Implementation issues

An issue that names a dependency starts after that audit has its specification.

| Items | Issue | Depends on |
| --- | --- | --- |
| 1, 2, 6 | [#42](https://github.com/dzackgarza/visual-tikz-editor/issues/42) Menu bar with File and Help menus | — |
| 2 | [#50](https://github.com/dzackgarza/visual-tikz-editor/issues/50) Document Properties dialog in the File menu holds the figure scale and bounds | — |
| 8 | [#45](https://github.com/dzackgarza/visual-tikz-editor/issues/45) Theme follows the system appearance; delete the theme button | — |
| 9 | [#46](https://github.com/dzackgarza/visual-tikz-editor/issues/46) Window title shows the file name and an unsaved marker | — |
| 12 | [#51](https://github.com/dzackgarza/visual-tikz-editor/issues/51) New per kind without a chooser; untitled tikzpicture at launch; dialogs close on Escape | — |
| 3, 5 | [#43](https://github.com/dzackgarza/visual-tikz-editor/issues/43) Edit and Object menus send commands to the focused view | #24, #39 |
| 4, 7 | [#44](https://github.com/dzackgarza/visual-tikz-editor/issues/44) View menu; views offered by document kind; one name per view | #23 |
| 10 | [#47](https://github.com/dzackgarza/visual-tikz-editor/issues/47) Fixed-height document bar; banners and toasts | #21 |
| 11 | [#48](https://github.com/dzackgarza/visual-tikz-editor/issues/48) Save conflict: Compare and Overwrite | — |
