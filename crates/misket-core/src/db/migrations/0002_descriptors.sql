-- Misket project schema, version 2: descriptors (document attributes).
-- Applied inside a transaction by db::migrate().

CREATE TABLE descriptor_fields (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind         TEXT NOT NULL CHECK (kind IN ('text','number','choice','date')),
  options_json TEXT,               -- choice: a JSON array of option strings
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (length(trim(name)) > 0)
);
CREATE INDEX descriptor_fields_order_idx ON descriptor_fields(sort_order);

-- Values are canonical strings validated by kind in Rust: numbers as decimal
-- (`12.5`), dates as ISO `YYYY-MM-DD`, choice as one of the field's options.
CREATE TABLE descriptor_values (
  document_id TEXT NOT NULL REFERENCES documents(id)         ON DELETE CASCADE,
  field_id    TEXT NOT NULL REFERENCES descriptor_fields(id) ON DELETE CASCADE,
  value       TEXT NOT NULL,
  PRIMARY KEY (document_id, field_id)
) WITHOUT ROWID;
CREATE INDEX descriptor_values_field_idx ON descriptor_values(field_id);
