-- Misket project schema, version 8: history, a persisted undo tree.
-- Applied inside a transaction by db::migrate().

-- One row per operation. `history` replaces `activity_log`: it keeps
-- everything the log held (who, when, what, a readable summary and a
-- structured detail payload) and adds the two things an undo tree needs.
--
-- `parent_id` makes the log a tree rather than a list: undo walks toward the
-- root, redo toward a leaf, and an operation performed after an undo becomes
-- a second child of the same parent instead of discarding the path it left.
-- `preferred_child` is the branch redo follows when a node has more than one,
-- and `branch_name` is the label "fork here" puts on a node.
--
-- `forward_json` and `inverse_json` are the operation and its exact opposite,
-- as self-contained JSON carrying the original ids. They are data, not
-- closures, so history survives a restart, a backup and a file exchange.
-- NULL means the step cannot be replayed in that direction: every row copied
-- from `activity_log` below, and (in this phase) the kinds no inverse has
-- been written for yet.
CREATE TABLE history (
  id              INTEGER PRIMARY KEY,
  parent_id       INTEGER NULL REFERENCES history(id) ON DELETE CASCADE,
  at              TEXT NOT NULL,
  actor           TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL,
  target_kind     TEXT NOT NULL,
  target_id       TEXT,
  summary         TEXT NOT NULL,
  detail_json     TEXT NOT NULL DEFAULT '{}',
  forward_json    TEXT NULL,
  inverse_json    TEXT NULL,
  branch_name     TEXT NULL,
  preferred_child INTEGER NULL
);

CREATE INDEX history_parent_idx ON history(parent_id);
CREATE INDEX history_at_idx     ON history(at);
CREATE INDEX history_target_idx ON history(target_kind, target_id);

-- Bytes an operation has to give back that are too big for a JSON payload:
-- a deleted document's text, an image's pixels. Nothing writes here yet;
-- the table exists now so the document operations can fill it without
-- another migration.
CREATE TABLE history_blobs (
  node_id INTEGER NOT NULL REFERENCES history(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  bytes   BLOB NOT NULL,
  PRIMARY KEY (node_id, name)
) WITHOUT ROWID;

-- Everything that was already logged becomes a linear chain: each entry's
-- parent is the entry before it, ids and order preserved. The payloads stay
-- NULL — these happened before inverses were recorded, so they can be read
-- but not undone.
INSERT INTO history (id, at, actor, kind, target_kind, target_id, summary, detail_json)
SELECT id, at, actor, kind, target_kind, target_id, summary, detail_json FROM activity_log;

-- In a second pass, so a row's parent always exists by the time the foreign
-- key is checked.
UPDATE history SET parent_id = (SELECT max(p.id) FROM history p WHERE p.id < history.id);
UPDATE history SET preferred_child = (SELECT min(c.id) FROM history c WHERE c.parent_id = history.id);

-- The head is where undo starts. Empty means "before the first node".
INSERT INTO project_meta (key, value)
SELECT 'history_head', COALESCE((SELECT CAST(max(id) AS TEXT) FROM history), '')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

DROP TABLE activity_log;
