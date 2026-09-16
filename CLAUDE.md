# Misket: notes for Claude Code

Misket is a local-first desktop app for qualitative coding (Tauri 2 + React/TypeScript, SQLite via rusqlite). Read `docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md` before changing the data model or the document view.

## Map

- `crates/misket-core/` — schema, migrations, and all domain logic as plain functions over `&rusqlite::Connection`. No UI or Tauri dependency. Tests run against in-memory databases. New behavior that touches data belongs here first, with a test.
- `src-tauri/` — thin Tauri commands over the core crate. `AppState` holds the open project behind a mutex. Errors are `misket_core::AppError` and serialize as `{ code, message }`.
- `src/core/` — pure TypeScript with no `react`, `@tauri-apps/*`, or `@/api` runtime imports (an ESLint rule enforces it; type-only imports are fine). Offsets, segmentation, DOM selection mapping, code tree, keymap, importers. Most Vitest tests live here.
- `src/api/` typed `invoke()` wrappers; `src/queries/` TanStack Query hooks; `src/state/` zustand stores; `src/components/` UI.

## Rules that matter

- Document text is immutable after import. Excerpt offsets are Unicode code points, end-exclusive. Convert to UTF-16 only through `src/core/offsets.ts`.
- Inside the document view text root, all text lives in `span[data-s]` elements whose only child is a text node. Do not put other text-bearing elements inside `.doc-text`.
- Every mutation records forward and inverse payloads through `activity::record`; new domain writes must supply both or the operation is not undoable. Undo is a tree in the project file (`db::history`); the frontend only calls `history_undo`/`history_redo`.
- `ExcerptFilter` has a manual `Default` in Rust (limit 200, include descendants); keep TS `src/api/types.ts` in sync with `crates/misket-core/src/models.rs`.
- Image documents keep their bytes in `media_blobs` and are served to the webview through the `misket-media` URI scheme (`src-tauri/src/lib.rs`, `src/api/media.ts`), never over `invoke`. Region excerpts are normalized rectangles; Rust writes `geometry` in one canonical form so the partial unique index can upsert it.

## Before pushing

```sh
pnpm check                                   # eslint + tsc + vitest
pnpm format:check
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The debug app can be exercised headlessly on Linux with `pnpm tauri build --debug --no-bundle` and `MISKET_E2E_PROJECT=/tmp/x.misket MISKET_E2E_IMPORT=fixtures/sample.txt target/debug/misket` under Xvfb; the WebDriver smoke test is in `e2e/`.

## Working style (from the maintainer)

- Use lighter models for routine, mechanical work: git pushes, branch cleanup, CI polling, formatting runs, dependency installs, and similar go to a Sonnet subagent (Haiku for trivial checks). Keep the main model for design and non-trivial code.
- Commit per coherent change with a descriptive message. Never force-push shared branches.
