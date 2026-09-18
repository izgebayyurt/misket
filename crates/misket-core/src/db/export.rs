//! Exports: codebook and excerpts as CSV, the whole project as JSON.

use std::collections::HashMap;
use std::io::Write;

use rusqlite::Connection;
use serde::Serialize;

use super::{activity, coders, codes, descriptors, documents, excerpts, memos, sets};
use crate::error::Result;
use crate::models::{
    ActivityEntry, Code, CodebookJsonCode, Coder, DescriptorField, DescriptorValue, ExcerptFilter,
    ExcerptWithCodes, Memo, SavedFilter, SetWithMembers,
};

/// The activity log as CSV: the audit trail in a form a reviewer, a
/// supervisor or a spreadsheet can read without Misket.
pub fn activity_csv<W: Write>(conn: &Connection, w: W) -> Result<()> {
    let mut wtr = csv::Writer::from_writer(w);
    wtr.write_record([
        "at",
        "actor",
        "kind",
        "target_kind",
        "target_id",
        "summary",
        "detail_json",
    ])?;
    for e in activity::all(conn)? {
        wtr.write_record([
            &e.at,
            &e.actor,
            &e.kind,
            &e.target_kind,
            e.target_id.as_deref().unwrap_or(""),
            &e.summary,
            &e.detail.to_string(),
        ])?;
    }
    wtr.flush()?;
    Ok(())
}

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
        "inclusion",
        "exclusion",
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
            c.inclusion.as_str(),
            c.exclusion.as_str(),
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
                inclusion: c.inclusion,
                exclusion: c.exclusion,
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

    // Coder names for the `coders` column, by id; an id with no row of its
    // own (work pulled from a copy) shows as the id, which is at least
    // something to match on.
    let coder_names: HashMap<String, String> = coders::list(conn)?
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect();

    let mut wtr = csv::Writer::from_writer(w);
    let mut header = vec![
        "excerpt_id".to_string(),
        "document".into(),
        "start".into(),
        "end".into(),
        // Milliseconds, filled only for a coded stretch of a recording. The
        // `start`/`end` pair above is the raw column, which means code points
        // for text and milliseconds for media; these two are unambiguous.
        "start_ms".into(),
        "end_ms".into(),
        "geometry".into(),
        "text".into(),
        "codes".into(),
        "coders".into(),
        "weights".into(),
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
        // One row per excerpt, as before: `codes` lists every code on it once
        // and `coders` lists everyone who coded it, both "; "-separated. Who
        // applied which code is in the project JSON export, not here.
        let mut coder_list: Vec<&str> = vec![];
        for coding in &e.codings {
            let name = coder_names
                .get(&coding.coder_id)
                .map(String::as_str)
                .unwrap_or(coding.coder_id.as_str());
            if !name.is_empty() && !coder_list.contains(&name) {
                coder_list.push(name);
            }
        }
        // "code=value" per rated coding; a passage two coders rated
        // differently lists both, same as `coders` lists both names.
        let weight_list = e
            .codings
            .iter()
            .filter_map(|coding| {
                let value = coding.weight?;
                let path = paths
                    .get(&coding.code_id)
                    .cloned()
                    .unwrap_or_else(|| coding.code_id.clone());
                Some(format!("{path}={value}"))
            })
            .collect::<Vec<_>>()
            .join("; ");
        let mut record = vec![
            e.id.clone(),
            row.document_name.clone(),
            e.start_pos.map(|v| v.to_string()).unwrap_or_default(),
            e.end_pos.map(|v| v.to_string()).unwrap_or_default(),
            media_ms(&e, e.start_pos),
            media_ms(&e, e.end_pos),
            e.geometry.clone().unwrap_or_default(),
            e.snapshot.clone().unwrap_or_default(),
            code_list,
            coder_list.join("; "),
            weight_list,
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

/// A position in milliseconds, or empty for anything that is not a coded
/// stretch of a recording.
fn media_ms(e: &ExcerptWithCodes, pos: Option<i64>) -> String {
    if e.kind == "video_range" {
        pos.map(|v| v.to_string()).unwrap_or_default()
    } else {
        String::new()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectJson {
    format: &'static str,
    format_version: u32,
    meta: HashMap<String, String>,
    documents: Vec<crate::models::Document>,
    codes: Vec<Code>,
    /// Everyone whose work is in the file. Codings carry `coderId` inside
    /// each excerpt's `codings`, and memos carry theirs directly.
    coders: Vec<Coder>,
    excerpts: Vec<ExcerptWithCodes>,
    memos: Vec<Memo>,
    descriptor_fields: Vec<DescriptorField>,
    descriptor_values: Vec<DescriptorValue>,
    sets: Vec<SetWithMembers>,
    saved_filters: Vec<SavedFilter>,
    /// The whole audit trail, oldest first.
    activity: Vec<ActivityEntry>,
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
    // Sets and saved filters, so a project export is enough to rebuild
    // everything the browser's filters can name.
    let mut all_sets = vec![];
    for kind in sets::KINDS {
        for set in sets::list_sets(conn, kind)? {
            let member_ids = sets::set_members(conn, &set.id)?;
            all_sets.push(SetWithMembers { set, member_ids });
        }
    }
    let all_coders: Vec<Coder> = coders::list(conn)?
        .into_iter()
        .map(|c| Coder {
            id: c.id,
            name: c.name,
            color: c.color,
            created_at: String::new(),
        })
        .collect();
    let out = ProjectJson {
        format: "misket-project",
        format_version: 1,
        meta,
        documents: docs,
        codes: codes::list(conn)?,
        coders: all_coders,
        excerpts: all_excerpts,
        memos: all_memos,
        descriptor_fields: descriptors::list_fields(conn)?,
        descriptor_values: all_descriptor_values,
        sets: all_sets,
        saved_filters: sets::list_saved_filters(conn)?,
        activity: activity::all(conn)?,
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
        coders::ensure_local(&p.conn, "ada", "Ada", "#D9534F").unwrap();
        let doc = documents::create(&p.conn, new_doc("He said \"hi\",\nthen left.")).unwrap();
        let a = mk_code(&p.conn, "Greeting", None);
        let b = mk_code(&p.conn, "Formal, sort of", Some(&a.id));
        let r = excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.summary.id.clone(),
                start_pos: Some(0),
                end_pos: Some(18),
                code_ids: vec![a.id.clone(), b.id.clone()],
                ..Default::default()
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
        sets::create_set(
            &p.conn,
            "code",
            "Greetings",
            std::slice::from_ref(&a.id),
            None,
        )
        .unwrap();
        sets::save_filter(
            &p.conn,
            "Formal only",
            &ExcerptFilter {
                code_ids: Some(vec![b.id.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        p
    }

    #[test]
    fn activity_csv_and_project_json_carry_the_audit_trail() {
        let p = populated();
        let mut buf = vec![];
        activity_csv(&p.conn, &mut buf).unwrap();
        let csv = String::from_utf8(buf).unwrap();
        let lines: Vec<_> = csv.lines().collect();
        assert_eq!(
            lines[0],
            "at,actor,kind,target_kind,target_id,summary,detail_json"
        );
        // Oldest first: the document was imported before anything else.
        assert!(lines[1].contains("document.imported"), "{}", lines[1]);
        assert!(csv.contains("code.created"));
        assert!(csv.contains("excerpt.created"));

        let mut buf = vec![];
        project_json(&p.conn, &mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        let entries = v["activity"].as_array().unwrap();
        assert_eq!(entries.len(), lines.len() - 1);
        assert_eq!(entries[0]["kind"], "document.imported");
        // `detail` is a real object, not a string to decode twice.
        assert!(entries[0]["detail"].is_object());
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
            "id,path,name,parent_id,color,description,inclusion,exclusion,shortcut,excerpt_count"
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

    /// A coded stretch of a recording exports its milliseconds in the
    /// dedicated columns, and the project JSON carries everything known
    /// about the media file (`documents.media_json`) so an export is enough
    /// to see what was coded and how long it ran.
    #[test]
    fn media_excerpts_export_their_milliseconds_and_media_json() {
        use crate::db::media;

        let p = populated();
        let dir = tempfile::tempdir().unwrap();
        let path = media::tests::fake_file(dir.path(), "tape.mp3", 4096, 8);
        let doc = media::create(&p.conn, None, media::tests::new_media(&path))
            .unwrap()
            .summary
            .id;
        let code = codes::list(&p.conn).unwrap()[0].id.clone();
        excerpts::apply_codes(
            &p.conn,
            crate::models::ApplyCodesInput {
                document_id: doc.clone(),
                kind: Some("video_range".into()),
                start_pos: Some(12_000),
                end_pos: Some(19_500),
                code_ids: vec![code],
                ..Default::default()
            },
        )
        .unwrap();

        let mut buf = vec![];
        excerpts_csv(&p.conn, &ExcerptFilter::default(), &mut buf).unwrap();
        let csv = String::from_utf8(buf).unwrap();
        let media_line = csv
            .lines()
            .find(|l| l.contains("[0:12.0–0:19.5]"))
            .unwrap_or_else(|| panic!("no media row in\n{csv}"));
        assert!(
            media_line.contains(",12000,19500,12000,19500,"),
            "{media_line}"
        );
        // A text excerpt leaves the millisecond columns empty.
        let text_line = csv
            .lines()
            .find(|l| l.contains("He said"))
            .unwrap_or_else(|| panic!("no text row in\n{csv}"));
        assert!(text_line.contains(",0,18,,,"), "{text_line}");

        let mut buf = vec![];
        project_json(&p.conn, &mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        let recording = v["documents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["id"] == doc.as_str())
            .unwrap();
        assert_eq!(recording["kind"], "video");
        assert_eq!(recording["media"]["durationMs"], 125_400);
        assert_eq!(recording["media"]["mime"], "audio/mpeg");
        assert!(recording["media"]["fileHash"].is_string());
        assert_eq!(recording["mediaMissing"], false);
        assert!(recording["text"].is_null());
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
                "excerpt_id,document,start,end,start_ms,end_ms,geometry,text,codes,coders,\
                 weights,memo_count,created_at,Site,Age\n"
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
        // Then who coded it; neither code has a weight scale, so the weights
        // column is empty, then the memo count.
        assert!(s.contains("\",Ada,,1,"), "{s}");
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

        let sets = v["sets"].as_array().unwrap();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0]["set"]["name"], "Greetings");
        assert_eq!(sets[0]["set"]["kind"], "code");
        assert_eq!(sets[0]["memberIds"].as_array().unwrap().len(), 1);
        let filters = v["savedFilters"].as_array().unwrap();
        assert_eq!(filters.len(), 1);
        assert_eq!(filters[0]["name"], "Formal only");
        assert_eq!(filters[0]["filter"]["codeIds"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn image_excerpts_export_their_geometry_and_snapshot() {
        let p = OpenProject::in_memory("With an image").unwrap();
        let img = documents::create_image(&p.conn, crate::db::documents::tests::new_image(b"png"))
            .unwrap()
            .summary
            .id;
        let code = mk_code(&p.conn, "Layout", None);
        excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: img.clone(),
                kind: Some("image_region".into()),
                geometry: Some(crate::models::Rect {
                    x: 0.3,
                    y: 0.4,
                    w: 0.12,
                    h: 0.08,
                }),
                code_ids: vec![code.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();

        let mut buf = vec![];
        excerpts_csv(&p.conn, &ExcerptFilter::default(), &mut buf).unwrap();
        let s = String::from_utf8(buf).unwrap();
        let row = s.lines().nth(1).unwrap();
        // Empty start/end, the canonical geometry, and the readable snapshot.
        assert!(row.contains(",Poster,,,"), "{row}");
        assert!(
            row.contains(r#""{""x"":0.3,""y"":0.4,""w"":0.12,""h"":0.08}""#),
            "{row}"
        );
        assert!(row.contains("region 12%×8% at (30%, 40%)"), "{row}");
        assert!(row.contains(",Layout,"), "{row}");

        let mut buf = vec![];
        project_json(&p.conn, &mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        assert_eq!(v["documents"][0]["kind"], "image");
        assert_eq!(v["documents"][0]["media"]["width"], 800);
        assert_eq!(v["documents"][0]["media"]["mime"], "image/png");
        assert_eq!(v["documents"][0]["text"], serde_json::Value::Null);
        assert_eq!(v["excerpts"][0]["kind"], "image_region");
        assert_eq!(
            v["excerpts"][0]["geometry"],
            r#"{"x":0.3,"y":0.4,"w":0.12,"h":0.08}"#
        );
    }
}
