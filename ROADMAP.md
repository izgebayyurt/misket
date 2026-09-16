# Misket roadmap

What a researcher needs from a qualitative coding tool, measured against
Dedoose, NVivo, ATLAS.ti, MAXQDA and QualCoder, minus what milestone 1 already
does. Each item links to its GitHub issue; this file is the ordered overview.

Status key: **done** shipped on `main`; **now** in progress; **next** queued;
**later** planned, not started.

## v0.1 Text coding (done)

Import txt/md/docx/pdf, hierarchical codebook with hotkeys, keyboard-driven
coding with overlapping excerpts, excerpt browser, memos, undo/redo, CSV/JSON
export, open-by-double-click, dark mode, cross-platform CI and release builds.

## v0.2 Analysis and workflow for text

| #   | Feature                                                                                                                                                                                                                                                                                  | Why it matters                                              | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| 1   | [#1](https://github.com/izgebayyurt/misket/issues/1) **Find in document and project-wide search**: ⌘F with match navigation inside the open document; a search box that lists hits across all documents and jumps to them                                                                | The first thing coders do after import is look for passages | done   |
| 2   | [#2](https://github.com/izgebayyurt/misket/issues/2) **Adjust excerpt boundaries**: grow/shrink start or end by word or character from the keyboard and with drag handles; split an excerpt at the cursor; merge adjacent excerpts with the same codes                                   | Coders constantly refine what exactly is coded              | done   |
| 3   | [#3](https://github.com/izgebayyurt/misket/issues/3) **Code frequency table**: counts per code (own and including sub-codes), per document, with click-through to the excerpt browser and CSV export                                                                                     | The basic descriptive output every report needs             | done   |
| 4   | [#4](https://github.com/izgebayyurt/misket/issues/4) **Code co-occurrence matrix**: how often two codes overlap on the same text, with cell click-through                                                                                                                                | Core analysis move: which themes travel together            | done   |
| 5   | [#5](https://github.com/izgebayyurt/misket/issues/5) **Code-by-document matrix** (heatmap): which documents carry which codes and how densely                                                                                                                                            | Compare participants and sources at a glance                | done   |
| 6   | [#6](https://github.com/izgebayyurt/misket/issues/6) **Descriptors** (document attributes): define fields (text, number, choice, date), assign values per document, filter excerpts and matrices by them                                                                                 | Mixed-methods work: compare by age group, site, wave        | done   |
| 7   | [#7](https://github.com/izgebayyurt/misket/issues/7) **Code and document sets**: saved groups and saved filters                                                                                                                                                                          | Keeps large projects navigable                              | next   |
| 8   | [#8](https://github.com/izgebayyurt/misket/issues/8) **Excerpt weights/ratings** per code (e.g. 1–5 intensity)                                                                                                                                                                           | Dedoose users expect it; enables scaled comparisons         | later  |
| 9   | [#9](https://github.com/izgebayyurt/misket/issues/9) **Keyboard reference overlay** (⌘/) and **Settings** (theme override, editor font size and line height, default import behaviour)                                                                                                   | Discoverability; comfort for long sessions                  | done   |
| 10  | [#10](https://github.com/izgebayyurt/misket/issues/10) **Codebook import/export** (CSV/JSON) to reuse across projects; code descriptions visible in the palette                                                                                                                          | Teams standardise codebooks                                 | done   |
| 11  | [#11](https://github.com/izgebayyurt/misket/issues/11) **Document viewer polish**: paragraph numbers, jump to top/bottom, reading position remembered per document, inline rename                                                                                                        | Orientation in long transcripts                             | next   |
| 12  | [#12](https://github.com/izgebayyurt/misket/issues/12) **Project overview**: rename project, project memo on the start of the workspace, statistics dashboard (documents, codes, excerpts over time)                                                                                     | A home screen for the project                               | done   |
| 13  | [#13](https://github.com/izgebayyurt/misket/issues/13) **Backups**: timestamped copy before destructive operations, "Save a copy as…"                                                                                                                                                    | Trust: the file is the whole study                          | done   |
| 14  | [#14](https://github.com/izgebayyurt/misket/issues/14) **Bulk operations**: multi-select excerpts in the browser to delete or recode; move all excerpts from code A to B; import a whole folder                                                                                          | Cleanup at scale                                            | done   |
| 34  | [#15](https://github.com/izgebayyurt/misket/issues/15) **Tidy whitespace on import**: when a file has runs of blank lines, trailing spaces, or hard-wrapped lines, offer to normalise them (with a before/after preview) before the text is stored, since text is immutable after import | Pasted transcripts arrive with stray blank lines            | done   |
| 15  | [#16](https://github.com/izgebayyurt/misket/issues/16) **Speaker-aware transcripts**: detect "Name:" turns, filter by speaker, code a whole turn with one key                                                                                                                            | Interview transcripts are the bread and butter              | later  |

## v0.3 Media coding (milestone 2)

| #   | Feature                                                                                                                                                                                                                                                 | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 16  | [#17](https://github.com/izgebayyurt/misket/issues/17) **Image documents**: import PNG/JPEG/WebP, viewer with zoom/pan, rectangle region excerpts drawn with the mouse, same palette and browser, thumbnails in the excerpt browser                     | done   |
| 17  | [#18](https://github.com/izgebayyurt/misket/issues/18) **Audio/video documents**: player with timeline and waveform, time-range excerpts set with in/out keys, frame-accurate scrubbing, excerpt thumbnails                                             | later  |
| 18  | [#19](https://github.com/izgebayyurt/misket/issues/19) **Transcript alignment**: import SRT/VTT/timestamped transcripts as text documents linked to media; clicking a transcript excerpt seeks the media; coding a time range highlights the transcript | later  |
| 19  | [#20](https://github.com/izgebayyurt/misket/issues/20) **Media by reference**: relink moved media files, optional copy-into-project, missing-media warnings                                                                                             | later  |

## v0.4 Teams and rigour

| #   | Feature                                                                                                                                                                                            | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 20  | [#21](https://github.com/izgebayyurt/misket/issues/21) **Multiple coders**: coder identity on every excerpt, per-coder colours, filter by coder                                                    | later  |
| 21  | [#22](https://github.com/izgebayyurt/misket/issues/22) **Inter-rater reliability**: compare two coders on the same documents, Cohen's kappa per code and pooled, disagreement list with resolution | later  |
| 22  | [#23](https://github.com/izgebayyurt/misket/issues/23) **Project merge**: import another `.misket` whose documents match by content hash; combine codebooks and excerpts                           | later  |
| 23  | [#24](https://github.com/izgebayyurt/misket/issues/24) **REFI-QDA (.qdpx) import and export** for interoperability with NVivo, ATLAS.ti and MAXQDA                                                 | later  |
| 24  | [#25](https://github.com/izgebayyurt/misket/issues/25) **Change log**: who did what and when, per project                                                                                          | later  |

## v0.5 Assistance (all opt-in, never on by default)

| #   | Feature                                                                                                                                                                                                                       | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 25  | [#26](https://github.com/izgebayyurt/misket/issues/26) **AI-assisted coding suggestions** with a user-supplied API key or a local model: suggest codes for a selection, summarise all excerpts under a code, never auto-apply | later  |
| 26  | [#27](https://github.com/izgebayyurt/misket/issues/27) **Local transcription** of audio/video with Whisper                                                                                                                    | later  |

## Infrastructure and polish

| #   | Feature                                                                                                                                                  | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 27  | [#28](https://github.com/izgebayyurt/misket/issues/28) **Code signing and notarisation** (macOS), Windows signing, **auto-update** via the Tauri updater | later  |
| 28  | [#29](https://github.com/izgebayyurt/misket/issues/29) **Opt-in crash and error reporting**; in-app log viewer                                           | later  |
| 29  | [#30](https://github.com/izgebayyurt/misket/issues/30) **Localisation** framework, English first, Turkish second                                         | later  |
| 30  | [#31](https://github.com/izgebayyurt/misket/issues/31) **Accessibility pass**: screen-reader labels, focus order, contrast in both themes                | later  |
| 31  | [#32](https://github.com/izgebayyurt/misket/issues/32) **Sample project** bundled for first run ("Try Misket with sample data")                          | done   |
| 32  | [#33](https://github.com/izgebayyurt/misket/issues/33) **Website and docs** on GitHub Pages: install guide, coding tutorial, keyboard cheatsheet         | done   |
| 33  | [#34](https://github.com/izgebayyurt/misket/issues/34) **Large-document virtualisation** (only if a real transcript proves slow; 2 MB measured fine)     | later  |
