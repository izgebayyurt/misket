-- Misket project schema, version 15: transcript alignment.
-- Applied inside a transaction by db::migrate().
--
-- A text document can point at a recording: the transcript of it. The link is
-- on the *text* side because a recording may be transcribed once and because
-- `ON DELETE SET NULL` is then the right thing — deleting the recording leaves
-- the transcript intact, just unlinked. (Undoing that delete puts the link
-- back: `documents::snapshot` carries the text documents that pointed here,
-- see `DocumentSnapshot::linked_by`.)
ALTER TABLE documents ADD COLUMN linked_media_id TEXT
  REFERENCES documents(id) ON DELETE SET NULL;

-- Finding "which transcript belongs to this recording" is a listing-time
-- lookup, once per media row.
CREATE INDEX documents_linked_media_idx ON documents(linked_media_id);

-- The alignment itself: a code point position in the transcript and the
-- millisecond of the recording it is heard at. Everything between two anchors
-- is interpolated linearly, before the first one the recording is assumed to
-- start at 0 ms, and past the last one the document's average rate carries on
-- (`text::align`).
--
-- Anchors come from an SRT/VTT import, from timestamps the transcript format
-- captured, or from the coder pressing "Align here" while the recording plays.
-- They hang off the document, so deleting it takes them; the snapshot in the
-- history carries them so undo brings them back.
CREATE TABLE transcript_anchors (
  document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  pos         INTEGER NOT NULL,
  ms          INTEGER NOT NULL,
  PRIMARY KEY (document_id, pos)
) WITHOUT ROWID;
