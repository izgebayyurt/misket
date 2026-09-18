-- Misket project schema, version 14: audio and video documents.
-- Applied inside a transaction by db::migrate().

-- One excerpt per exact time range, mirroring `excerpts_text_range_uq` and
-- `excerpts_image_region_uq`, so coding the same in/out points twice upserts
-- instead of duplicating. Positions are milliseconds (see 0001_init.sql).
CREATE UNIQUE INDEX excerpts_video_range_uq
  ON excerpts(document_id, start_pos, end_pos) WHERE kind = 'video_range';

-- `media_blobs` gains a name and an optional excerpt, so one store holds both
-- an image document's pixels (`name = 'source'`, no excerpt) and the small
-- JPEG frame captured for a video excerpt (`name = 'thumbnail'`).
--
-- Audio and video documents are held *by reference*: a two-hour interview
-- must not live inside the project file, so their bytes stay on disk at
-- `documents.source_path` and nothing is written here for them.
--
-- Nothing references `media_blobs`, so the rename-copy-drop rebuild below
-- cannot leave a dangling foreign key behind.
ALTER TABLE media_blobs RENAME TO media_blobs_old;
CREATE TABLE media_blobs (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  excerpt_id  TEXT REFERENCES excerpts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'source',
  mime        TEXT NOT NULL,
  bytes       BLOB NOT NULL
);
INSERT INTO media_blobs (document_id, excerpt_id, name, mime, bytes)
  SELECT document_id, NULL, 'source', mime, bytes FROM media_blobs_old;
DROP TABLE media_blobs_old;
CREATE UNIQUE INDEX media_blobs_document_uq
  ON media_blobs(document_id, name) WHERE excerpt_id IS NULL;
CREATE UNIQUE INDEX media_blobs_excerpt_uq
  ON media_blobs(excerpt_id, name) WHERE excerpt_id IS NOT NULL;
