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
| `load` | `source`, `fileName`, `settings`, `state`, `imageBaseUrl`, `nativeClipboard` | Opens the document with its view state (FR-040) |
| `settings` | `general.colorScheme`: `system` \| `light` \| `dark` | Sets the appearance from Settings › Appearance (FR-005) |
| `display` | `fullscreen` | Fills the window |
| `panel` | `panel`: `layers` \| `properties` \| `null` | Opens one panel or closes the open one; `null` also when the shell opens the Code panel (FR-060, research R13) |
| `replace-source` | `source` | Shows the source that Undo or Redo restored; keeps the viewport and the tool (research R3) |
| `dismiss-popover` | — | Closes the canvas popover, because the shell opened one (research R16) |
| `zoom` | `direction`: `in` \| `out` \| `fit` \| `selection` \| `normal`, or `scale` | The zoom commands of the readout ([surfaces](surfaces.md), Canvas controls; research R8) |
| `source`, `snapshot` | — | Reads the source or a rendered snapshot |
| `keyboard` | `bottom` | The height of the on-screen keyboard over the frame |
| `clipboard-result` | `targetRequestId`, `text` or `error` | Answers `clipboard-read` |
| `import-ink`, `interpret-ink`, `restore-ink` | `source`, `strokes` or `key` | Ink import and Restore Original Stroke (FR-027) |
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
| `persistence-save` | `key`, `value` | A preference or per-file view state to keep outside the source |
| `source-selection` | `source`, `from`, `to` | The selected source range, for the Code panel |
| `clipboard-read`, `clipboard-write` | `requestId`, `text` | Native clipboard in a desktop window |
| `export` | `format`, `source`, `svg`, `data` | The result of an export |
| `message`, `error` | `title`, `message` | A failure that the workbench reports |

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
