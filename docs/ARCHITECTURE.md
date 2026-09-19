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
  the inverse of every write) is unit-tested against an in-memory database.
- **`src-tauri`** exposes those functions as Tauri commands. `AppState` holds
  the open project behind a mutex; each command locks it for a few
  milliseconds. Errors serialize as `{ code, message }` so the frontend can
  branch on the code.
- **`src/core`** is pure TypeScript with no React or Tauri imports (enforced by
  ESLint): offset conversion, paragraph segmentation, DOM selection mapping,
  the code tree, the keymap and the importers. Most frontend tests live here.
- **`src/queries`** wraps commands in TanStack Query hooks.
  **`src/state`** holds ephemeral UI state (current
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

Undo is a tree in the project file (`crates/misket-core/src/db/history.rs`,
and "History" in `docs/DATA_MODEL.md`). Every domain write appends a node
carrying the operation and its exact inverse as JSON, inside the same
transaction as the change, so the inverse is data rather than a closure: it
survives a restart, a backup and a project file handed to someone else.

Undo walks toward the root and redo toward a leaf; an edit made after an undo
starts a branch instead of discarding the redo path, and `checkout` moves to
any node by walking down to the lowest common ancestor and back up the other
side in one transaction. Replaying calls the ordinary domain functions with a
per-connection flag raised that keeps them from recording the replay, which is
why every write path opens `util::tx` — a `SAVEPOINT` that nests where `BEGIN`
cannot.

`src/state/undoStore.ts` is a thin caller: it invokes `history_undo` or
`history_redo`, invalidates the whole query cache, and toasts the summary the
backend wrote. Documents, descriptors, sets, framework matrices, project
rename and the imports are recorded but not yet invertible; they confirm
first, and their frontend mutations still hold closures until phase 2 moves
them across.

## Images

An image document keeps its pixels inside the project file (`media_blobs`),
with `documents.source_path` recorded as a reference to where the file came
from. The webview never receives those bytes over the IPC bridge: `src-tauri`
registers a `misket-media` URI scheme that reads the blob for
`/document/<id>` from the open project, so an `<img>` tag streams it like any
other URL (`misket-media://localhost/…`, or `http://misket-media.localhost/…`
on Windows and Android; `src/api/media.ts` builds both).

Region excerpts are rectangles in _fractions of the image_, so they survive
any zoom level. `ImageView` lays the image out with plain `left/top/width/
height` rather than a CSS transform and draws the regions in an SVG overlay
with `viewBox="0 0 1 1"`, which keeps hit-testing and stroke widths honest.
A drawn rectangle becomes the workspace's pending selection, which is a union
of a text range and an image region, so the palette, the code hotkeys and
undo are the same code for both.

## Backups

`crates/misket-core/src/db/backup.rs` covers both "Save a copy as…" and the
automatic safety net. Both go through SQLite's `VACUUM INTO`, which is safe to
run against a database that is currently open (a raw file copy is not).
`save_copy` writes to a path the user picked, refusing to target the open
project file and replacing an existing destination only after copying to a
temp file next to it and renaming over it. `backup_before` writes into
`<project stem>.backups/` next to the project, prunes that folder to the
newest `keepBackups` backups (default 20, in `AppSettings`), and
`backup_before_throttled` skips the write entirely if the newest backup for
the same reason is under 60 seconds old, so a bulk delete does not produce one
copy per item.

The Tauri command layer (`src-tauri/src/backup_guard.rs`) calls
`backup_before_throttled` ahead of `delete_document`, `delete_code` (only
when it would affect existing excerpts) and `merge_code`, outside any
transaction the operation itself opens. A backup failure is logged and
swallowed — it never turns a successful edit into a failed one.

## Audio and video

Where an image's pixels go inside the project file, a recording does not: a
two-hour interview is gigabytes and a `.misket` is opened, copied and backed
up whole. So `documents.source_path` holds the path to the file on disk and
`media_json` holds what was measured from it — `db::media` owns that, along
with detecting a file that has moved and relinking to a new one.
`docs/DATA_MODEL.md` has the shapes; two things about the plumbing belong
here.

**Two ways into the bytes.** An `<img>` loads from the `misket-media` scheme
happily, so images and video excerpt thumbnails keep using it. A media
element will not: on Linux, WebKitGTK hands playback to GStreamer, which
refuses `misket-media://`, Tauri's own `asset://` and plain `file://` alike
with `MEDIA_ERR_SRC_NOT_SUPPORTED`. A `blob:` URL works, but building one
means holding the whole recording in the page — the very thing holding media
by reference avoids. So `src-tauri/src/media.rs` also binds a loopback
HTTP listener on an ephemeral port, serves the same routes over HTTP/1.1
(which GStreamer streams and seeks in natively), and answers only requests
carrying the random token minted for that run of the app. `src/api/media.ts`
knows which URL each use needs. Both paths answer `Range: bytes=…` with a
`206`, capped at 4 MiB a response, so seeking in a long recording never reads
more than a slice.

**A file that is not a document yet.** Only a decoder knows how long a
recording is, and the import needs that before it writes a row — so
`stage_media_probe` puts the picked file behind an opaque token, the page
loads `/probe/<token>` to read its headers, and the page never names a path
of its own.

`MediaView` is the counterpart of `ImageView`: a marked in/out pair becomes
the workspace's pending selection, which is now a union of a text range, an
image region and a media range, so the palette, the code hotkeys and undo
remain the same code for all three. The player's bare keys (space, `J`/`L`,
`,`/`.`, `[`/`]`) live in their own table in `src/core/keymap.ts` and are
matched by the view itself rather than by the application-wide listener,
because a bare full stop everywhere else in Misket is a full stop.

## Transcription

On macOS the app needs 10.15 or newer: whisper.cpp uses `std::filesystem`, so `bundle.macOS.minimumSystemVersion` and the workflows' `MACOSX_DEPLOYMENT_TARGET` are both set to 10.15 and must move together.

Turning a recording into a transcript runs on the machine, with whisper.cpp
through the `whisper-rs` bindings. It lives in `src-tauri/src/transcribe/`
rather than in `misket-core`, because none of it is domain logic over the
project database: it is decoding, inference and formatting, and what it
produces is an ordinary `documents::create` call.

**It is an optional feature.** `whisper` is on by default, so release builds
ship transcription, but the crate has to compile and pass its tests with
`--no-default-features` — whisper.cpp is a C++ build that wants CMake, and a
packager who does not want that dependency should still get a working Misket.
Only `engine::WhisperEngine` is behind the flag; decoding, the model registry,
the formatting and the command layer are compiled either way, and
`engine::load` returns a clear error instead of an engine. CI runs clippy and
the tests both ways (one extra step each, which is cheaper than a second job).

That split falls out of `engine::Engine`, a three-method trait over "samples
in, segments out, with progress and a cancel flag". `StubEngine` implements
it too, so the whole path — decode, resample, segment, format, anchor, create
the document, link it, undo it — is unit-tested without a 75 MiB model file.
The one test that needs a real model reads `MISKET_WHISPER_MODEL` and prints a
note when it is unset, rather than being an `#[ignore]` nobody ever runs.

**Audio in.** `transcribe::audio` decodes with Symphonia (mp3, aac/alac,
vorbis, flac, PCM; ISO-MP4 and Matroska containers) and resamples to the
16 kHz mono `f32` every Whisper model is trained on. The resampler is a
windowed-sinc convolution written out in forty lines rather than a
dependency — linear interpolation aliases 44.1 kHz speech badly enough to cost
accuracy, and the rate ratios involved are exactly what a low-pass sinc is
for. A container Symphonia cannot open falls back to `ffmpeg` on `PATH`, which
is why the docs say video may need ffmpeg and audio never does.

**Models.** Nothing is bundled and nothing is fetched until someone presses
Download. `transcribe::models` holds the catalogue (id, size, the SHA-1
whisper.cpp publishes in its `models/README.md`) and downloads into
`<app data>/models/whisper/` through a `.part` file, resuming with a `Range`
request and verifying the digest before the rename. Model ids reach the
filesystem, so anything that is not a catalogue id has to be a bare file name;
`installed_path` refuses a path.

**Running one.** `start_transcription` validates on the calling thread (so the
dialog can show why it will not run) and then hands the job to a worker, which
emits `transcription:progress` and `transcription:done`; a two-hour interview
is too long to hold an `invoke` open. Cancel flags live in `AppState` in two
small registries keyed by document id and model id, claimed with `start_job`
so a double-click cannot start two runs over one recording.

**Out the other end.** The document is plain text, one paragraph per segment
(or per N seconds), each opening `[mm:ss]`, with an anchor per paragraph
mapping its code-point offset to its millisecond. `save_transcript` writes the
document, its anchors and the link to the recording inside one `history::group`
— a transcript sitting in the project unlinked from its recording is not a
state anyone asked for, so one undo takes the whole thing back. No speaker
labels are produced: Whisper does not diarise, and deriving "Speaker 1" from
pauses would put a guess into the data where a coder reads a fact.
