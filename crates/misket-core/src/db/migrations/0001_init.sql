-- Misket project schema, version 1.
-- Applied inside a transaction by db::migrate(). Connection pragmas
-- (foreign_keys, journal_mode, synchronous, application_id) are set at open time.

CREATE TABLE project_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('text','image','video')),
  name          TEXT NOT NULL,
  source_path   TEXT,
  source_format TEXT,
  content_hash  TEXT NOT NULL,
  text          TEXT,             -- NFC, LF-only, no BOM. Immutable after insert.
  text_length   INTEGER,          -- code point count
  media_json    TEXT,             -- milestone 2: {"width","height","durationMs","mime"}
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK ((kind = 'text') = (text IS NOT NULL))
);

CREATE TABLE codes (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES codes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  color       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  shortcut    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (id <> parent_id)
);
CREATE INDEX codes_parent_idx ON codes(parent_id, sort_order);
CREATE UNIQUE INDEX codes_sibling_name_uq ON codes(COALESCE(parent_id, ''), name COLLATE NOCASE);
CREATE UNIQUE INDEX codes_shortcut_uq ON codes(shortcut) WHERE shortcut IS NOT NULL;

CREATE TABLE excerpts (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('text','image_region','video_range')),
  start_pos   INTEGER,            -- text: code point offset (inclusive); video: milliseconds
  end_pos     INTEGER,            -- text: code point offset (exclusive); video: milliseconds
  geometry    TEXT,               -- image_region: JSON {"x","y","w","h"} normalized 0..1
  snapshot    TEXT,               -- text: the excerpted text
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (
    (kind = 'text'         AND start_pos >= 0 AND end_pos > start_pos AND geometry IS NULL AND snapshot IS NOT NULL) OR
    (kind = 'video_range'  AND start_pos >= 0 AND end_pos > start_pos AND geometry IS NULL) OR
    (kind = 'image_region' AND geometry IS NOT NULL AND start_pos IS NULL AND end_pos IS NULL)
  )
);
CREATE INDEX excerpts_doc_pos_idx ON excerpts(document_id, start_pos, end_pos);
CREATE UNIQUE INDEX excerpts_text_range_uq ON excerpts(document_id, start_pos, end_pos) WHERE kind = 'text';

CREATE TABLE excerpt_codes (
  excerpt_id TEXT NOT NULL REFERENCES excerpts(id) ON DELETE CASCADE,
  code_id    TEXT NOT NULL REFERENCES codes(id)    ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (excerpt_id, code_id)
) WITHOUT ROWID;
CREATE INDEX excerpt_codes_code_idx ON excerpt_codes(code_id);

-- One nullable FK per target so ON DELETE CASCADE works. All NULL = project memo.
CREATE TABLE memos (
  id          TEXT PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  code_id     TEXT REFERENCES codes(id)     ON DELETE CASCADE,
  excerpt_id  TEXT REFERENCES excerpts(id)  ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK ((document_id IS NOT NULL) + (code_id IS NOT NULL) + (excerpt_id IS NOT NULL) <= 1)
);
CREATE INDEX memos_document_idx ON memos(document_id);
CREATE INDEX memos_code_idx     ON memos(code_id);
CREATE INDEX memos_excerpt_idx  ON memos(excerpt_id);
