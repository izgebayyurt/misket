# Data model

A project file is a SQLite database with `PRAGMA application_id = 0x4D534B54`
("MSKT") and `PRAGMA user_version` set to the schema version. Migrations live in
`crates/misket-core/src/db/migrations/` and run forward-only inside one
transaction; an older file is backed up next to itself (`name.misket.bak-v1`)
before it is upgraded.

Connection pragmas: `foreign_keys = ON`, `journal_mode = DELETE` (so the file
stays a single file that can be copied while open), `synchronous = NORMAL`.

## Tables

| Table               | Purpose                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_meta`      | key/value: `schema_version`, `project_id`, `name`, `created_at`, `created_with_app_version`                                                                                                                                                           |
| `documents`         | imported sources. `kind` is `text` today, `image`/`video` later. `text` is immutable; `text_length` is the code point count; `content_hash` de-duplicates imports                                                                                     |
| `codes`             | the codebook tree: adjacency list (`parent_id`) with `sort_order` among siblings, `color`, optional single-key `shortcut`. Sibling names are unique case-insensitively                                                                                |
| `excerpts`          | coded ranges. `kind` = `text` (code point `start_pos`/`end_pos`), `video_range` (milliseconds) or `image_region` (`geometry` JSON `{x,y,w,h}` normalized 0..1). `snapshot` stores the excerpted text. One text excerpt per exact range                |
| `excerpt_codes`     | many-to-many between excerpts and codes                                                                                                                                                                                                               |
| `memos`             | notes with at most one target: `document_id`, `code_id`, `excerpt_id`, or none (project memo). Each target is a real foreign key so deletes cascade                                                                                                   |
| `descriptor_fields` | document attributes ("Site", "Age group"). `kind` is `text`, `number`, `choice` or `date`; `options_json` holds a choice field's options as a JSON array of strings; `sort_order` is the order they are shown in. Names are unique case-insensitively |
| `descriptor_values` | one value per (`document_id`, `field_id`), `WITHOUT ROWID`. Both foreign keys cascade, so deleting a document or a field takes its values with it                                                                                                     |

All ids are UUID v4 strings so deleted rows can be restored with their original
identity (undo) and so exports are stable.

## Descriptors

Values are stored as canonical strings and validated by kind in Rust
(`db::descriptors`), so comparisons and grouping are exact:

| Kind     | Stored as                                                                                  |
| -------- | ------------------------------------------------------------------------------------------ |
| `text`   | the text as typed, trimmed                                                                 |
| `number` | canonical decimal, so `07.50` becomes `7.5`                                                |
| `date`   | ISO `YYYY-MM-DD`, a real calendar day                                                      |
| `choice` | one of the field's options, matched case-insensitively and stored as the option is spelled |

A field's `kind` is frozen once any document has a value for it, and an option
that is still in use cannot be removed; both return `Validation`.

`ExcerptFilter.descriptors` is a list of conditions, ANDed together:

```jsonc
{ "fieldId": "…", "op": "between", "values": ["18", "65"] }
```

`op` is `eq`, `neq`, `contains`, `gt`, `lt`, `between`, `in`, `empty` or
`notEmpty`. Each one becomes an `EXISTS` (or, for `neq` and `empty`, a
`NOT EXISTS`) subquery on `descriptor_values` joined to the excerpt through
`e.document_id`. Number fields compare with `CAST(value AS REAL)`; every other
kind compares as text, which is also the right order for ISO dates. Because
`neq` and `empty` are `NOT EXISTS`, documents with no value for the field match
them.

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
  (codes are full paths separated by `; `), then one column per descriptor
  field, named after the field, holding the excerpt's document's value
- Project JSON: `{ format: "misket-project", formatVersion: 1, meta, documents, codes, excerpts, memos, descriptorFields, descriptorValues }`
