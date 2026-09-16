# Misket roadmap

What a researcher needs from a qualitative coding tool, measured against
Dedoose, NVivo, ATLAS.ti, MAXQDA and QualCoder, minus what milestone 1 already
does. Each item is a GitHub issue; this file is the ordered overview.

Status key: **done** shipped on `main`; **now** in progress; **next** queued;
**later** planned, not started.

## v0.1 Text coding (done)

Import txt/md/docx/pdf, hierarchical codebook with hotkeys, keyboard-driven
coding with overlapping excerpts, excerpt browser, memos, undo/redo, CSV/JSON
export, open-by-double-click, dark mode, cross-platform CI and release builds.

## v0.2 Analysis and workflow for text

| #   | Feature                                                                                                                                                                                                                           | Why it matters                                              | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| 1   | **Find in document and project-wide search**: ⌘F with match navigation inside the open document; a search box that lists hits across all documents and jumps to them                                                              | The first thing coders do after import is look for passages | now    |
| 2   | **Adjust excerpt boundaries**: grow/shrink start or end by word or character from the keyboard and with drag handles; split an excerpt at the cursor; merge adjacent excerpts with the same codes                                 | Coders constantly refine what exactly is coded              | next   |
| 3   | **Code frequency table**: counts per code (own and including sub-codes), per document, with click-through to the excerpt browser and CSV export                                                                                   | The basic descriptive output every report needs             | now    |
| 4   | **Code co-occurrence matrix**: how often two codes overlap on the same text, with cell click-through                                                                                                                              | Core analysis move: which themes travel together            | now    |
| 5   | **Code-by-document matrix** (heatmap): which documents carry which codes and how densely                                                                                                                                          | Compare participants and sources at a glance                | now    |
| 6   | **Descriptors** (document attributes): define fields (text, number, choice, date), assign values per document, filter excerpts and matrices by them                                                                               | Mixed-methods work: compare by age group, site, wave        | now    |
| 7   | **Code and document sets**: saved groups and saved filters                                                                                                                                                                        | Keeps large projects navigable                              | next   |
| 8   | **Excerpt weights/ratings** per code (e.g. 1–5 intensity)                                                                                                                                                                         | Dedoose users expect it; enables scaled comparisons         | later  |
| 9   | **Keyboard reference overlay** (⌘/) and **Settings** (theme override, editor font size and line height, default import behaviour)                                                                                                 | Discoverability; comfort for long sessions                  | now    |
| 10  | **Codebook import/export** (CSV/JSON) to reuse across projects; code descriptions visible in the palette                                                                                                                          | Teams standardise codebooks                                 | next   |
| 11  | **Document viewer polish**: paragraph numbers, jump to top/bottom, reading position remembered per document, inline rename                                                                                                        | Orientation in long transcripts                             | next   |
| 12  | **Project overview**: rename project, project memo on the start of the workspace, statistics dashboard (documents, codes, excerpts over time)                                                                                     | A home screen for the project                               | later  |
| 13  | **Backups**: timestamped copy before destructive operations, "Save a copy as…"                                                                                                                                                    | Trust: the file is the whole study                          | next   |
| 14  | **Bulk operations**: multi-select excerpts in the browser to delete or recode; move all excerpts from code A to B; import a whole folder                                                                                          | Cleanup at scale                                            | next   |
| 34  | **Tidy whitespace on import**: when a file has runs of blank lines, trailing spaces, or hard-wrapped lines, offer to normalise them (with a before/after preview) before the text is stored, since text is immutable after import | now                                                         |
| 15  | **Speaker-aware transcripts**: detect "Name:" turns, filter by speaker, code a whole turn with one key                                                                                                                            | Interview transcripts are the bread and butter              | later  |

## v0.3 Media coding (milestone 2)

| #   | Feature                                                                                                                                                                                          | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 16  | **Image documents**: import PNG/JPEG/WebP, viewer with zoom/pan, rectangle region excerpts drawn with the mouse, same palette and browser, thumbnails in the excerpt browser                     | next   |
| 17  | **Audio/video documents**: player with timeline and waveform, time-range excerpts set with in/out keys, frame-accurate scrubbing, excerpt thumbnails                                             | later  |
| 18  | **Transcript alignment**: import SRT/VTT/timestamped transcripts as text documents linked to media; clicking a transcript excerpt seeks the media; coding a time range highlights the transcript | later  |
| 19  | **Media by reference**: relink moved media files, optional copy-into-project, missing-media warnings                                                                                             | later  |

## v0.4 Teams and rigour

| #   | Feature                                                                                                                                     | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 20  | **Multiple coders**: coder identity on every excerpt, per-coder colours, filter by coder                                                    | later  |
| 21  | **Inter-rater reliability**: compare two coders on the same documents, Cohen's kappa per code and pooled, disagreement list with resolution | later  |
| 22  | **Project merge**: import another `.misket` whose documents match by content hash; combine codebooks and excerpts                           | later  |
| 23  | **REFI-QDA (.qdpx) import and export** for interoperability with NVivo, ATLAS.ti and MAXQDA                                                 | later  |
| 24  | **Change log**: who did what and when, per project                                                                                          | later  |

## v0.5 Assistance (all opt-in, never on by default)

| #   | Feature                                                                                                                                                                | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 25  | **AI-assisted coding suggestions** with a user-supplied API key or a local model: suggest codes for a selection, summarise all excerpts under a code, never auto-apply | later  |
| 26  | **Local transcription** of audio/video with Whisper                                                                                                                    | later  |

## Infrastructure and polish

| #   | Feature                                                                                           | Status |
| --- | ------------------------------------------------------------------------------------------------- | ------ |
| 27  | **Code signing and notarisation** (macOS), Windows signing, **auto-update** via the Tauri updater | later  |
| 28  | **Opt-in crash and error reporting**; in-app log viewer                                           | later  |
| 29  | **Localisation** framework, English first, Turkish second                                         | later  |
| 30  | **Accessibility pass**: screen-reader labels, focus order, contrast in both themes                | later  |
| 31  | **Sample project** bundled for first run ("Try Misket with sample data")                          | next   |
| 32  | **Website and docs** on GitHub Pages: install guide, coding tutorial, keyboard cheatsheet         | later  |
| 33  | **Large-document virtualisation** (only if a real transcript proves slow; 2 MB measured fine)     | later  |
