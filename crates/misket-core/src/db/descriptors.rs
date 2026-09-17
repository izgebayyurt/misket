//! Descriptors: typed attributes attached to documents (participant age
//! group, site, interview wave, …) that mixed-methods work compares coding
//! across.
//!
//! Values are stored as canonical strings and validated by kind in Rust:
//! numbers as decimal (`12.5`), dates as ISO `YYYY-MM-DD`, choice as one of
//! the field's options, text as typed (trimmed).

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use super::history::DescriptorOp;
use super::{activity, documents, history, util};
use crate::error::{AppError, Result};
use crate::models::{
    DescriptorField, DescriptorFieldPatch, DescriptorMatrix, DescriptorMatrixRow, DescriptorValue,
    NewDescriptorField,
};

pub const KINDS: [&str; 4] = ["text", "number", "choice", "date"];

const COLUMNS: &str = "f.id, f.name, f.kind, f.options_json, f.sort_order,
     (SELECT count(*) FROM descriptor_values v WHERE v.field_id = f.id) AS value_count,
     f.created_at, f.updated_at";

fn from_row(r: &Row) -> rusqlite::Result<DescriptorField> {
    let options_json: Option<String> = r.get(3)?;
    let options = options_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default();
    Ok(DescriptorField {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        options,
        sort_order: r.get(4)?,
        value_count: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

// ------------------------------------------------------------- validation

fn validate_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("descriptor name is required".into()));
    }
    Ok(name)
}

fn validate_kind(kind: &str) -> Result<&str> {
    if KINDS.contains(&kind) {
        Ok(kind)
    } else {
        Err(AppError::Validation(format!(
            "unknown descriptor kind {kind:?}; use one of {}",
            KINDS.join(", ")
        )))
    }
}

/// Trim, drop blanks and reject duplicates (case-insensitively). A `choice`
/// field needs at least one option; every other kind must have none.
fn validate_options(kind: &str, options: Option<&[String]>) -> Result<Option<String>> {
    let cleaned: Vec<String> = options
        .unwrap_or(&[])
        .iter()
        .map(|o| o.trim().to_string())
        .filter(|o| !o.is_empty())
        .collect();
    if kind != "choice" {
        return Ok(None);
    }
    if cleaned.is_empty() {
        return Err(AppError::Validation(
            "a choice descriptor needs at least one option".into(),
        ));
    }
    for (i, o) in cleaned.iter().enumerate() {
        if cleaned[..i].iter().any(|p| p.eq_ignore_ascii_case(o)) {
            return Err(AppError::Validation(format!("duplicate option {o:?}")));
        }
    }
    Ok(Some(serde_json::to_string(&cleaned)?))
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// ISO `YYYY-MM-DD`, with a real day-of-month.
fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let num = |a: usize, z: usize| s[a..z].parse::<i64>().unwrap_or(0);
    let (y, m, d) = (num(0, 4), num(5, 7), num(8, 10));
    if !(1..=12).contains(&m) {
        return false;
    }
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(y) => 29,
        _ => 28,
    };
    (1..=days).contains(&d)
}

/// The canonical decimal form of a number, so `07.50` and `7.5` compare equal.
pub fn canonical_number(raw: &str) -> Result<String> {
    let n: f64 = raw
        .trim()
        .parse()
        .map_err(|_| AppError::Validation(format!("{raw:?} is not a number")))?;
    if !n.is_finite() {
        return Err(AppError::Validation(format!("{raw:?} is not a number")));
    }
    Ok(n.to_string())
}

/// Validate `raw` against the field's kind and return what should be stored.
pub fn canonical_value(field: &DescriptorField, raw: &str) -> Result<String> {
    let raw = raw.trim();
    match field.kind.as_str() {
        "number" => canonical_number(raw),
        "date" => {
            if valid_date(raw) {
                Ok(raw.to_string())
            } else {
                Err(AppError::Validation(format!(
                    "{raw:?} is not a date; use YYYY-MM-DD"
                )))
            }
        }
        "choice" => field
            .options
            .iter()
            .find(|o| o.eq_ignore_ascii_case(raw))
            .cloned()
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "{raw:?} is not an option of {:?} ({})",
                    field.name,
                    field.options.join(", ")
                ))
            }),
        _ => Ok(raw.to_string()),
    }
}

fn map_unique(e: rusqlite::Error, name: &str) -> AppError {
    if e.to_string().contains("UNIQUE") {
        AppError::Conflict(format!("a descriptor named {name:?} already exists"))
    } else {
        AppError::from(e)
    }
}

// ----------------------------------------------------------------- fields

pub fn list_fields(conn: &Connection) -> Result<Vec<DescriptorField>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM descriptor_fields f ORDER BY f.sort_order, f.created_at"
    ))?;
    let rows = stmt
        .query_map([], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get_field(conn: &Connection, id: &str) -> Result<DescriptorField> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM descriptor_fields f WHERE f.id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("descriptor field {id} not found")))
}

pub fn create_field(conn: &Connection, input: NewDescriptorField) -> Result<DescriptorField> {
    let name = validate_name(&input.name)?;
    let kind = validate_kind(&input.kind)?;
    let options_json = validate_options(kind, input.options.as_deref())?;
    let id = util::new_id();
    let now = util::now();
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM descriptor_fields",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO descriptor_fields (id, name, kind, options_json, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, name, kind, options_json, sort_order, now],
    )
    .map_err(|e| map_unique(e, name))?;
    let field = get_field(conn, &id)?;
    let order = order_of(conn)?;
    activity::record(
        conn,
        "descriptor.field_created",
        "descriptor_field",
        Some(&field.id),
        format!(
            "Created descriptor field \"{}\" ({})",
            field.name, field.kind
        ),
        json!({ "name": field.name, "kind": field.kind, "options": field.options }),
        Some(history::payload(&DescriptorOp::Field {
            field: Box::new(field.clone()),
            values: Some(vec![]),
            order: order.clone(),
        })),
        Some(history::payload(&DescriptorOp::DropField {
            field_id: field.id.clone(),
            order: order.into_iter().filter(|f| *f != field.id).collect(),
        })),
    )?;
    Ok(field)
}

/// Rename a field, change its options, or change its kind — which converts
/// the values documents already have where the new kind can hold them and
/// drops the ones it cannot. Undo restores every one of them.
pub fn update_field(
    conn: &Connection,
    id: &str,
    patch: DescriptorFieldPatch,
) -> Result<DescriptorField> {
    let current = get_field(conn, id)?;
    let name = match &patch.name {
        Some(n) => validate_name(n)?.to_string(),
        None => current.name.clone(),
    };
    let kind = match &patch.kind {
        Some(k) => validate_kind(k)?.to_string(),
        None => current.kind.clone(),
    };
    let options = match &patch.options {
        Some(o) => o.clone(),
        None => current.options.clone(),
    };
    let options_json = validate_options(&kind, Some(&options))?;
    // Narrowing a choice field must not orphan values that are already stored.
    if kind == "choice" && current.kind == "choice" {
        let mut stmt =
            conn.prepare("SELECT DISTINCT value FROM descriptor_values WHERE field_id = ?1")?;
        let used: Vec<String> = stmt
            .query_map([id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        if let Some(orphan) = used
            .iter()
            .find(|v| !options.iter().any(|o| o.eq_ignore_ascii_case(v)))
        {
            return Err(AppError::Validation(format!(
                "option {orphan:?} is still used by a document; remove those values first"
            )));
        }
    }
    // Changing the kind is allowed even when documents already have values:
    // the ones the new kind can hold are kept in its canonical form, the
    // rest are dropped — and every one of them is in the inverse payload, so
    // undo puts the field back with all of them.
    let before_values = values_of(conn, id)?;
    let tx = util::tx(conn)?;
    tx.execute(
        "UPDATE descriptor_fields SET name = ?2, kind = ?3, options_json = ?4, updated_at = ?5
         WHERE id = ?1",
        params![id, name, kind, options_json, util::now()],
    )
    .map_err(|e| map_unique(e, &name))?;
    if kind != current.kind {
        let converted = get_field(&tx, id)?;
        for (document_id, value) in &before_values {
            match canonical_value(&converted, value) {
                Ok(v) if v != *value => {
                    tx.execute(
                        "UPDATE descriptor_values SET value = ?3
                          WHERE document_id = ?1 AND field_id = ?2",
                        params![document_id, id, v],
                    )?;
                }
                Ok(_) => {}
                Err(_) => {
                    tx.execute(
                        "DELETE FROM descriptor_values WHERE document_id = ?1 AND field_id = ?2",
                        params![document_id, id],
                    )?;
                }
            }
        }
    }
    let after = get_field(&tx, id)?;
    let mut detail = serde_json::Map::new();
    let mut fields: Vec<&str> = vec![];
    if current.name != after.name {
        fields.push("name");
        detail.insert(
            "name".into(),
            activity::change(current.name.clone(), after.name.clone()),
        );
    }
    if current.kind != after.kind {
        fields.push("kind");
        detail.insert(
            "kind".into(),
            activity::change(current.kind.clone(), after.kind.clone()),
        );
    }
    if current.options != after.options {
        fields.push("options");
        detail.insert(
            "options".into(),
            activity::change(current.options.clone(), after.options.clone()),
        );
    }
    if !fields.is_empty() {
        detail.insert("changed".into(), json!(fields));
        let summary = if current.name != after.name {
            format!(
                "Renamed descriptor field \"{}\" to \"{}\"",
                current.name, after.name
            )
        } else {
            format!(
                "Changed {} of descriptor field \"{}\"",
                fields.join(", "),
                after.name
            )
        };
        activity::record(
            &tx,
            "descriptor.field_updated",
            "descriptor_field",
            Some(&after.id),
            summary,
            Value::Object(detail),
            Some(history::payload(&DescriptorOp::Field {
                field: Box::new(after.clone()),
                values: Some(values_of(&tx, id)?),
                order: vec![],
            })),
            Some(history::payload(&DescriptorOp::Field {
                field: Box::new(current.clone()),
                values: Some(before_values),
                order: vec![],
            })),
        )?;
    }
    tx.commit()?;
    get_field(conn, id)
}

/// Delete a field; its values go with it, into the history so undo can bring
/// both back.
pub fn delete_field(conn: &Connection, id: &str) -> Result<DescriptorField> {
    let field = get_field(conn, id)?;
    let values = values_of(conn, id)?;
    let before = order_of(conn)?;
    let tx = util::tx(conn)?;
    tx.execute("DELETE FROM descriptor_fields WHERE id = ?1", [id])?;
    renumber(&tx)?;
    activity::record(
        &tx,
        "descriptor.field_deleted",
        "descriptor_field",
        Some(id),
        format!("Deleted descriptor field \"{}\"", field.name),
        json!({
            "name": field.name,
            "kind": field.kind,
            "options": field.options,
            "valueCount": field.value_count,
        }),
        Some(history::payload(&DescriptorOp::DropField {
            field_id: id.to_string(),
            order: order_of(&tx)?,
        })),
        Some(history::payload(&DescriptorOp::Field {
            field: Box::new(field.clone()),
            values: Some(values),
            order: before,
        })),
    )?;
    tx.commit()?;
    Ok(field)
}

/// Every field id in sort order — what a payload has to restore, because
/// deleting or adding a field renumbers the rest.
fn order_of(conn: &Connection) -> Result<Vec<String>> {
    Ok(list_fields(conn)?.into_iter().map(|f| f.id).collect())
}

/// The `(documentId, value)` pairs stored for one field.
fn values_of(conn: &Connection, field_id: &str) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT document_id, value FROM descriptor_values WHERE field_id = ?1 ORDER BY document_id",
    )?;
    let rows = stmt.query_map([field_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn renumber(conn: &Connection) -> Result<()> {
    let mut stmt =
        conn.prepare("SELECT id FROM descriptor_fields ORDER BY sort_order, created_at")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE descriptor_fields SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    Ok(())
}

/// Put `ids` in this order; fields not listed keep their relative order after
/// the listed ones.
pub fn reorder_fields(conn: &Connection, ids: &[String]) -> Result<Vec<DescriptorField>> {
    let tx = util::tx(conn)?;
    let existing = list_fields(&tx)?;
    let before: Vec<String> = existing.iter().map(|f| f.id.clone()).collect();
    let mut order: Vec<String> = ids
        .iter()
        .filter(|id| existing.iter().any(|f| &&f.id == id))
        .cloned()
        .collect();
    for f in existing {
        if !order.contains(&f.id) {
            order.push(f.id);
        }
    }
    for (i, id) in order.iter().enumerate() {
        tx.execute(
            "UPDATE descriptor_fields SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    if order != before {
        activity::record(
            &tx,
            "descriptor.fields_reordered",
            "descriptor_field",
            None,
            "Reordered descriptor fields",
            json!({ "count": order.len() }),
            Some(history::payload(&DescriptorOp::ReorderFields {
                ids: order.clone(),
            })),
            Some(history::payload(&DescriptorOp::ReorderFields {
                ids: before.clone(),
            })),
        )?;
    }
    tx.commit()?;
    list_fields(conn)
}

// ----------------------------------------------------------------- values

/// Set (or, with `None` or an empty string, clear) one document's value.
pub fn set_value(
    conn: &Connection,
    document_id: &str,
    field_id: &str,
    value: Option<&str>,
) -> Result<Option<DescriptorValue>> {
    documents::get_summary(conn, document_id)?;
    let field = get_field(conn, field_id)?;
    let before: Option<String> = conn
        .query_row(
            "SELECT value FROM descriptor_values WHERE document_id = ?1 AND field_id = ?2",
            params![document_id, field_id],
            |r| r.get(0),
        )
        .optional()?;
    let raw = value.map(str::trim).filter(|v| !v.is_empty());
    let Some(raw) = raw else {
        let tx = util::tx(conn)?;
        tx.execute(
            "DELETE FROM descriptor_values WHERE document_id = ?1 AND field_id = ?2",
            params![document_id, field_id],
        )?;
        if before.is_some() {
            log_value(&tx, document_id, &field, before.as_deref(), None)?;
        }
        tx.commit()?;
        return Ok(None);
    };
    let canonical = canonical_value(&field, raw)?;
    let tx = util::tx(conn)?;
    tx.execute(
        "INSERT INTO descriptor_values (document_id, field_id, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(document_id, field_id) DO UPDATE SET value = excluded.value",
        params![document_id, field_id, canonical],
    )?;
    if before.as_deref() != Some(canonical.as_str()) {
        log_value(
            &tx,
            document_id,
            &field,
            before.as_deref(),
            Some(&canonical),
        )?;
    }
    tx.commit()?;
    Ok(Some(DescriptorValue {
        document_id: document_id.to_string(),
        field_id: field_id.to_string(),
        value: canonical,
    }))
}

/// One entry per descriptor value that really changed, attributed to the
/// document it describes so it shows up next to that document's other edits.
fn log_value(
    conn: &Connection,
    document_id: &str,
    field: &DescriptorField,
    before: Option<&str>,
    after: Option<&str>,
) -> Result<()> {
    let step = |value: Option<&str>| {
        history::payload(&DescriptorOp::SetValue {
            document_id: document_id.to_string(),
            field_id: field.id.clone(),
            value: value.map(String::from),
        })
    };
    let doc_name = activity::document_name(conn, document_id);
    let summary = match after {
        Some(v) => format!("Set {} of \"{doc_name}\" to \"{v}\"", field.name),
        None => format!("Cleared {} of \"{doc_name}\"", field.name),
    };
    activity::record(
        conn,
        "descriptor.value_set",
        "document",
        Some(document_id),
        summary,
        json!({
            "documentId": document_id,
            "documentName": doc_name,
            "fieldId": field.id,
            "fieldName": field.name,
            "value": activity::change(before.map(String::from), after.map(String::from)),
        }),
        Some(step(after)),
        Some(step(before)),
    )
}

pub fn values_for_document(conn: &Connection, document_id: &str) -> Result<Vec<DescriptorValue>> {
    documents::get_summary(conn, document_id)?;
    let mut stmt = conn.prepare(
        "SELECT v.document_id, v.field_id, v.value FROM descriptor_values v
         JOIN descriptor_fields f ON f.id = v.field_id
         WHERE v.document_id = ?1 ORDER BY f.sort_order, f.created_at",
    )?;
    let rows = stmt
        .query_map([document_id], |r| {
            Ok(DescriptorValue {
                document_id: r.get(0)?,
                field_id: r.get(1)?,
                value: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Every document with every field, for a table view.
pub fn values_matrix(conn: &Connection) -> Result<DescriptorMatrix> {
    let fields = list_fields(conn)?;
    let mut by_document: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut stmt = conn.prepare("SELECT document_id, field_id, value FROM descriptor_values")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })? {
        let (doc, field, value) = row?;
        by_document.entry(doc).or_default().insert(field, value);
    }
    let rows = documents::list(conn)?
        .into_iter()
        .map(|d| DescriptorMatrixRow {
            values: by_document.remove(&d.id).unwrap_or_default(),
            document_id: d.id,
            document_name: d.name,
        })
        .collect();
    Ok(DescriptorMatrix { fields, rows })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::OpenProject;

    pub(crate) fn mk_field(
        conn: &Connection,
        name: &str,
        kind: &str,
        options: &[&str],
    ) -> DescriptorField {
        create_field(
            conn,
            NewDescriptorField {
                name: name.into(),
                kind: kind.into(),
                options: if options.is_empty() {
                    None
                } else {
                    Some(options.iter().map(|o| o.to_string()).collect())
                },
            },
        )
        .unwrap()
    }

    fn setup() -> (OpenProject, String, String) {
        let p = OpenProject::in_memory("t").unwrap();
        let mut a = crate::db::documents::tests::new_doc("first");
        a.name = "Doc A".into();
        let mut b = crate::db::documents::tests::new_doc("second");
        b.name = "Doc B".into();
        let a = crate::db::documents::create(&p.conn, a).unwrap().summary.id;
        let b = crate::db::documents::create(&p.conn, b).unwrap().summary.id;
        (p, a, b)
    }

    #[test]
    fn create_validates_name_kind_and_options() {
        let p = OpenProject::in_memory("t").unwrap();
        let f = mk_field(&p.conn, "  Site  ", "choice", &["North", " South "]);
        assert_eq!(f.name, "Site");
        assert_eq!(f.options, vec!["North".to_string(), "South".to_string()]);
        assert_eq!((f.sort_order, f.value_count), (0, 0));
        // A plain field keeps no options even if some are passed.
        let age = mk_field(&p.conn, "Age", "number", &["ignored"]);
        assert!(age.options.is_empty());
        assert_eq!(age.sort_order, 1);

        for bad in [
            NewDescriptorField {
                name: " ".into(),
                kind: "text".into(),
                options: None,
            },
            NewDescriptorField {
                name: "X".into(),
                kind: "colour".into(),
                options: None,
            },
            NewDescriptorField {
                name: "Y".into(),
                kind: "choice".into(),
                options: None,
            },
            NewDescriptorField {
                name: "Z".into(),
                kind: "choice".into(),
                options: Some(vec!["a".into(), "A".into()]),
            },
        ] {
            assert!(
                matches!(
                    create_field(&p.conn, bad.clone()),
                    Err(AppError::Validation(_))
                ),
                "{bad:?}"
            );
        }
        // Names are unique, case-insensitively.
        assert!(matches!(
            create_field(
                &p.conn,
                NewDescriptorField {
                    name: "site".into(),
                    kind: "text".into(),
                    options: None,
                }
            ),
            Err(AppError::Conflict(_))
        ));
        assert_eq!(list_fields(&p.conn).unwrap().len(), 2);
        assert!(matches!(
            get_field(&p.conn, "nope"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn values_are_canonicalised_per_kind() {
        let (p, doc, _) = setup();
        let n = mk_field(&p.conn, "Age", "number", &[]);
        let d = mk_field(&p.conn, "Interviewed", "date", &[]);
        let c = mk_field(&p.conn, "Site", "choice", &["North", "South"]);
        let t = mk_field(&p.conn, "Notes", "text", &[]);

        assert_eq!(
            set_value(&p.conn, &doc, &n.id, Some(" 07.50 "))
                .unwrap()
                .unwrap()
                .value,
            "7.5"
        );
        assert_eq!(
            set_value(&p.conn, &doc, &d.id, Some("2024-02-29"))
                .unwrap()
                .unwrap()
                .value,
            "2024-02-29"
        );
        // A choice match is case-insensitive but stores the option as defined.
        assert_eq!(
            set_value(&p.conn, &doc, &c.id, Some("north"))
                .unwrap()
                .unwrap()
                .value,
            "North"
        );
        assert_eq!(
            set_value(&p.conn, &doc, &t.id, Some("  free text "))
                .unwrap()
                .unwrap()
                .value,
            "free text"
        );

        for (field, bad) in [
            (&n.id, "twelve"),
            (&n.id, "1/2"),
            (&d.id, "2023-02-29"),
            (&d.id, "2023-13-01"),
            (&d.id, "01-01-2023"),
            (&c.id, "East"),
        ] {
            assert!(
                matches!(
                    set_value(&p.conn, &doc, field, Some(bad)),
                    Err(AppError::Validation(_))
                ),
                "{bad}"
            );
        }
        assert_eq!(values_for_document(&p.conn, &doc).unwrap().len(), 4);
        // Setting again replaces; None and "" clear.
        set_value(&p.conn, &doc, &n.id, Some("9")).unwrap();
        assert!(set_value(&p.conn, &doc, &n.id, None).unwrap().is_none());
        assert!(set_value(&p.conn, &doc, &t.id, Some("  "))
            .unwrap()
            .is_none());
        assert_eq!(values_for_document(&p.conn, &doc).unwrap().len(), 2);
        assert_eq!(get_field(&p.conn, &c.id).unwrap().value_count, 1);

        assert!(matches!(
            set_value(&p.conn, "nope", &n.id, Some("1")),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            set_value(&p.conn, &doc, "nope", Some("1")),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            values_for_document(&p.conn, "nope"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn update_field_renames_and_guards_kind_and_options() {
        let (p, doc, _) = setup();
        let c = mk_field(&p.conn, "Site", "choice", &["North", "South"]);
        let renamed = update_field(
            &p.conn,
            &c.id,
            DescriptorFieldPatch {
                name: Some(" Location ".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "Location");
        assert_eq!(renamed.options, vec!["North".to_string(), "South".into()]);

        // Kind changes freely while the field is empty.
        let asnum = update_field(
            &p.conn,
            &c.id,
            DescriptorFieldPatch {
                kind: Some("number".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(asnum.kind, "number");
        assert!(asnum.options.is_empty());
        update_field(
            &p.conn,
            &c.id,
            DescriptorFieldPatch {
                kind: Some("choice".into()),
                options: Some(vec!["North".into(), "South".into()]),
                ..Default::default()
            },
        )
        .unwrap();

        set_value(&p.conn, &doc, &c.id, Some("North")).unwrap();
        // A kind change with values in place keeps the ones the new kind can
        // hold; "North" is still text, so it survives as text.
        let as_text = update_field(
            &p.conn,
            &c.id,
            DescriptorFieldPatch {
                kind: Some("text".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(as_text.kind, "text");
        assert_eq!(as_text.value_count, 1);
        // Becoming a number drops it: "North" is not one.
        let as_number = update_field(
            &p.conn,
            &c.id,
            DescriptorFieldPatch {
                kind: Some("number".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(as_number.value_count, 0);
        // Undo brings the choice field back with the value it had.
        crate::db::history::undo(&p.conn).unwrap().unwrap();
        crate::db::history::undo(&p.conn).unwrap().unwrap();
        assert_eq!(get_field(&p.conn, &c.id).unwrap().kind, "choice");
        assert_eq!(
            values_for_document(&p.conn, &doc).unwrap()[0].value,
            "North"
        );
        // Restating the same kind is not a change.
        assert!(update_field(
            &p.conn,
            &c.id,
            DescriptorFieldPatch {
                kind: Some("choice".into()),
                options: Some(vec!["North".into(), "South".into(), "West".into()]),
                ..Default::default()
            }
        )
        .is_ok());
        // Dropping an option that is in use is refused.
        assert!(matches!(
            update_field(
                &p.conn,
                &c.id,
                DescriptorFieldPatch {
                    options: Some(vec!["South".into()]),
                    ..Default::default()
                }
            ),
            Err(AppError::Validation(_))
        ));
        let other = mk_field(&p.conn, "Wave", "number", &[]);
        assert!(matches!(
            update_field(
                &p.conn,
                &other.id,
                DescriptorFieldPatch {
                    name: Some("location".into()),
                    ..Default::default()
                }
            ),
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            update_field(&p.conn, "nope", DescriptorFieldPatch::default()),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn reorder_and_delete_renumber_fields() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk_field(&p.conn, "A", "text", &[]);
        let b = mk_field(&p.conn, "B", "text", &[]);
        let c = mk_field(&p.conn, "C", "text", &[]);
        let after = reorder_fields(&p.conn, &[c.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(
            after.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
            vec!["C", "A", "B"]
        );
        assert_eq!(
            after.iter().map(|f| f.sort_order).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        // Unknown ids are ignored.
        reorder_fields(&p.conn, &["nope".into(), b.id.clone()]).unwrap();
        assert_eq!(
            list_fields(&p.conn)
                .unwrap()
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            vec!["B", "C", "A"]
        );
        let deleted = delete_field(&p.conn, &c.id).unwrap();
        assert_eq!(deleted.name, "C");
        assert_eq!(
            list_fields(&p.conn)
                .unwrap()
                .iter()
                .map(|f| (f.name.clone(), f.sort_order))
                .collect::<Vec<_>>(),
            vec![("B".to_string(), 0), ("A".to_string(), 1)]
        );
        assert!(matches!(
            delete_field(&p.conn, &c.id),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn deleting_a_field_or_document_cascades_to_values() {
        let (p, a, b) = setup();
        let site = mk_field(&p.conn, "Site", "choice", &["North", "South"]);
        let age = mk_field(&p.conn, "Age", "number", &[]);
        set_value(&p.conn, &a, &site.id, Some("North")).unwrap();
        set_value(&p.conn, &b, &site.id, Some("South")).unwrap();
        set_value(&p.conn, &a, &age.id, Some("41")).unwrap();
        let count = |conn: &Connection| -> i64 {
            conn.query_row("SELECT count(*) FROM descriptor_values", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(count(&p.conn), 3);
        crate::db::documents::delete(&p.conn, &b).unwrap();
        assert_eq!(count(&p.conn), 2);
        delete_field(&p.conn, &site.id).unwrap();
        assert_eq!(count(&p.conn), 1);
        assert_eq!(values_for_document(&p.conn, &a).unwrap().len(), 1);
    }

    #[test]
    fn matrix_lists_every_document_in_order() {
        let (p, a, b) = setup();
        let site = mk_field(&p.conn, "Site", "choice", &["North", "South"]);
        let age = mk_field(&p.conn, "Age", "number", &[]);
        set_value(&p.conn, &a, &site.id, Some("North")).unwrap();
        set_value(&p.conn, &a, &age.id, Some("41")).unwrap();
        let m = values_matrix(&p.conn).unwrap();
        assert_eq!(m.fields.len(), 2);
        assert_eq!(m.rows.len(), 2);
        assert_eq!(m.rows[0].document_name, "Doc A");
        assert_eq!(m.rows[0].values[&site.id], "North");
        assert_eq!(m.rows[0].values[&age.id], "41");
        assert_eq!(m.rows[1].document_id, b);
        assert!(m.rows[1].values.is_empty());
    }

    #[test]
    fn date_validation_covers_leap_years_and_shape() {
        for ok in ["2024-02-29", "2023-12-31", "0001-01-01", "2000-02-29"] {
            assert!(valid_date(ok), "{ok}");
        }
        for bad in [
            "2023-02-29",
            "1900-02-29",
            "2023-00-10",
            "2023-04-31",
            "2023-1-01",
            "2023-01-1",
            "20230101",
            "2023-01-01T00:00:00Z",
            "abcd-ef-gh",
            "",
        ] {
            assert!(!valid_date(bad), "{bad}");
        }
    }
}
