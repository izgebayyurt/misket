# Misket

Open-source qualitative coding for text, images and video. A local-first desktop
app: your project is a single file on your machine, nothing is uploaded anywhere.

Misket is an alternative to tools like Dedoose for researchers who want a modern,
keyboard-friendly interface without a subscription.

## Status

Milestone 1 (text coding) is under construction. Image and video coding are
planned for milestone 2; the data model already supports them.

## Development

Prerequisites: Node 22, pnpm 10, Rust stable, and the
[Tauri Linux/macOS/Windows prerequisites](https://tauri.app/start/prerequisites/).

```sh
pnpm install
pnpm tauri dev        # run the app
pnpm check            # lint + typecheck + vitest
cargo test --workspace
```

## Layout

- `src/` React + TypeScript frontend. `src/core/` is pure logic with no React or
  Tauri imports and carries most of the unit tests.
- `crates/misket-core/` the project database (SQLite via rusqlite) and all domain
  logic, tested against in-memory databases.
- `src-tauri/` the desktop shell: thin Tauri commands over `misket-core`.

## License

MIT
