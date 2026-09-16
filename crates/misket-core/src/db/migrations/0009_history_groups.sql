-- Misket project schema, version 9: compound steps in the history tree.
-- Applied inside a transaction by db::migrate().

-- One user action can be several writes: merging two codes touches both
-- sides, importing a folder creates a document per file, rolling sub-codes up
-- retags and then deletes each of them. Each write still gets its own node —
-- so each still carries an exact inverse, and each still shows up in the
-- activity feed where it belongs — but the nodes of one action share a
-- `group_id` and undo, redo and checkout move over the whole group at once.
--
-- The group's id is the id of its first node, so a group is identified by
-- the node that leads it and nothing has to be allocated. `group_summary` is
-- set on that leading node only: it is what the history view shows in place
-- of the group's individual steps ("Imported 2 documents").
--
-- Schema 8 paired the two halves of a merge or a split with a
-- `{"op":"linked"}` payload instead; those rows keep working, because the
-- payload is now read as "this node's effect is carried by its sibling".
ALTER TABLE history ADD COLUMN group_id INTEGER NULL;
ALTER TABLE history ADD COLUMN group_summary TEXT NULL;

CREATE INDEX history_group_idx ON history(group_id);
