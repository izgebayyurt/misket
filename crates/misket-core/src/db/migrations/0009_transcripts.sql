-- Misket project schema, version 9: speaker-aware transcripts.
-- Applied inside a transaction by db::migrate().
--
-- `transcript_json` remembers how a document marks who is speaking, so the
-- detection in `text::transcript` runs once per document rather than on every
-- read. It holds the `TranscriptFormat` (`{"kind":"preset","preset":"name_colon"}`,
-- `{"kind":"regex","pattern":"…"}`) plus a small cache of what that format
-- finds in this document — the speakers and how many turns each has — so a
-- document listing can show the speakers without re-scanning the text.
-- Document text is immutable, so that cache can never go stale.
--
--   NULL                  never looked at (detection will run on next read)
--   {"kind":"none"}       looked at, explicitly not a transcript
--
-- The project-level default lives in `project_meta` under `transcript_default`
-- ("auto", or a serialized format), which needs no schema change.

ALTER TABLE documents ADD COLUMN transcript_json TEXT;
