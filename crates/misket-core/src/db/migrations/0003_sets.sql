-- Misket project schema, version 3: code and document sets, saved filters.
-- Applied inside a transaction by db::migrate().

-- A named group of codes or of documents. Names are unique per kind,
-- case-insensitively, so "Round 1" can exist as both a code set and a
-- document set.
CREATE TABLE sets (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('code','document')),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX sets_kind_name_uq ON sets(kind, name COLLATE NOCASE);
CREATE INDEX sets_kind_order_idx ON sets(kind, sort_order);

-- `member_id` points at `codes.id` or `documents.id` depending on the set's
-- kind, so it cannot be a foreign key. The triggers below take the place of
-- ON DELETE CASCADE.
CREATE TABLE set_members (
  set_id    TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  PRIMARY KEY (set_id, member_id)
) WITHOUT ROWID;
CREATE INDEX set_members_member_idx ON set_members(member_id);

CREATE TRIGGER set_members_code_deleted AFTER DELETE ON codes BEGIN
  DELETE FROM set_members
   WHERE member_id = OLD.id
     AND set_id IN (SELECT id FROM sets WHERE kind = 'code');
END;

CREATE TRIGGER set_members_document_deleted AFTER DELETE ON documents BEGIN
  DELETE FROM set_members
   WHERE member_id = OLD.id
     AND set_id IN (SELECT id FROM sets WHERE kind = 'document');
END;

-- A whole ExcerptFilter stored as JSON, exactly as the excerpt browser sends
-- it to `query_excerpts`.
CREATE TABLE saved_filters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  filter_json TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (length(trim(name)) > 0)
);
CREATE INDEX saved_filters_order_idx ON saved_filters(sort_order);
