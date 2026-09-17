# Misket

Open-source qualitative coding for text and images, with video on the way.
Misket is a local-first desktop app: your project is a single file on your
machine, and nothing is uploaded anywhere.

**[Website and docs](https://izgebayyurt.github.io/misket/)** — install
guide, coding tutorial, keyboard cheatsheet.

It is an alternative to tools like Dedoose for researchers who want a modern,
keyboard-friendly interface without a subscription.

![Coding a transcript](docs/screenshots/coding.png)

## What it does today

- **Import** plain text, Markdown, Word (`.docx`), PDF (text only) and image
  (PNG, JPEG, WebP) documents, one at a time or a whole folder at once
  ("Import folder…", optionally including subfolders).
  If a file has blank-line gaps, trailing spaces or other likely-accidental
  whitespace, Misket offers to tidy it up before import (document text is
  immutable once imported). Check "Remember my choice" in that dialog to skip
  it on future imports; its "Ask again on import" link resets that.
- **Build a codebook**: nested codes with colors, single-key hotkeys,
  drag-and-drop reordering, merge and delete with impact preview, and
  "Move excerpts to…" to hand one code's excerpts to another without losing
  either code. **Roll up** a sub-code into its parent — or every sub-code at
  once — from the code's menu, with a checkbox for deleting the emptied codes
  afterwards; leave it off and the whole roll-up is undoable. Import a codebook (JSON or CSV) exported from another Misket
  project to reuse it: merge it into the current codebook by matching code
  names, or add it fresh under a chosen code.
- **Define codes properly**: each code has a description (what it means), an
  "Include when" and an "Exclude when" rule, and one excerpt pinned as its
  canonical example — press the star next to a code in the excerpt popover or
  inspector. The whole definition, example quote included, sits in the right
  panel whenever the code is selected; the palette shows only the description,
  so it stays scannable while you code. Definitions travel with the codebook
  export and import.
- **Code excerpts**: select text, press `Ctrl`/`⌘`+`K` and pick a code (type
  `>name` to create one on the spot), or press a code's hotkey. The picker
  shows each code's description and, for nested codes, its full path.
  `Ctrl`/`⌘`+`.` repeats whichever code you applied last — the status bar
  names it, so the key is never a guess. `Ctrl`/`⌘`+`Shift`+`K` codes
  **in vivo**: it names a new code after the selected words (under the code
  selected in the tree, if any) and applies it in one undoable step; typing
  `>` in the palette with a selection fills the same name in, still editable.
  Overlapping excerpts are drawn as stacked colored lanes.
- **Code image regions**: an image opens in a pan-and-zoom viewer (scroll to
  zoom, `Alt`-drag to pan, `0` to fit). Drag a rectangle over it and code it
  with the same palette and hotkeys; regions are drawn in their code's colour,
  `Tab` cycles them, and the excerpt browser shows a thumbnail of each one.
  The image is copied into the project file, so a `.misket` stays
  self-contained.
- **Find your place in a long transcript**: paragraph numbers in the gutter
  (optional), `Ctrl`/`⌘`+`G` to go to one, `Ctrl`/`⌘`+`Home`/`End` to jump to
  the top or bottom, and a reading position remembered per document so
  reopening one lands where you left off. Rename the open document by
  double-clicking its title or pressing `F2`.
- **Adjust what is coded**: move a text excerpt's start or end by a word or a
  character from the keyboard, drag the grips at either end, split an excerpt
  at the cursor, or merge it with a touching neighbour (codes and memos are
  combined). All of it is undoable.
- **Push down later**: code to the parent while reading, then pick "Review
  excerpts…" on that code to work through its _own_ excerpts (not its
  sub-codes') with a review bar pinned above the list. Click a row, press a
  sub-code button or its number key, and the excerpt moves from the parent to
  that sub-code and the focus advances — one undoable step each, with a
  "New child…" button for the sub-code you did not know you needed yet.
- **Browse excerpts** across the project, filtered by code (with sub-codes),
  document, or uncoded only, and jump back to any of them in context.
  Tick the checkboxes (`Shift`+click for a range, or "Select all N loaded") to
  add a code to, remove a code from, or delete many excerpts at once; `Escape`
  clears the selection and undo reverses the whole batch.
- **Auto-code by pattern**: in project search, toggle "Regex" to search with a
  regular expression instead of plain text, then "Auto-code all N matches…" to
  pick a code, choose what gets coded (just the match, its whole sentence, or
  its whole paragraph) and apply it to every hit in one undoable step —
  matches that share a sentence or paragraph share one excerpt.
- **Speaker-aware transcripts**: Misket works out how a transcript marks who
  is speaking — `Name:`, `[Name]`, `Name (00:12):`, `[00:12:03] Name:`,
  `00:12:03 Name:`, or a pattern you write yourself — and lays those labels
  out in a gutter beside the text instead of leaving them in the flow. The
  text itself is never edited, so coding is unaffected: a selection that
  starts on a label starts at what was said. The document header says which
  format is in force ("Transcript: Name:, 42 turns, 3 speakers") and opens a
  dialog to change it, mark the document as not a transcript, or make the
  choice the project's default. Detection is conservative — a label only
  counts once it recurs, and `Note:`-style asides need to recur three times.
  Excerpts carry a speaker chip, the excerpt browser filters by speaker, and
  the code cross-tab can put speakers across the top.
- **Auto-code by speaker turn**: the "Speakers" menu in the document header
  lists each speaker with their turn count; "Code all turns of _Speaker_
  with…" codes every one of their turns (the spoken text, not the label) with
  one chosen code.
- **Query**: build Boolean and proximity retrievals in the browser — "Access
  and Barriers", "Access not Barriers", "Access near Barriers in the same
  paragraph" or within N characters — with one level of grouping, and save
  them with the rest of the filter. Codes count as together when their
  excerpts overlap, not only when one excerpt carries both.
- **Analyse**: a code frequency table (own counts and counts with sub-codes,
  per document, plus a 30-day coding-activity sparkline per code), a code
  co-occurrence matrix showing which codes overlap on the same text, a
  code-by-document heatmap, a code-by-descriptor cross-tab putting codes
  against the values of any document attribute — sites, waves, age bands
  binned automatically, dates by month — counting excerpts or documents, and
  a word frequency view (scoped to a document/set or to the text under a
  code, with stop words and stemming as toggles, a project-editable
  stop-word list, a sortable table and a word cloud). Every cell or word
  clicks through to the matching excerpts or a seeded project search, and
  each view exports to CSV. The overview screen's 30-day sparkline can be
  narrowed to a single code the same way.
- **Framework matrices**: a grid of cases by themes — a row per document, per
  document in a set, or per value of a descriptor ("Site", "Wave"), and a
  column per code or per code in a set — where you write a short summary in
  every cell. The badge on a cell counts the excerpts behind it and opens them
  in a drawer beside the grid, so the summary is written while reading the
  evidence. Exports as CSV or as a Markdown table.
- **Stemmed search**: find-in-document and find-in-project both have a "Match
  word forms" toggle that matches other forms of the same word by stem (e.g.
  "code" also finds "coding" and "coded"); turned off automatically while the
  project search's regex toggle is on, since a pattern matches raw text.
- **Descriptors**: define document attributes (text, number, choice or date)
  such as site, interview wave or age group, set them per document or in a
  table of every document, and filter excerpts by them ("Age is more than 30",
  "Site is any of North, South").
- **Sets and saved filters**: group codes or documents under a name ("Barriers",
  "Round 1 interviews") from the sidebar, the overview screen, or a row's "Add
  to set" menu, click a set to see its excerpts, use sets as one tick in the
  excerpt browser's and the analysis views' pickers, and save a whole filter
  under a name to come back to it. Sets and saved filters are included in the
  project JSON export.
- **Memos** on documents, codes, excerpts and the project.
- **Coder identity**: every code you apply and every memo you write is signed
  with who you are — a name, a colour and an id this copy of Misket generates
  once (Settings → "You"). Two people can code the same passage with the same
  code without overwriting each other: those are two codings, and the excerpt
  inspector shows a small mark for each, with "Remove Bob's coding" when it is
  not yours. Filter the excerpt browser and the analysis views by coder, colour
  the document's underlines by who coded rather than by which code, and see
  everyone's share on the overview screen. Counts are over passages, not
  codings, so agreement never inflates a total. This is the groundwork for
  merging a colleague's copy of a project and for inter-rater reliability.
- **Working with a team**: there is no server, so each researcher keeps their
  own file in a shared folder — `study.ada.misket`, `study.bob.misket` — and
  pulls the other's work in whenever they like ("Pull from a copy…" in the
  status bar). A pull is a union: everything the other copy has and yours does
  not, attributed to whoever made it. Nothing of yours is deleted and nothing
  is written to their file. Misket previews what it would bring — documents,
  codes, excerpts, codings by coder, memos — and asks only about the few things
  you have both edited, with the safe answer preselected. The whole pull is one
  undo, and pulling again later brings only what is new. See
  [Working with a team](site/docs/data.html#working-with-a-team).
- **Audit trail**: every change — a code created, renamed, moved or merged, an
  excerpt coded, adjusted or deleted, a memo written, a descriptor set — is
  recorded in the project file with who made it and when. The overview screen
  lists the latest hundred, the code and excerpt inspectors show one thing's
  history as a timeline with the values before and after, and the whole log
  exports as CSV. Set your name under Settings → "You"; without one Misket uses
  your computer's user name.
- **Undo/redo**: everything is undoable — deleting a document with its
  excerpts, changing a descriptor's type, importing a codebook, editing a
  framework matrix, renaming the project — and what you did in one go comes
  back in one go. The only exception is restoring a backup, which replaces the
  whole file. History is kept in the project file, so it survives closing the
  app, travels with a backup, and is still there for whoever you send the
  project to.
- **History view**: see every change as a branch graph, jump to any point,
  fork and name branches, compact old history.
- **Export** the codebook as CSV or a reusable JSON file, excerpts as CSV, the
  activity log as CSV, or the whole project as JSON.

![Excerpt browser](docs/screenshots/browser.png)

## Keyboard

| Action                                                 | Shortcut                                      |
| ------------------------------------------------------ | --------------------------------------------- |
| Code the selection / add a code to the focused excerpt | `Ctrl`/`⌘` + `K`                              |
| Apply a code directly                                  | its hotkey (set in the code's settings)       |
| In vivo code: name a code after the selected words     | `Ctrl`/`⌘` + `Shift` + `K`                    |
| Apply the last code used again (quick code)            | `Ctrl`/`⌘` + `.`                              |
| Fit / zoom an image                                    | `0` / `+` / `-`                               |
| Next / previous excerpt                                | `Tab` / `Shift`+`Tab`                         |
| Jump to the top / bottom of the document               | `Ctrl`/`⌘` + `Home` / `End`                   |
| Go to paragraph                                        | `Ctrl`/`⌘` + `G`                              |
| Rename the open document                               | `F2` or double-click its title                |
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
| Project overview                                       | `Shift` + `Ctrl`/`⌘` + `H`                    |
| History (the branch graph)                             | `Shift` + `Ctrl`/`⌘` + `Y`                    |
| Excerpt browser                                        | `Ctrl`/`⌘` + `E`                              |
| Analysis views                                         | `Shift` + `Ctrl`/`⌘` + `A`                    |
| Find in the current document                           | `Ctrl`/`⌘` + `F`                              |
| Find in project (search every document)                | `Shift` + `Ctrl`/`⌘` + `F`                    |
| Import documents                                       | `Ctrl`/`⌘` + `I`                              |
| Undo / redo                                            | `Ctrl`/`⌘` + `Z` / `Shift` + `Ctrl`/`⌘` + `Z` |
| Settings (theme, text size, paragraph numbers)         | `Ctrl`/`⌘` + `,`                              |
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

If you create or open a project inside a folder a cloud sync client manages
(Dropbox, OneDrive, Google Drive, iCloud Drive, Box, Nextcloud, ownCloud,
Syncthing, MEGA, pCloud…), Misket shows a dismissable banner: sync clients can
rewrite a file out from under an open database and corrupt it, a documented
failure mode in other QDA tools. Keep it there only if you close Misket before
the folder syncs to another machine, or use the banner's **Move project…** to
copy it to a local folder and switch to the copy (the original file is left in
place, just in case).

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

- **Milestone 2**: image regions are in; video time ranges and transcript
  alignment are next (the data model already supports both).
- Inter-rater reliability, full-text search, REFI-QDA import/export, project
  sharing.

## License

MIT
