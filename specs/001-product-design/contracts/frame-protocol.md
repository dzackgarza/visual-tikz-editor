# Contract: frame protocol

The workbench reaches each editor frame only through messages (constitution, Architecture and
Boundaries). This contract states the messages that the [surfaces](surfaces.md) need. The
schemas live in `vendor/tikz-editor/embed/src/commands.ts` and `events.ts` for the canvas editor,
and in `vendor/quiver/ZETTLR.patch` for Quiver. A change to a message changes the protocol
version that `init` reports; the workbench refuses an editor that reports another version.

Every canvas command carries `sessionId`, `revision`, and `requestId`, and gets one `reply` with
`status` `ok` or `failed` and a `CommandFailure`. Every canvas event carries `sessionId` and
`revision`.

## Canvas editor: commands from the workbench

| Command | Fields | Purpose |
| --- | --- | --- |
| `load` | `source`, `fileName`, `state`, `imageBaseUrl`, `nativeClipboard` | Opens the document at its kept view state (FR-040); a `state` whose figure the source no longer holds opens the document as one without a view state |
| `display` | `fullscreen` | Fills the window |
| `panel` | `panel`: `layers` \| `properties` \| `null` | Opens one panel or closes the open one; `null` also when the shell opens the Code panel (FR-060, research R13) |
| `replace-source` | `source` | Shows the source that Undo or Redo restored; keeps the viewport and the tool (research R3) |
| `dismiss-popover` | — | Closes the canvas popover, because the shell opened one (research R16) |
| `zoom` | `direction`: `in` \| `out` \| `fit` \| `selection` \| `normal`, or `scale` | The zoom commands of the readout ([surfaces](surfaces.md), Canvas controls; research R8) |
| `source`, `snapshot` | — | Reads the source or a rendered snapshot |
| `keyboard` | `bottom` | The height of the on-screen keyboard over the frame |
| `clipboard-result` | `targetRequestId`, `text` or `error` | Answers `clipboard-read` |
| `cancel` | `targetRequestId` | Cancels a running command |

## Canvas editor: events to the workbench

| Event | Fields | Purpose |
| --- | --- | --- |
| `init` | `version` | The protocol version |
| `loaded`, `rendered` | `sourceRevision` | The document is shown |
| `change` | `source`, `sourceRevision` | An edit: one step of the document history (research R3); the save state goes to unsaved (FR-006) |
| `save` | `source`, `fileName` | The Save shortcut inside the canvas |
| `undo-request`, `redo-request` | — | The Undo or Redo shortcut inside the canvas; the shell acts on the document history (FR-012b) |
| `selection` | `empty` | Properties shows the figure when the selection is empty (FR-060a) |
| `panel` | `panel`: `layers` \| `properties` \| `null` | The panel that is open, after any change, including its own close button |
| `popover-opened` | — | The canvas opened a popover; the shell closes its own (research R16) |
| `settings-request` | — | The Settings shortcut inside the canvas; the shell opens the Settings window (FR-062) |
| `persistence-save` | `key`, `value` | A preference to keep outside the source, among them Settings › Appearance (FR-062) |
| `view-state` | `state`: figure, selection, tool, view (the scale and the figure point at the centre of the canvas, as Inkscape keeps a document's zoom and centre), Zoom to Fit, geometry interpretation, and the locked and hidden statements (each its span and text; data-model Layer) | The settled view of the loaded file; the workbench keeps it in `$XDG_STATE_HOME/visual-tikz-editor/view-state.json`, keyed by file path, and sends it in the next `load` of that file (FR-040, FR-063) |
| `source-selection` | `source`, `from`, `to` | The selected source range, for the Code panel |
| `clipboard-read`, `clipboard-write` | `requestId`, `text` | Native clipboard in a desktop window |
| `export` | `format`, `source`, `svg`, `data` | The result of an export |
| `message`, `error` | `title`, `message` | A failure that the workbench reports |

## Canvas editor: the Settings window

The editor page opened with `view=settings` in its hash shows only the Settings window, over the
whole app (FR-062). It reads the saved preferences from `storage` in its hash, as every editor
page does, and takes no commands. Its events:

| Event | Fields | Purpose |
| --- | --- | --- |
| `persistence-save` | `key`, `value` | A changed setting; the workbench keeps it in `$XDG_CONFIG_HOME/visual-tikz-editor/preferences.json` |
| `settings-closed` | — | The Settings window closed |

The open canvas frames read a changed setting from the browser storage they share with the
Settings window.

## Quiver: messages

| Direction | Message | Purpose |
| --- | --- | --- |
| to Quiver | `zettlr-quiver:load`, `zettlr-quiver:source` | Opens or replaces the `tikzcd` source, also after Undo or Redo (research R3) |
| to Quiver | `zettlr-quiver:theme` | Sets the appearance (FR-005) |
| to Quiver | `zettlr-quiver:display` | Fills the window |
| from Quiver | `zettlr-quiver:ready`, `zettlr-quiver:loaded` | The frame is ready; the diagram is shown |
| from Quiver | `zettlr-quiver:change` | An edit, with the source: one step of the document history |
| from Quiver | `zettlr-quiver:undo-request`, `zettlr-quiver:redo-request` | The Undo or Redo shortcut inside Quiver; the shell acts on the document history (FR-012b) |
| from Quiver | `zettlr-quiver:save`, `zettlr-quiver:close-request`, `zettlr-quiver:error` | Save, close, and failure |

Inside the shell, Quiver's toolbar shows no Undo, Redo, Save, autosave, theme, or About (research R3).
