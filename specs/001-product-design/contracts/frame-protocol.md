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
| `panel` | `panel`: `layers` \| `properties` \| `null` | Opens one panel or closes the open one (research R13) |
| `document-properties` | — | Opens Document Properties from the title menu |
| `undo`, `redo` | — | Acts on the canvas history (research R3) |
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
| `change` | `source`, `sourceRevision` | An edit; the save state goes to unsaved (FR-006) |
| `save` | `source`, `fileName` | The Save shortcut inside the canvas |
| `history` | `canUndo`, `canRedo` | Dims Undo and Redo in the document bar (research R3) |
| `selection` | `empty` | Dims Properties with nothing selected (research R13) |
| `panel` | `panel`: `layers` \| `properties` \| `null` | The panel that is open, after any change, including its own close button |
| `popover-opened` | — | The canvas opened a popover; the shell closes its own (research R16) |
| `input` | — | The canvas took input; it becomes the input view (data model, View) |
| `persistence-save` | `key`, `value` | A preference or per-file view state to keep outside the source |
| `source-selection` | `source`, `from`, `to` | The selected source range, for the Code view |
| `clipboard-read`, `clipboard-write` | `requestId`, `text` | Native clipboard in a desktop window |
| `export` | `format`, `source`, `svg`, `data` | The result of an export |
| `message`, `error` | `title`, `message` | A failure that the workbench reports |

## Quiver: messages

| Direction | Message | Purpose |
| --- | --- | --- |
| to Quiver | `zettlr-quiver:load`, `zettlr-quiver:source` | Opens or replaces the `tikzcd` source |
| to Quiver | `zettlr-quiver:theme` | Sets the appearance (FR-005) |
| to Quiver | `zettlr-quiver:display` | Fills the window |
| to Quiver | `zettlr-quiver:undo`, `zettlr-quiver:redo` | Acts on Quiver's history (research R3) |
| from Quiver | `zettlr-quiver:ready`, `zettlr-quiver:loaded` | The frame is ready; the diagram is shown |
| from Quiver | `zettlr-quiver:change` | An edit, with the source |
| from Quiver | `zettlr-quiver:history` | `canUndo`, `canRedo` |
| from Quiver | `zettlr-quiver:input` | Quiver took input; it becomes the input view |
| from Quiver | `zettlr-quiver:save`, `zettlr-quiver:close-request`, `zettlr-quiver:error` | Save, close, and failure |

Inside the shell, Quiver's toolbar shows no Undo, Redo, Save, autosave, theme, or About (research R3).
