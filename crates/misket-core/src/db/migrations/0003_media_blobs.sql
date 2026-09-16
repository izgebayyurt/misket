-- Misket project schema, version 3: image documents.
-- Applied inside a transaction by db::migrate().

-- Media bytes live inside the project file so a `.misket` stays self-contained
-- and can be moved between machines; `documents.source_path` is kept as a
-- reference to where the file came from.
CREATE TABLE media_blobs (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  bytes       BLOB NOT NULL
);

-- One image excerpt per exact rectangle, mirroring `excerpts_text_range_uq`,
-- so applying a code to the same region upserts instead of duplicating.
-- `geometry` is written by Rust in one canonical form (see db::excerpts::Rect).
CREATE UNIQUE INDEX excerpts_image_region_uq
  ON excerpts(document_id, geometry) WHERE kind = 'image_region';
