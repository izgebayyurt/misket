# Misket

Open-source qualitative coding for text, with images and video on the way.
Misket is a local-first desktop app: your project is a single file on your
machine, and nothing is uploaded anywhere.

**[Website and docs](https://izgebayyurt.github.io/misket/)** — install
guide, coding tutorial, keyboard cheatsheet.

It is an alternative to tools like Dedoose for researchers who want a modern,
keyboard-friendly interface without a subscription.

![Coding a transcript](docs/screenshots/coding.png)

## What it does today (milestone 1)

- **Import** plain text, Markdown, Word (`.docx`) and PDF (text only) documents,
  one at a time or a whole folder at once ("Import folder…", optionally
  including subfolders). If a file has blank-line gaps, trailing spaces or other likely-accidental
  whitespace, Misket offers to tidy it up before import (document text is
  immutable once imported). Check "Remember my choice" in that dialog to skip
  it on future imports; its "Ask again on import" link resets that.
- **Build a codebook**: nested codes with colors, descriptions, single-key
  hotkeys, drag-and-drop reordering, merge and delete with impact preview, and
  "Move excerpts to…" to hand one code's excerpts to another without losing
  either code. Import a codebook (JSON or CSV) exported from another Misket
  project to reuse it: merge it into the current codebook by matching code
  names, or add it fresh under a chosen code.
- **Code excerpts**: select text, press `Ctrl`/`⌘`+`K` and pick a code (type
  `>name` to create one on the spot), or press a code's hotkey. The picker
  shows each code's description and, for nested codes, its full path.
  Overlapping excerpts are drawn as stacked colored lanes.
- **Adjust what is coded**: move an excerpt's start or end by a word or a
  character from the keyboard, drag the grips at either end, split an excerpt
  at the cursor, or merge it with a touching neighbour (codes and memos are
  combined). All of it is undoable.
- **Browse excerpts** across the project, filtered by code (with sub-codes),
  document, or uncoded only, and jump back to any of them in context.
  Tick the checkboxes (`Shift`+click for a range, or "Select all N loaded") to
  add a code to, remove a code from, or delete many excerpts at once; `Escape`
  clears the selection and undo reverses the whole batch.
- **Analyse**: a code frequency table (own counts and counts with sub-codes,
  per document), a code co-occurrence matrix showing which codes overlap on the
  same text, and a code-by-document heatmap. Every cell clicks through to the
  matching excerpts, and each view exports to CSV.
- **Descriptors**: define document attributes (text, number, choice or date)
  such as site, interview wave or age group, set them per document or in a
  table of every document, and filter excerpts by them ("Age is more than 30",
  "Site is any of North, South").
- **Memos** on documents, codes, excerpts and the project.
- **Undo/redo** for every coding and codebook action.
- **Export** the codebook as CSV or a reusable JSON file, excerpts as CSV, or
  the whole project as JSON.

![Excerpt browser](docs/screenshots/browser.png)

## Keyboard

| Action                                                 | Shortcut                                      |
| ------------------------------------------------------ | --------------------------------------------- |
| Code the selection / add a code to the focused excerpt | `Ctrl`/`⌘` + `K`                              |
| Apply a code directly                                  | its hotkey (set in the code's settings)       |
| Next / previous excerpt                                | `Tab` / `Shift`+`Tab`                         |
| Edit the focused excerpt                               | `Enter`                                       |
| Delete the focused excerpt                             | `Backspace`                                   |
| Move the excerpt's **end** by a word                   | `Alt` + `←` / `→`                             |
| Move the excerpt's **end** by a character              | `Ctrl`/`⌘` + `Shift` + `←` / `→`              |
| Move the excerpt's **start** by a word                 | `Ctrl`/`⌘` + `Alt` + `←` / `→`                |
| Move the excerpt's **start** by a character            | `Ctrl`/`⌘` + `Alt` + `Shift` + `←` / `→`      |
| Split the focused excerpt at the cursor                | `Ctrl`/`⌘` + `Shift` + `S`                    |
| Merge the focused excerpt with its neighbour           | `Ctrl`/`⌘` + `Shift` + `M`                    |
| Extend the selection by a word                         | `Alt` + `Shift` + `←` / `→`                   |
| New memo on the current document, code or excerpt      | `Ctrl`/`⌘` + `M`                              |
| Excerpt browser                                        | `Ctrl`/`⌘` + `E`                              |
| Analysis views                                         | `Shift` + `Ctrl`/`⌘` + `A`                    |
| Find in the current document                           | `Ctrl`/`⌘` + `F`                              |
| Find in project (search every document)                | `Shift` + `Ctrl`/`⌘` + `F`                    |
| Import documents                                       | `Ctrl`/`⌘` + `I`                              |
| Undo / redo                                            | `Ctrl`/`⌘` + `Z` / `Shift` + `Ctrl`/`⌘` + `Z` |
| Settings (theme, text size, confirm-delete)            | `Ctrl`/`⌘` + `,`                              |
| Keyboard shortcuts reference                           | `Ctrl`/`⌘` + `/`                              |

`Alt` + arrows move the focused excerpt's **end** edge; adding `Ctrl`/`⌘`
moves the **start** edge instead, and adding `Shift` steps by one character
rather than one word. The end edge's character step is the one exception to
that rule — it drops `Alt`, because `Alt` + `Shift` + arrows already extends
the selection. You can also drag the round grips at either end of the focused
excerpt; every adjustment, split and merge is undoable.

## Install

Builds for macOS, Windows and Linux are published on the
[releases page](https://github.com/izgebayyurt/misket/releases). They are not
code-signed yet: macOS will ask you to allow the app under System Settings >
Privacy & Security, and Windows SmartScreen will show a warning the first time.

## Your data

Your project is a `.misket` file (a SQLite database) on your own disk; nothing
leaves your computer. Before a destructive change — deleting a document,
deleting a code that has excerpts, merging one code into another, or importing
a codebook — Misket
writes a timestamped copy into a `<project name>.backups/` folder next to the
project file, and keeps the newest 20 (configurable in Settings). Use
**Backups…** in the status bar to browse them, see their size and reason, and
restore one (which first backs up the current state too, so restoring is
itself never destructive). Use **Export > Save a copy as…** at any time for a
manual snapshot. None of this replaces your own backup discipline for
anything that matters.

No project yet? Click "Try Misket with sample data" on the start screen for a
ready-made study to explore.

## Development

Prerequisites: Node 22, pnpm 10, Rust stable, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm tauri dev          # run the app with hot reload
pnpm check              # lint + typecheck + vitest
cargo test --workspace  # database and domain logic tests
pnpm tauri build        # installable bundle for this platform
```

### Setting up on macOS from scratch

Minimums: Rust 1.85 or newer (some dependencies use the 2024 edition) and
Node 22. Use rustup for Rust and a version manager such as nvm for Node; the
Homebrew `rust` and `node@22` packages are easy to end up with stale or
mismatched libraries.

```sh
xcode-select --install                                   # compilers and system SDKs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust stable (or: rustup update stable)
brew install nvm && nvm install 22                       # Node 22 (follow nvm's shell-setup notes first)
corepack enable && corepack prepare pnpm@10.33.0 --activate      # pnpm, pinned by package.json
git clone https://github.com/izgebayyurt/misket.git ~/Documents/GitHub/misket
cd ~/Documents/GitHub/misket
pnpm install
pnpm tauri dev
```

The first `pnpm tauri dev` compiles the Rust side and takes a few minutes; later
runs are incremental.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit
together, [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for the schema, and
[e2e/README.md](e2e/README.md) for the WebDriver smoke test.

## Roadmap

- **Milestone 2**: coding image regions and video time ranges (the data model
  already supports both).
- Inter-rater reliability, full-text search, REFI-QDA import/export, project
  sharing.

## License

MIT
