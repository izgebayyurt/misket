-- Misket project schema, version 6: framework matrices (Ritchie & Spencer).
-- Applied inside a transaction by db::migrate().

-- A saved grid of cases by themes. Rows are computed live from the row
-- configuration, never stored: `row_kind = 'document'` gives one row per
-- document (every document, or the members of `row_set_id`), and
-- `row_kind = 'descriptor_value'` gives one row per distinct value of
-- `row_field_id` among those documents.
--
-- Columns are either the members of the code set `code_set_id` or the codes
-- listed in `code_ids_json` (a JSON array of code ids, in column order).
--
-- `row_field_id`, `row_set_id` and `code_set_id` are deliberately not foreign
-- keys: deleting a field or a set is undoable and recreates it with the same
-- id, so a matrix that names one keeps pointing at it instead of being
-- silently rewritten. A target that is really gone just yields no rows or no
-- columns.
CREATE TABLE framework_matrices (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  row_kind      TEXT NOT NULL CHECK (row_kind IN ('document','descriptor_value')),
  row_field_id  TEXT NULL,
  row_set_id    TEXT NULL,
  code_set_id   TEXT NULL,
  code_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (length(trim(name)) > 0)
);
CREATE INDEX framework_matrices_created_idx ON framework_matrices(created_at);

-- One written summary per cell. `row_key` is the document id (row_kind
-- 'document') or the descriptor value (row_kind 'descriptor_value', the empty
-- string for documents with no value), so a summary survives re-ordering and
-- re-grouping. Rows with an empty summary are deleted rather than stored.
CREATE TABLE framework_cells (
  matrix_id  TEXT NOT NULL REFERENCES framework_matrices(id) ON DELETE CASCADE,
  row_key    TEXT NOT NULL,
  code_id    TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (matrix_id, row_key, code_id)
) WITHOUT ROWID;

-- `code_id` is not a foreign key for the same reason `set_members.member_id`
-- is not; this trigger stands in for ON DELETE CASCADE.
CREATE TRIGGER framework_cells_code_deleted AFTER DELETE ON codes BEGIN
  DELETE FROM framework_cells WHERE code_id = OLD.id;
END;
