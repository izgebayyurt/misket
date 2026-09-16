-- Misket project schema, version 7: structured code definitions.
-- Applied inside a transaction by db::migrate().
--
-- A code's `description` stays "what this code means". The two new columns
-- hold the rules coders actually write down when a codebook has to survive a
-- second pass or a second coder: when to apply the code, and when not to.
-- `example_excerpt_id` points at one already-coded excerpt that stands as the
-- canonical instance; deleting that excerpt only clears the pointer, it never
-- deletes the code.

ALTER TABLE codes ADD COLUMN inclusion TEXT NOT NULL DEFAULT '';
ALTER TABLE codes ADD COLUMN exclusion TEXT NOT NULL DEFAULT '';
ALTER TABLE codes ADD COLUMN example_excerpt_id TEXT REFERENCES excerpts(id) ON DELETE SET NULL;

CREATE INDEX codes_example_excerpt_idx ON codes(example_excerpt_id)
  WHERE example_excerpt_id IS NOT NULL;
