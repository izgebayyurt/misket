# Data model

A project file is a SQLite database with `PRAGMA application_id = 0x4D534B54`
("MSKT") and `PRAGMA user_version` set to the schema version. Migrations live in
`crates/misket-core/src/db/migrations/` and run forward-only inside one
transaction; an older file is backed up next to itself (`name.misket.bak-v1`)
before it is upgraded.

Connection pragmas: `foreign_keys = ON`, `journal_mode = DELETE` (so the file
stays a single file that can be copied while open), `synchronous = NORMAL`.

## Tables

| Table               | Purpose                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_meta`      | key/value: `schema_version`, `project_id`, `name`, `created_at`, `created_with_app_version`                                                                                                                                                                                   |
| `documents`         | imported sources. `kind` is `text` or `image` (`video` later). `text` is immutable and NULL for media; `text_length` is the code point count; `media_json` holds `{width,height,mime}`; `content_hash` de-duplicates imports                                                  |
| `codes`             | the codebook tree: adjacency list (`parent_id`) with `sort_order` among siblings, `color`, optional single-key `shortcut`. Sibling names are unique case-insensitively                                                                                                        |
| `excerpts`          | coded ranges. `kind` = `text` (code point `start_pos`/`end_pos`), `video_range` (milliseconds) or `image_region` (`geometry` JSON `{x,y,w,h}` normalized 0..1). `snapshot` stores the excerpted text or a description of the region. One excerpt per exact range or rectangle |
| `excerpt_codes`     | many-to-many between excerpts and codes                                                                                                                                                                                                                                       |
| `media_blobs`       | the bytes of an image document, with their MIME type, one row per document. Deleting the document drops them                                                                                                                                                                  |
| `memos`             | notes with at most one target: `document_id`, `code_id`, `excerpt_id`, or none (project memo). Each target is a real foreign key so deletes cascade                                                                                                                           |
| `descriptor_fields` | document attributes ("Site", "Age group"). `kind` is `text`, `number`, `choice` or `date`; `options_json` holds a choice field's options as a JSON array of strings; `sort_order` is the order they are shown in. Names are unique case-insensitively                         |
| `descriptor_values` | one value per (`document_id`, `field_id`), `WITHOUT ROWID`. Both foreign keys cascade, so deleting a document or a field takes its values with it                                                                                                                             |

All ids are UUID v4 strings so deleted rows can be restored with their original
identity (undo) and so exports are stable.

## Images

An image document (`kind = 'image'`) has no `text`; its size and MIME type are
in `media_json` as `{"width":…,"height":…,"mime":…}`, and its bytes live in
`media_blobs` (schema 3). Keeping them inside the project file means a
`.misket` is still one self-contained file that can be copied or backed up on
its own; `source_path` is kept as a record of where the image came from (and
is what the import reads once), but nothing depends on it afterwards.
`content_hash` is the sha256 of the bytes, so
importing the same picture twice is the same `Conflict` as importing the same
text twice. Only PNG, JPEG and WebP are accepted.

An image excerpt stores its rectangle in `geometry` as fractions of the
image's width and height:

```jsonc
{ "x": 0.3, "y": 0.4, "w": 0.12, "h": 0.08 }
```

so it is independent of zoom, display size and any later re-export. Rust
validates it (`x, y ≥ 0`, `w, h > 0`, and the rectangle inside `1×1`) and
writes it in one canonical form, rounded to six decimals with the keys in that
order. That canonical form is what makes the partial unique index
`excerpts_image_region_uq (document_id, geometry) WHERE kind='image_region'`
behave like the text one: coding the same rectangle again adds codes to the
existing excerpt instead of creating a second.

Because there are no pixels to quote, `snapshot` holds a short description of
the rectangle instead, so the excerpt browser, the exports and the memo lists
always have something readable:

```
region 12%×8% at (30%, 40%)
```

The excerpt context (`contextBefore` / `contextAfter`) is empty for image
excerpts.

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
- Excerpts CSV: `excerpt_id, document, start, end, geometry, text, codes, memo_count, created_at`
  (codes are full paths separated by `; `), then one column per descriptor
  field, named after the field, holding the excerpt's document's value.
  `start`/`end` are empty for image excerpts and `geometry` is empty for text
  ones; `text` holds the snapshot either way
- Project JSON: `{ format: "misket-project", formatVersion: 1, meta, documents, codes, excerpts, memos, descriptorFields, descriptorValues }`.
  Image bytes are not included: the JSON stays a readable text export, and the
  `.misket` file remains the thing that holds the media.
