# Architecture

Misket is a local-first desktop app. There is no server: a project is one
SQLite file (`*.misket`) on the user's disk, and every action is a transaction
against it.

```
┌──────────────────────────────┐   invoke()   ┌──────────────────────────┐
│ src/  React + TypeScript      │ ───────────▶ │ src-tauri/  Tauri commands│
│   api/      typed wrappers    │ ◀─────────── │   thin wrappers, AppState │
│   core/     pure logic + tests│   JSON DTOs  └────────────┬─────────────┘
│   queries/  TanStack hooks    │                           │ &Connection
│   state/    zustand stores    │              ┌────────────▼─────────────┐
│   components/                 │              │ crates/misket-core        │
└──────────────────────────────┘              │   db/: schema, documents, │
                                              │   codes, excerpts, memos, │
                                              │   export; models; errors  │
                                              └────────────┬─────────────┘
                                                           │ rusqlite (bundled)
                                                      project.misket
```

## Layers

- **`crates/misket-core`** owns the schema, migrations and all domain logic as
  plain functions over a `rusqlite::Connection`. It has no UI or Tauri
  dependency, so every rule (range validation, cycle guards, cascades,
  snapshots for undo) is unit-tested against an in-memory database.
- **`src-tauri`** exposes those functions as Tauri commands. `AppState` holds
  the open project behind a mutex; each command locks it for a few
  milliseconds. Errors serialize as `{ code, message }` so the frontend can
  branch on the code.
- **`src/core`** is pure TypeScript with no React or Tauri imports (enforced by
  ESLint): offset conversion, paragraph segmentation, DOM selection mapping,
  the code tree, the undo stack, the keymap and the importers. Most frontend
  tests live here.
- **`src/queries`** wraps commands in TanStack Query hooks and registers undo
  commands for mutations. **`src/state`** holds ephemeral UI state (current
  view, pending selection, focused excerpt, palette, toasts).

## Text and offsets

Document text is normalized once at import (BOM stripped, LF line endings,
Unicode NFC) and never edited, so excerpt offsets stay valid forever.
Offsets are stored as **Unicode code points**, end-exclusive. The DOM works in
UTF-16, so `src/core/offsets.ts` converts at exactly two points: when a
selection becomes an `apply_codes` call, and when excerpts are loaded for
rendering. Rust re-validates every range against the stored length and
recomputes the excerpt snapshot itself.

## Rendering highlights

The document view splits text into paragraphs on `\n` and each paragraph into
segments at excerpt boundaries (`src/core/segmentation.ts`). Every segment is a
`<span data-s=…>` whose only child is a text node; nothing else inside the text
root contains text. That contract is what lets `src/core/selection.ts` map a
browser `Range` back to document offsets. Overlapping excerpts are drawn as
stacked underline lanes (one per code, up to four) over a neutral tint.

## Undo

Undo is an inverse-command stack on the frontend (`src/core/undo.ts`). Each
mutation registers a command with `redo()`/`undo()` that call backend commands;
deletes return snapshots that `restore_*` reinserts with the original ids.
Operations that cannot be inverted cheaply (deleting a document or code,
merging codes, importing) confirm first and clear the stack.

## Milestone 2 (images and video)

The `excerpts` table already has `kind` (`text` | `image_region` |
`video_range`), `geometry` (normalized rectangle JSON) and millisecond
`start_pos`/`end_pos` for video. Media documents will be stored by reference
(`documents.source_path`, `media_json`). No schema migration is needed to add
the viewers.
