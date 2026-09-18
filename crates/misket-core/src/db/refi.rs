//! REFI-QDA (`.qdpx`) import and export.
//!
//! [REFI-QDA](https://www.qdasoftware.org/) is the interchange format the QDA
//! vendors agreed on: NVivo, ATLAS.ti, MAXQDA, QDA Miner, Quirkos, QualCoder
//! and Dedoose all read or write it. A `.qdpx` is a ZIP holding
//! `project.qde` — XML against the REFI-QDA Project schema 1.0, namespace
//! `urn:QDA-XML:project:1.0` — and a `Sources` folder with the source files
//! themselves, plain text in UTF-8 plus whatever media the project has.
//!
//! # What maps onto what
//!
//! | Misket                        | REFI-QDA                                     |
//! | ----------------------------- | -------------------------------------------- |
//! | project name                  | `Project/@name`                              |
//! | coders                        | `Users/User`                                 |
//! | codes (tree, colour)          | `CodeBook/Codes/Code`, nested                |
//! | code description + definition | `Code/Description`, as labelled paragraphs   |
//! | text document                 | `TextSource` + `Sources/<guid>.txt`          |
//! | image document                | `PictureSource` + `Sources/<guid>.png`       |
//! | text excerpt                  | `PlainTextSelection` (UTF-16 offsets)        |
//! | image region                  | `PictureSelection` (pixels)                  |
//! | coding by coder               | `Coding` + `CodeRef`, `@creatingUser`        |
//! | memo                          | `Notes/Note` + a `NoteRef` on its target     |
//! | descriptor field / value      | `Variables/Variable` / `VariableValue`       |
//! | code set, document set        | `Sets/Set` with `MemberCode`/`MemberSource`  |
//!
//! Transcript formats, framework matrices, saved filters, code shortcuts and
//! the history tree have no REFI-QDA equivalent and stay behind; `Cases`,
//! `Links` and `Graphs` have no Misket equivalent and are reported rather
//! than silently dropped (a `Case`'s variable values do land on the
//! documents it names, because that is what other tools put there).
//!
//! # Offsets
//!
//! A `PlainTextSelection` counts **UTF-16 code units** into the plain text
//! file as it sits in the ZIP. Misket stores code point offsets into text
//! that has had its BOM stripped, its CRLFs collapsed and NFC applied. Both
//! directions go through `db::text`: [`text::utf16_offsets`] for the units
//! and [`text::normalize_mapped`] for what normalization did to the indices.
//!
//! # Undo
//!
//! An import is one [`history::group`] (`project.refi_imported`), built the
//! way `db::merge` builds a pull: every row arrives as a history node
//! carrying its own forward and inverse payload, so one Ctrl-Z takes the
//! whole `.qdpx` back out again and a redo brings it in with the same ids.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Write};
use std::path::Path;

use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

use super::history::{CodeOp, DescriptorOp, DocumentOp, ExcerptChange, MemoChange, PullChange};
use super::transcripts::StoredTranscript;
use super::{
    activity, coders, codes, descriptors, excerpts, export, history, media, sets, text, util,
};
use crate::error::{AppError, Result};
use crate::models::{
    CodePatch, CodeRow, CodeTreeSnapshot, Coder, DescriptorField, DocumentSnapshot,
    ExcerptSnapshot, ExcerptWithCodes, Memo, Rect, RefiExportReport, RefiImportMode,
    RefiImportReport, RefiPreview, SetInfo, SetWithMembers, TagRow,
};

const NS: &str = "urn:QDA-XML:project:1.0";
const QDE: &str = "project.qde";
/// NVivo writes `Sources`, MAXQDA writes `sources`; we write the former and
/// read either (see [`Package::source_bytes`]).
const SOURCES_DIR: &str = "Sources";
/// The scheme REFI-QDA uses for a path inside the container.
const INTERNAL: &str = "internal://";

/// The labelled paragraphs a code's `Description` carries, so the three
/// definition fields survive a trip through a format that has one text box.
const INCLUSION_LABEL: &str = "When to apply:";
const EXCLUSION_LABEL: &str = "When not to apply:";
const EXAMPLE_LABEL: &str = "Example:";
/// The choice options of a descriptor field, in its `Variable/Description`.
const OPTIONS_LABEL: &str = "Options:";
/// A set whose members are all gone would lose the one thing that says
/// whether it is a code set or a document set, so it is written down.
const SET_KIND_LABEL: &str = "Misket set:";

// ------------------------------------------------------------------- GUIDs

/// A Misket id as a REFI-QDA GUID: our ids are UUIDs, and upper case is the
/// form the standard's examples use.
///
/// Anything that is *not* a UUID — an id from a project file somebody edited
/// by hand, a coder id from an older settings file — is hashed into one, so
/// the output always matches the schema's `GUIDType` pattern and the same
/// input always gives the same GUID.
fn guid(id: &str) -> String {
    if is_uuid(id) {
        return id.to_ascii_uppercase();
    }
    let hash = text::sha256_hex(id.as_bytes());
    format_uuid(&hash).to_ascii_uppercase()
}

/// A GUID derived from several parts, for something Misket keys by a tuple
/// rather than by an id — a coding is `(excerpt, code, coder)`.
fn derived_guid(kind: &str, parts: &[&str]) -> String {
    let joined = format!("{kind}\u{1}{}", parts.join("\u{1}"));
    format_uuid(&text::sha256_hex(joined.as_bytes())).to_ascii_uppercase()
}

/// The first 16 bytes of a hex digest as a version-4-shaped UUID.
fn format_uuid(hex: &str) -> String {
    let mut bytes: Vec<u8> = hex
        .as_bytes()
        .chunks(2)
        .take(16)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap_or("00"), 16).unwrap_or(0))
        .collect();
    bytes.resize(16, 0);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// The id a GUID becomes on the way in: braces off, lower case, which is the
/// canonical UUID form Misket generates — so a project exported and imported
/// again gets its own ids back.
fn id_of(guid: &str) -> String {
    let trimmed = guid.trim().trim_start_matches('{').trim_end_matches('}');
    if is_uuid(trimmed) {
        trimmed.to_ascii_lowercase()
    } else {
        trimmed.to_string()
    }
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

// ------------------------------------------------- labelled paragraphs

/// `description` plus the definition fields, as paragraphs another tool shows
/// verbatim and [`split_description`] reads back.
fn join_description(description: &str, inclusion: &str, exclusion: &str, example: &str) -> String {
    let mut parts: Vec<String> = vec![];
    if !description.trim().is_empty() {
        parts.push(description.trim_end().to_string());
    }
    for (label, body) in [
        (INCLUSION_LABEL, inclusion),
        (EXCLUSION_LABEL, exclusion),
        (EXAMPLE_LABEL, example),
    ] {
        if !body.trim().is_empty() {
            parts.push(format!("{label} {}", body.trim()));
        }
    }
    parts.join("\n\n")
}

/// The inverse of [`join_description`]: `(description, inclusion, exclusion,
/// example)`. A paragraph with no label we recognise stays in the
/// description, so a `Description` written by another tool arrives whole.
fn split_description(text: &str) -> (String, String, String, String) {
    let (mut description, mut inclusion, mut exclusion, mut example) =
        (vec![], String::new(), String::new(), String::new());
    for para in text.split("\n\n") {
        let trimmed = para.trim();
        if let Some(rest) = trimmed.strip_prefix(INCLUSION_LABEL) {
            inclusion = rest.trim().to_string();
        } else if let Some(rest) = trimmed.strip_prefix(EXCLUSION_LABEL) {
            exclusion = rest.trim().to_string();
        } else if let Some(rest) = trimmed.strip_prefix(EXAMPLE_LABEL) {
            example = rest.trim().to_string();
        } else if !trimmed.is_empty() {
            description.push(trimmed.to_string());
        }
    }
    (description.join("\n\n"), inclusion, exclusion, example)
}

/// How a code's example excerpt travels: the quoted words for a human, and
/// the excerpt's GUID so an import can point at the excerpt itself again.
fn example_paragraph(quote: &str, excerpt_guid: &str) -> String {
    format!(
        "\u{201C}{}\u{201D} [misket:excerpt:{excerpt_guid}]",
        activity::elide(quote, 160)
    )
}

/// The GUID out of an [`example_paragraph`], if it has one.
fn example_guid(paragraph: &str) -> Option<String> {
    let start = paragraph.find("[misket:excerpt:")? + "[misket:excerpt:".len();
    let rest = &paragraph[start..];
    let end = rest.find(']')?;
    Some(rest[..end].to_string())
}

// -------------------------------------------------------------- XML writing

/// A thin wrapper over `quick_xml::Writer` so the tree below reads like the
/// document it produces. Writing to a `Vec` cannot really fail; an error can
/// only mean a malformed name, which would be our bug.
struct Xml(Writer<Vec<u8>>);

type Attrs<'a> = Vec<(&'a str, String)>;

fn xml_err(e: impl std::fmt::Display) -> AppError {
    AppError::Io(format!("writing REFI-QDA XML: {e}"))
}

impl Xml {
    fn new() -> Result<Self> {
        let mut w = Writer::new_with_indent(Vec::new(), b' ', 2);
        w.write_event(Event::Decl(BytesDecl::new("1.0", Some("utf-8"), None)))
            .map_err(xml_err)?;
        Ok(Self(w))
    }

    fn open(&mut self, name: &str, attrs: &Attrs<'_>) -> Result<()> {
        let mut el = BytesStart::new(name);
        for (k, v) in attrs {
            el.push_attribute((*k, v.as_str()));
        }
        self.0.write_event(Event::Start(el)).map_err(xml_err)
    }

    fn close(&mut self, name: &str) -> Result<()> {
        self.0
            .write_event(Event::End(BytesEnd::new(name)))
            .map_err(xml_err)
    }

    fn empty(&mut self, name: &str, attrs: &Attrs<'_>) -> Result<()> {
        let mut el = BytesStart::new(name);
        for (k, v) in attrs {
            el.push_attribute((*k, v.as_str()));
        }
        self.0.write_event(Event::Empty(el)).map_err(xml_err)
    }

    /// `<Name>text</Name>`, on one line, with the text escaped.
    fn text_el(&mut self, name: &str, body: &str) -> Result<()> {
        self.open(name, &vec![])?;
        self.0
            .write_event(Event::Text(BytesText::new(body)))
            .map_err(xml_err)?;
        self.close(name)
    }

    fn finish(self) -> Vec<u8> {
        self.0.into_inner()
    }
}

/// An attribute list with the empty values left out, because every optional
/// REFI-QDA attribute is better absent than blank.
fn attrs<'a>(pairs: impl IntoIterator<Item = (&'a str, String)>) -> Attrs<'a> {
    pairs.into_iter().filter(|(_, v)| !v.is_empty()).collect()
}

// ------------------------------------------------------------------ export

/// One document as the exporter needs it: the row, the file it becomes, and
/// everything hanging off it.
struct OutSource {
    id: String,
    name: String,
    /// `TextSource`, `PictureSource` or `VideoSource`.
    element: &'static str,
    /// The name inside `Sources/`, empty for a source referenced by path.
    file_name: String,
    /// An external path, for media Misket only holds by reference.
    external_path: Option<String>,
    bytes: Option<Vec<u8>>,
    text: Option<String>,
    excerpts: Vec<ExcerptSnapshot>,
    width: i64,
    height: i64,
    created_at: String,
}

/// Write the whole project as a `.qdpx`.
pub fn export_refi(conn: &Connection, path: &Path) -> Result<RefiExportReport> {
    let mut report = RefiExportReport {
        path: path.to_string_lossy().into_owned(),
        ..Default::default()
    };

    let project_name = super::meta(conn, "name")?.unwrap_or_else(|| "Project".into());
    let created_at = super::meta(conn, "created_at")?.unwrap_or_else(util::now);
    let local = history::local_coder(conn);

    // Users. A coding whose coder never got a `coders` row (work pulled from
    // a copy that did not bring one) still needs a User to point at.
    let mut users: Vec<Coder> = vec![];
    let mut seen_users: HashSet<String> = HashSet::new();
    for c in coders::list(conn)? {
        if c.id.is_empty() || !seen_users.insert(c.id.clone()) {
            continue;
        }
        users.push(Coder {
            id: c.id,
            name: c.name,
            color: c.color,
            created_at: String::new(),
        });
    }

    let all_codes = codes::list(conn)?;
    let fields = descriptors::list_fields(conn)?;
    let all_memos = read_memos(conn)?;

    // Every memo, by the GUID of whatever it is about, so each target can
    // write its own `NoteRef` children.
    let mut notes_by_target: HashMap<String, Vec<String>> = HashMap::new();
    for m in &all_memos {
        let target = m
            .document_id
            .as_deref()
            .or(m.code_id.as_deref())
            .or(m.excerpt_id.as_deref())
            .unwrap_or("")
            .to_string();
        notes_by_target
            .entry(target)
            .or_default()
            .push(m.id.clone());
    }
    // Sources.
    let mut sources: Vec<OutSource> = vec![];
    for d in super::documents::list(conn)? {
        let mut out = OutSource {
            id: d.id.clone(),
            name: d.name.clone(),
            element: "TextSource",
            file_name: String::new(),
            external_path: None,
            bytes: None,
            text: None,
            excerpts: vec![],
            width: d.media.as_ref().and_then(|m| m.width).unwrap_or(0),
            height: d.media.as_ref().and_then(|m| m.height).unwrap_or(0),
            created_at: d.created_at.clone(),
        };
        for e in excerpts::list_for_document(conn, &d.id)? {
            out.excerpts.push(excerpts::snapshot(conn, &e.id)?);
        }
        match d.kind.as_str() {
            "text" => {
                let (body, _) = super::documents::get_text(conn, &d.id)?;
                out.file_name = format!("{}.txt", guid(&d.id));
                out.text = Some(body);
                report.text_sources += 1;
            }
            "image" => {
                let (mime, bytes) = super::documents::get_media(conn, &d.id)?;
                out.element = "PictureSource";
                out.file_name = format!("{}.{}", guid(&d.id), extension_for(&mime));
                out.bytes = Some(bytes);
                report.picture_sources += 1;
            }
            "video" => {
                // Misket holds video by reference, so the `.qdpx` does too:
                // the path travels, the bytes do not.
                out.element = "VideoSource";
                out.external_path = d.source_path.clone();
                report.other_sources += 1;
                if out.external_path.is_none() {
                    report
                        .skipped
                        .push(format!("{:?}: a video with no file path", d.name));
                }
            }
            other => {
                report
                    .skipped
                    .push(format!("{:?}: unsupported document kind {other}", d.name));
                continue;
            }
        }
        sources.push(out);
    }

    // Sets, and the saved filters that have nowhere to go.
    let mut out_sets: Vec<SetWithMembers> = vec![];
    for kind in ["code", "document"] {
        for s in sets::list_sets(conn, kind)? {
            let member_ids = sets::set_members(conn, &s.id)?;
            out_sets.push(SetWithMembers { set: s, member_ids });
        }
    }
    let filters = sets::list_saved_filters(conn)?.len();
    if filters > 0 {
        report.skipped.push(format!(
            "{filters} saved filter{} (REFI-QDA has no equivalent)",
            if filters == 1 { "" } else { "s" }
        ));
    }
    let matrices: i64 =
        conn.query_row("SELECT count(*) FROM framework_matrices", [], |r| r.get(0))?;
    if matrices > 0 {
        report.skipped.push(format!(
            "{matrices} framework matri{} (REFI-QDA has no equivalent)",
            if matrices == 1 { "x" } else { "ces" }
        ));
    }
    if all_codes.iter().any(|c| c.shortcut.is_some()) {
        report
            .skipped
            .push("code shortcuts (REFI-QDA has no equivalent)".into());
    }

    // ---------------------------------------------------------------- XML
    let mut x = Xml::new()?;
    x.open(
        "Project",
        &attrs([
            ("xmlns", NS.to_string()),
            ("name", project_name),
            ("origin", format!("Misket {}", env!("CARGO_PKG_VERSION"))),
            (
                "creatingUserGUID",
                if local.is_empty() {
                    String::new()
                } else {
                    guid(&local)
                },
            ),
            ("creationDateTime", xsd_date_time(&created_at)),
        ]),
    )?;

    if !users.is_empty() {
        x.open("Users", &vec![])?;
        for u in &users {
            x.empty(
                "User",
                &attrs([("guid", guid(&u.id)), ("name", u.name.clone())]),
            )?;
        }
        x.close("Users")?;
        report.users = users.len() as i64;
    }

    // The codebook, nested the way it is on screen.
    if !all_codes.is_empty() {
        x.open("CodeBook", &vec![])?;
        x.open("Codes", &vec![])?;
        let mut by_parent: BTreeMap<Option<String>, Vec<&crate::models::Code>> = BTreeMap::new();
        for c in &all_codes {
            by_parent.entry(c.parent_id.clone()).or_default().push(c);
        }
        for c in by_parent.get(&None).cloned().unwrap_or_default() {
            write_code(conn, &mut x, c, &by_parent, &notes_by_target, &mut report)?;
        }
        x.close("Codes")?;
        x.close("CodeBook")?;
    }

    if !fields.is_empty() {
        x.open("Variables", &vec![])?;
        for f in &fields {
            let description = if f.kind == "choice" && !f.options.is_empty() {
                format!("{OPTIONS_LABEL} {}", f.options.join(" | "))
            } else {
                String::new()
            };
            let variable_attrs = attrs([
                ("guid", guid(&f.id)),
                ("name", f.name.clone()),
                ("typeOfVariable", variable_type(&f.kind).to_string()),
            ]);
            if description.is_empty() {
                x.empty("Variable", &variable_attrs)?;
            } else {
                x.open("Variable", &variable_attrs)?;
                x.text_el("Description", &description)?;
                x.close("Variable")?;
            }
        }
        x.close("Variables")?;
        report.variables = fields.len() as i64;
    }

    if !sources.is_empty() {
        x.open("Sources", &vec![])?;
        for s in &sources {
            write_source(conn, &mut x, s, &fields, &notes_by_target, &mut report)?;
        }
        x.close("Sources")?;
    }

    if !all_memos.is_empty() {
        x.open("Notes", &vec![])?;
        for m in &all_memos {
            x.open(
                "Note",
                &attrs([
                    ("guid", guid(&m.id)),
                    ("name", m.title.clone()),
                    (
                        "creatingUser",
                        if m.coder_id.is_empty() {
                            String::new()
                        } else {
                            guid(&m.coder_id)
                        },
                    ),
                    ("creationDateTime", xsd_date_time(&m.created_at)),
                    ("modifiedDateTime", xsd_date_time(&m.updated_at)),
                ]),
            )?;
            if !m.body.is_empty() {
                x.text_el("PlainTextContent", &m.body)?;
            }
            x.close("Note")?;
        }
        x.close("Notes")?;
        report.notes = all_memos.len() as i64;
    }

    if !out_sets.is_empty() {
        x.open("Sets", &vec![])?;
        for s in &out_sets {
            x.open(
                "Set",
                &attrs([("guid", guid(&s.set.id)), ("name", s.set.name.clone())]),
            )?;
            x.text_el(
                "Description",
                &format!("{SET_KIND_LABEL} {} set", s.set.kind),
            )?;
            let member = if s.set.kind == "code" {
                "MemberCode"
            } else {
                "MemberSource"
            };
            for id in &s.member_ids {
                x.empty(member, &attrs([("targetGUID", guid(id))]))?;
            }
            x.close("Set")?;
        }
        x.close("Sets")?;
        report.sets = out_sets.len() as i64;
    }

    // Project memos, last in the sequence the schema declares.
    for id in notes_by_target.get("").into_iter().flatten() {
        x.empty("NoteRef", &attrs([("targetGUID", guid(id))]))?;
    }

    x.close("Project")?;
    let xml = x.finish();

    // -------------------------------------------------------------- the ZIP
    let file = std::fs::File::create(path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(QDE, options).map_err(zip_err)?;
    zip.write_all(&xml)?;
    for s in &sources {
        if s.file_name.is_empty() {
            continue;
        }
        zip.start_file(format!("{SOURCES_DIR}/{}", s.file_name), options)
            .map_err(zip_err)?;
        if let Some(t) = &s.text {
            zip.write_all(t.as_bytes())?;
        } else if let Some(b) = &s.bytes {
            zip.write_all(b)?;
        }
    }
    zip.finish().map_err(zip_err)?;
    Ok(report)
}

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::Io(format!("qdpx: {e}"))
}

/// `xsd:dateTime` wants no fractional-second surprises and no empty string;
/// our timestamps are already RFC 3339, which is a valid `xsd:dateTime`.
fn xsd_date_time(at: &str) -> String {
    if at.trim().is_empty() {
        String::new()
    } else {
        at.to_string()
    }
}

fn extension_for(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

/// Which `typeOfVariable` one of our descriptor kinds is. A `choice` field is
/// `Text` with its options in the `Description`, because REFI-QDA has no
/// enumerated variable.
fn variable_type(kind: &str) -> &'static str {
    match kind {
        "number" => "Float",
        "date" => "Date",
        _ => "Text",
    }
}

fn write_code(
    conn: &Connection,
    x: &mut Xml,
    code: &crate::models::Code,
    by_parent: &BTreeMap<Option<String>, Vec<&crate::models::Code>>,
    notes_by_target: &HashMap<String, Vec<String>>,
    report: &mut RefiExportReport,
) -> Result<()> {
    let example = match &code.example_excerpt_id {
        Some(id) => {
            let quote: Option<String> = conn
                .query_row("SELECT snapshot FROM excerpts WHERE id = ?1", [id], |r| {
                    r.get(0)
                })
                .optional()?
                .flatten();
            example_paragraph(quote.as_deref().unwrap_or(""), &guid(id))
        }
        None => String::new(),
    };
    let description = join_description(
        &code.description,
        &code.inclusion,
        &code.exclusion,
        &example,
    );
    let code_attrs = attrs([
        ("guid", guid(&code.id)),
        ("name", code.name.clone()),
        ("isCodable", "true".to_string()),
        ("color", code.color.clone()),
    ]);
    let notes = notes_by_target.get(&code.id).cloned().unwrap_or_default();
    let children = by_parent
        .get(&Some(code.id.clone()))
        .cloned()
        .unwrap_or_default();
    report.codes += 1;
    if description.is_empty() && notes.is_empty() && children.is_empty() {
        return x.empty("Code", &code_attrs);
    }
    x.open("Code", &code_attrs)?;
    if !description.is_empty() {
        x.text_el("Description", &description)?;
    }
    for id in &notes {
        x.empty("NoteRef", &attrs([("targetGUID", guid(id))]))?;
    }
    for child in children {
        write_code(conn, x, child, by_parent, notes_by_target, report)?;
    }
    x.close("Code")
}

#[allow(clippy::too_many_lines)]
fn write_source(
    conn: &Connection,
    x: &mut Xml,
    s: &OutSource,
    fields: &[DescriptorField],
    notes_by_target: &HashMap<String, Vec<String>>,
    report: &mut RefiExportReport,
) -> Result<()> {
    let path_attr = match (&s.external_path, s.file_name.is_empty()) {
        (Some(p), _) => p.clone(),
        (None, false) => format!("{INTERNAL}{}", s.file_name),
        (None, true) => String::new(),
    };
    let path_key = if s.element == "TextSource" {
        "plainTextPath"
    } else {
        "path"
    };
    x.open(
        s.element,
        &attrs([
            ("guid", guid(&s.id)),
            ("name", s.name.clone()),
            (path_key, path_attr),
            ("creationDateTime", xsd_date_time(&s.created_at)),
        ]),
    )?;

    // Selections, each with its codings.
    let units = s.text.as_deref().map(text::utf16_offsets);
    for snapshot in &s.excerpts {
        let e = &snapshot.excerpt;
        let (element, position): (&str, Attrs<'_>) = match e.kind.as_str() {
            "text" => {
                let map = units.as_deref().unwrap_or(&[]);
                (
                    "PlainTextSelection",
                    vec![
                        (
                            "startPosition",
                            text::cp_to_utf16(map, e.start_pos.unwrap_or(0)).to_string(),
                        ),
                        (
                            "endPosition",
                            text::cp_to_utf16(map, e.end_pos.unwrap_or(0)).to_string(),
                        ),
                    ],
                )
            }
            "image_region" => {
                let rect = parse_rect(e.geometry.as_deref())?;
                let px = |v: f64, size: i64| (v * size as f64).round() as i64;
                (
                    "PictureSelection",
                    vec![
                        ("firstX", px(rect.x, s.width).to_string()),
                        ("firstY", px(rect.y, s.height).to_string()),
                        ("secondX", px(rect.x + rect.w, s.width).to_string()),
                        ("secondY", px(rect.y + rect.h, s.height).to_string()),
                    ],
                )
            }
            "video_range" => (
                "VideoSelection",
                vec![
                    ("begin", e.start_pos.unwrap_or(0).to_string()),
                    ("end", e.end_pos.unwrap_or(0).to_string()),
                ],
            ),
            other => {
                report
                    .skipped
                    .push(format!("an excerpt of unknown kind {other}"));
                continue;
            }
        };
        let creating = snapshot
            .tags
            .first()
            .map(|t| t.coder_id.clone())
            .unwrap_or_default();
        let mut selection_attrs: Attrs<'_> = vec![("guid", guid(&e.id))];
        // The position attributes are required, so they go in as they are.
        selection_attrs.extend(position);
        selection_attrs.extend(attrs([
            (
                "creatingUser",
                if creating.is_empty() {
                    String::new()
                } else {
                    guid(&creating)
                },
            ),
            ("creationDateTime", xsd_date_time(&e.created_at)),
        ]));
        x.open(element, &selection_attrs)?;
        for t in &snapshot.tags {
            write_coding(x, &e.id, t)?;
            report.codings += 1;
        }
        for id in notes_by_target.get(&e.id).into_iter().flatten() {
            x.empty("NoteRef", &attrs([("targetGUID", guid(id))]))?;
        }
        x.close(element)?;
        report.selections += 1;
    }

    for id in notes_by_target.get(&s.id).into_iter().flatten() {
        x.empty("NoteRef", &attrs([("targetGUID", guid(id))]))?;
    }

    // Descriptor values.
    for f in fields {
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM descriptor_values WHERE document_id = ?1 AND field_id = ?2",
                rusqlite::params![s.id, f.id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(value) = value else { continue };
        x.open("VariableValue", &vec![])?;
        x.empty("VariableRef", &attrs([("targetGUID", guid(&f.id))]))?;
        x.text_el(value_element(&f.kind), &value)?;
        x.close("VariableValue")?;
    }

    x.close(s.element)?;
    Ok(())
}

fn value_element(kind: &str) -> &'static str {
    match kind {
        "number" => "FloatValue",
        "date" => "DateValue",
        _ => "TextValue",
    }
}

fn write_coding(x: &mut Xml, excerpt_id: &str, t: &TagRow) -> Result<()> {
    x.open(
        "Coding",
        &attrs([
            (
                "guid",
                derived_guid("coding", &[excerpt_id, &t.code_id, &t.coder_id]),
            ),
            (
                "creatingUser",
                if t.coder_id.is_empty() {
                    String::new()
                } else {
                    guid(&t.coder_id)
                },
            ),
            ("creationDateTime", xsd_date_time(&t.created_at)),
        ]),
    )?;
    x.empty("CodeRef", &attrs([("targetGUID", guid(&t.code_id))]))?;
    x.close("Coding")
}

fn parse_rect(geometry: Option<&str>) -> Result<Rect> {
    let raw = geometry.unwrap_or("{}");
    serde_json::from_str(raw).map_err(|e| AppError::Validation(format!("region geometry: {e}")))
}

/// Every memo in the project, oldest first.
fn read_memos(conn: &Connection) -> Result<Vec<Memo>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, code_id, excerpt_id, title, body, coder_id, created_at, updated_at
           FROM memos ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Memo {
            id: r.get(0)?,
            document_id: r.get(1)?,
            code_id: r.get(2)?,
            excerpt_id: r.get(3)?,
            title: r.get(4)?,
            body: r.get(5)?,
            coder_id: r.get(6)?,
            created_at: r.get(7)?,
            updated_at: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ------------------------------------------------------------------ reading

/// One element of `project.qde`, with its namespace prefix already dropped.
///
/// `project.qde` is small — the sources live beside it as files — so reading
/// it into a tree and walking that is both simpler and easier to get right
/// than driving a pull parser through a schema this nested.
#[derive(Debug, Default, Clone)]
struct El {
    name: String,
    attrs: Vec<(String, String)>,
    /// The element's own character data, with the whitespace between child
    /// elements dropped.
    text: String,
    kids: Vec<El>,
}

impl El {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    fn attr_or(&self, name: &str) -> &str {
        self.attr(name).unwrap_or("")
    }

    fn number(&self, name: &str) -> Option<i64> {
        self.attr(name)?.trim().parse().ok()
    }

    fn all(&self, name: &'static str) -> impl Iterator<Item = &El> {
        self.kids.iter().filter(move |k| k.name == name)
    }

    fn first(&self, name: &'static str) -> Option<&El> {
        self.all(name).next()
    }

    /// The text of the first `name` child, or `""`.
    fn child_text(&self, name: &'static str) -> &str {
        self.first(name).map(|e| e.text.as_str()).unwrap_or("")
    }

    /// The `targetGUID`s of this element's `NoteRef` children.
    fn note_refs(&self) -> Vec<String> {
        self.all("NoteRef")
            .filter_map(|n| n.attr("targetGUID"))
            .map(id_of)
            .collect()
    }
}

/// Parse `project.qde` into a tree. Namespace prefixes are ignored: the file
/// declares one namespace and every element in it belongs to that namespace,
/// so a local name identifies an element unambiguously — and a file that
/// declares `urn:QDA-XML:project:1.0` as the default namespace, as a prefix,
/// or (some tools) not at all, all read the same way.
fn parse_qde(xml: &str) -> Result<El> {
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.expand_empty_elements = true;
    config.check_end_names = false;

    let mut stack: Vec<El> = vec![El::default()];
    loop {
        let event = reader
            .read_event()
            .map_err(|e| AppError::Validation(format!("{QDE} is not valid XML: {e}")))?;
        match event {
            Event::Start(start) => {
                let name = start.local_name().as_ref().to_string();
                let mut attrs = vec![];
                for attr in start.attributes() {
                    let attr = attr.map_err(|e| {
                        AppError::Validation(format!("{QDE}: bad attribute on <{name}>: {e}"))
                    })?;
                    let key = attr.key.local_name().as_ref().to_string();
                    let value = attr
                        .normalized_value(quick_xml::XmlVersion::Explicit1_0)
                        .map_err(|e| {
                            AppError::Validation(format!("{QDE}: bad attribute value: {e}"))
                        })?
                        .into_owned();
                    attrs.push((key, value));
                }
                stack.push(El {
                    name,
                    attrs,
                    ..Default::default()
                });
            }
            Event::End(_) => {
                if stack.len() > 1 {
                    let done = stack.pop().unwrap_or_default();
                    if let Some(parent) = stack.last_mut() {
                        parent.kids.push(done);
                    }
                }
            }
            Event::Text(t) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(t.as_ref());
                }
            }
            // quick-xml reports an entity or character reference on its own
            // rather than inside the text around it, so `&amp;` and `&#8217;`
            // are put back here.
            Event::GeneralRef(r) => {
                let resolved = match r.resolve_char_ref() {
                    Ok(Some(c)) => Some(c),
                    _ => match r.as_ref() {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "apos" => Some('\''),
                        "quot" => Some('"'),
                        _ => None,
                    },
                };
                // An entity the document declared itself is not resolved
                // here, and its name is not content, so it is dropped.
                if let (Some(c), Some(top)) = (resolved, stack.last_mut()) {
                    top.text.push(c);
                }
            }
            Event::CData(c) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(c.as_ref());
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let root = stack.swap_remove(0);
    root.kids
        .into_iter()
        .find(|k| k.name == "Project")
        .ok_or_else(|| AppError::Validation(format!("{QDE} has no <Project> element")))
}

/// An open `.qdpx`: the parsed `project.qde` plus the ZIP its sources sit in.
struct Package {
    archive: zip::ZipArchive<std::fs::File>,
    /// Lower-cased entry name -> the name as stored, so `Sources` and
    /// `sources` (NVivo and MAXQDA) both resolve.
    entries: HashMap<String, String>,
    root: El,
    /// Where the `.qdpx` itself is, for a source stored beside it.
    base: std::path::PathBuf,
}

impl Package {
    fn open(path: &Path) -> Result<Self> {
        let file = std::fs::File::open(path)?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            AppError::Validation(format!(
                "{} is not a .qdpx (REFI-QDA) file: {e}",
                path.display()
            ))
        })?;
        let mut entries = HashMap::new();
        let mut qde_name: Option<String> = None;
        for i in 0..archive.len() {
            let entry = archive.by_index(i).map_err(zip_err)?;
            if !entry.is_file() {
                continue;
            }
            let name = entry.name().replace('\\', "/");
            let name = name.trim_start_matches("./").to_string();
            let lower = name.to_ascii_lowercase();
            // `project.qde` is the usual name, but the standard only asks for
            // one `.qde` at the root.
            if lower == QDE || (qde_name.is_none() && lower.ends_with(".qde")) {
                qde_name = Some(name.clone());
            }
            entries.insert(lower, name);
        }
        let qde_name = qde_name.ok_or_else(|| {
            AppError::Validation(format!(
                "{} holds no project.qde, so it is not a REFI-QDA project",
                path.display()
            ))
        })?;
        let mut xml = String::new();
        archive
            .by_name(&qde_name)
            .map_err(zip_err)?
            .read_to_string(&mut xml)
            .map_err(|e| AppError::Validation(format!("{qde_name} is not UTF-8 text: {e}")))?;
        let root = parse_qde(&xml)?;
        Ok(Self {
            archive,
            entries,
            root,
            base: path.parent().unwrap_or(Path::new(".")).to_path_buf(),
        })
    }

    /// The bytes a `plainTextPath` / `path` attribute names: inside the ZIP
    /// for `internal://`, otherwise beside the `.qdpx` or at an absolute path.
    fn source_bytes(&mut self, attr: &str) -> Option<Vec<u8>> {
        let attr = attr.trim();
        if attr.is_empty() {
            return None;
        }
        let inside = attr.strip_prefix(INTERNAL).map(|rest| {
            rest.trim_start_matches('/')
                .replace('\\', "/")
                .to_ascii_lowercase()
        });
        if let Some(file) = inside {
            let bare = file.rsplit('/').next().unwrap_or(&file).to_string();
            for candidate in [format!("sources/{bare}"), bare.clone(), file.clone()] {
                if let Some(name) = self.entries.get(&candidate).cloned() {
                    let mut bytes = vec![];
                    if self
                        .archive
                        .by_name(&name)
                        .ok()?
                        .read_to_end(&mut bytes)
                        .is_ok()
                    {
                        return Some(bytes);
                    }
                }
            }
            return None;
        }
        std::fs::read(self.external_path(attr)?).ok()
    }

    /// The file on disk a non-`internal://` path attribute names: absolute as
    /// written, or relative to the `.qdpx`. `None` for an empty or internal
    /// path, or for a file that is not there.
    ///
    /// Audio and video are imported **by reference**, so for them this is the
    /// whole story: the path is what the document keeps.
    fn external_path(&self, attr: &str) -> Option<std::path::PathBuf> {
        let attr = attr.trim();
        if attr.is_empty() || attr.starts_with(INTERNAL) {
            return None;
        }
        let cleaned = attr.trim_start_matches("file://");
        let direct = Path::new(cleaned);
        let candidate = if direct.is_absolute() {
            direct.to_path_buf()
        } else {
            self.base.join(direct)
        };
        candidate.is_file().then_some(candidate)
    }
}

/// Every `Code` in a `CodeBook`, depth first, with its parent's GUID.
fn walk_codes<'a>(parent: Option<String>, el: &'a El, out: &mut Vec<(Option<String>, &'a El)>) {
    for code in el.all("Code") {
        out.push((parent.clone(), code));
        walk_codes(Some(id_of(code.attr_or("guid"))), code, out);
    }
}

/// The `Codes` element, wherever the writer put it: `CodeBook/Codes` is the
/// standard, but a bare `Codes` under `Project` turns up too.
fn codes_element(root: &El) -> Option<&El> {
    root.first("CodeBook")
        .and_then(|b| b.first("Codes"))
        .or_else(|| root.first("Codes"))
}

fn source_elements(root: &El) -> Vec<&El> {
    root.first("Sources")
        .map(|s| s.kids.iter().collect())
        .unwrap_or_default()
}

/// A text source read out of the package, normalized, with the bridge from a
/// REFI-QDA offset to a Misket one.
struct IncomingText {
    text: String,
    /// Code point offset in the shipped file -> code point offset in `text`.
    map: Vec<i64>,
    /// Code point boundaries of the shipped file, in UTF-16 code units.
    units: Vec<i64>,
}

impl IncomingText {
    fn from_raw(raw: &str) -> Self {
        let units = text::utf16_offsets(raw);
        let (text, map) = text::normalize_mapped(raw);
        Self { text, map, units }
    }

    /// A `startPosition` / `endPosition` as a Misket code point offset.
    fn at(&self, refi_units: i64) -> i64 {
        let raw_cp = text::utf16_to_cp(&self.units, refi_units);
        let i = (raw_cp.max(0) as usize).min(self.map.len().saturating_sub(1));
        self.map.get(i).copied().unwrap_or(0)
    }
}

// ----------------------------------------------------------------- preview

/// What importing `path` would bring in. Reads the file and writes nothing.
pub fn preview_refi(conn: &Connection, path: &Path) -> Result<RefiPreview> {
    let pack = Package::open(path)?;
    let root = &pack.root;
    let mut out = RefiPreview {
        project_name: root.attr_or("name").to_string(),
        origin: root.attr_or("origin").to_string(),
        ..Default::default()
    };

    if let Some(codes) = codes_element(root) {
        let mut flat = vec![];
        walk_codes(None, codes, &mut flat);
        out.codes = flat.len() as i64;
    }
    out.users = root
        .first("Users")
        .map(|u| u.all("User").count() as i64)
        .unwrap_or(0);
    out.notes = root
        .first("Notes")
        .map(|n| n.all("Note").count() as i64)
        .unwrap_or(0);
    out.variables = root
        .first("Variables")
        .map(|v| v.all("Variable").count() as i64)
        .unwrap_or(0);
    out.sets = root
        .first("Sets")
        .map(|s| s.all("Set").count() as i64)
        .unwrap_or(0);

    let mut unsupported: Vec<String> = vec![];
    for source in source_elements(root) {
        let name = source_label(source);
        match source.name.as_str() {
            "TextSource" => {
                if source.attr("plainTextPath").is_some()
                    || !source.child_text("PlainTextContent").is_empty()
                {
                    out.text_sources += 1;
                    out.codings += count_codings(source);
                } else {
                    unsupported.push(format!("{name}: rich text only, with no plain text"));
                }
            }
            "PictureSource" => {
                out.picture_sources += 1;
                out.codings += count_codings(source);
            }
            other => unsupported.push(format!("{name}: {other} (Misket has no place for it yet)")),
        }
    }
    for (element, one, many) in [
        ("Cases", "case", "cases"),
        ("Links", "link", "links"),
        ("Graphs", "graph", "graphs"),
    ] {
        if let Some(el) = root.first(element) {
            let n = el.kids.len();
            if n > 0 {
                let extra = if element == "Cases" {
                    " (their variable values are kept as document attributes)"
                } else {
                    " (Misket has no equivalent)"
                };
                unsupported.push(format!("{n} {}{extra}", if n == 1 { one } else { many }));
            }
        }
    }
    out.unsupported = unsupported;

    let documents: i64 = conn.query_row("SELECT count(*) FROM documents", [], |r| r.get(0))?;
    let codes: i64 = conn.query_row("SELECT count(*) FROM codes", [], |r| r.get(0))?;
    out.project_has_content = documents > 0 || codes > 0;
    Ok(out)
}

/// How a source reads in a report sentence.
fn source_label(source: &El) -> String {
    let name = source.attr_or("name");
    if name.is_empty() {
        format!("{} {}", source.name, source.attr_or("guid"))
    } else {
        format!("\u{201C}{name}\u{201D}")
    }
}

/// Every `Coding` under a source, whether on the source itself or on one of
/// its selections.
fn count_codings(source: &El) -> i64 {
    let mut n = source.all("Coding").count() as i64;
    for kid in &source.kids {
        if kid.name.ends_with("Selection") {
            n += kid.all("Coding").count() as i64;
        }
    }
    n
}

// ------------------------------------------------------------ image headers

/// `(width, height, mime)` read out of an image's header.
///
/// Misket stores PNG, JPEG and WebP, and a `.qdpx` arrives with no size in
/// it — the desktop app measures an image in the webview, which is not
/// available here — so the three headers are read directly.
fn image_info(bytes: &[u8]) -> Option<(i64, i64, &'static str)> {
    let be32 = |at: usize| -> Option<i64> {
        let b = bytes.get(at..at + 4)?;
        Some(i64::from(u32::from_be_bytes([b[0], b[1], b[2], b[3]])))
    };
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((be32(16)?, be32(20)?, "image/png"));
    }
    if bytes.starts_with(b"\xff\xd8") {
        let mut i = 2usize;
        while i + 8 < bytes.len() {
            if bytes[i] != 0xff {
                i += 1;
                continue;
            }
            let marker = bytes[i + 1];
            // Start-of-frame, in any of its flavours, carries the size.
            if (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
                let h = i64::from(u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]));
                let w = i64::from(u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]));
                return Some((w, h, "image/jpeg"));
            }
            let len = usize::from(u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]));
            i += 2 + len.max(2);
        }
        return None;
    }
    if bytes.len() > 30 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        let chunk = &bytes[12..16];
        let d = &bytes[20..];
        let le24 = |at: usize| -> Option<i64> {
            let b = d.get(at..at + 3)?;
            Some(i64::from(u32::from_le_bytes([b[0], b[1], b[2], 0])))
        };
        match chunk {
            b"VP8X" => return Some((le24(4)? + 1, le24(7)? + 1, "image/webp")),
            b"VP8 " => {
                let b = d.get(6..10)?;
                let w = i64::from(u16::from_le_bytes([b[0], b[1]]) & 0x3fff);
                let h = i64::from(u16::from_le_bytes([b[2], b[3]]) & 0x3fff);
                return Some((w, h, "image/webp"));
            }
            b"VP8L" => {
                let b = d.get(1..5)?;
                let bits = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                return Some((
                    i64::from(bits & 0x3fff) + 1,
                    i64::from((bits >> 14) & 0x3fff) + 1,
                    "image/webp",
                ));
            }
            _ => return None,
        }
    }
    None
}

// ------------------------------------------------------------------ import

/// An id from the file, or a fresh one when it is missing or already in use.
fn free_id(wanted: &str, taken: &mut HashSet<String>) -> String {
    let id = if wanted.is_empty() || taken.contains(wanted) {
        util::new_id()
    } else {
        wanted.to_string()
    };
    taken.insert(id.clone());
    id
}

/// `#abc` and `#AABBCC` both become `#AABBCC`; anything else is not a colour.
fn hex_color(raw: &str) -> Option<String> {
    let s = raw.trim();
    let body = s.strip_prefix('#')?;
    if !body.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match body.len() {
        6 => Some(format!("#{}", body.to_ascii_uppercase())),
        3 => {
            let d: Vec<char> = body.to_ascii_uppercase().chars().collect();
            Some(format!("#{}{}{}{}{}{}", d[0], d[0], d[1], d[1], d[2], d[2]))
        }
        _ => None,
    }
}

/// Which Misket descriptor kind a `typeOfVariable` becomes, with the choice
/// options we may have written into its `Description` on the way out.
fn field_kind(type_of: &str, description: &str) -> (String, Vec<String>) {
    let mut options: Vec<String> = vec![];
    for para in description.split("\n\n") {
        let trimmed = para.trim();
        if let Some(rest) = trimmed.strip_prefix(OPTIONS_LABEL) {
            options = rest
                .split('|')
                .map(|o| o.trim().to_string())
                .filter(|o| !o.is_empty())
                .collect();
        }
    }
    match type_of.trim() {
        "Integer" | "Float" => ("number".to_string(), vec![]),
        "Date" => ("date".to_string(), vec![]),
        _ if !options.is_empty() => ("choice".to_string(), options),
        // Boolean and DateTime have no Misket kind; their values are still
        // readable as text, which is better than dropping them.
        _ => ("text".to_string(), vec![]),
    }
}

/// The value inside a `VariableValue`, whichever of the six elements it used.
fn variable_value(el: &El) -> Option<String> {
    for name in [
        "TextValue",
        "IntegerValue",
        "FloatValue",
        "DateValue",
        "DateTimeValue",
        "BooleanValue",
    ] {
        if let Some(v) = el.first(name) {
            return Some(v.text.trim().to_string());
        }
    }
    None
}

/// Record one node and run it, exactly as `db::merge` does: the payload is
/// both what happens now and what a redo replays.
#[allow(clippy::too_many_arguments)]
fn step(
    conn: &Connection,
    kind: &str,
    target_kind: &str,
    target_id: Option<&str>,
    summary: &str,
    detail: Value,
    forward: Value,
    inverse: Value,
    blobs: &[(&str, &[u8])],
) -> Result<()> {
    let id = history::record_with_blobs(
        conn,
        &activity::actor(conn),
        kind,
        target_kind,
        target_id,
        summary,
        &detail,
        Some(forward),
        Some(inverse),
        blobs,
    )?;
    if id == 0 {
        return Ok(());
    }
    let node = history::get(conn, id)?;
    history::apply_forward(conn, &node)
}

/// Read a `.qdpx` into the open project as one undoable step.
///
/// `Merge` matches documents by content and codes by their full name path;
/// `Replace` is only allowed into a project with no documents and no codes,
/// and brings everything in under the file's own GUIDs — so a project
/// exported and imported back into an empty file comes out identical.
pub fn import_refi(
    conn: &Connection,
    path: &Path,
    mode: RefiImportMode,
) -> Result<RefiImportReport> {
    let mut pack = Package::open(path)?;
    if mode == RefiImportMode::Replace {
        let content: i64 = conn.query_row(
            "SELECT (SELECT count(*) FROM documents) + (SELECT count(*) FROM codes)",
            [],
            |r| r.get(0),
        )?;
        if content > 0 {
            return Err(AppError::Conflict(
                "\"replace\" can only import into a project with no documents and no codes; \
                 import into a new project, or choose \"merge\""
                    .into(),
            ));
        }
    }
    let project_name = pack.root.attr_or("name").trim().to_string();
    let label = if project_name.is_empty() {
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "a REFI-QDA project".into())
    } else {
        project_name.clone()
    };
    let opening = format!("Imported the REFI-QDA project \u{201C}{label}\u{201D}");
    history::group(conn, &opening, |conn| {
        let tx = util::tx(conn)?;
        let report = execute_import(&tx, &mut pack, mode, &label)?;
        history::relabel_group(&tx, &report.summary)?;
        tx.commit()?;
        Ok(report)
    })
}

/// A source that became a document, with what a selection on it needs.
struct Landed<'a> {
    el: &'a El,
    doc_id: String,
    /// Text sources only: the text and the offset bridge.
    text: Option<IncomingText>,
    width: i64,
    height: i64,
    /// Audio and video sources only: how long the recording is known to be,
    /// in milliseconds. `0` means "not measured yet" — a `.qdpx` records no
    /// duration, so the viewer fills it in the first time the document is
    /// opened (`db::media::set_measured`).
    duration_ms: i64,
}

/// What a memo is about: `(document, code, excerpt)`, all three absent for a
/// memo about the project itself, exactly as `memos` stores it.
type NoteTarget = (Option<String>, Option<String>, Option<String>);

/// A selection on its way in, before it is known whether the document
/// already has an excerpt over the same words.
struct Pending {
    /// Identifies the passage within its document, for the de-duplication
    /// two tools' overlapping selections need.
    key: String,
    kind: &'static str,
    start: Option<i64>,
    end: Option<i64>,
    geometry: Option<String>,
    snapshot: Option<String>,
    /// Every GUID the file gave this passage, so a `NoteRef` finds it.
    refi_ids: Vec<String>,
    created_at: String,
    updated_at: String,
    /// `(code id, coder id, created at)`.
    tags: Vec<(String, String, String)>,
}

/// An `xsd:dateTime` from the file if it looks like one, else `fallback`.
/// Misket timestamps are RFC 3339, which is the same shape.
fn timestamp(raw: &str, fallback: &str) -> String {
    let s = raw.trim();
    let looks_right = s.len() >= 16
        && s.as_bytes().get(4) == Some(&b'-')
        && s.as_bytes().get(7) == Some(&b'-')
        && (s.as_bytes().get(10) == Some(&b'T') || s.as_bytes().get(10) == Some(&b' '));
    if looks_right {
        s.to_string()
    } else {
        fallback.to_string()
    }
}

/// What to call a source: its `name`, else the file it points at, else a
/// generic label, because `documents.name` may not be empty.
fn document_name(el: &El, fallback: &str) -> String {
    let named = el.attr_or("name").trim();
    if !named.is_empty() {
        return named.to_string();
    }
    for key in ["plainTextPath", "path", "currentPath"] {
        if let Some(p) = el.attr(key) {
            let file = p.trim_start_matches(INTERNAL).replace('\\', "/");
            let base = file.rsplit('/').next().unwrap_or("").trim();
            if !base.is_empty() {
                return base.to_string();
            }
        }
    }
    fallback.to_string()
}

fn next_document_order(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM documents",
        [],
        |r| r.get(0),
    )?)
}

/// How an existing excerpt is keyed against an incoming [`Pending`].
fn range_key(e: &ExcerptWithCodes) -> String {
    match e.kind.as_str() {
        "image_region" => format!("r:{}", e.geometry.clone().unwrap_or_default()),
        // Text offsets are code points and media offsets are milliseconds, so
        // the two have to be told apart or a re-import of a recording would
        // look for a text range that is not there.
        "video_range" => format!("v:{}:{}", e.start_pos.unwrap_or(0), e.end_pos.unwrap_or(0)),
        _ => format!("t:{}:{}", e.start_pos.unwrap_or(0), e.end_pos.unwrap_or(0)),
    }
}

/// `(code id, coder id, created at)` for every `Coding` under `el` whose code
/// we imported. A coding pointing at a code that is not in the codebook has
/// nothing to attach to, so it is dropped.
fn codings_of(
    el: &El,
    code_of: &HashMap<String, String>,
    coder_for: &impl Fn(&str) -> String,
    fallback_at: &str,
) -> Vec<(String, String, String)> {
    let mut out = vec![];
    for coding in el.all("Coding") {
        let Some(target) = coding.first("CodeRef").and_then(|r| r.attr("targetGUID")) else {
            continue;
        };
        let Some(code_id) = code_of.get(&id_of(target)) else {
            continue;
        };
        out.push((
            code_id.clone(),
            coder_for(coding.attr_or("creatingUser")),
            timestamp(coding.attr_or("creationDateTime"), fallback_at),
        ));
    }
    out
}

/// The passage a `Coding` on the source itself means: all of it.
fn whole_source_pending(
    l: &Landed<'_>,
    doc_len: i64,
    now: &str,
    tags: Vec<(String, String, String)>,
) -> Result<Option<Pending>> {
    match &l.text {
        Some(incoming) if doc_len > 0 => Ok(Some(Pending {
            key: format!("t:0:{doc_len}"),
            kind: "text",
            start: Some(0),
            end: Some(doc_len),
            geometry: None,
            snapshot: Some(incoming.text.clone()),
            refi_ids: vec![],
            created_at: now.to_string(),
            updated_at: now.to_string(),
            tags,
        })),
        None if l.width > 0 && l.height > 0 => {
            let rect = Rect {
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
            };
            let geometry = excerpts::canonical_geometry(&rect)?;
            Ok(Some(Pending {
                key: format!("r:{geometry}"),
                kind: "image_region",
                start: None,
                end: None,
                geometry: Some(geometry),
                snapshot: Some(excerpts::region_snapshot(&rect)),
                refi_ids: vec![],
                created_at: now.to_string(),
                updated_at: now.to_string(),
                tags,
            }))
        }
        // A `Coding` on the recording itself codes all of it — but only when
        // something knows how long it is. A `.qdpx` does not say, so this is
        // usually a document already in the project, measured before.
        None if l.duration_ms > 0 => Ok(Some(Pending {
            key: format!("v:0:{}", l.duration_ms),
            kind: "video_range",
            start: Some(0),
            end: Some(l.duration_ms),
            geometry: None,
            snapshot: Some(media::range_label(0, l.duration_ms)),
            refi_ids: vec![],
            created_at: now.to_string(),
            updated_at: now.to_string(),
            tags,
        })),
        _ => Ok(None),
    }
}

/// Every field id in order, with `appended` (a field about to be created)
/// last, so a `DescriptorOp::Field` lands the new one at the end.
fn field_order(conn: &Connection, appended: Option<&str>) -> Result<Vec<String>> {
    let mut ids: Vec<String> = descriptors::list_fields(conn)?
        .into_iter()
        .map(|f| f.id)
        .collect();
    if let Some(id) = appended {
        if !ids.iter().any(|i| i == id) {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

#[allow(clippy::too_many_lines)]
fn execute_import(
    conn: &Connection,
    pack: &mut Package,
    mode: RefiImportMode,
    label: &str,
) -> Result<RefiImportReport> {
    // The tree is small (the sources are files beside it), and owning it
    // leaves `pack` free to be borrowed for reading those files.
    let root = pack.root.clone();
    let merge = mode == RefiImportMode::Merge;
    let now = util::now();
    let local = history::local_coder(conn);
    let mut report = RefiImportReport {
        project_name: root.attr_or("name").trim().to_string(),
        ..Default::default()
    };

    // -------------------------------------------------------------- users
    let mut known_coders: HashSet<String> = HashSet::new();
    let mut new_coders: Vec<Coder> = vec![];
    for u in root.first("Users").into_iter().flat_map(|e| e.all("User")) {
        let id = id_of(u.attr_or("guid"));
        if id.is_empty() || !known_coders.insert(id.clone()) {
            continue;
        }
        let mut name = u.attr_or("name").trim().to_string();
        if name.is_empty() {
            name = u.attr_or("id").trim().to_string();
        }
        if name.is_empty() {
            name = format!("Coder {}", &id[..id.len().min(8)]);
        }
        // An id this project already knows keeps the name and colour it has:
        // that is the coder's own identity, not the exporting tool's idea
        // of it.
        if coders::get(conn, &id)?.is_none() {
            new_coders.push(Coder {
                id,
                name,
                color: coders::color_for(u.attr_or("guid")),
                created_at: now.clone(),
            });
        }
    }
    report.coders = new_coders.len() as i64;
    let coder_for = |attr: &str| -> String {
        let id = id_of(attr);
        if !id.is_empty() && known_coders.contains(&id) {
            id
        } else {
            // A coding whose user the file never declared is ours: it
            // arrived on this machine, and nothing else can be said.
            local.clone()
        }
    };

    step(
        conn,
        "project.refi_imported",
        "project",
        None,
        &format!("Imported the REFI-QDA project \u{201C}{label}\u{201D}"),
        json!({
            "projectName": report.project_name,
            "origin": root.attr_or("origin"),
            "mode": if merge { "merge" } else { "replace" },
        }),
        history::payload(&PullChange {
            coders: new_coders.clone(),
            ..Default::default()
        }),
        history::payload(&PullChange {
            drop_coders: new_coders.iter().map(|c| c.id.clone()).collect(),
            ..Default::default()
        }),
        &[],
    )?;

    // -------------------------------------------------------------- codes
    let existing_codes = codes::list(conn)?;
    let existing_paths = export::code_paths(&existing_codes);
    let by_lower_path: HashMap<String, String> = if merge {
        existing_codes
            .iter()
            .filter_map(|c| {
                existing_paths
                    .get(&c.id)
                    .map(|p| (p.to_lowercase(), c.id.clone()))
            })
            .collect()
    } else {
        HashMap::new()
    };
    let mut taken_code_ids: HashSet<String> = existing_codes.iter().map(|c| c.id.clone()).collect();
    // (parent key, lower-cased name) -> our code id, so two codes the file
    // puts side by side under one name become one code rather than a
    // constraint violation.
    let mut sibling: HashMap<(String, String), String> = existing_codes
        .iter()
        .map(|c| {
            (
                (
                    c.parent_id.clone().unwrap_or_default(),
                    c.name.to_lowercase(),
                ),
                c.id.clone(),
            )
        })
        .collect();
    let mut next_code_order: HashMap<String, i64> = HashMap::new();
    for c in &existing_codes {
        let key = c.parent_id.clone().unwrap_or_default();
        let at = next_code_order.entry(key).or_insert(0);
        *at = (*at).max(c.sort_order + 1);
    }

    let mut flat: Vec<(Option<String>, &El)> = vec![];
    if let Some(el) = codes_element(&root) {
        walk_codes(None, el, &mut flat);
    }
    let mut code_of: HashMap<String, String> = HashMap::new();
    let mut refi_code_path: HashMap<String, String> = HashMap::new();
    let mut new_code_rows: Vec<CodeRow> = vec![];
    let mut wanted_examples: Vec<(String, String)> = vec![];
    let mut unsupported: Vec<String> = vec![];
    let mut palette_at = existing_codes.len();
    for (parent, el) in &flat {
        let refi_id = id_of(el.attr_or("guid"));
        let name = el.attr_or("name").trim().to_string();
        if name.is_empty() {
            unsupported.push(format!("a code with no name ({})", el.attr_or("guid")));
            continue;
        }
        let path = match parent.as_ref().and_then(|p| refi_code_path.get(p)) {
            Some(p) => format!("{p} / {name}"),
            None => name.clone(),
        };
        if !refi_id.is_empty() {
            refi_code_path.insert(refi_id.clone(), path.clone());
        }
        if let Some(id) = by_lower_path.get(&path.to_lowercase()) {
            report.matched_codes += 1;
            code_of.insert(refi_id, id.clone());
            continue;
        }
        let our_parent = parent.as_ref().and_then(|p| code_of.get(p).cloned());
        let key = (our_parent.clone().unwrap_or_default(), name.to_lowercase());
        if let Some(id) = sibling.get(&key) {
            code_of.insert(refi_id, id.clone());
            continue;
        }
        let (description, inclusion, exclusion, example) =
            split_description(el.child_text("Description"));
        let color = hex_color(el.attr_or("color")).unwrap_or_else(|| {
            let c = codes::PALETTE[palette_at % codes::PALETTE.len()].to_string();
            palette_at += 1;
            c
        });
        let id = free_id(&refi_id, &mut taken_code_ids);
        let order = next_code_order
            .entry(our_parent.clone().unwrap_or_default())
            .or_insert(0);
        let sort_order = *order;
        *order += 1;
        if el.attr_or("isCodable").eq_ignore_ascii_case("false") {
            unsupported.push(format!(
                "\u{201C}{name}\u{201D} is a category, not a code; Misket imports it as a code"
            ));
        }
        new_code_rows.push(CodeRow {
            id: id.clone(),
            parent_id: our_parent,
            name,
            color,
            description,
            inclusion,
            exclusion,
            shortcut: None,
            weight_scale: None,
            sort_order,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
        sibling.insert(key, id.clone());
        if let Some(guid) = example_guid(&example) {
            wanted_examples.push((id.clone(), id_of(&guid)));
        }
        code_of.insert(refi_id, id);
    }
    report.codes = new_code_rows.len() as i64;
    if !new_code_rows.is_empty() {
        let ids: Vec<String> = new_code_rows.iter().map(|c| c.id.clone()).collect();
        step(
            conn,
            "code.created",
            "code",
            ids.first().map(String::as_str),
            &format!(
                "Imported {} code{}",
                ids.len(),
                if ids.len() == 1 { "" } else { "s" }
            ),
            json!({ "count": ids.len(), "from": label }),
            history::payload(&CodeOp::Restore {
                snapshot: CodeTreeSnapshot {
                    codes: new_code_rows.clone(),
                    ..Default::default()
                },
                reparent: vec![],
                remove_tags: vec![],
            }),
            history::payload(&CodeOp::Drop {
                code_ids: ids.clone(),
            }),
            &[],
        )?;
    }

    // ---------------------------------------------------------- variables
    let mut field_of: HashMap<String, String> = HashMap::new();
    let existing_fields = descriptors::list_fields(conn)?;
    let mut field_by_name: HashMap<String, String> = existing_fields
        .iter()
        .map(|f| (f.name.to_lowercase(), f.id.clone()))
        .collect();
    let mut taken_field_ids: HashSet<String> =
        existing_fields.iter().map(|f| f.id.clone()).collect();
    for v in root
        .first("Variables")
        .into_iter()
        .flat_map(|e| e.all("Variable"))
    {
        let refi_id = id_of(v.attr_or("guid"));
        let name = v.attr_or("name").trim().to_string();
        if name.is_empty() {
            continue;
        }
        if let Some(id) = field_by_name.get(&name.to_lowercase()) {
            field_of.insert(refi_id, id.clone());
            continue;
        }
        let (kind, options) = field_kind(v.attr_or("typeOfVariable"), v.child_text("Description"));
        let id = free_id(&refi_id, &mut taken_field_ids);
        let field = DescriptorField {
            id: id.clone(),
            name: name.clone(),
            kind,
            options,
            sort_order: 0,
            value_count: 0,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let order = field_order(conn, Some(&id))?;
        let before = field_order(conn, None)?;
        step(
            conn,
            "descriptor.field_created",
            "descriptor_field",
            Some(&id),
            &format!("Imported the attribute \u{201C}{name}\u{201D}"),
            json!({ "name": name, "from": label }),
            history::payload(&DescriptorOp::Field {
                field: Box::new(field),
                values: None,
                order,
            }),
            history::payload(&DescriptorOp::DropField {
                field_id: id.clone(),
                order: before,
            }),
            &[],
        )?;
        report.descriptor_fields += 1;
        field_by_name.insert(name.to_lowercase(), id.clone());
        field_of.insert(refi_id, id);
    }

    // ------------------------------------------------------------ sources
    let mut taken_doc_ids: HashSet<String> = HashSet::new();
    let mut by_hash: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, content_hash FROM documents")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (id, hash) = row?;
            taken_doc_ids.insert(id.clone());
            if merge {
                by_hash.insert(hash, id);
            }
        }
    }

    let mut landed: Vec<Landed<'_>> = vec![];
    let mut document_of: HashMap<String, String> = HashMap::new();
    for source in source_elements(&root) {
        let shown = source_label(source);
        let refi_id = id_of(source.attr_or("guid"));
        let created = timestamp(source.attr_or("creationDateTime"), &now);
        let updated = timestamp(source.attr_or("modifiedDateTime"), &created);
        match source.name.as_str() {
            "TextSource" => {
                let inline = source.child_text("PlainTextContent").to_string();
                let raw = if !inline.trim().is_empty() {
                    Some(inline)
                } else {
                    source
                        .attr("plainTextPath")
                        .and_then(|p| pack.source_bytes(p))
                        .map(|b| String::from_utf8_lossy(&b).into_owned())
                };
                let Some(raw) = raw else {
                    unsupported.push(format!(
                        "{shown}: no plain text alongside the rich text, so it was skipped"
                    ));
                    continue;
                };
                let incoming = IncomingText::from_raw(&raw);
                let hash = text::sha256_hex(incoming.text.as_bytes());
                if let Some(id) = by_hash.get(&hash).cloned() {
                    report.matched_documents += 1;
                    document_of.insert(refi_id, id.clone());
                    landed.push(Landed {
                        el: source,
                        doc_id: id,
                        text: Some(incoming),
                        width: 0,
                        height: 0,
                        duration_ms: 0,
                    });
                    continue;
                }
                let name = document_name(source, "Text source");
                let id = free_id(&refi_id, &mut taken_doc_ids);
                let format = match super::transcripts::get_default(conn)? {
                    Some(d) => d,
                    None => crate::text::transcript::detect_format(&incoming.text)
                        .map(|(f, _)| f)
                        .unwrap_or_else(crate::text::transcript::TranscriptFormat::none),
                };
                let stored = StoredTranscript::of(&incoming.text, format);
                let snapshot = DocumentSnapshot {
                    id: id.clone(),
                    kind: "text".into(),
                    name: name.clone(),
                    source_format: Some("txt".into()),
                    content_hash: hash.clone(),
                    text_length: Some(text::cp_len(&incoming.text)),
                    sort_order: next_document_order(conn)?,
                    transcript_json: Some(serde_json::to_string(&stored)?),
                    created_at: created,
                    updated_at: updated,
                    ..Default::default()
                };
                step(
                    conn,
                    "document.imported",
                    "document",
                    Some(&id),
                    &format!("Imported the text source \u{201C}{name}\u{201D}"),
                    json!({ "name": name, "from": label }),
                    history::payload(&DocumentOp::Restore {
                        snapshot: Box::new(snapshot),
                    }),
                    history::payload(&DocumentOp::Drop {
                        document_id: id.clone(),
                    }),
                    &[("text", incoming.text.as_bytes())],
                )?;
                report.documents += 1;
                by_hash.insert(hash, id.clone());
                document_of.insert(refi_id, id.clone());
                landed.push(Landed {
                    el: source,
                    doc_id: id,
                    text: Some(incoming),
                    width: 0,
                    height: 0,
                    duration_ms: 0,
                });
            }
            "PictureSource" => {
                let bytes = source
                    .attr("path")
                    .or_else(|| source.attr("currentPath"))
                    .and_then(|p| pack.source_bytes(p));
                let Some(bytes) = bytes else {
                    unsupported.push(format!("{shown}: the picture file is not in the package"));
                    continue;
                };
                let Some((width, height, mime)) = image_info(&bytes) else {
                    unsupported.push(format!(
                        "{shown}: Misket reads PNG, JPEG and WebP pictures, and could not read this one"
                    ));
                    continue;
                };
                if width <= 0 || height <= 0 {
                    unsupported.push(format!("{shown}: the picture has no readable size"));
                    continue;
                }
                let hash = text::sha256_hex(&bytes);
                if let Some(id) = by_hash.get(&hash).cloned() {
                    report.matched_documents += 1;
                    document_of.insert(refi_id, id.clone());
                    landed.push(Landed {
                        el: source,
                        doc_id: id,
                        text: None,
                        width,
                        height,
                        duration_ms: 0,
                    });
                    continue;
                }
                let name = document_name(source, "Picture source");
                let id = free_id(&refi_id, &mut taken_doc_ids);
                let media = serde_json::to_string(&crate::models::MediaInfo {
                    width: Some(width),
                    height: Some(height),
                    mime: mime.to_string(),
                    size_bytes: Some(bytes.len() as i64),
                    ..Default::default()
                })?;
                let stored =
                    StoredTranscript::of("", crate::text::transcript::TranscriptFormat::none());
                let snapshot = DocumentSnapshot {
                    id: id.clone(),
                    kind: "image".into(),
                    name: name.clone(),
                    source_format: Some(
                        super::documents::IMAGE_MIMES
                            .iter()
                            .find(|(m, _)| *m == mime)
                            .map(|(_, f)| (*f).to_string())
                            .unwrap_or_else(|| "png".into()),
                    ),
                    content_hash: hash.clone(),
                    media_json: Some(media),
                    media_mime: Some(mime.to_string()),
                    sort_order: next_document_order(conn)?,
                    transcript_json: Some(serde_json::to_string(&stored)?),
                    created_at: created,
                    updated_at: updated,
                    ..Default::default()
                };
                step(
                    conn,
                    "document.imported",
                    "document",
                    Some(&id),
                    &format!("Imported the picture source \u{201C}{name}\u{201D}"),
                    json!({ "name": name, "from": label }),
                    history::payload(&DocumentOp::Restore {
                        snapshot: Box::new(snapshot),
                    }),
                    history::payload(&DocumentOp::Drop {
                        document_id: id.clone(),
                    }),
                    &[("media", bytes.as_slice())],
                )?;
                report.documents += 1;
                by_hash.insert(hash, id.clone());
                document_of.insert(refi_id, id.clone());
                landed.push(Landed {
                    el: source,
                    doc_id: id,
                    text: None,
                    width,
                    height,
                    duration_ms: 0,
                });
            }
            // Audio and video come in **by reference**: the `.qdpx` names a
            // file, the project remembers where it is, and none of it is
            // copied into the project file (`db::media`). A `.qdpx` records
            // no duration, so the document starts without one and the viewer
            // measures the file the first time it is opened.
            "AudioSource" | "VideoSource" => {
                let attr = source
                    .attr("path")
                    .or_else(|| source.attr("currentPath"))
                    .unwrap_or("")
                    .to_string();
                let Some(file) = pack.external_path(&attr) else {
                    unsupported.push(if attr.trim().is_empty() {
                        format!("{shown}: a recording with no file path")
                    } else if attr.trim().starts_with(INTERNAL) {
                        format!(
                            "{shown}: the recording is packed inside the .qdpx, and Misket keeps \
                             audio and video on disk — unzip it and import the file"
                        )
                    } else {
                        format!("{shown}: no file at {}", attr.trim())
                    });
                    continue;
                };
                let Some(mime) = media::mime_for_path(&file) else {
                    unsupported.push(format!(
                        "{shown}: Misket does not read {} files",
                        file.extension()
                            .map(|e| e.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "these".into())
                    ));
                    continue;
                };
                let hash = media::file_hash(&file)?;
                if let Some(id) = by_hash.get(&hash).cloned() {
                    report.matched_documents += 1;
                    document_of.insert(refi_id, id.clone());
                    let known = super::documents::get_summary(conn, &id)?
                        .media
                        .and_then(|m| m.duration_ms)
                        .unwrap_or_default();
                    landed.push(Landed {
                        el: source,
                        doc_id: id,
                        text: None,
                        width: 0,
                        height: 0,
                        duration_ms: known,
                    });
                    continue;
                }
                let name = document_name(source, "Recording");
                let id = free_id(&refi_id, &mut taken_doc_ids);
                let media_json = serde_json::to_string(&crate::models::MediaInfo {
                    mime: mime.to_string(),
                    size_bytes: file.metadata().ok().map(|m| m.len() as i64),
                    file_hash: Some(hash.clone()),
                    ..Default::default()
                })?;
                let stored =
                    StoredTranscript::of("", crate::text::transcript::TranscriptFormat::none());
                let snapshot = DocumentSnapshot {
                    id: id.clone(),
                    kind: super::documents::MEDIA_KIND.into(),
                    name: name.clone(),
                    source_path: Some(file.to_string_lossy().into_owned()),
                    source_format: media::MEDIA_MIMES
                        .iter()
                        .find(|(m, _)| *m == mime)
                        .map(|(_, f)| (*f).to_string()),
                    content_hash: hash.clone(),
                    media_json: Some(media_json),
                    sort_order: next_document_order(conn)?,
                    transcript_json: Some(serde_json::to_string(&stored)?),
                    created_at: created,
                    updated_at: updated,
                    ..Default::default()
                };
                step(
                    conn,
                    "document.imported",
                    "document",
                    Some(&id),
                    &format!("Imported the recording \u{201C}{name}\u{201D}"),
                    json!({ "name": name, "from": label, "sourcePath": snapshot.source_path }),
                    history::payload(&DocumentOp::Restore {
                        snapshot: Box::new(snapshot),
                    }),
                    history::payload(&DocumentOp::Drop {
                        document_id: id.clone(),
                    }),
                    // Nothing: the bytes never enter the project file.
                    &[],
                )?;
                report.documents += 1;
                by_hash.insert(hash, id.clone());
                document_of.insert(refi_id, id.clone());
                landed.push(Landed {
                    el: source,
                    doc_id: id,
                    text: None,
                    width: 0,
                    height: 0,
                    duration_ms: 0,
                });
            }
            other => unsupported.push(format!(
                "{shown}: {} {other} — Misket imports text, picture, audio and video sources",
                if other.starts_with(['A', 'E', 'I', 'O', 'U']) {
                    "an"
                } else {
                    "a"
                }
            )),
        }
    }

    // --------------------------------------------------------- selections
    let mut excerpt_of: HashMap<String, String> = HashMap::new();
    let mut restore: Vec<ExcerptSnapshot> = vec![];
    let mut extra_tags: Vec<TagRow> = vec![];
    let mut taken_excerpt_ids: HashSet<String> = HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT id FROM excerpts")?;
        for id in stmt.query_map([], |r| r.get::<_, String>(0))? {
            taken_excerpt_ids.insert(id?);
        }
    }
    for l in &landed {
        // What the document already carries, so a merge into a document we
        // both have adds codings rather than colliding with its excerpts.
        let mut here: HashMap<String, (String, bool)> = HashMap::new();
        for e in excerpts::list_for_document(conn, &l.doc_id)? {
            here.insert(range_key(&e), (e.id.clone(), true));
        }
        let mut pendings: Vec<Pending> = vec![];
        let doc_len = l.text.as_ref().map(|t| text::cp_len(&t.text)).unwrap_or(0);
        let is_media = l.el.name == "AudioSource" || l.el.name == "VideoSource";

        // A `Coding` on the source itself codes the whole thing.
        let whole = codings_of(l.el, &code_of, &coder_for, &now);
        if !whole.is_empty() {
            if let Some(p) = whole_source_pending(l, doc_len, &now, whole)? {
                pendings.push(p);
            }
        }
        for sel in &l.el.kids {
            if !sel.name.ends_with("Selection") {
                continue;
            }
            let tags = codings_of(sel, &code_of, &coder_for, &now);
            let refi_id = id_of(sel.attr_or("guid"));
            let created = timestamp(sel.attr_or("creationDateTime"), &now);
            let updated = timestamp(sel.attr_or("modifiedDateTime"), &created);
            match (sel.name.as_str(), l.text.as_ref()) {
                ("PlainTextSelection", Some(incoming)) => {
                    let (Some(from), Some(to)) =
                        (sel.number("startPosition"), sel.number("endPosition"))
                    else {
                        unsupported.push(format!(
                            "{}: a selection with no position",
                            source_label(l.el)
                        ));
                        continue;
                    };
                    let start = incoming.at(from.min(to)).clamp(0, doc_len);
                    let end = incoming.at(from.max(to)).clamp(0, doc_len);
                    if end <= start {
                        unsupported.push(format!(
                            "{}: an empty selection at {from}\u{2013}{to}",
                            source_label(l.el)
                        ));
                        continue;
                    }
                    pendings.push(Pending {
                        key: format!("t:{start}:{end}"),
                        kind: "text",
                        start: Some(start),
                        end: Some(end),
                        geometry: None,
                        snapshot: text::cp_slice(&incoming.text, start, end).map(str::to_string),
                        refi_ids: vec![refi_id],
                        created_at: created,
                        updated_at: updated,
                        tags,
                    });
                }
                ("PictureSelection", _) if l.width > 0 => {
                    let px = |a: Option<i64>| a.unwrap_or(0) as f64;
                    let (x1, x2) = (px(sel.number("firstX")), px(sel.number("secondX")));
                    let (y1, y2) = (px(sel.number("firstY")), px(sel.number("secondY")));
                    let rect = Rect {
                        x: (x1.min(x2) / l.width as f64).clamp(0.0, 1.0),
                        y: (y1.min(y2) / l.height as f64).clamp(0.0, 1.0),
                        w: ((x1.max(x2) - x1.min(x2)) / l.width as f64).clamp(0.0, 1.0),
                        h: ((y1.max(y2) - y1.min(y2)) / l.height as f64).clamp(0.0, 1.0),
                    };
                    if rect.w <= 0.0 || rect.h <= 0.0 {
                        unsupported.push(format!("{}: an empty region", source_label(l.el)));
                        continue;
                    }
                    let geometry = excerpts::canonical_geometry(&rect)?;
                    pendings.push(Pending {
                        key: format!("r:{geometry}"),
                        kind: "image_region",
                        start: None,
                        end: None,
                        geometry: Some(geometry),
                        snapshot: Some(excerpts::region_snapshot(&rect)),
                        refi_ids: vec![refi_id],
                        created_at: created,
                        updated_at: updated,
                        tags,
                    });
                }
                ("AudioSelection" | "VideoSelection", _) if is_media => {
                    let (Some(begin), Some(end)) = (sel.number("begin"), sel.number("end")) else {
                        unsupported.push(format!(
                            "{}: a selection with no in and out points",
                            source_label(l.el)
                        ));
                        continue;
                    };
                    let start = begin.min(end).max(0);
                    let stop = begin.max(end);
                    // A `.qdpx` carries no duration, so the only bound worth
                    // enforcing is that the stretch has a length.
                    if stop <= start {
                        unsupported.push(format!(
                            "{}: an empty stretch at {begin}\u{2013}{end} ms",
                            source_label(l.el)
                        ));
                        continue;
                    }
                    pendings.push(Pending {
                        key: format!("v:{start}:{stop}"),
                        kind: "video_range",
                        start: Some(start),
                        end: Some(stop),
                        geometry: None,
                        snapshot: Some(media::range_label(start, stop)),
                        refi_ids: vec![refi_id],
                        created_at: created,
                        updated_at: updated,
                        tags,
                    });
                }
                (other, _) => unsupported.push(format!(
                    "{}: a {other} Misket has no place for",
                    source_label(l.el)
                )),
            }
        }

        // One excerpt per distinct range or region: two selections over the
        // same words are one passage with two people's codings.
        let mut merged: Vec<Pending> = vec![];
        for p in pendings {
            match merged.iter_mut().find(|m| m.key == p.key) {
                Some(m) => {
                    m.tags.extend(p.tags);
                    m.refi_ids.extend(p.refi_ids);
                }
                None => merged.push(p),
            }
        }
        for p in merged {
            let (id, existed) = match here.get(&p.key) {
                Some((id, _)) => (id.clone(), true),
                None => (
                    free_id(
                        p.refi_ids.first().map(String::as_str).unwrap_or(""),
                        &mut taken_excerpt_ids,
                    ),
                    false,
                ),
            };
            for refi in &p.refi_ids {
                if !refi.is_empty() {
                    excerpt_of.insert(refi.clone(), id.clone());
                }
            }
            let tags: Vec<TagRow> = p
                .tags
                .iter()
                .map(|(code_id, coder_id, at)| TagRow {
                    excerpt_id: id.clone(),
                    code_id: code_id.clone(),
                    coder_id: coder_id.clone(),
                    created_at: at.clone(),
                    // REFI-QDA carries no weight of its own; a scaled code's
                    // default is for a coding made *in* Misket, not one
                    // arriving from another tool's export.
                    weight: None,
                })
                .collect();
            report.codings += tags.len() as i64;
            if existed {
                extra_tags.extend(tags);
                continue;
            }
            here.insert(p.key.clone(), (id.clone(), true));
            restore.push(ExcerptSnapshot {
                excerpt: ExcerptWithCodes {
                    id,
                    document_id: l.doc_id.clone(),
                    kind: p.kind.to_string(),
                    start_pos: p.start,
                    end_pos: p.end,
                    geometry: p.geometry,
                    snapshot: p.snapshot,
                    code_ids: vec![],
                    codings: vec![],
                    memo_count: 0,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                },
                memos: vec![],
                tags,
                // An imported video range has no captured frame yet; the
                // viewer takes one the first time the excerpt is looked at.
                thumbnail: None,
            });
        }
    }
    report.excerpts = restore.len() as i64;
    if !restore.is_empty() {
        let ids: Vec<String> = restore.iter().map(|e| e.excerpt.id.clone()).collect();
        step(
            conn,
            "excerpt.restored",
            "excerpt",
            ids.first().map(String::as_str),
            &format!(
                "Imported {} excerpt{}",
                ids.len(),
                if ids.len() == 1 { "" } else { "s" }
            ),
            json!({ "count": ids.len(), "from": label }),
            history::payload(&ExcerptChange {
                restore_excerpts: restore.clone(),
                ..Default::default()
            }),
            history::payload(&ExcerptChange {
                delete_excerpts: ids.clone(),
                ..Default::default()
            }),
            &[],
        )?;
    }
    if !extra_tags.is_empty() {
        step(
            conn,
            "bulk.codes_added",
            "excerpt",
            extra_tags.first().map(|t| t.excerpt_id.as_str()),
            &format!(
                "Imported {} coding{} onto excerpts already here",
                extra_tags.len(),
                if extra_tags.len() == 1 { "" } else { "s" }
            ),
            json!({ "count": extra_tags.len(), "from": label }),
            history::payload(&ExcerptChange {
                add_tags: extra_tags.clone(),
                ..Default::default()
            }),
            history::payload(&ExcerptChange {
                remove_tags: extra_tags.clone(),
                ..Default::default()
            }),
            &[],
        )?;
    }

    // -------------------------------------------------------------- notes
    // A note belongs to whatever pointed at it, and `NoteRef` can sit on the
    // project, a code, a source or a selection.
    let mut note_target: HashMap<String, NoteTarget> = HashMap::new();
    for id in root.note_refs() {
        note_target.insert(id, (None, None, None));
    }
    for (_, el) in &flat {
        let Some(our) = code_of.get(&id_of(el.attr_or("guid"))) else {
            continue;
        };
        for id in el.note_refs() {
            note_target.insert(id, (None, Some(our.clone()), None));
        }
    }
    for l in &landed {
        for id in l.el.note_refs() {
            note_target.insert(id, (Some(l.doc_id.clone()), None, None));
        }
        for sel in &l.el.kids {
            let Some(our) = excerpt_of.get(&id_of(sel.attr_or("guid"))) else {
                continue;
            };
            if our.is_empty() {
                continue;
            }
            for id in sel.note_refs() {
                note_target.insert(id, (None, None, Some(our.clone())));
            }
        }
    }

    let mut taken_memo_ids: HashSet<String> = HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT id FROM memos")?;
        for id in stmt.query_map([], |r| r.get::<_, String>(0))? {
            taken_memo_ids.insert(id?);
        }
    }
    let mut memos: Vec<Memo> = vec![];
    for note in root.first("Notes").into_iter().flat_map(|e| e.all("Note")) {
        let refi_id = id_of(note.attr_or("guid"));
        let body = {
            let inline = note.child_text("PlainTextContent").to_string();
            if inline.is_empty() {
                note.attr("plainTextPath")
                    .and_then(|p| pack.source_bytes(p))
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
                    .unwrap_or_default()
            } else {
                inline
            }
        };
        let body = text::normalize(&body);
        let mut title = note.attr_or("name").trim().to_string();
        if title.is_empty() {
            title = activity::elide(body.lines().next().unwrap_or(""), 60);
        }
        if title.is_empty() && body.is_empty() {
            continue;
        }
        let created = timestamp(note.attr_or("creationDateTime"), &now);
        let (document_id, code_id, excerpt_id) = note_target
            .get(&refi_id)
            .cloned()
            .unwrap_or((None, None, None));
        memos.push(Memo {
            id: free_id(&refi_id, &mut taken_memo_ids),
            document_id,
            code_id,
            excerpt_id,
            title,
            body,
            coder_id: coder_for(note.attr_or("creatingUser")),
            updated_at: timestamp(note.attr_or("modifiedDateTime"), &created),
            created_at: created,
        });
    }
    report.memos = memos.len() as i64;
    if !memos.is_empty() {
        step(
            conn,
            "memo.created",
            "memo",
            memos.first().map(|m| m.id.as_str()),
            &format!(
                "Imported {} memo{}",
                memos.len(),
                if memos.len() == 1 { "" } else { "s" }
            ),
            json!({ "count": memos.len(), "from": label }),
            history::payload(&MemoChange {
                restore: memos.clone(),
                ..Default::default()
            }),
            history::payload(&MemoChange {
                delete: memos.iter().map(|m| m.id.clone()).collect(),
                ..Default::default()
            }),
            &[],
        )?;
    }

    // --------------------------------------------- descriptor values
    // A source carries its own; a `Case` carries them for the sources it
    // names, which is where MAXQDA and ATLAS.ti put document variables.
    let mut values: Vec<(String, String, String)> = vec![];
    for l in &landed {
        for v in l.el.all("VariableValue") {
            if let Some(pair) = descriptor_pair(v, &field_of) {
                values.push((l.doc_id.clone(), pair.0, pair.1));
            }
        }
    }
    for case in root.first("Cases").into_iter().flat_map(|e| e.all("Case")) {
        let documents: Vec<String> = case
            .all("SourceRef")
            .filter_map(|r| r.attr("targetGUID"))
            .filter_map(|g| document_of.get(&id_of(g)).cloned())
            .collect();
        for v in case.all("VariableValue") {
            if let Some((field_id, value)) = descriptor_pair(v, &field_of) {
                for doc in &documents {
                    values.push((doc.clone(), field_id.clone(), value.clone()));
                }
            }
        }
    }
    for (document_id, field_id, raw) in values {
        let field = descriptors::get_field(conn, &field_id)?;
        let Ok(value) = descriptors::canonical_value(&field, &raw) else {
            unsupported.push(format!(
                "{raw:?} is not a valid \u{201C}{}\u{201D}, so it was left out",
                field.name
            ));
            continue;
        };
        let before: Option<String> = conn
            .query_row(
                "SELECT value FROM descriptor_values WHERE document_id = ?1 AND field_id = ?2",
                rusqlite::params![document_id, field_id],
                |r| r.get(0),
            )
            .optional()?;
        if before.as_deref() == Some(value.as_str()) {
            continue;
        }
        step(
            conn,
            "descriptor.value_set",
            "document",
            Some(&document_id),
            "Imported a document attribute",
            json!({ "fieldId": field_id, "value": value }),
            history::payload(&DescriptorOp::SetValue {
                document_id: document_id.clone(),
                field_id: field_id.clone(),
                value: Some(value),
            }),
            history::payload(&DescriptorOp::SetValue {
                document_id: document_id.clone(),
                field_id: field_id.clone(),
                value: before,
            }),
            &[],
        )?;
        report.descriptor_values += 1;
    }

    // --------------------------------------------------------------- sets
    let mut taken_set_ids: HashSet<String> = HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT id FROM sets")?;
        for id in stmt.query_map([], |r| r.get::<_, String>(0))? {
            taken_set_ids.insert(id?);
        }
    }
    for s in root.first("Sets").into_iter().flat_map(|e| e.all("Set")) {
        let name = s.attr_or("name").trim().to_string();
        if name.is_empty() {
            continue;
        }
        let codes_in: Vec<String> = s
            .all("MemberCode")
            .filter_map(|m| m.attr("targetGUID"))
            .filter_map(|g| code_of.get(&id_of(g)).cloned())
            .collect();
        let docs_in: Vec<String> = s
            .all("MemberSource")
            .filter_map(|m| m.attr("targetGUID"))
            .filter_map(|g| document_of.get(&id_of(g)).cloned())
            .collect();
        let described_document = s
            .child_text("Description")
            .contains(&format!("{SET_KIND_LABEL} document"));
        let (kind, mut members) = if !codes_in.is_empty() {
            ("code", codes_in)
        } else if !docs_in.is_empty() || described_document {
            ("document", docs_in)
        } else {
            ("code", vec![])
        };
        members.sort();
        members.dedup();
        let existing = sets::list_sets(conn, kind)?;
        if let Some(found) = existing.iter().find(|e| e.name.eq_ignore_ascii_case(&name)) {
            let was = sets::set_members(conn, &found.id)?;
            let mut union = was.clone();
            for m in &members {
                if !union.contains(m) {
                    union.push(m.clone());
                }
            }
            if union == was {
                continue;
            }
            step(
                conn,
                "set.members_changed",
                "set",
                Some(&found.id),
                &format!("Imported members into the set \u{201C}{name}\u{201D}"),
                json!({ "count": union.len() }),
                history::payload(&super::history::SetOp::Members {
                    set_id: found.id.clone(),
                    member_ids: union,
                    updated_at: now.clone(),
                }),
                history::payload(&super::history::SetOp::Members {
                    set_id: found.id.clone(),
                    member_ids: was,
                    updated_at: found.updated_at.clone(),
                }),
                &[],
            )?;
            continue;
        }
        let id = free_id(&id_of(s.attr_or("guid")), &mut taken_set_ids);
        let created = SetWithMembers {
            set: SetInfo {
                id: id.clone(),
                kind: kind.to_string(),
                name: name.clone(),
                sort_order: existing.len() as i64,
                member_count: members.len() as i64,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
            member_ids: members,
        };
        step(
            conn,
            "set.created",
            "set",
            Some(&id),
            &format!("Imported the {kind} set \u{201C}{name}\u{201D}"),
            json!({ "kind": kind, "name": name }),
            history::payload(&super::history::SetOp::Restore {
                set: Box::new(created),
            }),
            history::payload(&super::history::SetOp::Drop { set_id: id.clone() }),
            &[],
        )?;
        report.sets += 1;
    }

    // ------------------------------------------------------ example excerpts
    for (code_id, refi_excerpt) in wanted_examples {
        let Some(excerpt_id) = excerpt_of.get(&refi_excerpt).filter(|i| !i.is_empty()) else {
            continue;
        };
        step(
            conn,
            "code.updated",
            "code",
            Some(&code_id),
            &format!(
                "Imported the example excerpt for \u{201C}{}\u{201D}",
                activity::code_name(conn, &code_id)
            ),
            json!({ "codeId": code_id }),
            history::payload(&CodeOp::Update {
                code_id: code_id.clone(),
                patch: Box::new(CodePatch {
                    example_excerpt_id: Some(Some(excerpt_id.clone())),
                    ..Default::default()
                }),
                updated_at: now.clone(),
            }),
            history::payload(&CodeOp::Update {
                code_id: code_id.clone(),
                patch: Box::new(CodePatch {
                    example_excerpt_id: Some(None),
                    ..Default::default()
                }),
                updated_at: now.clone(),
            }),
            &[],
        )?;
    }

    for (element, what, kept) in [
        (
            "Cases",
            "case",
            " (Misket has no cases; their variable values became document attributes)",
        ),
        ("Links", "link", " (Misket has no equivalent)"),
        ("Graphs", "graph", " (Misket has no equivalent)"),
    ] {
        if let Some(el) = root.first(element) {
            let n = el.kids.len();
            if n > 0 {
                unsupported.push(format!("{n} {what}{}{kept}", if n == 1 { "" } else { "s" }));
            }
        }
    }
    unsupported.sort();
    unsupported.dedup();
    report.unsupported = unsupported;
    report.summary = summarize_import(&report, label);
    Ok(report)
}

/// The `(field id, raw value)` a `VariableValue` names, when its variable is
/// one we imported.
fn descriptor_pair(el: &El, field_of: &HashMap<String, String>) -> Option<(String, String)> {
    let target = el.first("VariableRef")?.attr("targetGUID")?;
    let field_id = field_of.get(&id_of(target))?.clone();
    let value = variable_value(el)?;
    if value.is_empty() {
        return None;
    }
    Some((field_id, value))
}

/// The sentence a whole import is remembered by.
fn summarize_import(report: &RefiImportReport, label: &str) -> String {
    let plural = |n: i64, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    let mut parts: Vec<String> = vec![];
    for (n, one, many) in [
        (report.documents, "document", "documents"),
        (report.codes, "code", "codes"),
        (report.excerpts, "excerpt", "excerpts"),
        (report.codings, "coding", "codings"),
        (report.memos, "memo", "memos"),
    ] {
        if n > 0 {
            parts.push(plural(n, one, many));
        }
    }
    if parts.is_empty() {
        return format!("Imported \u{201C}{label}\u{201D}: nothing new");
    }
    format!("Imported \u{201C}{label}\u{201D}: {}", parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::history::tests::{assert_same, dump_state};
    use crate::db::{coders, documents, memos, OpenProject};
    use crate::models::{ApplyCodesInput, MemoTarget, NewCode, NewDescriptorField, NewDocument};
    use std::path::PathBuf;

    const ADA: &str = "11111111-1111-4111-8111-111111111111";
    const BOB: &str = "22222222-2222-4222-8222-222222222222";
    const XSD: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/refi/Project-mrt2019.xsd"
    );
    const SAMPLE_PNG: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/sample.png");

    /// The project state an interchange format is judged on: what things are
    /// called and what they say, not the ids they happen to have.
    fn digest(conn: &Connection) -> BTreeMap<String, Vec<String>> {
        let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let all_codes = codes::list(conn).unwrap();
        let paths = export::code_paths(&all_codes);
        let code_path = |id: &str| paths.get(id).cloned().unwrap_or_else(|| id.to_string());
        let coder_name = |id: &str| match coders::get(conn, id).unwrap() {
            Some(c) => c.name,
            None => format!("<{id}>"),
        };

        out.insert(
            "codes".into(),
            all_codes
                .iter()
                .map(|c| {
                    format!(
                        "{} color={} desc={:?} in={:?} ex={:?}",
                        code_path(&c.id),
                        c.color,
                        c.description,
                        c.inclusion,
                        c.exclusion
                    )
                })
                .collect(),
        );

        let mut docs = vec![];
        let mut codings = vec![];
        for d in documents::list(conn).unwrap() {
            let body = match d.kind.as_str() {
                "text" => documents::get_text(conn, &d.id).unwrap().0,
                _ => format!(
                    "<{} bytes>",
                    documents::get_media(conn, &d.id).unwrap().1.len()
                ),
            };
            docs.push(format!(
                "{} kind={} len={:?} text={}",
                d.name,
                d.kind,
                d.text_length,
                text::sha256_hex(body.as_bytes())
            ));
            for e in excerpts::list_for_document(conn, &d.id).unwrap() {
                for c in &e.codings {
                    codings.push(format!(
                        "{} [{}..{}] {} {} by {}",
                        d.name,
                        e.start_pos.unwrap_or(-1),
                        e.end_pos.unwrap_or(-1),
                        e.geometry.clone().unwrap_or_default(),
                        code_path(&c.code_id),
                        coder_name(&c.coder_id)
                    ));
                }
            }
        }
        docs.sort();
        codings.sort();
        out.insert("documents".into(), docs);
        out.insert("codings".into(), codings);

        let mut notes: Vec<String> = read_memos(conn)
            .unwrap()
            .iter()
            .map(|m| {
                let target = match (&m.document_id, &m.code_id, &m.excerpt_id) {
                    (Some(_), _, _) => "document",
                    (_, Some(id), _) => {
                        return format!("code {} {:?} {:?}", code_path(id), m.title, m.body)
                    }
                    (_, _, Some(_)) => "excerpt",
                    _ => "project",
                };
                format!(
                    "{target} {:?} {:?} by {}",
                    m.title,
                    m.body,
                    coder_name(&m.coder_id)
                )
            })
            .collect();
        notes.sort();
        out.insert("memos".into(), notes);

        let matrix = descriptors::values_matrix(conn).unwrap();
        out.insert(
            "descriptorFields".into(),
            matrix
                .fields
                .iter()
                .map(|f| format!("{} {} {:?}", f.name, f.kind, f.options))
                .collect(),
        );
        // Field ids differ between projects; compare by field name instead.
        let field_name: HashMap<String, String> = matrix
            .fields
            .iter()
            .map(|f| (f.id.clone(), f.name.clone()))
            .collect();
        let mut values: Vec<String> = matrix
            .rows
            .iter()
            .flat_map(|row| {
                row.values.iter().map(|(field_id, value)| {
                    format!(
                        "{}/{} = {value}",
                        row.document_name,
                        field_name.get(field_id).cloned().unwrap_or_default()
                    )
                })
            })
            .collect();
        values.sort();
        out.insert("descriptorValues".into(), values);

        let mut set_rows = vec![];
        for kind in ["code", "document"] {
            for s in sets::list_sets(conn, kind).unwrap() {
                let mut members: Vec<String> = sets::set_members(conn, &s.id)
                    .unwrap()
                    .iter()
                    .map(|m| {
                        if kind == "code" {
                            code_path(m)
                        } else {
                            documents::get_summary(conn, m)
                                .map(|d| d.name)
                                .unwrap_or_else(|_| m.clone())
                        }
                    })
                    .collect();
                members.sort();
                set_rows.push(format!("{kind} {} [{}]", s.name, members.join(", ")));
            }
        }
        set_rows.sort();
        out.insert("sets".into(), set_rows);
        out
    }

    /// Build a `.qdpx` from strings, the way the fixtures in this module are
    /// written: a `project.qde` and whatever sources it points at.
    fn write_qdpx(path: &Path, qde: &str, sources: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file(QDE, options).unwrap();
        zip.write_all(qde.as_bytes()).unwrap();
        for (name, bytes) in sources {
            zip.start_file(format!("Sources/{name}"), options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn read_entry(path: &Path, name: &str) -> Vec<u8> {
        let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        let mut out = vec![];
        archive
            .by_name(name)
            .unwrap()
            .read_to_end(&mut out)
            .unwrap();
        out
    }

    /// Validate `project.qde` against the official REFI-QDA schema, when
    /// libxml2's `xmllint` is on the machine. Without it the test still
    /// checks the file parses, and says what it skipped.
    fn assert_valid_qde(path: &Path) {
        let xml = read_entry(path, QDE);
        parse_qde(&String::from_utf8(xml.clone()).unwrap()).expect("project.qde parses");
        let dir = tempfile::tempdir().unwrap();
        let qde = dir.path().join("project.qde");
        std::fs::write(&qde, &xml).unwrap();
        let out = std::process::Command::new("xmllint")
            .args(["--noout", "--schema", XSD])
            .arg(&qde)
            .output();
        match out {
            Ok(out) if out.status.success() => {}
            Ok(out) => panic!(
                "project.qde does not validate against {XSD}:\n{}",
                String::from_utf8_lossy(&out.stderr)
            ),
            Err(e) => eprintln!("skipping schema validation: xmllint unavailable ({e})"),
        }
    }

    /// A project with a bit of everything: two coders, a nested codebook with
    /// definitions, text and picture documents, overlapping codings, memos on
    /// every kind of target, both descriptor kinds and both kinds of set.
    fn rich_project() -> OpenProject {
        let p = OpenProject::in_memory("Field study").unwrap();
        activity::set_actor(&p.conn, "Ada").unwrap();
        coders::ensure_local(&p.conn, ADA, "Ada Lovelace", "#D9534F").unwrap();
        coders::upsert(
            &p.conn,
            &Coder {
                id: BOB.into(),
                name: "Bob Miles".into(),
                color: "#5CB85C".into(),
                created_at: util::now(),
            },
        )
        .unwrap();

        let doc = documents::create(
            &p.conn,
            NewDocument {
                name: "Interview 1".into(),
                source_path: None,
                source_format: "txt".into(),
                // Emoji and CJK, so UTF-16 conversion has something to do.
                text: "Ada: 漢字 and 😀 are one code point each.\nBob: quite so, yes.\n".into(),
                allow_duplicate: false,
            },
        )
        .unwrap()
        .summary
        .id;

        let bytes = std::fs::read(SAMPLE_PNG).unwrap();
        let (w, h, mime) = image_info(&bytes).expect("fixtures/sample.png is a readable PNG");
        let image = documents::create_image(
            &p.conn,
            crate::models::NewImageDocument {
                name: "Whiteboard".into(),
                mime: mime.into(),
                width: w,
                height: h,
                bytes: Some(bytes),
                ..Default::default()
            },
        )
        .unwrap()
        .summary
        .id;

        let parent = codes::create(
            &p.conn,
            NewCode {
                name: "Attitudes".into(),
                description: Some("How people talk about it".into()),
                inclusion: Some("Apply to evaluative statements".into()),
                exclusion: Some("Not to plain description".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let child = codes::create(
            &p.conn,
            NewCode {
                name: "Positive".into(),
                parent_id: Some(parent.id.clone()),
                color: Some("#123456".into()),
                ..Default::default()
            },
        )
        .unwrap();

        // Two coders on one passage, which is two codings of one excerpt.
        let coded = excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.clone(),
                start_pos: Some(5),
                end_pos: Some(13),
                code_ids: vec![parent.id.clone(), child.id.clone()],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt;
        history::set_local_coder(&p.conn, BOB).unwrap();
        excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.clone(),
                start_pos: Some(5),
                end_pos: Some(13),
                code_ids: vec![child.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        history::set_local_coder(&p.conn, ADA).unwrap();

        excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: image.clone(),
                kind: Some("image_region".into()),
                geometry: Some(Rect {
                    x: 0.25,
                    y: 0.5,
                    w: 0.25,
                    h: 0.25,
                }),
                code_ids: vec![parent.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();

        codes::update(
            &p.conn,
            &child.id,
            CodePatch {
                example_excerpt_id: Some(Some(coded.id.clone())),
                ..Default::default()
            },
        )
        .unwrap();

        memos::create(&p.conn, MemoTarget::default(), "Design", "Why three sites").unwrap();
        memos::create(
            &p.conn,
            MemoTarget {
                code_id: Some(parent.id.clone()),
                ..Default::default()
            },
            "On Attitudes",
            "Split later?",
        )
        .unwrap();
        memos::create(
            &p.conn,
            MemoTarget {
                document_id: Some(doc.clone()),
                ..Default::default()
            },
            "On Interview 1",
            "Recorded outdoors",
        )
        .unwrap();
        memos::create(
            &p.conn,
            MemoTarget {
                excerpt_id: Some(coded.id.clone()),
                ..Default::default()
            },
            "On this passage",
            "Check the translation",
        )
        .unwrap();

        let site = descriptors::create_field(
            &p.conn,
            NewDescriptorField {
                name: "Site".into(),
                kind: "choice".into(),
                options: Some(vec!["North".into(), "South".into()]),
            },
        )
        .unwrap();
        let age = descriptors::create_field(
            &p.conn,
            NewDescriptorField {
                name: "Age".into(),
                kind: "number".into(),
                options: None,
            },
        )
        .unwrap();
        descriptors::set_value(&p.conn, &doc, &site.id, Some("North")).unwrap();
        descriptors::set_value(&p.conn, &doc, &age.id, Some("41")).unwrap();

        sets::create_set(
            &p.conn,
            "code",
            "Round 1",
            &[parent.id.clone(), child.id.clone()],
            None,
        )
        .unwrap();
        sets::create_set(
            &p.conn,
            "document",
            "Wave A",
            std::slice::from_ref(&doc),
            None,
        )
        .unwrap();
        p
    }

    #[test]
    fn guids_are_uuids_upper_cased_and_come_back_lower() {
        let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
        assert_eq!(guid(id), "3F2504E0-4F89-41D3-9A0C-0305E82C3301");
        assert_eq!(id_of(&guid(id)), id);
        // Braces, as some tools write them.
        assert_eq!(id_of("{3F2504E0-4F89-41D3-9A0C-0305E82C3301}"), id);
        // Anything that is not a UUID still comes out schema-valid.
        let odd = guid("local");
        assert!(is_uuid(&odd.to_ascii_lowercase()), "{odd}");
        assert_eq!(odd, guid("local"), "the same input gives the same GUID");
        assert_ne!(odd, guid("remote"));
        // A coding's GUID is a function of the three things that identify it.
        assert_eq!(
            derived_guid("coding", &["a", "b", "c"]),
            derived_guid("coding", &["a", "b", "c"])
        );
        assert_ne!(
            derived_guid("coding", &["a", "b", "c"]),
            derived_guid("coding", &["a", "b", "d"])
        );
    }

    #[test]
    fn definition_fields_survive_one_description_box() {
        let joined = join_description("What it means", "When yes", "When no", "an example");
        assert_eq!(
            joined,
            "What it means\n\nWhen to apply: When yes\n\nWhen not to apply: When no\n\nExample: an example"
        );
        assert_eq!(
            split_description(&joined),
            (
                "What it means".into(),
                "When yes".into(),
                "When no".into(),
                "an example".into()
            )
        );
        // A description written by another tool arrives whole.
        assert_eq!(
            split_description("Just prose\n\nand more of it").0,
            "Just prose\n\nand more of it"
        );
        // The example paragraph carries the excerpt back too.
        let para = example_paragraph("the words", "AAAAAAAA-0000-4000-8000-000000000000");
        assert_eq!(
            example_guid(&para).as_deref(),
            Some("AAAAAAAA-0000-4000-8000-000000000000")
        );
        assert_eq!(example_guid("no marker here"), None);
    }

    #[test]
    fn image_headers_give_up_their_size() {
        let png = std::fs::read(SAMPLE_PNG).unwrap();
        let (w, h, mime) = image_info(&png).unwrap();
        assert!(w > 0 && h > 0, "{w}x{h}");
        assert_eq!(mime, "image/png");
        assert_eq!(image_info(b"not an image at all"), None);
        // A minimal JPEG: SOI, a comment segment, then SOF0 with 7x11.
        let jpeg: Vec<u8> = [
            &[0xff, 0xd8][..],
            &[0xff, 0xfe, 0x00, 0x04, 0x41, 0x42][..],
            &[0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0b, 0x00, 0x07][..],
        ]
        .concat();
        assert_eq!(image_info(&jpeg), Some((7, 11, "image/jpeg")));
    }

    #[test]
    fn export_writes_a_schema_valid_qdpx() {
        let p = rich_project();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.qdpx");
        let report = export_refi(&p.conn, &path).unwrap();
        assert_eq!(report.text_sources, 1);
        assert_eq!(report.picture_sources, 1);
        assert_eq!(report.codes, 2);
        assert_eq!(report.users, 2);
        assert_eq!(report.notes, 4);
        assert_eq!(report.variables, 2);
        assert_eq!(report.sets, 2);
        assert_eq!(report.selections, 2);
        assert_eq!(
            report.codings, 4,
            "two coders on one passage, plus a region"
        );
        assert_valid_qde(&path);

        // The plain text is in the container, as UTF-8, under its GUID.
        let names: Vec<String> = {
            let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
            (0..archive.len())
                .map(|i| archive.by_index(i).unwrap().name().to_string())
                .collect()
        };
        assert!(names.contains(&QDE.to_string()), "{names:?}");
        assert_eq!(
            names.iter().filter(|n| n.starts_with("Sources/")).count(),
            2,
            "{names:?}"
        );
        let qde = String::from_utf8(read_entry(&path, QDE)).unwrap();
        assert!(qde.contains(&format!("xmlns=\"{NS}\"")));
        assert!(qde.contains("plainTextPath=\"internal://"));
        assert!(qde.contains("When to apply: Apply to evaluative statements"));
    }

    #[test]
    fn utf16_offsets_travel_through_the_container() {
        let p = rich_project();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.qdpx");
        export_refi(&p.conn, &path).unwrap();
        let qde = String::from_utf8(read_entry(&path, QDE)).unwrap();
        let root = parse_qde(&qde).unwrap();
        let source = source_elements(&root)
            .into_iter()
            .find(|s| s.name == "TextSource")
            .unwrap();
        let selection = source.first("PlainTextSelection").unwrap();
        // Code points 5..13 are "漢字 and 😀": the emoji is two UTF-16 code
        // units, so the end moves on by one while the start does not.
        assert_eq!(selection.number("startPosition"), Some(5));
        assert_eq!(selection.number("endPosition"), Some(14));
    }

    #[test]
    fn a_round_trip_through_a_qdpx_keeps_the_project() {
        let src = rich_project();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.qdpx");
        export_refi(&src.conn, &path).unwrap();

        let dest = OpenProject::in_memory("empty").unwrap();
        activity::set_actor(&dest.conn, "Ada").unwrap();
        let report = import_refi(&dest.conn, &path, RefiImportMode::Replace).unwrap();
        assert_eq!(report.documents, 2, "{report:?}");
        assert_eq!(report.codes, 2);
        assert_eq!(report.excerpts, 2);
        assert_eq!(report.codings, 4);
        assert_eq!(report.memos, 4);
        assert_eq!(report.coders, 2);
        assert_eq!(report.descriptor_fields, 2);
        assert_eq!(report.descriptor_values, 2);
        assert_eq!(report.sets, 2);
        assert_eq!(report.unsupported, Vec::<String>::new());

        assert_same(&digest(&src.conn), &digest(&dest.conn), "round trip");
        // Ids come back too, because our GUIDs are our UUIDs.
        let same_ids: Vec<String> = codes::list(&dest.conn)
            .unwrap()
            .iter()
            .map(|c| c.id.clone())
            .collect();
        let source_ids: Vec<String> = codes::list(&src.conn)
            .unwrap()
            .iter()
            .map(|c| c.id.clone())
            .collect();
        assert_eq!(same_ids, source_ids);
        // And the example excerpt pointer with them.
        let example = codes::list(&dest.conn)
            .unwrap()
            .into_iter()
            .find(|c| c.name == "Positive")
            .unwrap();
        assert!(example.example_excerpt_id.is_some());
    }

    #[test]
    fn the_sample_project_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.misket");
        crate::sample::create_sample_project(&file).unwrap();
        let src = OpenProject::open(&file).unwrap();
        coders::ensure_local(&src.conn, ADA, "Ada", "#D9534F").unwrap();

        let path = dir.path().join("sample.qdpx");
        let report = export_refi(&src.conn, &path).unwrap();
        assert_eq!(report.text_sources, 3);
        assert_valid_qde(&path);

        let dest = OpenProject::in_memory("empty").unwrap();
        import_refi(&dest.conn, &path, RefiImportMode::Replace).unwrap();
        assert_same(&digest(&src.conn), &digest(&dest.conn), "sample round trip");
    }

    /// A `project.qde` written by hand, the way another tool would send one:
    /// a CRLF file, nested codes, two users, a note on a selection and a
    /// variable, with offsets counted in UTF-16 units over the raw file.
    fn minimal_qdpx(dir: &Path) -> PathBuf {
        // "Ada: 😀 漢字 here.\r\nBob: and here.\r\n"
        let raw = "Ada: 😀 漢字 here.\r\nBob: and here.\r\n";
        let units = text::utf16_offsets(raw);
        // Code point 5..12 is "😀 漢字 he"; in UTF-16 it starts at 5 and the
        // emoji pushes the end out by one.
        let (start, end) = (text::cp_to_utf16(&units, 5), text::cp_to_utf16(&units, 12));
        let qde = format!(
            r###"<?xml version="1.0" encoding="utf-8"?>
<Project xmlns="{NS}" name="Hand written" origin="A Rival Tool 9.0"
         creationDateTime="2024-03-01T10:00:00Z">
  <Users>
    <User guid="{ADA}" name="Ada"/>
    <User guid="{BOB}" name="Bob"/>
  </Users>
  <CodeBook>
    <Codes>
      <Code guid="AAAAAAAA-0000-4000-8000-000000000001" name="Attitudes" isCodable="true" color="#abc">
        <Description>Top level</Description>
        <Code guid="AAAAAAAA-0000-4000-8000-000000000002" name="Positive" isCodable="true" color="#123456">
          <Description>Nested under Attitudes</Description>
        </Code>
      </Code>
    </Codes>
  </CodeBook>
  <Variables>
    <Variable guid="BBBBBBBB-0000-4000-8000-000000000001" name="Site" typeOfVariable="Text"/>
  </Variables>
  <Sources>
    <TextSource guid="CCCCCCCC-0000-4000-8000-000000000001" name="Interview A"
                plainTextPath="internal://interview-a.txt"
                creatingUser="{ADA}" creationDateTime="2024-03-01T10:05:00Z">
      <PlainTextSelection guid="DDDDDDDD-0000-4000-8000-000000000001" startPosition="{start}" endPosition="{end}"
                          creatingUser="{ADA}" creationDateTime="2024-03-01T10:06:00Z">
        <Coding guid="EEEEEEEE-0000-4000-8000-000000000001" creatingUser="{ADA}">
          <CodeRef targetGUID="AAAAAAAA-0000-4000-8000-000000000002"/>
        </Coding>
        <Coding guid="EEEEEEEE-0000-4000-8000-000000000002" creatingUser="{BOB}">
          <CodeRef targetGUID="AAAAAAAA-0000-4000-8000-000000000001"/>
        </Coding>
        <NoteRef targetGUID="FFFFFFFF-0000-4000-8000-000000000001"/>
      </PlainTextSelection>
      <VariableValue>
        <VariableRef targetGUID="BBBBBBBB-0000-4000-8000-000000000001"/>
        <TextValue>North</TextValue>
      </VariableValue>
    </TextSource>
  </Sources>
  <Notes>
    <Note guid="FFFFFFFF-0000-4000-8000-000000000001" name="On the emoji" creatingUser="{BOB}"
          creationDateTime="2024-03-01T11:00:00Z">
      <PlainTextContent>Ask what the emoji meant.</PlainTextContent>
    </Note>
  </Notes>
  <Sets>
    <Set guid="99999999-0000-4000-8000-000000000001" name="Round 1">
      <MemberCode targetGUID="AAAAAAAA-0000-4000-8000-000000000002"/>
    </Set>
  </Sets>
  <Links>
    <Link guid="88888888-0000-4000-8000-000000000001" name="see also"/>
  </Links>
</Project>
"###
        );
        let path = dir.join("minimal.qdpx");
        write_qdpx(&path, &qde, &[("interview-a.txt", raw.as_bytes())]);
        path
    }

    #[test]
    fn imports_a_hand_written_qdpx_with_crlf_and_two_users() {
        let dir = tempfile::tempdir().unwrap();
        let path = minimal_qdpx(dir.path());
        let p = OpenProject::in_memory("dest").unwrap();
        activity::set_actor(&p.conn, "Cleo").unwrap();
        coders::ensure_local(&p.conn, "33333333-3333-4333-8333-333333333333", "Cleo", "").unwrap();

        let preview = preview_refi(&p.conn, &path).unwrap();
        assert_eq!(preview.project_name, "Hand written");
        assert_eq!(preview.origin, "A Rival Tool 9.0");
        assert_eq!(preview.text_sources, 1);
        assert_eq!(preview.codes, 2);
        assert_eq!(preview.codings, 2);
        assert_eq!(preview.users, 2);
        assert_eq!(preview.notes, 1);
        assert_eq!(preview.variables, 1);
        assert_eq!(preview.sets, 1);
        assert!(!preview.project_has_content);
        assert_eq!(
            preview.unsupported,
            vec!["1 link (Misket has no equivalent)".to_string()]
        );

        let report = import_refi(&p.conn, &path, RefiImportMode::Merge).unwrap();
        assert_eq!(report.documents, 1);
        assert_eq!(report.codes, 2);
        assert_eq!(report.excerpts, 1);
        assert_eq!(report.codings, 2);
        assert_eq!(report.coders, 2);
        assert_eq!(report.memos, 1);
        assert_eq!(report.descriptor_fields, 1);
        assert_eq!(report.descriptor_values, 1);
        assert_eq!(report.sets, 1);

        // CRLF collapsed, and the selection still quotes the right words.
        let doc = documents::list(&p.conn).unwrap().remove(0);
        assert_eq!(doc.name, "Interview A");
        let (body, _) = documents::get_text(&p.conn, &doc.id).unwrap();
        assert_eq!(body, "Ada: 😀 漢字 here.\nBob: and here.\n");
        let excerpts = excerpts::list_for_document(&p.conn, &doc.id).unwrap();
        assert_eq!(excerpts.len(), 1);
        assert_eq!(excerpts[0].snapshot.as_deref(), Some("😀 漢字 he"));

        // Nesting, and a short colour expanded to the long form.
        let all = codes::list(&p.conn).unwrap();
        let parent = all.iter().find(|c| c.name == "Attitudes").unwrap();
        let child = all.iter().find(|c| c.name == "Positive").unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));
        assert_eq!(parent.color, "#AABBCC");
        assert_eq!(child.description, "Nested under Attitudes");

        // Two people's codings of one passage, each under their own name.
        let mut by_coder: Vec<String> = excerpts[0]
            .codings
            .iter()
            .map(|c| {
                format!(
                    "{} by {}",
                    all.iter().find(|x| x.id == c.code_id).unwrap().name,
                    coders::get(&p.conn, &c.coder_id).unwrap().unwrap().name
                )
            })
            .collect();
        by_coder.sort();
        assert_eq!(by_coder, vec!["Attitudes by Bob", "Positive by Ada"]);

        // The note landed on the selection, attributed to Bob.
        let note = memos::list_for_excerpt(&p.conn, &excerpts[0].id).unwrap();
        assert_eq!(note.len(), 1);
        assert_eq!(note[0].title, "On the emoji");
        assert_eq!(note[0].body, "Ask what the emoji meant.");
        assert_eq!(note[0].coder_id, BOB);
        assert_eq!(note[0].created_at, "2024-03-01T11:00:00Z");

        let fields = descriptors::list_fields(&p.conn).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(
            (fields[0].name.as_str(), fields[0].kind.as_str()),
            ("Site", "text")
        );
        assert_eq!(
            descriptors::values_for_document(&p.conn, &doc.id).unwrap()[0].value,
            "North"
        );
        let code_sets = sets::list_sets(&p.conn, "code").unwrap();
        assert_eq!(code_sets.len(), 1);
        assert_eq!(
            sets::set_members(&p.conn, &code_sets[0].id).unwrap(),
            vec![child.id.clone()]
        );
    }

    /// A `.qdpx` that names an audio or video file imports it **by
    /// reference**: the document remembers where the file is, its selections
    /// become `video_range` excerpts in milliseconds, and nothing of the
    /// recording enters the project file. A recording packed inside the
    /// container is reported rather than unpacked.
    #[test]
    fn audio_and_video_sources_import_by_reference() {
        let dir = tempfile::tempdir().unwrap();
        // Two real files beside the .qdpx: one named relatively, one absolutely.
        let tape = media::tests::fake_file(dir.path(), "tape.wav", 4096, 21);
        let reel = media::tests::fake_file(dir.path(), "reel.mp4", 8192, 22);
        let qde = format!(
            r###"<?xml version="1.0" encoding="utf-8"?>
<Project xmlns="{NS}" name="With media" origin="A Rival Tool 9.0">
  <Users>
    <User guid="{ADA}" name="Ada"/>
  </Users>
  <CodeBook>
    <Codes>
      <Code guid="AAAAAAAA-0000-4000-8000-0000000000B1" name="Turning point" isCodable="true" color="#abc"/>
    </Codes>
  </CodeBook>
  <Sources>
    <AudioSource guid="CCCCCCCC-0000-4000-8000-0000000000B1" name="Tape 1" path="tape.wav">
      <AudioSelection guid="DDDDDDDD-0000-4000-8000-0000000000B1" begin="12000" end="19500"
                      creatingUser="{ADA}">
        <Coding guid="EEEEEEEE-0000-4000-8000-0000000000B1" creatingUser="{ADA}">
          <CodeRef targetGUID="AAAAAAAA-0000-4000-8000-0000000000B1"/>
        </Coding>
      </AudioSelection>
    </AudioSource>
    <VideoSource guid="CCCCCCCC-0000-4000-8000-0000000000B2" name="Reel" path="{reel}">
      <VideoSelection guid="DDDDDDDD-0000-4000-8000-0000000000B2" begin="4000" end="2000"
                      creatingUser="{ADA}">
        <Coding guid="EEEEEEEE-0000-4000-8000-0000000000B2" creatingUser="{ADA}">
          <CodeRef targetGUID="AAAAAAAA-0000-4000-8000-0000000000B1"/>
        </Coding>
      </VideoSelection>
      <VideoSelection guid="DDDDDDDD-0000-4000-8000-0000000000B3" begin="9000" end="9000"/>
    </VideoSource>
    <AudioSource guid="CCCCCCCC-0000-4000-8000-0000000000B3" name="Packed" path="internal://in.wav"/>
    <VideoSource guid="CCCCCCCC-0000-4000-8000-0000000000B4" name="Gone" path="nowhere.mp4"/>
  </Sources>
</Project>
"###,
            reel = reel.to_string_lossy()
        );
        let path = dir.path().join("media.qdpx");
        write_qdpx(&path, &qde, &[]);

        let p = OpenProject::in_memory("dest").unwrap();
        coders::ensure_local(&p.conn, "33333333-3333-4333-8333-333333333333", "Cleo", "").unwrap();
        let report = import_refi(&p.conn, &path, RefiImportMode::Merge).unwrap();
        assert_eq!(report.documents, 2, "the two resolvable recordings");
        // The packed one and the missing one are explained, not swallowed.
        assert_eq!(report.unsupported.len(), 3, "{:?}", report.unsupported);
        assert!(
            report.unsupported.iter().any(|u| u.contains("inside the")),
            "{:?}",
            report.unsupported
        );
        assert!(
            report.unsupported.iter().any(|u| u.contains("no file at")),
            "{:?}",
            report.unsupported
        );
        // An empty stretch is reported too.
        assert!(
            report
                .unsupported
                .iter()
                .any(|u| u.contains("empty stretch")),
            "{:?}",
            report.unsupported
        );

        let docs = documents::list(&p.conn).unwrap();
        let audio = docs.iter().find(|d| d.name == "Tape 1").unwrap();
        assert_eq!(audio.kind, "video", "audio and video share one kind");
        assert_eq!(audio.source_format.as_deref(), Some("wav"));
        assert_eq!(audio.source_path.as_deref(), Some(&*tape.to_string_lossy()));
        assert!(!audio.media_missing);
        let info = audio.media.clone().unwrap();
        assert_eq!(info.mime, "audio/wav");
        assert_eq!(info.size_bytes, Some(4096));
        assert_eq!(
            info.file_hash.as_deref(),
            Some(&*media::file_hash(&tape).unwrap())
        );
        // A .qdpx says nothing about how long a recording is; the viewer
        // measures the file the first time it is opened.
        assert_eq!(info.duration_ms, None);
        // And none of the bytes came along.
        let blobs: i64 = p
            .conn
            .query_row("SELECT count(*) FROM media_blobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(blobs, 0);

        let coded = excerpts::list_for_document(&p.conn, &audio.id).unwrap();
        assert_eq!(coded.len(), 1);
        assert_eq!(coded[0].kind, "video_range");
        assert_eq!(
            (coded[0].start_pos, coded[0].end_pos),
            (Some(12_000), Some(19_500))
        );
        assert_eq!(coded[0].snapshot.as_deref(), Some("[0:12.0–0:19.5]"));
        assert_eq!(coded[0].codings.len(), 1);

        // An out-point before the in-point is read as the stretch between them.
        let video = docs.iter().find(|d| d.name == "Reel").unwrap();
        assert_eq!(video.source_format.as_deref(), Some("mp4"));
        let coded = excerpts::list_for_document(&p.conn, &video.id).unwrap();
        assert_eq!(coded.len(), 1);
        assert_eq!(
            (coded[0].start_pos, coded[0].end_pos),
            (Some(2_000), Some(4_000))
        );

        // Importing the same package again matches the recordings by their
        // file fingerprint rather than duplicating them.
        let again = import_refi(&p.conn, &path, RefiImportMode::Merge).unwrap();
        assert_eq!(again.documents, 0);
        assert_eq!(again.matched_documents, 2);
        assert_eq!(documents::list(&p.conn).unwrap().len(), 2);

        // Undo takes an import back, recording and all, and never touches the
        // files themselves.
        history::undo(&p.conn).unwrap().unwrap();
        history::undo(&p.conn).unwrap().unwrap();
        assert_eq!(documents::list(&p.conn).unwrap().len(), 0);
        assert!(tape.is_file() && reel.is_file());
    }

    #[test]
    fn undoing_an_import_restores_every_table() {
        let dir = tempfile::tempdir().unwrap();
        let path = minimal_qdpx(dir.path());
        let p = OpenProject::in_memory("dest").unwrap();
        activity::set_actor(&p.conn, "Cleo").unwrap();
        coders::ensure_local(&p.conn, "33333333-3333-4333-8333-333333333333", "Cleo", "").unwrap();
        // Something of our own to make sure the undo stops at the import.
        codes::create(
            &p.conn,
            NewCode {
                name: "Ours".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let before = dump_state(&p.conn);
        import_refi(&p.conn, &path, RefiImportMode::Merge).unwrap();
        let after = dump_state(&p.conn);
        assert_ne!(before, after);

        // One undo takes the whole `.qdpx` back out, group and all.
        history::undo(&p.conn).unwrap().expect("the import undoes");
        assert_same(&before, &dump_state(&p.conn), "undo of a REFI-QDA import");
        history::redo(&p.conn, None).unwrap().expect("and redoes");
        assert_same(&after, &dump_state(&p.conn), "redo of a REFI-QDA import");
    }

    #[test]
    fn merge_matches_documents_by_content_and_codes_by_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = minimal_qdpx(dir.path());
        let p = OpenProject::in_memory("dest").unwrap();
        activity::set_actor(&p.conn, "Cleo").unwrap();
        coders::ensure_local(&p.conn, "33333333-3333-4333-8333-333333333333", "Cleo", "").unwrap();
        // The same text, imported here first, and the same codebook by name.
        documents::create(
            &p.conn,
            NewDocument {
                name: "Ours".into(),
                source_path: None,
                source_format: "txt".into(),
                text: "Ada: 😀 漢字 here.\r\nBob: and here.\r\n".into(),
                allow_duplicate: false,
            },
        )
        .unwrap();
        let parent = codes::create(
            &p.conn,
            NewCode {
                name: "attitudes".into(),
                ..Default::default()
            },
        )
        .unwrap();
        codes::create(
            &p.conn,
            NewCode {
                name: "POSITIVE".into(),
                parent_id: Some(parent.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();

        let report = import_refi(&p.conn, &path, RefiImportMode::Merge).unwrap();
        assert_eq!(report.documents, 0);
        assert_eq!(report.matched_documents, 1);
        assert_eq!(report.codes, 0);
        assert_eq!(report.matched_codes, 2);
        assert_eq!(report.codings, 2);
        assert_eq!(documents::list(&p.conn).unwrap().len(), 1);
        assert_eq!(codes::list(&p.conn).unwrap().len(), 2);
        // The codings landed on our document, under the file's names.
        let doc = documents::list(&p.conn).unwrap().remove(0);
        assert_eq!(doc.name, "Ours", "a matched document keeps its own name");
        let excerpts = excerpts::list_for_document(&p.conn, &doc.id).unwrap();
        assert_eq!(excerpts[0].codings.len(), 2);
    }

    #[test]
    fn replace_refuses_a_project_that_already_holds_work() {
        let dir = tempfile::tempdir().unwrap();
        let path = minimal_qdpx(dir.path());
        let p = rich_project();
        assert!(matches!(
            import_refi(&p.conn, &path, RefiImportMode::Replace),
            Err(AppError::Conflict(_))
        ));
        assert!(preview_refi(&p.conn, &path).unwrap().project_has_content);
    }

    /// A `project.qde` in the shapes other tools really write, which our own
    /// export never produces: a namespace *prefix* rather than a default
    /// namespace, GUIDs in braces, a lower-case `sources` folder (MAXQDA's
    /// spelling), the text inline in `PlainTextContent`, a category
    /// (`isCodable="false"`), a `Coding` on the source itself, a `Case`
    /// carrying the document's variables, and sources Misket cannot hold.
    ///
    /// A file exported by NVivo or MAXQDA would be the better test, but
    /// qdasoftware.org is not reachable from this machine and no vendor
    /// `.qdpx` is published in a public repository, so the conventions are
    /// reproduced here from the standard and from QualCoder's reader.
    #[test]
    fn imports_the_conventions_other_tools_write() {
        let dir = tempfile::tempdir().unwrap();
        let qde = format!(
            r###"<?xml version="1.0" encoding="utf-8"?>
<qda:Project xmlns:qda="{NS}" name="Rival export" origin="MAXQDA 2022">
  <qda:Users>
    <qda:User guid="{{{ADA}}}" name="AL"/>
  </qda:Users>
  <qda:CodeBook>
    <qda:Codes>
      <qda:Code guid="{{AAAAAAAA-0000-4000-8000-0000000000A1}}" name="Themes" isCodable="false">
        <qda:Code guid="{{AAAAAAAA-0000-4000-8000-0000000000A2}}" name="Trust" isCodable="true"/>
      </qda:Code>
    </qda:Codes>
  </qda:CodeBook>
  <qda:Variables>
    <qda:Variable guid="{{BBBBBBBB-0000-4000-8000-0000000000B1}}" name="Wave" typeOfVariable="Integer"/>
  </qda:Variables>
  <qda:Cases>
    <qda:Case guid="{{CACACACA-0000-4000-8000-0000000000C0}}" name="P1">
      <qda:SourceRef targetGUID="{{CCCCCCCC-0000-4000-8000-0000000000C1}}"/>
      <qda:VariableValue>
        <qda:VariableRef targetGUID="{{BBBBBBBB-0000-4000-8000-0000000000B1}}"/>
        <qda:IntegerValue>2</qda:IntegerValue>
      </qda:VariableValue>
    </qda:Case>
  </qda:Cases>
  <qda:Sources>
    <qda:TextSource guid="{{CCCCCCCC-0000-4000-8000-0000000000C1}}" name="Inline">
      <qda:PlainTextContent>Trust came up twice &amp; again.</qda:PlainTextContent>
      <qda:Coding guid="{{EEEEEEEE-0000-4000-8000-0000000000E1}}" creatingUser="{{{ADA}}}">
        <qda:CodeRef targetGUID="{{AAAAAAAA-0000-4000-8000-0000000000A2}}"/>
      </qda:Coding>
    </qda:TextSource>
    <qda:TextSource guid="{{CCCCCCCC-0000-4000-8000-0000000000C2}}" name="From a file"
                    plainTextPath="internal://lower.txt"/>
    <qda:TextSource guid="{{CCCCCCCC-0000-4000-8000-0000000000C3}}" name="Rich only"
                    richTextPath="internal://rich.docx"/>
    <qda:PDFSource guid="{{CCCCCCCC-0000-4000-8000-0000000000C4}}" name="A report"
                   path="internal://report.pdf"/>
    <qda:AudioSource guid="{{CCCCCCCC-0000-4000-8000-0000000000C5}}" name="Tape 1"
                     path="internal://tape.wav"/>
  </qda:Sources>
</qda:Project>
"###
        );
        let path = dir.path().join("rival.qdpx");
        // MAXQDA spells the folder in lower case, so the container is built
        // by hand here rather than through `write_qdpx`.
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file(QDE, options).unwrap();
            zip.write_all(qde.as_bytes()).unwrap();
            zip.start_file("sources/lower.txt", options).unwrap();
            zip.write_all("A second file, from the sources folder.\r\n".as_bytes())
                .unwrap();
            zip.finish().unwrap();
        }

        let p = OpenProject::in_memory("dest").unwrap();
        coders::ensure_local(&p.conn, "33333333-3333-4333-8333-333333333333", "Cleo", "").unwrap();
        let preview = preview_refi(&p.conn, &path).unwrap();
        assert_eq!(preview.project_name, "Rival export");
        assert_eq!(preview.origin, "MAXQDA 2022");
        assert_eq!(preview.text_sources, 2, "the rich-text-only one is not one");
        assert_eq!(preview.codes, 2);
        assert_eq!(preview.users, 1);

        let report = import_refi(&p.conn, &path, RefiImportMode::Merge).unwrap();
        assert_eq!(report.documents, 2);
        assert_eq!(report.codes, 2);
        // The `Coding` on the source codes the whole document.
        assert_eq!(report.excerpts, 1);
        assert_eq!(report.codings, 1);
        assert_eq!(report.descriptor_fields, 1);
        assert_eq!(report.descriptor_values, 1, "from the Case");

        let docs = documents::list(&p.conn).unwrap();
        let inline = docs.iter().find(|d| d.name == "Inline").unwrap();
        assert_eq!(
            documents::get_text(&p.conn, &inline.id).unwrap().0,
            "Trust came up twice & again."
        );
        let from_file = docs.iter().find(|d| d.name == "From a file").unwrap();
        assert_eq!(
            documents::get_text(&p.conn, &from_file.id).unwrap().0,
            "A second file, from the sources folder.\n"
        );
        let whole = excerpts::list_for_document(&p.conn, &inline.id).unwrap();
        assert_eq!((whole[0].start_pos, whole[0].end_pos), (Some(0), Some(28)));
        assert_eq!(whole[0].codings[0].coder_id, ADA);

        // The braced GUIDs became our ids, lower-cased.
        assert!(codes::list(&p.conn)
            .unwrap()
            .iter()
            .any(|c| c.id == "aaaaaaaa-0000-4000-8000-0000000000a2"));
        // An Integer variable is a number here, and the Case's value landed.
        let field = descriptors::list_fields(&p.conn).unwrap().remove(0);
        assert_eq!(
            (field.name.as_str(), field.kind.as_str()),
            ("Wave", "number")
        );
        assert_eq!(
            descriptors::values_for_document(&p.conn, &from_file.id).unwrap(),
            vec![]
        );
        assert_eq!(
            descriptors::values_for_document(&p.conn, &inline.id).unwrap()[0].value,
            "2"
        );

        // And everything it could not take is named rather than dropped.
        let said = report.unsupported.join("\n");
        for expected in ["Rich only", "A report", "Tape 1", "is a category", "1 case"] {
            assert!(
                said.contains(expected),
                "{expected:?} missing from:\n{said}"
            );
        }
    }

    #[test]
    fn a_file_that_is_not_a_qdpx_is_refused_clearly() {
        let dir = tempfile::tempdir().unwrap();
        let not_zip = dir.path().join("x.qdpx");
        std::fs::write(&not_zip, b"hello").unwrap();
        let p = OpenProject::in_memory("dest").unwrap();
        assert!(matches!(
            preview_refi(&p.conn, &not_zip),
            Err(AppError::Validation(_))
        ));
        // A ZIP with no project.qde in it.
        let empty = dir.path().join("empty.qdpx");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&empty).unwrap());
            zip.start_file("readme.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"nothing here").unwrap();
            zip.finish().unwrap();
        }
        assert!(matches!(
            preview_refi(&p.conn, &empty),
            Err(AppError::Validation(_))
        ));
    }
}
