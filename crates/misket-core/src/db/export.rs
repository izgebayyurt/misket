//! Exports: codebook and excerpts as CSV, the whole project as JSON.

use std::collections::HashMap;
use std::io::Write;

use rusqlite::Connection;
use serde::Serialize;

use super::{codes, descriptors, documents, excerpts, memos};
use crate::error::Result;
use crate::models::{
    Code, CodebookJsonCode, DescriptorField, DescriptorValue, ExcerptFilter, ExcerptWithCodes, Memo,
};

/// Full code path ("Parent / Child") for every code.
pub(crate) fn code_paths(all: &[Code]) -> HashMap<String, String> {
    let by_id: HashMap<&str, &Code> = all.iter().map(|c| (c.id.as_str(), c)).collect();
    let mut out = HashMap::new();
    for c in all {
        let mut parts = vec![c.name.clone()];
        let mut cur = c.parent_id.as_deref();
        let mut guard = 0;
        while let Some(pid) = cur {
            guard += 1;
            if guard > 64 {
                break;
            }
            match by_id.get(pid) {
                Some(p) => {
                    parts.push(p.name.clone());
                    cur = p.parent_id.as_deref();
                }
                None => break,
            }
        }
        parts.reverse();
        out.insert(c.id.clone(), parts.join(" / "));
    }
    out
}

pub fn codebook_csv<W: Write>(conn: &Connection, w: W) -> Result<()> {
    let all = codes::list(conn)?;
    let paths = code_paths(&all);
    let mut wtr = csv::Writer::from_writer(w);
    wtr.write_record([
        "id",
        "path",
        "name",
        "parent_id",
        "color",
        "description",
        "shortcut",
        "excerpt_count",
    ])?;
    // Depth-first in path order so parents precede children.
    let mut sorted = all.clone();
    sorted.sort_by(|a, b| paths[&a.id].cmp(&paths[&b.id]));
    for c in sorted {
        wtr.write_record([
            c.id.as_str(),
            paths[&c.id].as_str(),
            c.name.as_str(),
            c.parent_id.as_deref().unwrap_or(""),
            c.color.as_str(),
            c.description.as_str(),
            c.shortcut.as_deref().unwrap_or(""),
            &c.excerpt_count.to_string(),
        ])?;
    }
    wtr.flush()?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodebookJsonDoc {
    format: &'static str,
    version: u32,
    codes: Vec<CodebookJsonCode>,
}

/// Self-contained codebook export: parents precede children (depth-first in
/// path order, like `codebook_csv`), reusable with `codebook_import::import_codebook`.
pub fn codebook_json<W: Write>(conn: &Connection, w: W) -> Result<()> {
    let all = codes::list(conn)?;
    let paths = code_paths(&all);
    let mut sorted = all;
    sorted.sort_by(|a, b| paths[&a.id].cmp(&paths[&b.id]));
    let out = CodebookJsonDoc {
        format: "misket-codebook",
        version: 1,
        codes: sorted
            .into_iter()
            .map(|c| CodebookJsonCode {
                id: c.id,
                parent_id: c.parent_id,
                name: c.name,
                color: c.color,
                description: c.description,
                shortcut: c.shortcut,
                sort_order: c.sort_order,
            })
            .collect(),
    };
    serde_json::to_writer_pretty(w, &out)?;
    Ok(())
}

pub fn excerpts_csv<W: Write>(conn: &Connection, filter: &ExcerptFilter, w: W) -> Result<()> {
    let all = codes::list(conn)?;
    let paths = code_paths(&all);
    let page = excerpts::query(
        conn,
        &ExcerptFilter {
            limit: 1_000_000,
            offset: 0,
            ..filter.clone()
        },
    )?;
    // One extra column per descriptor, holding the excerpt's document's value.
    let fields = descriptors::list_fields(conn)?;
    let mut values: HashMap<(String, String), String> = HashMap::new();
    let mut stmt = conn.prepare("SELECT document_id, field_id, value FROM descriptor_values")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })? {
        let (doc, field, value) = row?;
        values.insert((doc, field), value);
    }
    drop(stmt);

    let mut wtr = csv::Writer::from_writer(w);
    let mut header = vec![
        "excerpt_id".to_string(),
        "document".into(),
        "start".into(),
        "end".into(),
        "text".into(),
        "codes".into(),
        "memo_count".into(),
        "created_at".into(),
    ];
    header.extend(fields.iter().map(|f| f.name.clone()));
    wtr.write_record(&header)?;
    for row in page.rows {
        let e = row.excerpt;
        let code_list = e
            .code_ids
            .iter()
            .map(|id| paths.get(id).cloned().unwrap_or_else(|| id.clone()))
            .collect::<Vec<_>>()
            .join("; ");
        let mut record = vec![
            e.id.clone(),
            row.document_name.clone(),
            e.start_pos.map(|v| v.to_string()).unwrap_or_default(),
            e.end_pos.map(|v| v.to_string()).unwrap_or_default(),
            e.snapshot.clone().unwrap_or_default(),
            code_list,
            e.memo_count.to_string(),
            e.created_at.clone(),
        ];
        record.extend(fields.iter().map(|f| {
            values
                .get(&(e.document_id.clone(), f.id.clone()))
                .cloned()
                .unwrap_or_default()
        }));
        wtr.write_record(&record)?;
    }
    wtr.flush()?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectJson {
    format: &'static str,
    format_version: u32,
    meta: HashMap<String, String>,
    documents: Vec<crate::models::Document>,
    codes: Vec<Code>,
    excerpts: Vec<ExcerptWithCodes>,
    memos: Vec<Memo>,
    descriptor_fields: Vec<DescriptorField>,
    descriptor_values: Vec<DescriptorValue>,
}

pub fn project_json<W: Write>(conn: &Connection, w: W) -> Result<()> {
    let mut meta = HashMap::new();
    let mut stmt = conn.prepare("SELECT key, value FROM project_meta")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        meta.insert(k, v);
    }
    let docs = documents::list(conn)?
        .into_iter()
        .map(|d| documents::get(conn, &d.id))
        .collect::<Result<Vec<_>>>()?;
    let mut all_excerpts = vec![];
    for d in &docs {
        all_excerpts.extend(excerpts::list_for_document(conn, &d.summary.id)?);
    }
    let mut all_memos = vec![];
    let mut stmt = conn.prepare("SELECT id FROM memos ORDER BY created_at")?;
    for id in stmt.query_map([], |r| r.get::<_, String>(0))? {
        all_memos.push(memos::get(conn, &id?)?);
    }
    let mut all_descriptor_values = vec![];
    for d in &docs {
        all_descriptor_values.extend(descriptors::values_for_document(conn, &d.summary.id)?);
    }
    let out = ProjectJson {
        format: "misket-project",
        format_version: 1,
        meta,
        documents: docs,
        codes: codes::list(conn)?,
        excerpts: all_excerpts,
        memos: all_memos,
        descriptor_fields: descriptors::list_fields(conn)?,
        descriptor_values: all_descriptor_values,
    };
    serde_json::to_writer_pretty(w, &out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::descriptors::tests::mk_field;
    use crate::db::documents::tests::new_doc;
    use crate::db::OpenProject;
    use crate::models::{ApplyCodesInput, MemoTarget};

    fn populated() -> OpenProject {
        let p = OpenProject::in_memory("Export me").unwrap();
        let doc = documents::create(&p.conn, new_doc("He said \"hi\",\nthen left.")).unwrap();
        let a = mk_code(&p.conn, "Greeting", None);
        let b = mk_code(&p.conn, "Formal, sort of", Some(&a.id));
        let r = excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.summary.id.clone(),
                start_pos: 0,
                end_pos: 18,
                code_ids: vec![a.id.clone(), b.id.clone()],
            },
        )
        .unwrap();
        memos::create(
            &p.conn,
            MemoTarget {
                excerpt_id: Some(r.excerpt.id),
                ..Default::default()
            },
            "m",
            "note",
        )
        .unwrap();
        let site = mk_field(&p.conn, "Site", "choice", &["North", "South"]);
        let age = mk_field(&p.conn, "Age", "number", &[]);
        descriptors::set_value(&p.conn, &doc.summary.id, &site.id, Some("North")).unwrap();
        descriptors::set_value(&p.conn, &doc.summary.id, &age.id, Some("41")).unwrap();
        p
    }

    #[test]
    fn codebook_csv_has_paths_and_quotes_commas() {
        let p = populated();
        let mut buf = vec![];
        codebook_csv(&p.conn, &mut buf).unwrap();
        let s = String::from_utf8(buf).unwrap();
        let lines: Vec<_> = s.lines().collect();
        assert_eq!(
            lines[0],
            "id,path,name,parent_id,color,description,shortcut,excerpt_count"
        );
        assert!(lines[1].contains(",Greeting,Greeting,,#"));
        assert!(lines[2].contains("\"Greeting / Formal, sort of\",\"Formal, sort of\","));
        assert!(lines[1].ends_with(",1"));
    }

    #[test]
    fn codebook_json_is_self_contained_and_parent_first() {
        let p = populated();
        let mut buf = vec![];
        codebook_json(&p.conn, &mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        assert_eq!(v["format"], "misket-codebook");
        assert_eq!(v["version"], 1);
        let codes = v["codes"].as_array().unwrap();
        assert_eq!(codes.len(), 2);
        // "Greeting" precedes "Greeting / Formal, sort of" (parent before child).
        assert_eq!(codes[0]["name"], "Greeting");
        assert!(codes[0]["parentId"].is_null());
        assert_eq!(codes[1]["name"], "Formal, sort of");
        assert_eq!(codes[1]["parentId"], codes[0]["id"]);
        assert!(codes[0]["color"].as_str().unwrap().starts_with('#'));
    }

    #[test]
    fn excerpts_csv_escapes_quotes_and_newlines() {
        let p = populated();
        let mut buf = vec![];
        excerpts_csv(&p.conn, &ExcerptFilter::default(), &mut buf).unwrap();
        let s = String::from_utf8(buf).unwrap();
        // One column per descriptor field, after the fixed columns.
        assert!(
            s.starts_with(
                "excerpt_id,document,start,end,text,codes,memo_count,created_at,Site,Age\n"
            ),
            "{s}"
        );
        // The excerpt's document has both values, in field order.
        assert!(s.trim_end().ends_with(",North,41"), "{s}");
        // The snapshot spans a newline and contains quotes: CSV doubles the quotes.
        assert!(s.contains("\"He said \"\"hi\"\",\nthen\""), "{s}");
        // Both code paths, semicolon-separated, then the memo count.
        assert!(s.contains("Greeting / Formal, sort of"), "{s}");
        assert!(s.contains("; Greeting"), "{s}");
        assert!(s.contains("\",1,"), "{s}");
    }

    #[test]
    fn project_json_roundtrips_structure() {
        let p = populated();
        let mut buf = vec![];
        project_json(&p.conn, &mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        assert_eq!(v["format"], "misket-project");
        assert_eq!(v["formatVersion"], 1);
        assert_eq!(v["meta"]["name"], "Export me");
        assert_eq!(v["documents"].as_array().unwrap().len(), 1);
        assert_eq!(v["documents"][0]["text"], "He said \"hi\",\nthen left.");
        assert_eq!(v["codes"].as_array().unwrap().len(), 2);
        assert_eq!(v["excerpts"][0]["codeIds"].as_array().unwrap().len(), 2);
        assert_eq!(v["memos"][0]["body"], "note");
        let fields = v["descriptorFields"].as_array().unwrap();
        assert_eq!(fields.len(), 2);
        assert_eq!(fields[0]["name"], "Site");
        assert_eq!(fields[0]["kind"], "choice");
        assert_eq!(fields[0]["options"][1], "South");
        assert_eq!(fields[0]["valueCount"], 1);
        let values = v["descriptorValues"].as_array().unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(values[0]["fieldId"], fields[0]["id"]);
        assert_eq!(values[0]["value"], "North");
        assert_eq!(values[0]["documentId"], v["documents"][0]["id"]);
        assert_eq!(values[1]["value"], "41");
    }
}
