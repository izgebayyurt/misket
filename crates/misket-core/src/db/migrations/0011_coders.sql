-- Misket project schema, version 11: coder identity.
-- Applied inside a transaction by db::migrate().
--
-- Misket still has no accounts, but a project file now knows *whose* work it
-- holds. A coder is an install: an id generated once and kept in the app's
-- settings, plus the name and colour that install signs with. That is enough
-- for the two things the id exists for — merging a colleague's copy of the
-- project back into this one, and comparing two people's coding of the same
-- passage — while staying a plain string that travels with the file.
--
-- The rows are written by `db::coders::ensure_local`, which the desktop app
-- calls right after migrating: it upserts the row for whoever is at the
-- keyboard and backfills the empty ids this migration leaves behind. Nothing
-- here needs to know the local coder, so the migration itself is pure SQL and
-- the same for everyone.

CREATE TABLE coders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- `excerpt_codes` gains the coder to its primary key: two people can apply
-- the same code to the same passage, and those are two rows, two facts and
-- two things to agree or disagree about. SQLite cannot add a column to a
-- primary key, so the table is rebuilt.
--
-- `coder_id = ''` means "written before this migration, owner not yet
-- known". `ensure_local` turns every one of them into the local coder, once;
-- afterwards there are none and the backfill is a no-op.
CREATE TABLE excerpt_codes_v11 (
  excerpt_id TEXT NOT NULL REFERENCES excerpts(id) ON DELETE CASCADE,
  code_id    TEXT NOT NULL REFERENCES codes(id)    ON DELETE CASCADE,
  coder_id   TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (excerpt_id, code_id, coder_id)
) WITHOUT ROWID;

INSERT INTO excerpt_codes_v11 (excerpt_id, code_id, coder_id, created_at)
SELECT excerpt_id, code_id, '', created_at FROM excerpt_codes;

DROP TABLE excerpt_codes;
ALTER TABLE excerpt_codes_v11 RENAME TO excerpt_codes;

CREATE INDEX excerpt_codes_code_idx  ON excerpt_codes(code_id);
CREATE INDEX excerpt_codes_coder_idx ON excerpt_codes(coder_id);

-- A memo is somebody's note, and a history node is somebody's edit. Neither
-- is part of a key, so both take a plain column with the same empty-string
-- convention.
ALTER TABLE memos   ADD COLUMN coder_id TEXT NOT NULL DEFAULT '';
ALTER TABLE history ADD COLUMN coder_id TEXT NOT NULL DEFAULT '';

CREATE INDEX memos_coder_idx ON memos(coder_id);
