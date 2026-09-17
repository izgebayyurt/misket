-- Misket project schema, version 12: sync points for "pull from another copy".
-- Applied inside a transaction by db::migrate().
--
-- Two researchers keep one file each (`study.ada.misket`, `study.bob.misket`)
-- in a shared folder and pull each other's work in whenever they like. A pull
-- is a union: it never deletes anything, and it never writes to the other
-- file. What it cannot decide on its own is a *scalar* both sides can edit —
-- a code's name, a memo's body, a descriptor value, a framework summary —
-- because "they changed it" and "we changed it" look identical from one file.
--
-- A sync point is the answer: the scalar state as it stood the last time we
-- pulled from a particular copy, so the next pull is a three-way merge
-- against a real base instead of a guess. Take theirs where ours has not
-- moved since the base, keep ours where theirs has not, and ask only when
-- both did.
--
-- One row per copy we have ever pulled from, identified by the pair that
-- names it across renames and re-copies: the other file's `project_id` and
-- the coder who writes in it (`db::merge::their_coder`). `base_json` is a
-- compact snapshot written by `db::merge` — codes, memo bodies, descriptor
-- values, framework cells, document names, set names, transcript formats —
-- and is read by nothing else, so its shape can change with the code that
-- writes it. `our_node_id` and `their_node_id` record how far each history
-- had run at that moment, which is diagnostic only.
--
-- Writing a sync point is part of the undoable `project.pulled` group, so
-- undoing a pull takes the sync point back with it and the next pull behaves
-- as though the first had never happened.
CREATE TABLE sync_points (
  other_project_id TEXT    NOT NULL,
  other_coder_id   TEXT    NOT NULL,
  at               TEXT    NOT NULL,
  our_node_id      INTEGER,
  their_node_id    INTEGER,
  base_json        TEXT    NOT NULL DEFAULT '{}',
  PRIMARY KEY (other_project_id, other_coder_id)
) WITHOUT ROWID;
