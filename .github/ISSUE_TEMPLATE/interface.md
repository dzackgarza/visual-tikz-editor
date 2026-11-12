---
name: Interface change
about: A change to a control, panel, menu, gesture, or message, grounded in prior art
labels:
  - enhancement
  - area:frontend
---

Part of #<audit issue>. Specification items <n> of [docs/prior-art/<specification>.md](https://github.com/dzackgarza/visual-tikz-editor/blob/main/docs/prior-art/<specification>.md).

## Current state

What the editor does today, with source references (`file.ts:line`) and a screenshot from a fresh profile.

## Prior art

Required before any requirement is written. For each application: its name and version, its documented behaviour quoted with a link or a source path and line, and a screenshot committed under `docs/prior-art/images/`. Name at least one desktop vector editor (Inkscape, Ipe, Illustrator) and one pen-and-touch notebook (Xournal++, GoodNotes, Notability, Apple Notes) when both kinds have the control. When the question is not in a specification yet, add the research to the owning specification first.

## Requirements

- Each requirement states the behaviour and names the application it follows.

## Depends on

Issues that must land first, or "—".

## Acceptance

Browser stories with mouse, pen, and finger, in the standalone app and the Zettlr embed, that fail on the present build and pass after the change. Name the existing stories that assert the replaced behaviour; they are rewritten in the same change.
