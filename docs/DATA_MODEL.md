# Data model

A project file is a SQLite database with `PRAGMA application_id = 0x4D534B54`
("MSKT") and `PRAGMA user_version` set to the schema version. Migrations live in
`crates/misket-core/src/db/migrations/` and run forward-only inside one
transaction; an older file is backed up next to itself (`name.misket.bak-v1`)
before it is upgraded.

Connection pragmas: `foreign_keys = ON`, `journal_mode = DELETE` (so the file
stays a single file that can be copied while open), `synchronous = NORMAL`.

## Tables

| Table           | Purpose                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_meta`  | key/value: `schema_version`, `project_id`, `name`, `created_at`, `created_with_app_version`                                                                                                                                            |
| `documents`     | imported sources. `kind` is `text` today, `image`/`video` later. `text` is immutable; `text_length` is the code point count; `content_hash` de-duplicates imports                                                                      |
| `codes`         | the codebook tree: adjacency list (`parent_id`) with `sort_order` among siblings, `color`, optional single-key `shortcut`. Sibling names are unique case-insensitively                                                                 |
| `excerpts`      | coded ranges. `kind` = `text` (code point `start_pos`/`end_pos`), `video_range` (milliseconds) or `image_region` (`geometry` JSON `{x,y,w,h}` normalized 0..1). `snapshot` stores the excerpted text. One text excerpt per exact range |
| `excerpt_codes` | many-to-many between excerpts and codes                                                                                                                                                                                                |
| `memos`         | notes with at most one target: `document_id`, `code_id`, `excerpt_id`, or none (project memo). Each target is a real foreign key so deletes cascade                                                                                    |

All ids are UUID v4 strings so deleted rows can be restored with their original
identity (undo) and so exports are stable.

## Queries worth knowing

- Descendants of a code use a recursive CTE, not a materialized path:
  ```sql
  WITH RECURSIVE sub(id) AS (
    SELECT id FROM codes WHERE id IN (?)
    UNION SELECT c.id FROM codes c JOIN sub ON c.parent_id = sub.id
  ) SELECT id FROM sub;
  ```
  It powers "include sub-codes" in the excerpt browser and the cycle guard
  when a code is moved.
- Excerpt context in the browser is computed in SQL with `substr()`, which
  counts code points, matching the stored offsets.
- The analysis views (`db/analysis.rs`) read `excerpt_codes` joined to
  `excerpts`: frequencies expand each code with the same recursive CTE and
  de-duplicate excerpts, and co-occurrence pairs text excerpts in one document
  whose ranges overlap (`a.start < b.end AND b.start < a.end`), counting each
  pair of excerpts once per pair of codes.

## Exports

- Codebook CSV: `id, path, name, parent_id, color, description, shortcut, excerpt_count`
- Excerpts CSV: `excerpt_id, document, start, end, text, codes, memo_count, created_at`
  (codes are full paths separated by `; `)
- Project JSON: `{ format: "misket-project", formatVersion: 1, meta, documents, codes, excerpts, memos }`
