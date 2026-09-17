-- Misket project schema, version 13: excerpt weights / ratings per code.
-- Applied inside a transaction by db::migrate().
--
-- Dedoose calls this a code's "weight" (others: intensity, valence, a
-- 1..5 scale, a -2..+2 sentiment). A code can carry a numeric scale, and
-- each application of that code to an excerpt can be given a value on that
-- scale, so a project can report a mean or a distribution rather than a
-- plain count.
--
-- `weight_scale_json` is NULL for a code with no scale (the overwhelming
-- majority): `{ "min": 1, "max": 5, "step": 1, "default": 3,
-- "labels": {"1": "weak", "5": "strong"} }`. Validated in `db::codes`.
--
-- `excerpt_codes.weight` is one coder's value on their coding of one excerpt,
-- so two coders can rate the same passage differently. NULL means "not
-- rated" — a code can carry a scale that some codings simply do not use yet,
-- and clearing a code's scale nulls every weight under it (`db::codes`).
--
-- `excerpt_codes` is `WITHOUT ROWID` with primary key
-- (excerpt_id, code_id, coder_id); SQLite allows `ALTER TABLE ADD COLUMN`
-- on such a table as long as the new column is not part of the key, which
-- this one is not.

ALTER TABLE codes ADD COLUMN weight_scale_json TEXT;

ALTER TABLE excerpt_codes ADD COLUMN weight REAL;
