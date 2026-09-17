# Data model

A project file is a SQLite database with `PRAGMA application_id = 0x4D534B54`
("MSKT") and `PRAGMA user_version` set to the schema version. Migrations live in
`crates/misket-core/src/db/migrations/` and run forward-only inside one
transaction; an older file is backed up next to itself (`name.misket.bak-v1`)
before it is upgraded.

Connection pragmas: `foreign_keys = ON`, `journal_mode = DELETE` (so the file
stays a single file that can be copied while open), `synchronous = NORMAL`.

## Tables

| Table                | Purpose                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_meta`       | key/value: `schema_version`, `project_id`, `name`, `created_at`, `created_with_app_version`                                                                                                                                                                                               |
| `documents`          | imported sources. `kind` is `text` or `image` (`video` later). `text` is immutable and NULL for media; `text_length` is the code point count; `media_json` holds `{width,height,mime}`; `content_hash` de-duplicates imports; `transcript_json` is how the document marks who is speaking |
| `codes`              | the codebook tree: adjacency list (`parent_id`) with `sort_order` among siblings, `color`, optional single-key `shortcut`, and the definition fields `description`, `inclusion`, `exclusion` and `example_excerpt_id`. Sibling names are unique case-insensitively                        |
| `excerpts`           | coded ranges. `kind` = `text` (code point `start_pos`/`end_pos`), `video_range` (milliseconds) or `image_region` (`geometry` JSON `{x,y,w,h}` normalized 0..1). `snapshot` stores the excerpted text or a description of the region. One excerpt per exact range or rectangle             |
| `excerpt_codes`      | many-to-many between excerpts and codes, per coder: the primary key is `(excerpt_id, code_id, coder_id)`, so two people applying the same code to one passage are two rows                                                                                                                |
| `coders`             | who has worked on this project: `id` (a UUID an install generates once and keeps in its settings), `name`, `color`, `created_at`                                                                                                                                                          |
| `media_blobs`        | the bytes of an image document, with their MIME type, one row per document. Deleting the document drops them                                                                                                                                                                              |
| `memos`              | notes with at most one target: `document_id`, `code_id`, `excerpt_id`, or none (project memo). Each target is a real foreign key so deletes cascade. `coder_id` is who wrote it                                                                                                           |
| `descriptor_fields`  | document attributes ("Site", "Age group"). `kind` is `text`, `number`, `choice` or `date`; `options_json` holds a choice field's options as a JSON array of strings; `sort_order` is the order they are shown in. Names are unique case-insensitively                                     |
| `descriptor_values`  | one value per (`document_id`, `field_id`), `WITHOUT ROWID`. Both foreign keys cascade, so deleting a document or a field takes its values with it                                                                                                                                         |
| `sets`               | named groups of codes or of documents. `kind` is `code` or `document`; names are unique per kind, case-insensitively, so "Round 1" can be both                                                                                                                                            |
| `set_members`        | `(set_id, member_id)`, `WITHOUT ROWID`. `member_id` is a code id or a document id depending on the set's kind, so it is not a foreign key; two triggers stand in for the cascade                                                                                                          |
| `saved_filters`      | a whole `ExcerptFilter` as JSON under a unique (case-insensitive) name                                                                                                                                                                                                                    |
| `framework_matrices` | a saved framework matrix: its name, how to make its rows (`row_kind`, `row_field_id`, `row_set_id`) and where its columns come from (`code_set_id`, or `code_ids_json`). Names are unique case-insensitively                                                                              |
| `framework_cells`    | the written summary for one (`matrix_id`, `row_key`, `code_id`), `WITHOUT ROWID`. `row_key` is a document id or a descriptor value; a trigger stands in for the missing `code_id` cascade                                                                                                 |

All ids are UUID v4 strings so deleted rows can be restored with their original
identity (undo) and so exports are stable.

## Coders

Misket has no accounts and no server, and a project is one file. A **coder**
(schema 11, `crates/misket-core/src/db/coders.rs`) is therefore an _install_:
a UUID generated once and kept in the app's settings (`AppSettings.coderId`),
plus the name and colour that install signs with (`coderName`, `coderColor` —
the name is the same string the activity log's `actor` uses). The id is the
stable part. Names change and two people can share one; the id is what lets a
later "pull from another coder's copy" tell two people's work apart, and an
inter-rater view line them up.

Three columns carry it:

| Column                   | Why                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `excerpt_codes.coder_id` | part of the primary key, so agreeing with a colleague adds a coding instead of doing nothing |
| `memos.coder_id`         | a memo is somebody's note                                                                    |
| `history.coder_id`       | an edit is somebody's edit, so undo and redo can give a coding back to whoever made it       |

`coder_id = ''` means "written before schema 11, owner not yet known". The
migration leaves every existing row that way and `coders::ensure_local` — which
the desktop app calls right after migrating, with the id, name and colour from
settings — upserts the local coder's row and adopts them, once. That is right,
because a project file that predates coder identity can only have had one
person in it. It is idempotent and a no-op from the second open on.

Like the actor name, the local coder id rides on the connection rather than
through forty function parameters: `history::set_local_coder` writes it to a
`TEMP` table and `history::local_coder(conn)` reads it back, so it is per
connection and never in the file. A `&Connection` that was never told (a core
test that has not called `ensure_local`) writes an empty coder.

**Which rules follow from that.**

- Every new coding — `apply_codes`, `add_codes`, in vivo, quick-code,
  auto-code, `bulk::add_codes_many` — is the local coder's.
- Anything that _moves_ a coding keeps its original coder: `bulk::retag_code`
  (which is also roll-up), `codes::merge`, splitting and merging excerpts, and
  every undo payload. Merging two codes never quietly reassigns a colleague's
  work to whoever ran the merge.
- `excerpts::remove_code(conn, excerpt, code, coder_id)` takes off _one_
  coder's row: `None` means the local coder, which is what the inspector's ×
  does, and `Some(id)` is the deliberate "Remove Bob's coding".
  `bulk::remove_codes_many` is the same, always the local coder's. Deleting the
  whole excerpt still takes every coder's rows with it, and its inverse
  restores them with their coders.
- Counting is over **distinct `(excerpt, code)` pairs**, everywhere:
  frequencies, co-occurrence, code-by-document, both cross-tabs, `Code.excerptCount`
  and the overview's top codes. A passage two people coded the same way is one
  excerpt under that code, not two. Narrowing to one coder is the way to ask
  "how much did _they_ code".
- `ExcerptFilter.coderIds` (absent or empty = everyone) keeps only excerpts
  carrying a coding by one of those coders. It narrows which excerpts come
  back, not which codes they show.

The DTO side: an excerpt keeps `codeIds` — every code on it once, whoever
applied it, so rendering and the document view's lanes do not change when a
second coder agrees — and adds `codings: [{codeId, coderId}]`, one entry per
`excerpt_codes` row. `coders::list` (the `list_coders` command) returns
`CoderSummary {id, name, color, codingCount, memoCount, isLocal}` for everyone
in the file, including an id that appears on a coding but has no `coders` row
of its own, named by its id so nothing is invisible to a filter.

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

## Transcripts

A transcript opens each turn with a speaker label — `Alice:`, `[Alice]`,
`Alice (00:12):`, `[00:12:03] Alice:`, `00:12:03 Alice:`. Those labels are
**part of the document text**, and they stay there: text is immutable and
every excerpt offset is a code point into it, so moving them would invalidate
work already done. What Misket stores is how to _find_ them.

`documents.transcript_json` (schema 10) holds the `TranscriptFormat`:

```jsonc
{ "kind": "preset", "preset": "name_colon" }
{ "kind": "regex", "pattern": "^<<(?<speaker>[^>]+)>>[ \t]*" }
{ "kind": "none" } // looked at, and explicitly not a transcript
```

`NULL` means the document has never been looked at; the next read detects a
format and stores the answer (`db::transcripts::ensure`, called from
`documents::create` and `documents::get`). Stored alongside the format is a
cache of what it finds — `speakers` and `turnCount` — which is what puts
`speakers` on `DocumentSummary` without a listing re-scanning any text.
Document text never changes, so that cache is valid for as long as the format
is. `project_meta.transcript_default` is the project-level default for new
imports: `auto`, or a serialized format.

Each preset is a regex anchored at the start of a line with a named group
`speaker` and, where the form carries one, `time`; a custom pattern is the
user's own, validated to compile and to name `speaker`. Detection
(`text::transcript::detect_format`) tries every preset and keeps the one that
finds the most turns, which is conservative on purpose: a label must be one to
four words, at most 40 characters, made of letters, digits, spaces,
apostrophes, hyphens and dots, and it must **recur** — twice, or three times
when it is a single letter (`Q:`) or a word documents use as an aside
(`Note:`). A `(see notes):` parenthetical and a one-off `Note:` line stay
ordinary text.

A `Turn` carries `[labelStart, labelEnd)` — the whole label, leading spaces,
name, timestamp, delimiter and trailing spaces — and `[start, end)`, the
spoken text with trailing whitespace trimmed. Both are code points. That
split is what lets the document view cut the label into its own segments and
lay them out in a gutter, and what lets `clipToSpokenText` trim a selection
that starts or ends inside one.

`ExcerptRow.speaker` is who was speaking where the excerpt starts — the turn
whose `[labelStart, end)` contains it, so an excerpt that swallowed a label is
still attributed to the right person. `ExcerptFilter.speakers` narrows to what
those speakers said; like `query`, it is not a SQL condition, so
`excerpts::query` applies it in Rust before paging and `total` stays honest.
Both read turns through `transcripts::TurnIndex`, which loads each document's
transcript once however many of its excerpts are involved.

`analysis::code_by_descriptor` special-cases the field id `speaker`: the
columns become the speakers of the documents in scope (case-insensitively
sorted), plus a trailing `(no speaker)` column for anything outside a turn.
Unlike a descriptor, where a document belongs to exactly one column, a
transcript feeds several, so `documentsPerColumn` is the documents that
speaker appears in. Each column carries `op: "speaker"` and its own name in
`values`, which is the speaker filter that reproduces it; the `(no speaker)`
column carries none, so it does not click through.

## Code definitions

A code carries three pieces of prose plus one pointer (schema 5):

| Column               | Holds                                                       |
| -------------------- | ----------------------------------------------------------- |
| `description`        | what the code means                                         |
| `inclusion`          | when to apply it                                            |
| `exclusion`          | when not to, and what to use instead                        |
| `example_excerpt_id` | one already-coded excerpt held up as the canonical instance |

`inclusion` and `exclusion` are `TEXT NOT NULL DEFAULT ''`, so every existing
code migrates with both rules empty and nothing has to be back-filled.
`example_excerpt_id` is a real foreign key with `ON DELETE SET NULL`: deleting
the excerpt someone picked as an example clears the pointer and leaves the
code (and its other excerpts) untouched. `codes::update` validates the id
against `excerpts` first, so a dangling pointer is a `NotFound` at write time
rather than a blank panel later. The patch uses a double option, so
`{"exampleExcerptId": null}` clears it and omitting the field leaves it alone
— the same convention as `shortcut`.

Only `description` is shown in the code palette, which has to stay scannable
while coding; the full definition lives in the code dialog and in the memo
panel, next to a quote of the example excerpt's snapshot.

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

## Framework matrices

A framework matrix (Ritchie & Spencer; NVivo calls them "framework matrices")
is a grid of **cases** by **themes** where every cell holds a short written
summary of what that case says about that theme, with the excerpts behind it
one click away. `framework_matrices` stores only the _configuration_; the grid
itself is recomputed on every read by `db::framework::get_matrix`, so
importing a document, filling in a descriptor or coding another passage
changes the grid without rewriting anything.

| Column                          | Meaning                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `row_kind = 'document'`         | one row per document: every document, or the members of `row_set_id`                             |
| `row_kind = 'descriptor_value'` | one row per distinct value of `row_field_id` among those documents; the row pools their excerpts |
| `code_set_id`                   | the columns are that code set's members, in codebook order                                       |
| `code_ids_json`                 | otherwise the columns are this JSON array of code ids, in column order                           |

Rows come out in project document order; grouped rows follow the field's own
order (a `choice` field's options in the order they are defined, numbers
numerically, everything else — including ISO dates — as text), and documents
with no value gather into a last row labelled `(no value)` whose `row_key` is
the empty string. A row set or grouping field that no longer exists yields no
rows, and a column code that no longer exists is dropped, rather than making
the matrix unopenable.

`row_field_id`, `row_set_id` and `code_set_id` are deliberately **not**
foreign keys. Deleting a set or a descriptor field is undoable and recreates
it with its original id, so a matrix that names one keeps pointing at it
instead of being silently rewritten by `ON DELETE SET NULL`.

A cell's `excerptCount` is the distinct excerpts in that row's documents
carrying that code **or any of its descendants** — the same
descendant-inclusive counting `code_frequencies` does, so the badge and the
drawer agree. `get_matrix` returns one cell per (row, column) pair, summary
included, which is exactly what the grid renders.

`framework_cells.row_key` is the document id or the descriptor value rather
than a row index, so reordering documents or reshaping the matrix never moves
a summary onto the wrong case. `set_cell_summary` returns the previous text so
the frontend's undo stack can put it back, and deletes the row when the new
summary is blank instead of storing an empty one. `code_id` is not a foreign
key for the same reason `set_members.member_id` is not, so a trigger takes the
place of the cascade:

```sql
CREATE TRIGGER framework_cells_code_deleted AFTER DELETE ON codes BEGIN
  DELETE FROM framework_cells WHERE code_id = OLD.id;
END;
```

A deleted _document_ keeps its summaries: the row simply stops being listed,
and undoing the delete brings the row and its text back together.

`delete_matrix` hands back the matrix with every summary it held
(`FrameworkMatrixWithCells`) and `restore_matrix` puts both back, so deleting
a matrix is undoable like everything else. `export_csv` writes the row label
then one column per code holding that cell's summary, with the code paths as
the header.

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

## History

`history` (schema 8, groups in schema 9) is both the audit trail and the undo
stack. It replaced
`activity_log`, which was append-only and could only be read; a history row
also carries the operation and its exact opposite, so a change can be walked
back and forward long after the window that made it has closed. It is a table
in the project file rather than a sidecar, so the trail _and_ the undo are
copied by `backup::save_copy`, written into every timestamped backup, and
restored with the data they describe.

| Column                             | Holds                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                               | the write order; the log is read by `id`, never by `at` (see below)                     |
| `parent_id`                        | the step this one followed — the edge that makes the log a tree. `NULL` for a root      |
| `at`, `actor`                      | when, and whoever was at the keyboard                                                   |
| `coder_id`                         | which coder made this edit (schema 11); `''` for a node recorded before that            |
| `kind`, `target_kind`, `target_id` | the dotted verb and what it happened to                                                 |
| `summary`, `detail_json`           | the sentence the UI shows, and the structured before/after values behind it             |
| `forward_json`, `inverse_json`     | the operation and its opposite, as replayable JSON. `NULL` = this step cannot be walked |
| `branch_name`                      | the name "fork here" gave this node                                                     |
| `preferred_child`                  | which child redo follows when there is more than one                                    |
| `group_id`                         | the compound step this node is part of, named by the id of the node that leads it       |
| `group_summary`                    | on a group's leading node only: the label shown in place of the steps inside it         |

`history_blobs(node_id, name, bytes)` holds what is too big for a JSON
payload — a deleted document's text under `text`, an image's pixels under
`media` — keyed by node and by a name the payload refers to. The rows go with
their node: `ON DELETE CASCADE` when compaction drops it, and explicitly when
compaction clears the payloads of the new root.

`project_meta.history_head` is the id of the node undo would take back next;
empty means "before the first node". `history_root_child` is the same idea for
redo at the very beginning.

### The tree

Undo walks toward the root, redo toward a leaf. An edit made _after_ an undo
becomes a second child of the same parent rather than discarding the path it
left, so nothing is ever thrown away:

```
c1 ── c2 ── c3          ← undo to c1, then edit again
       └─── c4 (head)   ← c2 and c3 are still there
```

`history::checkout(id)` moves the project to any node: it computes the path
from the head up to the lowest common ancestor and down the other side, and
applies the inverses and then the forwards in one transaction, so a path that
turns out to contain a step with no payload leaves the project untouched.
`fork_here(name)` labels a node, `tree()` reads the whole shape, and
`compact_before(id)` throws away everything that is not `id` or under it,
making `id` a root with its payloads cleared; it refuses while the project is
somewhere else in the tree, because that state would become unreachable.

### Compound steps

One thing the user does can be several writes: merging two codes touches both
sides, importing a folder creates a document per file, rolling sub-codes up
retags and then deletes each of them, in vivo coding creates a code and
applies it. Each write still gets its own node — so each still carries an
exact inverse, and each still reads correctly in the activity feed — but they
share a `group_id`, and `undo`, `redo` and `checkout` move over the whole
group at once.

`history::begin_group(conn, summary)` / `end_group(conn)` bracket them, in the
same per-connection `TEMP` table as the replay flag; `history::group(conn,
summary, f)` is the closure form, and `relabel_group` renames the step for an
operation that only knows what it did once it has done it ("Imported a
codebook: 12 codes created, 3 matched"). The first node recorded inside a
group lends the group its id and carries its label. `tree()` collapses a group
into that one node, with `stepCount` saying how many writes are behind it, and
`checkout` on a node inside a group lands on the whole group rather than
half-way through one operation. The Tauri commands `history_begin_group` /
`history_end_group` expose the bracket, for the few multi-step actions the
frontend still drives (a multi-file import, a push-down, a roll-up).

### Payload conventions

A payload is `serde_json::Value`, self-contained, and carries the **original
ids**, so a restore puts the same row back rather than a copy that only looks
the same. Timestamps travel with it too (`created_at` on a tag, `updated_at`
on a code or an excerpt), because "put it back as it was" includes when it
last changed. So does attribution: a `TagRow` carries `coder_id` and a `Memo`
carries its own, so undoing and redoing a coding gives it back to whoever made
it rather than to whoever pressed Ctrl+Z. An empty `coder_id` in a payload
written before schema 11 replays as the local coder, which is who wrote it. There is one vocabulary per family, and the same shape serves
both directions:

| Family                             | Payload                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `code.*`                           | a `CodeOp`: `restore` (a `CodeTreeSnapshot`, plus children to re-parent and tags to take back), `drop`, `delete`, `update`, `move`, `merge`  |
| `excerpt.*`, `bulk.*`              | an `ExcerptChange`: memos to move, excerpts to delete, ranges to set, snapshots to restore, tags to remove, tags to add, timestamps to touch |
| `memo.*`                           | a `MemoChange`: memo ids to delete and whole rows to upsert                                                                                  |
| `document.*`                       | a `DocumentOp`: `restore` (a `DocumentSnapshot`, with the text and the pixels in the node's blobs), `drop`, `rename`, `reorder`              |
| `descriptor.*`                     | a `DescriptorOp`: `field` (the row, optionally replacing every value), `dropField`, `reorderFields`, `setValue`                              |
| `set.*`, `filter.*`                | a `SetOp`: `restore`, `drop`, `rename`, `members` (the whole list), `restoreFilter`, `dropFilter`                                            |
| `framework.*`                      | a `FrameworkOp`: `restore` (the matrix and every summary), `drop`, `configure`, `cell`                                                       |
| `project.*`, `analysis.*`          | a `ProjectOp`: one `project_meta` key and the value to put there                                                                             |
| `transcript.*`                     | a `TranscriptChange`: the document (absent for the project default) and the format to put in force (absent meaning "detect again")           |
| a node whose sibling does the work | `{"op":"noop"}` — the first half of a merge or a split, whose group partner undoes both (schema 8 wrote `{"op":"linked"}`; both are read)    |

A `DocumentSnapshot` is everything deleting a document would take with it: the
row, the excerpts cut from it with their codes and memos, its descriptor
values, the document sets it belonged to, the framework summaries written
against its row and its own memos. Its text and image bytes are _not_ in the
JSON — they go in `history_blobs`, which is why `DocumentOp::Restore` is
handed the node it belongs to. `documents::restore` puts it all back under the
original id, skipping anything whose other side has been deleted since.

A `CodeTreeSnapshot` is everything deleting a branch of the codebook would
take with it: the rows parents-first, the sibling order of the groups
involved, the tags, the memos, the set memberships, the framework cells and
the example-excerpt pointers. `codes::snapshot_subtree` reads it before the
delete; `codes::restore_subtree` puts it back, skipping any row whose target
(an excerpt, a set, a matrix) has gone in the meantime rather than failing.

### Recording, and the replay flag

Every write path in `db::` records its own node, inside the same transaction
as the change:

```rust
activity::record(&tx, "code.moved", "code", Some(id), summary, detail, forward, inverse)?;
```

so an entry can never outlive — or be lost by — what it describes. Passing
`None` for both payloads records a step that reads correctly but cannot be
undone; nothing does that any more, and it is what every row copied over from
`activity_log` looks like.

Replaying a node calls the ordinary domain functions, which would log the
replay as a fresh edit. `history::with_replay` raises a flag in a `TEMP`
table (`temp.history_state`, per connection, never in the file) that turns
`record` into a no-op for the duration, and always lowers it again. Because
those functions open transactions of their own, every write path uses
`util::tx`, a `SAVEPOINT` that nests where `BEGIN` cannot.

**The actor.** Misket has no user accounts, so it is a plain string: the name
set in Settings (`AppSettings.coderName`) or the OS user name
(`USER`/`USERNAME`). Rather than grow an `actor` parameter on forty functions,
the Tauri layer puts it on the connection once, at open, with
`activity::set_actor`, which writes it to a `TEMP` table. SQLite keeps temp
tables per connection and outside the database file, so two people opening the
same project never see each other's name and the `.misket` is unchanged by it.
A `&Connection` that was never told (every core test) logs an empty actor.

**Kinds.** The verb is dotted, `noun.past_tense`. Every one of them is
undoable; restoring a backup is the only change in the app that is not, and it
is not recorded here at all, because it replaces the file the history lives in.

| Group        | Kinds                                                                                                                           | Undoable |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `code`       | `created`, `updated`, `moved`, `deleted`, `merged_into` (the source), `merged_from` (the survivor)                              | yes      |
| `excerpt`    | `created`, `codes_added`, `code_removed`, `range_updated`, `split`, `split_off`, `merged`, `merged_into`, `deleted`, `restored` | yes      |
| `bulk`       | `excerpts_deleted`, `codes_added`, `codes_removed`, `retagged`, `auto_coded`                                                    | yes      |
| `memo`       | `created`, `updated`, `deleted`, `restored`                                                                                     | yes      |
| `document`   | `imported`, `renamed`, `reordered`, `deleted`                                                                                   | yes      |
| `descriptor` | `field_created`, `field_updated`, `field_deleted`, `fields_reordered`, `value_set`                                              | yes      |
| `set`        | `created`, `renamed`, `members_changed`, `deleted`                                                                              | yes      |
| `filter`     | `saved`, `deleted`                                                                                                              | yes      |
| `framework`  | `matrix_created`, `matrix_updated`, `matrix_deleted`, `cell_set`                                                                | yes      |
| `codebook`   | `imported` (one group over the `code.*` nodes it wrote)                                                                         | yes      |
| `project`    | `renamed`                                                                                                                       | yes      |
| `analysis`   | `stop_words_set`                                                                                                                | yes      |
| —            | restoring a backup (`backup::restore`)                                                                                          | **no**   |

A node with no `inverse_json` can therefore only be one the schema-8 migration
copied over from `activity_log` — those predate payloads — or the root
`compact_before` made, whose past was deliberately thrown away. Undo says so
rather than "this step cannot be undone".

`target_kind` is `code`, `excerpt`, `document`, `descriptor_field`, `set`,
`saved_filter`, `framework_matrix`, `codebook` or `project`. Three conventions make the per-target
timelines readable:

- A **merge** and a **split** write one entry per side (`code.merged_into` on
  the source and `code.merged_from` on the survivor; `excerpt.split` and
  `excerpt.split_off`), because both halves need the event in their own
  history and one of them is about to disappear; they share a `group_id`, so
  they are one step to undo. Everything else writes one entry, or none when
  nothing actually changed (saving a code dialog without an edit, setting a
  descriptor to the value it already had).
- A **memo** is logged against what it is attached to, not against itself, so
  a code's history shows the note written while it was being renamed.
- A **bulk** operation targets its kind with a null `target_id` (or, for
  `retag_code`, the source code) and lists the ids it touched in
  `detail_json`.

`detail_json` holds a `{"from": …, "to": …}` object per field that moved, plus
whatever context the summary leaves out. `activity::code_history` and
`activity::excerpt_history` are `target_kind`/`target_id` lookups ordered by
`id`; `activity::list` pages the whole log newest first and also returns every
kind present, so the UI builds its filter from one call. An `ActivityEntry`
also carries `parentId`, `undoable`, `branchName` and `isHead`, so the feed
can show where the project currently stands.

Ordering is by `id`, never by `at`: `util::now()` formats RFC 3339 with
trailing zeros trimmed, so `…:00Z` sorts _after_ `…:00.5Z` as a string.

### History view

The History view (`src/components/history/HistoryView.tsx`) draws the whole
tree from one `history_tree()` call: `src/core/historyGraph.ts` is a pure
layout that turns the flat `HistoryNodeSummary[]` into rows (newest at the
top; a node always sorts above its parent, since child ids are always
greater) and lanes. The main line is the path from the root through each
node's `preferredChild` — the same field `next_child` reads when redo has no
argument — falling back to the newest child, so it always lands in lane 0;
every other child at a fork opens a lane at the point it diverges and gives
it back once it rejoins, so unrelated forks made at different times can share
a column without a line ever being drawn through an unrelated dot. Clicking a
row calls `history_checkout`; the row menu offers "Fork here…" (checks out
the node, then `history_fork`), "Rename branch…" (`history_rename_branch`)
and "Compact history before here…" (`history_compact`, refused up front —
with the same message the backend would give — when the head is not on or
under the chosen node). The view reads `history_tree()` fresh on every
mutation and on window focus, the same way the activity feed already did.

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

- Codebook CSV: `id, path, name, parent_id, color, description, inclusion, exclusion, shortcut, excerpt_count`
- Codebook JSON: `{ format: "misket-codebook", version: 1, codes: [{ id, parentId, name, color, description, inclusion, exclusion, shortcut, sortOrder }] }`,
  codes listed parents-before-children (depth-first in path order, like the CSV).
  `example_excerpt_id` is deliberately left out of both: it points at an
  excerpt that does not exist in the importing project
- Excerpts CSV: `excerpt_id, document, start, end, geometry, text, codes, coders, memo_count, created_at`
  (codes are full paths separated by `; `), then one column per descriptor
  field, named after the field, holding the excerpt's document's value.
  One row per excerpt, not per coding: `codes` lists every code on it once and
  `coders` lists the names of everyone who coded it, both `; `-separated. Who
  applied which code is in the project JSON, where each excerpt's `codings`
  pairs them up.
  `start`/`end` are empty for image excerpts and `geometry` is empty for text
  ones; `text` holds the snapshot either way
- Activity CSV: `at, actor, kind, target_kind, target_id, summary, detail_json`, oldest first
- Project JSON: `{ format: "misket-project", formatVersion: 1, meta, documents, codes, coders, excerpts, memos, descriptorFields, descriptorValues, sets, savedFilters, activity }`.
  `coders` is everyone whose work is in the file; each excerpt carries
  `codings: [{codeId, coderId}]` alongside `codeIds`, and each memo its own
  `coderId`.
  `sets` is `[{ set: SetInfo, memberIds }]` for every code set and document
  set; `savedFilters` is the `SavedFilter` list with `filter` already parsed
  back into an `ExcerptFilter` object, not left as a JSON string; `activity`
  is the whole log, oldest first, with each entry's `detail` already parsed.
  Image bytes
  are not included: the JSON stays a readable text export, and the `.misket`
  file remains the thing that holds the media.

## Codebook import

`db::codebook_import::import_codebook` (`crates/misket-core/src/db/codebook_import.rs`)
reads either a codebook JSON export or CSV with header
`name, parent, color, description, inclusion, exclusion, shortcut` (`parent`
is a full path with `/` separators, matching the CSV export above), reducing
both to a flat list of full name paths. The pre-schema-5 header
`name, parent, color, description, shortcut` is still accepted and imports
with both rules empty, and JSON entries missing `inclusion`/`exclusion`
default to empty strings. One transaction:

- `merge` matches existing codes by full path, case-insensitively. A matched
  code only gets its `description`/`inclusion`/`exclusion`/`color`/`shortcut`
  filled in where they are empty — never overwritten. Codes with no match are
  created under the matched parent (or at the root).
- `add-under` grafts every imported code fresh under a given parent (or the
  root), without matching against the existing codebook at all.

A color is imported only if it is a valid `#rrggbb` string; otherwise the
code gets the same next-in-palette default as a code created with no color.
A shortcut is imported only if it is free; if it is already taken (or
otherwise invalid), it is dropped and the code's path is added to the
report's `skippedShortcuts` instead of failing the import.
