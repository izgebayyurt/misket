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
| `sets`              | named groups of codes or of documents. `kind` is `code` or `document`; names are unique per kind, case-insensitively, so "Round 1" can be both                                                                                                                                |
| `set_members`       | `(set_id, member_id)`, `WITHOUT ROWID`. `member_id` is a code id or a document id depending on the set's kind, so it is not a foreign key; two triggers stand in for the cascade                                                                                              |
| `saved_filters`     | a whole `ExcerptFilter` as JSON under a unique (case-insensitive) name                                                                                                                                                                                                        |

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

### The code-by-descriptor cross-tab

`db::analysis::code_by_descriptor` turns one descriptor field into the columns
of a matrix whose rows are codes — the mixed-methods comparison ("how often
does each theme come up at each site"). It takes a `CrosstabRequest` rather
than a row of arguments: the field, the codes to use as rows (every code when
none are picked), `include_descendants`, the usual document ids and document
sets, a bin count, and a mode.

Columns come from the values the **documents in scope** actually have, so a
matrix never carries a column nobody used:

| Kind     | Columns                                                                                                                                                  | Click-through operator |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `choice` | one per option in use, in the field's own option order                                                                                                   | `eq`                   |
| `text`   | one per distinct value, sorted case-insensitively                                                                                                        | `eq`                   |
| `number` | `bins` equal-width bins between the smallest and the largest value (4 by default); half-open, except the last, which is closed so the maximum has a home | `between`              |
| `date`   | one per year-month that occurs, ascending                                                                                                                | `between`              |

A `(no value)` column (`empty`) is appended only when some document in scope
has no value for the field. Every column carries the `DescriptorFilter` that
reproduces it, so a cell click opens the excerpt browser on exactly what the
cell counted. `between` is inclusive on both ends, which is what the browser
supports, so a document sitting exactly on a bin edge is reachable from either
neighbouring column even though it was counted in only one.

A cell counts excerpts — de-duplicated, so an excerpt tagged with both a code
and one of its sub-codes counts once — or, with `mode = "documents"`, distinct
documents. Every document belongs to exactly one column, so a row's cells add
up to its total either way; `documentsPerColumn` is the denominator, the
documents in scope per column whether or not anything in them is coded.

## Boolean and proximity queries

`ExcerptFilter.query` is the one condition that is not SQL. It is a small
recursive expression:

```jsonc
{
  "op": "near",
  "terms": [
    { "codeId": "…", "includeDescendants": true },
    { "op": "or", "terms": [{ "codeId": "…" }, { "codeId": "…" }] },
  ],
  "within": { "kind": "paragraph" },
}
```

A term is either a code (with the same "include sub-codes" choice as the rest
of the browser) or a nested query, told apart by their fields. `op` is `and`,
`or`, `not` or `near`; `within` applies only to `near` and is either
`{"kind":"paragraph"}` (the default) or `{"kind":"chars","n":…}`.

The semantics are **co-located**, not per-excerpt: an excerpt satisfies a term
when it carries the code itself _or_ overlaps an excerpt that does, using the
same half-open `a.start < b.end AND b.start < a.end` as `co_occurrence` and
`overlaps_code_id`. That is the only reading that is useful on real coding,
where two coders rarely draw byte-identical ranges. Because an excerpt always
overlaps itself, one carrying both codes matches `and` and `near` on its own,
and is excluded from `not`.

| `op`   | An excerpt matches when it…                                                      |
| ------ | -------------------------------------------------------------------------------- |
| `and`  | satisfies every term                                                             |
| `or`   | satisfies any term                                                               |
| `not`  | satisfies the first term and does not overlap any excerpt satisfying a later one |
| `near` | satisfies the first term and lies near an excerpt satisfying each later one      |

`near` in paragraph scope means the two excerpts touch a common paragraph;
paragraphs are the document text split on `\n`, and an excerpt's paragraph
span is computed from its offsets, so an excerpt crossing a break belongs to
both. In character scope it means at most `n` **code points** lie between them
(overlapping or touching counts as zero), so emoji and CJK text measure the way
the offsets do.

Image regions never match: a query is defined on ranges, exactly like
`overlaps_code_id`.

`db::query_expr` evaluates it in Rust rather than in SQL: `excerpts::query`
runs the rest of the filter, takes the candidate ids **in result order**, and
for each document involved loads that document's text excerpts once and
evaluates the expression over bitmasks. The neighbours a term looks at are
every text excerpt of the document, not only the candidates — asking whether
an excerpt overlaps something coded B is a question about the document, not
about what the browser would otherwise have shown. Filtering happens before
paging, so `total` is the number of real matches and the page is then re-read
by id. `validate` rejects an unknown operator, a `not`/`near` with fewer than
two terms, an empty code id, an out-of-range distance or excessive nesting
before any of that runs; `src/core/query.ts` mirrors those rules so the
builder can grey out "Apply" instead of bouncing off an error.

A saved filter is a whole `ExcerptFilter`, so queries save with it and the
saved-filter list shows `describeQuery` under the name.

## Sets and saved filters

A **set** is a named group of codes or of documents. The two kinds live in one
table because they behave identically; `sets.kind` says which, and the unique
index is on `(kind, name COLLATE NOCASE)`, so the same name can name a code set
and a document set.

`set_members.member_id` points at `codes.id` or at `documents.id` depending on
the set's kind, so it cannot be a foreign key and `ON DELETE CASCADE` cannot
clean it up. Two triggers do that instead:

```sql
CREATE TRIGGER set_members_code_deleted AFTER DELETE ON codes BEGIN
  DELETE FROM set_members
   WHERE member_id = OLD.id
     AND set_id IN (SELECT id FROM sets WHERE kind = 'code');
END;
```

and the mirror image for `documents`. A set whose members have all been deleted
is still a set; deleting a set (`ON DELETE CASCADE` on `set_id`) takes its
member rows but never the codes or documents themselves.

`ExcerptFilter` gains `code_set_ids` and `document_set_ids`. `db::excerpts::query`
expands each set to its members and unions them into the ids the user picked
before anything else looks at them, so a code set behaves exactly like ticking
every code in it: `include_descendants` still expands each member to its
subtree, and `require_all_codes` still asks for every one of them at once. A
filter that names only empty or unknown sets matches nothing rather than
everything.

A **saved filter** is that whole `ExcerptFilter` serialized to JSON under a
name. `save_filter` upserts on the name (case-insensitively), so saving twice
under one name replaces it. JSON that cannot be parsed — written by a newer
build, or hand-edited — reads back as the default filter rather than making the
whole list unreadable. Applying one sets every field of the browser's filter
state, so anything it leaves out returns to its default.

`db::sets::union_with_sets` is the one place that does this expansion (the
picked ids, then the ids the picked sets expand to, de-duplicated);
`excerpts::query` uses it for both `code_set_ids` and `document_set_ids`.
`db::analysis::code_frequencies` and `db::analysis::co_occurrence` reuse it for
a `document_set_ids` parameter — the only id filter either of them takes — so
the "Sets" group in the analysis views' document picker behaves exactly like
the excerpt browser's: a set that is picked but empty or unknown matches no
document, not every document. `code_by_document` and the sets UI itself take
no code filter, so there is no `code_set_ids` in the analysis views.

## Adjusting excerpts

Three operations in `db::excerpts` refine an existing text excerpt, each in one
transaction and each invertible from the frontend's undo stack:

| Operation        | Effect                                                                                                                                                            | Inverse                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `update_range`   | moves `start_pos`/`end_pos`, recomputes `snapshot` from the document text and bumps `updated_at`; codes and memos are untouched                                   | `update_range` back to the old offsets                                                      |
| `split`          | cuts `[start, end)` at a code point into `[start, at)` and `[at, end)`; the left half keeps the id and the memos, the right half copies the codes                 | `merge_adjacent` of the two halves                                                          |
| `merge_adjacent` | folds two touching or overlapping excerpts into `[min start, max end)` with the union of their codes; the right one is deleted and its memos move to the survivor | undo the added codes, `update_range` the survivor back, then `restore` the removed snapshot |

Ranges are still validated against `documents.text_length` in code points, and
a range another text excerpt already occupies exactly is a `Conflict`, because
`excerpts_text_range_uq` allows one text excerpt per exact range. Two excerpts
count as mergeable when they touch or overlap (`left.start <= right.end AND
right.start <= left.end`).

Because a merge re-points memos to the survivor rather than deleting them,
`restore` upserts memos (`ON CONFLICT(id) DO UPDATE`) so undoing a merge moves
them back instead of failing on the primary key.

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
- The code-by-descriptor cross-tab reads `descriptor_values` for one field,
  maps every in-scope document to exactly one column, and then counts the
  excerpt tags in Rust; nothing about the binning belongs in SQL.

## Exports

- Codebook CSV: `id, path, name, parent_id, color, description, shortcut, excerpt_count`
- Codebook JSON: `{ format: "misket-codebook", version: 1, codes: [{ id, parentId, name, color, description, shortcut, sortOrder }] }`,
  codes listed parents-before-children (depth-first in path order, like the CSV)
- Excerpts CSV: `excerpt_id, document, start, end, geometry, text, codes, memo_count, created_at`
  (codes are full paths separated by `; `), then one column per descriptor
  field, named after the field, holding the excerpt's document's value.
  `start`/`end` are empty for image excerpts and `geometry` is empty for text
  ones; `text` holds the snapshot either way
- Project JSON: `{ format: "misket-project", formatVersion: 1, meta, documents, codes, excerpts, memos, descriptorFields, descriptorValues, sets, savedFilters }`.
  `sets` is `[{ set: SetInfo, memberIds }]` for every code set and document
  set; `savedFilters` is the `SavedFilter` list with `filter` already parsed
  back into an `ExcerptFilter` object, not left as a JSON string. Image bytes
  are not included: the JSON stays a readable text export, and the `.misket`
  file remains the thing that holds the media.

## Codebook import

`db::codebook_import::import_codebook` (`crates/misket-core/src/db/codebook_import.rs`)
reads either a codebook JSON export or CSV with header
`name, parent, color, description, shortcut` (`parent` is a full path with
`/` separators, matching the CSV export above), reducing both to a flat
list of full name paths. One transaction:

- `merge` matches existing codes by full path, case-insensitively. A matched
  code only gets its `description`/`color`/`shortcut` filled in where they
  are empty — never overwritten. Codes with no match are created under the
  matched parent (or at the root).
- `add-under` grafts every imported code fresh under a given parent (or the
  root), without matching against the existing codebook at all.

A color is imported only if it is a valid `#rrggbb` string; otherwise the
code gets the same next-in-palette default as a code created with no color.
A shortcut is imported only if it is free; if it is already taken (or
otherwise invalid), it is dropped and the code's path is added to the
report's `skippedShortcuts` instead of failing the import.
