-- Misket project schema, version 6: the coding activity log.
-- Applied inside a transaction by db::migrate().

-- One row per domain write (a code created, an excerpt recoded, a memo
-- edited, …). It lives in the project file itself, so the audit trail is
-- copied, backed up and restored with the data it describes.
--
-- `actor` is whoever was at the keyboard: the name set in the app's settings,
-- or the OS user name. It is a plain string on purpose — Misket has no user
-- accounts, and a project file is exchanged between people as a file.
--
-- `kind` is a dotted verb ('code.created', 'excerpt.split', 'undo', …),
-- `target_kind`/`target_id` say what it happened to, `summary` is the
-- sentence the UI shows, and `detail_json` holds the structured before/after
-- values so a code's history can be read back field by field.
CREATE TABLE activity_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id   TEXT,
  summary     TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);

-- The overview reads the newest entries; the inspectors read one target's.
CREATE INDEX activity_log_at_idx ON activity_log(at);
CREATE INDEX activity_log_target_idx ON activity_log(target_kind, target_id);
