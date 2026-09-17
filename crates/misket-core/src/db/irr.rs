//! Inter-rater reliability: how far two coders agree.
//!
//! Everything here is read-only and computed from the tables that already
//! exist — `excerpts`, `excerpt_codes.coder_id`, and the documents' text. No
//! agreement is ever stored.
//!
//! # The unit of analysis
//!
//! Agreement is only meaningful once you say *what* is being agreed about, so
//! the unit is explicit and it is the first control in the view.
//!
//! | [`IrrUnit`]          | A unit is…                                                                                   |
//! | -------------------- | -------------------------------------------------------------------------------------------- |
//! | [`Paragraph`]        | the document text split on `\n`, exactly as the viewer shows it; each non-blank line, trimmed |
//! | [`Turn`]             | one speaker turn, for documents with a transcript format; documents without one fall back to paragraphs |
//! | [`Excerpt`]          | one distinct range that either coder marked — the union of their excerpts, and the strictest |
//!
//! In an **image** document a unit is one image-region excerpt either coder
//! coded, under every mode: there are no paragraphs or turns to cut, and the
//! regions are the only shared frame of reference.
//!
//! Units are the denominator whether or not anything was coded in them, which
//! is what makes the "neither" cell — and therefore kappa — meaningful.
//!
//! # When a code is "present"
//!
//! For [`Paragraph`] and [`Turn`], a code is present for a coder on a unit
//! when that coder has a coding of it on some excerpt that **overlaps the unit
//! by at least `overlap_threshold` of the unit, or by at least
//! `overlap_threshold` of the excerpt** (both measured in code points, with a
//! non-zero overlap required either way). The second half is what lets a short
//! excerpt sitting inside a long paragraph count: it covers little of the
//! paragraph but the paragraph covers all of it.
//!
//! For [`Excerpt`] units and image regions the rule is exact: the coder must
//! have applied the code to an excerpt with precisely that range (or that
//! region). `overlap_threshold` does not apply.
//!
//! # The figures
//!
//! Each code gets a 2×2 table over the units — both, A only, B only, neither —
//! and from it percent agreement `(both + neither) / units` and the standard
//! two-rater binary Cohen's kappa
//!
//! ```text
//! po = (both + neither) / n
//! pa = (both + a_only)  / n      (A's marginal)
//! pb = (both + b_only)  / n      (B's marginal)
//! pe = pa·pb + (1 − pa)·(1 − pb)
//! κ  = (po − pe) / (1 − pe)
//! ```
//!
//! κ is `None` where it is undefined: no units at all, or `pe == 1` — which is
//! what happens when neither coder ever applied the code, or both applied it
//! to everything. Reporting nothing there is honest; reporting 0 would not be.
//!
//! Two pooled figures come with the report, because they answer different
//! questions and papers quote both: **pooled kappa** over every (code × unit)
//! decision concatenated into one 2×2 table, which is dominated by the codes
//! that are used most; and the **mean of the per-code kappas** that are
//! defined, which treats every code alike. Overall percent agreement is over
//! the same pooled decisions.
//!
//! Bands are Landis & Koch (1977).

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use super::{coders, codes, documents, export, sets, text, transcripts};
use crate::error::{AppError, Result};
use crate::models::{IrrCodeRow, IrrDisagreement, IrrDocumentRow, IrrReport, IrrRequest, IrrUnit};

/// How many disagreements the report carries; `disagreement_count` always
/// says how many there really are.
pub const MAX_DISAGREEMENTS: usize = 500;

/// How much of a unit's text a disagreement row quotes, in code points.
const SNIPPET_LIMIT: i64 = 240;

// ------------------------------------------------------------------- figures

/// The Landis & Koch (1977) band for a kappa, as the view and the CSV label
/// it. Kept in step with `kappaBand` in `src/core/irr.ts`.
pub fn interpretation(kappa: f64) -> &'static str {
    if kappa < 0.0 {
        "Poor"
    } else if kappa <= 0.20 {
        "Slight"
    } else if kappa <= 0.40 {
        "Fair"
    } else if kappa <= 0.60 {
        "Moderate"
    } else if kappa <= 0.80 {
        "Substantial"
    } else {
        "Almost perfect"
    }
}

/// Two-rater binary Cohen's kappa over one 2×2 table, or `None` where it is
/// undefined (no units, or expected agreement of exactly 1).
pub fn kappa(both: i64, a_only: i64, b_only: i64, neither: i64) -> Option<f64> {
    let n = (both + a_only + b_only + neither) as f64;
    if n <= 0.0 {
        return None;
    }
    let po = (both + neither) as f64 / n;
    let pa = (both + a_only) as f64 / n;
    let pb = (both + b_only) as f64 / n;
    let pe = pa * pb + (1.0 - pa) * (1.0 - pb);
    if (1.0 - pe).abs() < 1e-12 {
        return None;
    }
    Some((po - pe) / (1.0 - pe))
}

fn agreement(both: i64, neither: i64, units: i64) -> f64 {
    if units <= 0 {
        0.0
    } else {
        (both + neither) as f64 / units as f64
    }
}

fn band(kappa: Option<f64>) -> String {
    kappa.map(interpretation).unwrap_or("").to_string()
}

// --------------------------------------------------------------------- units

/// One unit of analysis inside one document.
struct Unit {
    /// `text` or `image_region`, matching `excerpts.kind`.
    kind: &'static str,
    /// Code points, end-exclusive. Both `0` for an image region.
    start: i64,
    end: i64,
    /// The excerpt this unit *is*, for the modes where a unit is an excerpt.
    excerpt_id: Option<String>,
    snippet: String,
}

/// One `excerpt_codes` row by one of the two coders, with its excerpt's shape.
struct Coding {
    excerpt_id: String,
    code_id: String,
    /// `true` for coder A, `false` for coder B.
    is_a: bool,
    kind: String,
    start: i64,
    end: i64,
}

/// Code point offset of the start of each paragraph, splitting on `\n` — the
/// same cut the document viewer and `query_expr` make.
fn paragraph_starts(text: &str) -> Vec<i64> {
    let mut starts = vec![0i64];
    for (i, c) in text.chars().enumerate() {
        if c == '\n' {
            starts.push(i as i64 + 1);
        }
    }
    starts
}

/// `[start, end)` with leading and trailing whitespace trimmed off, in code
/// points, or `None` when nothing but whitespace is left.
fn trimmed(chars: &[char], start: i64, end: i64) -> Option<(i64, i64)> {
    let mut s = start;
    let mut e = end.min(chars.len() as i64);
    while s < e && chars[s as usize].is_whitespace() {
        s += 1;
    }
    while e > s && chars[(e - 1) as usize].is_whitespace() {
        e -= 1;
    }
    (e > s).then_some((s, e))
}

fn snippet_of(doc_text: &str, start: i64, end: i64) -> String {
    let cut = end.min(start + SNIPPET_LIMIT);
    let mut out = text::cp_slice(doc_text, start, cut)
        .unwrap_or_default()
        .replace(['\n', '\r', '\t'], " ");
    if cut < end {
        out.push('…');
    }
    out
}

/// Does `[es, ee)` cover enough of unit `[us, ue)` (or the unit enough of it)?
///
/// A non-zero overlap is required first, so a threshold of 0 does not make
/// every excerpt in the document count.
fn overlaps_enough(us: i64, ue: i64, es: i64, ee: i64, threshold: f64) -> bool {
    let overlap = ue.min(ee) - us.max(es);
    if overlap <= 0 {
        return false;
    }
    let unit_len = (ue - us).max(1) as f64;
    let ex_len = (ee - es).max(1) as f64;
    let o = overlap as f64;
    o / unit_len >= threshold || o / ex_len >= threshold
}

/// One document and everything needed to cut it into units.
struct DocScope<'a> {
    id: &'a str,
    /// The `documents.kind` column: `text` or `image`.
    kind: &'a str,
    text: &'a str,
    codings: &'a [Coding],
    /// Excerpt id to `excerpts.snapshot` — an image region's only label.
    snapshots: &'a HashMap<String, String>,
}

/// The units of one document, in reading order.
fn units_of(
    conn: &Connection,
    turns: &mut transcripts::TurnIndex,
    doc: &DocScope<'_>,
    unit: IrrUnit,
) -> Result<Vec<Unit>> {
    let (document_id, doc_kind, doc_text, codings, snapshots) =
        (doc.id, doc.kind, doc.text, doc.codings, doc.snapshots);
    // An image document has no text to cut, so its regions are the units
    // whatever mode is asked for.
    if doc_kind == "image" {
        let mut seen: HashSet<&str> = HashSet::new();
        let mut out = Vec::new();
        for c in codings.iter().filter(|c| c.kind == "image_region") {
            if !seen.insert(c.excerpt_id.as_str()) {
                continue;
            }
            out.push(Unit {
                kind: "image_region",
                start: 0,
                end: 0,
                excerpt_id: Some(c.excerpt_id.clone()),
                snippet: snapshots.get(&c.excerpt_id).cloned().unwrap_or_default(),
            });
        }
        return Ok(out);
    }

    let chars: Vec<char> = doc_text.chars().collect();
    let mut spans: Vec<(i64, i64, Option<String>)> = Vec::new();
    match unit {
        IrrUnit::Excerpt => {
            // The union of both coders' ranges, one unit per distinct range.
            let mut seen: HashSet<(i64, i64)> = HashSet::new();
            for c in codings.iter().filter(|c| c.kind == "text") {
                if seen.insert((c.start, c.end)) {
                    spans.push((c.start, c.end, Some(c.excerpt_id.clone())));
                }
            }
            spans.sort_by_key(|(s, e, _)| (*s, *e));
        }
        IrrUnit::Turn => {
            let found = turns.turns(conn, document_id)?;
            if found.is_empty() {
                // Not a transcript: paragraphs, so a mixed project still has
                // one comparison rather than two.
                spans = paragraph_spans(&chars, doc_text);
            } else {
                for t in found {
                    if let Some((s, e)) = trimmed(&chars, t.start, t.end) {
                        spans.push((s, e, None));
                    }
                }
            }
        }
        IrrUnit::Paragraph => spans = paragraph_spans(&chars, doc_text),
    }

    // An excerpt whose range *is* the unit, so a jump can focus it and
    // "adopt" can reuse it.
    let by_range: HashMap<(i64, i64), &str> = codings
        .iter()
        .filter(|c| c.kind == "text")
        .map(|c| ((c.start, c.end), c.excerpt_id.as_str()))
        .collect();

    Ok(spans
        .into_iter()
        .map(|(start, end, excerpt_id)| Unit {
            kind: "text",
            start,
            end,
            excerpt_id: excerpt_id.or_else(|| by_range.get(&(start, end)).map(|id| id.to_string())),
            snippet: snippet_of(doc_text, start, end),
        })
        .collect())
}

fn paragraph_spans(chars: &[char], doc_text: &str) -> Vec<(i64, i64, Option<String>)> {
    let starts = paragraph_starts(doc_text);
    let len = chars.len() as i64;
    let mut out = Vec::new();
    for (i, s) in starts.iter().enumerate() {
        // Up to the next paragraph's start, less the `\n` that separates them.
        let raw_end = starts.get(i + 1).map(|n| n - 1).unwrap_or(len);
        if let Some((s, e)) = trimmed(chars, *s, raw_end) {
            out.push((s, e, None));
        }
    }
    out
}

// ------------------------------------------------------------------ the view

/// The documents to compare: the ones asked for, or — with none asked for —
/// every document both coders have at least one coding in.
fn scope_documents(conn: &Connection, req: &IrrRequest) -> Result<Vec<String>> {
    // Explicit ids plus every id the picked sets expand to, exactly like the
    // other analysis views.
    let expanded = sets::union_with_sets(
        conn,
        req.document_ids.as_deref(),
        req.document_set_ids.as_deref().unwrap_or_default(),
    )?;
    let asked = req.document_ids.as_ref().is_some_and(|ids| !ids.is_empty())
        || req
            .document_set_ids
            .as_ref()
            .is_some_and(|ids| !ids.is_empty());
    let picked: Option<HashSet<String>> =
        asked.then(|| expanded.into_iter().collect::<HashSet<String>>());
    let shared: HashSet<String> = if picked.is_some() {
        HashSet::new()
    } else {
        let mut stmt = conn.prepare(
            "SELECT e.document_id FROM excerpt_codes ec
               JOIN excerpts e ON e.id = ec.excerpt_id
              WHERE ec.coder_id = ?1
             INTERSECT
             SELECT e.document_id FROM excerpt_codes ec
               JOIN excerpts e ON e.id = ec.excerpt_id
              WHERE ec.coder_id = ?2",
        )?;
        let ids = stmt
            .query_map([&req.coder_a, &req.coder_b], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        ids
    };
    // Project order, and only documents that still exist.
    Ok(documents::list(conn)?
        .into_iter()
        .map(|d| d.id)
        .filter(|id| match &picked {
            Some(p) => p.contains(id),
            None => shared.contains(id),
        })
        .collect())
}

/// Every coding by either coder in one document, with its excerpt's shape,
/// plus the region snapshots (an image unit's only label).
fn codings_of(
    conn: &Connection,
    document_id: &str,
    req: &IrrRequest,
) -> Result<(Vec<Coding>, HashMap<String, String>)> {
    let mut stmt = conn.prepare(
        "SELECT ec.excerpt_id, ec.code_id, ec.coder_id, e.kind,
                COALESCE(e.start_pos, 0), COALESCE(e.end_pos, 0), COALESCE(e.snapshot, '')
           FROM excerpt_codes ec
           JOIN excerpts e ON e.id = ec.excerpt_id
          WHERE e.document_id = ?1 AND ec.coder_id IN (?2, ?3)
          ORDER BY e.start_pos, e.end_pos, e.geometry, e.id, ec.code_id",
    )?;
    let mut snapshots = HashMap::new();
    let rows: Vec<Coding> = stmt
        .query_map([document_id, &req.coder_a, &req.coder_b], |r| {
            let coder_id: String = r.get(2)?;
            let excerpt_id: String = r.get(0)?;
            let snapshot: String = r.get(6)?;
            Ok((
                Coding {
                    code_id: r.get(1)?,
                    is_a: coder_id == req.coder_a,
                    kind: r.get(3)?,
                    start: r.get(4)?,
                    end: r.get(5)?,
                    excerpt_id: excerpt_id.clone(),
                },
                excerpt_id,
                snapshot,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(|(c, id, snap)| {
            snapshots.insert(id, snap);
            c
        })
        .collect();
    Ok((rows, snapshots))
}

/// A running 2×2 table.
#[derive(Default, Clone, Copy)]
struct Cell {
    both: i64,
    a_only: i64,
    b_only: i64,
    neither: i64,
}

impl Cell {
    fn add(&mut self, a: bool, b: bool) {
        match (a, b) {
            (true, true) => self.both += 1,
            (true, false) => self.a_only += 1,
            (false, true) => self.b_only += 1,
            (false, false) => self.neither += 1,
        }
    }
    fn n(&self) -> i64 {
        self.both + self.a_only + self.b_only + self.neither
    }
}

/// Compare two coders over the documents they both worked on. See the module
/// docs for the unit rule, the presence rule and the formulas.
pub fn compare(conn: &Connection, req: &IrrRequest) -> Result<IrrReport> {
    if req.coder_a.is_empty() || req.coder_b.is_empty() {
        return Err(AppError::Validation("pick two coders to compare".into()));
    }
    if req.coder_a == req.coder_b {
        return Err(AppError::Validation(
            "a coder always agrees with themselves — pick two different coders".into(),
        ));
    }
    let threshold = if req.overlap_threshold.is_finite() {
        req.overlap_threshold.clamp(0.0, 1.0)
    } else {
        0.5
    };

    let names: HashMap<String, String> = coders::list(conn)?
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect();
    let name_of = |id: &String| names.get(id).cloned().unwrap_or_else(|| id.clone());

    let doc_ids = scope_documents(conn, req)?;
    let doc_names: HashMap<String, (String, String)> = documents::list(conn)?
        .into_iter()
        .map(|d| (d.id, (d.name, d.kind)))
        .collect();

    let all_codes = codes::list(conn)?;
    let paths = export::code_paths(&all_codes);
    let picked_codes: Option<HashSet<&str>> = req
        .code_ids
        .as_ref()
        .filter(|ids| !ids.is_empty())
        .map(|ids| ids.iter().map(String::as_str).collect());

    // Pass one: load every coding in scope, so the code scope can default to
    // "what either coder actually applied here".
    let mut per_document: Vec<(String, Vec<Coding>, HashMap<String, String>)> = Vec::new();
    let mut applied: HashSet<String> = HashSet::new();
    for id in &doc_ids {
        let (codings, snapshots) = codings_of(conn, id, req)?;
        for c in &codings {
            applied.insert(c.code_id.clone());
        }
        per_document.push((id.clone(), codings, snapshots));
    }

    let scoped: Vec<&crate::models::Code> = all_codes
        .iter()
        .filter(|c| match &picked_codes {
            Some(p) => p.contains(c.id.as_str()),
            None => applied.contains(&c.id),
        })
        .collect();
    let code_index: HashMap<&str, usize> = scoped
        .iter()
        .enumerate()
        .map(|(i, c)| (c.id.as_str(), i))
        .collect();

    let mut per_code = vec![Cell::default(); scoped.len()];
    let mut pooled = Cell::default();
    let mut documents_out: Vec<IrrDocumentRow> = Vec::new();
    let mut disagreements: Vec<IrrDisagreement> = Vec::new();
    let mut disagreement_count: i64 = 0;
    let mut total_units: i64 = 0;
    let mut turns = transcripts::TurnIndex::new();

    for (document_id, codings, snapshots) in &per_document {
        let (document_name, doc_kind) = doc_names
            .get(document_id)
            .cloned()
            .unwrap_or_else(|| (document_id.clone(), "text".into()));
        let doc_text = if doc_kind == "image" {
            String::new()
        } else {
            documents::get_text(conn, document_id)
                .map(|(t, _)| t)
                .unwrap_or_default()
        };
        let units = units_of(
            conn,
            &mut turns,
            &DocScope {
                id: document_id,
                kind: &doc_kind,
                text: &doc_text,
                codings,
                snapshots,
            },
            req.unit,
        )?;
        let exact = req.unit == IrrUnit::Excerpt || doc_kind == "image";

        let mut doc_cell = Cell::default();
        let mut doc_disagreements: i64 = 0;
        for (unit_index, unit) in units.iter().enumerate() {
            // Which of the scoped codes each coder has on this unit, and the
            // excerpts that put them there.
            let mut present: Vec<(bool, bool)> = vec![(false, false); scoped.len()];
            let mut carriers: HashMap<(usize, bool), Vec<String>> = HashMap::new();
            for c in codings {
                let Some(&i) = code_index.get(c.code_id.as_str()) else {
                    continue;
                };
                let hit = if exact {
                    match (&unit.excerpt_id, unit.kind) {
                        (Some(id), "image_region") => c.excerpt_id == *id,
                        _ => c.kind == "text" && c.start == unit.start && c.end == unit.end,
                    }
                } else {
                    c.kind == "text"
                        && overlaps_enough(unit.start, unit.end, c.start, c.end, threshold)
                };
                if !hit {
                    continue;
                }
                if c.is_a {
                    present[i].0 = true;
                } else {
                    present[i].1 = true;
                }
                carriers
                    .entry((i, c.is_a))
                    .or_default()
                    .push(c.excerpt_id.clone());
            }

            for (i, code) in scoped.iter().enumerate() {
                let (a, b) = present[i];
                per_code[i].add(a, b);
                pooled.add(a, b);
                doc_cell.add(a, b);
                if a == b {
                    continue;
                }
                doc_disagreements += 1;
                disagreement_count += 1;
                if disagreements.len() >= MAX_DISAGREEMENTS {
                    continue;
                }
                disagreements.push(IrrDisagreement {
                    document_id: document_id.clone(),
                    document_name: document_name.clone(),
                    unit_index: unit_index as i64,
                    kind: unit.kind.to_string(),
                    start: unit.start,
                    end: unit.end,
                    snippet: unit.snippet.clone(),
                    code_id: code.id.clone(),
                    code_name: paths.get(&code.id).cloned().unwrap_or(code.name.clone()),
                    color: code.color.clone(),
                    who: if a { "a" } else { "b" }.to_string(),
                    coder_id: if a {
                        req.coder_a.clone()
                    } else {
                        req.coder_b.clone()
                    },
                    unit_excerpt_id: unit.excerpt_id.clone(),
                    excerpt_ids: carriers.get(&(i, a)).cloned().unwrap_or_default(),
                });
            }
        }
        total_units += units.len() as i64;
        documents_out.push(IrrDocumentRow {
            document_id: document_id.clone(),
            document_name,
            units: units.len() as i64,
            percent_agreement: agreement(doc_cell.both, doc_cell.neither, doc_cell.n()),
            disagreements: doc_disagreements,
        });
    }

    let code_rows: Vec<IrrCodeRow> = scoped
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let cell = per_code[i];
            let k = kappa(cell.both, cell.a_only, cell.b_only, cell.neither);
            IrrCodeRow {
                code_id: c.id.clone(),
                code_name: c.name.clone(),
                code_path: paths.get(&c.id).cloned().unwrap_or(c.name.clone()),
                color: c.color.clone(),
                units: total_units,
                both: cell.both,
                a_only: cell.a_only,
                b_only: cell.b_only,
                neither: cell.neither,
                percent_agreement: agreement(cell.both, cell.neither, cell.n()),
                kappa: k,
                interpretation: band(k),
            }
        })
        .collect();

    let defined: Vec<f64> = code_rows.iter().filter_map(|r| r.kappa).collect();
    let mean_kappa =
        (!defined.is_empty()).then(|| defined.iter().sum::<f64>() / defined.len() as f64);
    let pooled_kappa = kappa(pooled.both, pooled.a_only, pooled.b_only, pooled.neither);

    Ok(IrrReport {
        coder_a_name: name_of(&req.coder_a),
        coder_b_name: name_of(&req.coder_b),
        coder_a: req.coder_a.clone(),
        coder_b: req.coder_b.clone(),
        unit: req.unit,
        overlap_threshold: threshold,
        documents: documents_out,
        units: total_units,
        decisions: pooled.n(),
        codes: code_rows,
        pooled_kappa,
        pooled_interpretation: band(pooled_kappa),
        mean_kappa,
        percent_agreement: agreement(pooled.both, pooled.neither, pooled.n()),
        disagreements,
        disagreement_count,
    })
}

// ----------------------------------------------------------------------- CSV

fn num(v: f64) -> String {
    format!("{:.4}", v)
}

fn opt(v: Option<f64>) -> String {
    v.map(num).unwrap_or_default()
}

/// The per-code table with the pooled rows under it, then the parameters that
/// produced it — a methods section needs the second half as much as the first.
pub fn export_csv(conn: &Connection, req: &IrrRequest) -> Result<String> {
    let r = compare(conn, req)?;
    let mut wtr = csv::WriterBuilder::new()
        .flexible(true)
        .from_writer(Vec::new());
    wtr.write_record([
        "Code",
        "Units",
        "Both",
        &format!("Only {}", r.coder_a_name),
        &format!("Only {}", r.coder_b_name),
        "Neither",
        "Percent agreement",
        "Cohen's kappa",
        "Interpretation",
    ])?;
    for c in &r.codes {
        wtr.write_record([
            &c.code_path,
            &c.units.to_string(),
            &c.both.to_string(),
            &c.a_only.to_string(),
            &c.b_only.to_string(),
            &c.neither.to_string(),
            &num(c.percent_agreement),
            &opt(c.kappa),
            &c.interpretation,
        ])?;
    }
    let pooled = [
        "Pooled (all decisions)".to_string(),
        r.decisions.to_string(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        num(r.percent_agreement),
        opt(r.pooled_kappa),
        r.pooled_interpretation.clone(),
    ];
    wtr.write_record(pooled)?;
    wtr.write_record([
        "Mean of per-code kappas".to_string(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        opt(r.mean_kappa),
        r.mean_kappa.map(interpretation).unwrap_or("").to_string(),
    ])?;
    // A rule between the table and the parameters. Nine empty fields
    // rather than an empty record, which the writer would quote as `""`.
    wtr.write_record([""; 9])?;
    wtr.write_record(["Coder A", &r.coder_a_name])?;
    wtr.write_record(["Coder B", &r.coder_b_name])?;
    wtr.write_record(["Unit of analysis", r.unit.label()])?;
    if r.unit != IrrUnit::Excerpt {
        wtr.write_record(["Overlap threshold", &num(r.overlap_threshold)])?;
    }
    wtr.write_record(["Documents", &r.documents.len().to_string()])?;
    wtr.write_record(["Units", &r.units.to_string()])?;
    wtr.write_record(["Codes", &r.codes.len().to_string()])?;
    wtr.write_record(["Disagreements", &r.disagreement_count.to_string()])?;
    for d in &r.documents {
        wtr.write_record([
            &format!("Document: {}", d.document_name),
            &d.units.to_string(),
            "",
            "",
            "",
            "",
            &num(d.percent_agreement),
        ])?;
    }
    let bytes = wtr.into_inner().map_err(|e| AppError::Io(e.to_string()))?;
    String::from_utf8(bytes).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::coders::tests::as_coder;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::tests::new_doc;
    use crate::db::{documents, excerpts, OpenProject};
    use crate::models::{ApplyCodesInput, NewDocument};
    use std::path::Path;

    const ADA: &str = "coder-ada";
    const BOB: &str = "coder-bob";

    /// Four paragraphs, one of them blank, so the blank one is not a unit:
    ///
    /// | index | range     | text           |
    /// | ----- | --------- | -------------- |
    /// | 0     | `[0,10)`  | `Alpha one.`   |
    /// | 1     | `[12,21)` | `Beta two.`    |
    /// | 2     | `[22,34)` | `Gamma three.` |
    /// | 3     | `[35,46)` | `Delta four.`  |
    const TEXT: &str = "Alpha one.\n\nBeta two.\nGamma three.\nDelta four.";

    struct Fx {
        project: OpenProject,
        doc: String,
        x: String,
        y: String,
        z: String,
    }

    fn apply_as(conn: &Connection, coder: &str, doc: &str, start: i64, end: i64, codes: &[&str]) {
        as_coder(conn, coder, if coder == ADA { "Ada" } else { "Bob" });
        excerpts::apply_codes(
            conn,
            ApplyCodesInput {
                document_id: doc.into(),
                start_pos: Some(start),
                end_pos: Some(end),
                code_ids: codes.iter().map(|c| c.to_string()).collect(),
                ..Default::default()
            },
        )
        .unwrap();
    }

    /// Ada and Bob over the four paragraphs above:
    ///
    /// - `X`: both on 0, Ada only on 1, Bob only on 2, neither on 3
    /// - `Y`: both on 0 and 1
    /// - `Z`: Ada only on 0, 1 and 2
    fn fixture() -> Fx {
        let project = OpenProject::in_memory("t").unwrap();
        let conn = &project.conn;
        let doc = documents::create(conn, new_doc(TEXT)).unwrap().summary.id;
        let x = mk_code(conn, "X", None).id;
        let y = mk_code(conn, "Y", None).id;
        let z = mk_code(conn, "Z", None).id;
        apply_as(conn, ADA, &doc, 0, 10, &[&x, &y, &z]);
        apply_as(conn, ADA, &doc, 12, 21, &[&x, &y, &z]);
        apply_as(conn, ADA, &doc, 22, 34, &[&z]);
        apply_as(conn, BOB, &doc, 0, 10, &[&x, &y]);
        apply_as(conn, BOB, &doc, 12, 21, &[&y]);
        apply_as(conn, BOB, &doc, 22, 34, &[&x]);
        Fx {
            project,
            doc,
            x,
            y,
            z,
        }
    }

    fn req(unit: IrrUnit) -> IrrRequest {
        IrrRequest {
            coder_a: ADA.into(),
            coder_b: BOB.into(),
            unit,
            ..Default::default()
        }
    }

    fn row<'a>(r: &'a IrrReport, code_id: &str) -> &'a IrrCodeRow {
        r.codes.iter().find(|c| c.code_id == code_id).unwrap()
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    // ---------------------------------------------------------------- kappa

    #[test]
    fn kappa_matches_hand_computed_tables() {
        // Perfect agreement, whatever the marginals.
        assert_eq!(kappa(5, 0, 0, 5), Some(1.0));
        assert_eq!(kappa(1, 0, 0, 99), Some(1.0));
        // Independent coders who each say yes half the time: chance-level.
        assert_eq!(kappa(25, 25, 25, 25), Some(0.0));
        // Never the same answer: as far below chance as it goes.
        assert_eq!(kappa(0, 5, 5, 0), Some(-1.0));
        // po = 0.75, pa = 5/12, pb = 0.5, pe = 0.5 → κ = 0.5.
        assert!(close(kappa(4, 1, 2, 5).unwrap(), 0.5));
        // Undefined: nothing to compare, or expected agreement of exactly 1.
        assert_eq!(kappa(0, 0, 0, 0), None);
        assert_eq!(kappa(0, 0, 0, 10), None, "neither coder ever applied it");
        assert_eq!(kappa(10, 0, 0, 0), None, "both applied it everywhere");
    }

    #[test]
    fn landis_and_koch_bands() {
        assert_eq!(interpretation(-0.2), "Poor");
        assert_eq!(interpretation(0.0), "Slight");
        assert_eq!(interpretation(0.20), "Slight");
        assert_eq!(interpretation(0.21), "Fair");
        assert_eq!(interpretation(0.60), "Moderate");
        assert_eq!(interpretation(0.75), "Substantial");
        assert_eq!(interpretation(0.9), "Almost perfect");
    }

    // ---------------------------------------------------------------- units

    #[test]
    fn paragraph_units_are_the_viewer_s_non_blank_lines() {
        let f = fixture();
        let r = compare(&f.project.conn, &req(IrrUnit::Paragraph)).unwrap();
        assert_eq!(r.units, 4, "the blank line is not a unit");
        assert_eq!(r.documents.len(), 1);
        assert_eq!(r.documents[0].units, 4);

        let x = row(&r, &f.x);
        assert_eq!((x.both, x.a_only, x.b_only, x.neither), (1, 1, 1, 1));
        assert!(close(x.percent_agreement, 0.5));
        assert!(close(x.kappa.unwrap(), 0.0));

        let y = row(&r, &f.y);
        assert_eq!((y.both, y.a_only, y.b_only, y.neither), (2, 0, 0, 2));
        assert_eq!(y.kappa, Some(1.0));
        assert_eq!(y.interpretation, "Almost perfect");

        let z = row(&r, &f.z);
        assert_eq!((z.both, z.a_only, z.b_only, z.neither), (0, 3, 0, 1));
    }

    #[test]
    fn a_code_neither_coder_applied_has_no_kappa() {
        let f = fixture();
        let w = mk_code(&f.project.conn, "W", None).id;
        let mut q = req(IrrUnit::Paragraph);
        q.code_ids = Some(vec![w.clone()]);
        let r = compare(&f.project.conn, &q).unwrap();
        let w = row(&r, &w);
        assert_eq!((w.both, w.a_only, w.b_only, w.neither), (0, 0, 0, 4));
        assert_eq!(w.kappa, None);
        assert_eq!(w.interpretation, "");
        assert!(close(w.percent_agreement, 1.0), "they did agree, vacuously");
    }

    #[test]
    fn the_default_code_scope_is_what_either_coder_applied() {
        let f = fixture();
        mk_code(&f.project.conn, "Never used", None);
        let r = compare(&f.project.conn, &req(IrrUnit::Paragraph)).unwrap();
        assert_eq!(r.codes.len(), 3);
    }

    #[test]
    fn excerpt_units_are_the_union_of_both_coders_ranges_matched_exactly() {
        let f = fixture();
        let conn = &f.project.conn;
        // A range only Ada marked, nested inside paragraph 3.
        apply_as(conn, ADA, &f.doc, 35, 40, &[&f.x]);
        let r = compare(conn, &req(IrrUnit::Excerpt)).unwrap();
        // [0,10), [12,21), [22,34) and [35,40).
        assert_eq!(r.units, 4);
        let x = row(&r, &f.x);
        // Both on [0,10); Ada only on [12,21) and [35,40); Bob only on [22,34).
        assert_eq!((x.both, x.a_only, x.b_only, x.neither), (1, 2, 1, 0));
        // The nested range does not lend its code to the paragraph around it.
        let first = r
            .disagreements
            .iter()
            .find(|d| d.start == 35)
            .expect("the nested range disagrees");
        assert_eq!(first.who, "a");
        assert!(first.unit_excerpt_id.is_some(), "a unit that is an excerpt");
    }

    #[test]
    fn turn_units_come_from_the_transcript_and_fall_back_to_paragraphs() {
        let project = OpenProject::in_memory("t").unwrap();
        let conn = &project.conn;
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/transcript.txt");
        let text = std::fs::read_to_string(path).unwrap();
        let transcript = documents::create(
            conn,
            NewDocument {
                name: "Transcript".into(),
                ..new_doc(&text)
            },
        )
        .unwrap()
        .summary
        .id;
        let plain = documents::create(
            conn,
            NewDocument {
                name: "Notes".into(),
                ..new_doc(TEXT)
            },
        )
        .unwrap()
        .summary
        .id;
        let x = mk_code(conn, "X", None).id;
        for doc in [&transcript, &plain] {
            apply_as(conn, ADA, doc, 0, 12, &[&x]);
            apply_as(conn, BOB, doc, 0, 12, &[&x]);
        }

        let paragraphs = compare(conn, &req(IrrUnit::Paragraph)).unwrap();
        let turns = compare(conn, &req(IrrUnit::Turn)).unwrap();
        let by_doc = |r: &IrrReport, id: &str| {
            r.documents
                .iter()
                .find(|d| d.document_id == id)
                .unwrap()
                .units
        };
        // The transcript has fewer turns than lines: one turn runs over two.
        assert!(by_doc(&turns, &transcript) < by_doc(&paragraphs, &transcript));
        assert!(by_doc(&turns, &transcript) > 0);
        // The plain text has no format, so turn mode falls back to its lines.
        assert_eq!(by_doc(&turns, &plain), by_doc(&paragraphs, &plain));
        assert_eq!(by_doc(&paragraphs, &plain), 4);
    }

    // ------------------------------------------------------------ threshold

    #[test]
    fn the_overlap_threshold_counts_in_both_directions() {
        let f = fixture();
        let conn = &f.project.conn;
        let w = mk_code(conn, "W", None).id;
        // A short excerpt wholly inside paragraph 2 ([22,34)): it covers a
        // quarter of the unit, but the unit covers all of it.
        apply_as(conn, ADA, &f.doc, 22, 25, &[&w]);
        // One long excerpt of Bob's, from halfway through paragraph 0 to
        // most of the way through paragraph 2. It covers half of paragraph 0,
        // all of paragraph 1 and two thirds of paragraph 2 — but only a fifth
        // to a third of *itself* falls in any one of them.
        apply_as(conn, BOB, &f.doc, 5, 30, &[&w]);

        let at = |t: f64| {
            let mut q = req(IrrUnit::Paragraph);
            q.overlap_threshold = t;
            q.code_ids = Some(vec![w.clone()]);
            let r = compare(conn, &q).unwrap();
            let c = row(&r, &w);
            (c.a_only, c.b_only, c.both)
        };
        // At 0.9 Ada's three code points still carry paragraph 2 — the unit
        // covers the whole excerpt — and Bob has only paragraph 1, the one
        // his excerpt covers outright.
        assert_eq!(at(0.9), (1, 1, 0));
        // At 0.6 Bob reaches paragraph 2 as well (8 of its 12 code points),
        // where the two of them now agree.
        assert_eq!(at(0.6), (0, 1, 1));
        // At 0.25 he picks up paragraph 0 too (half of it).
        assert_eq!(at(0.25), (0, 2, 1));
    }

    #[test]
    fn a_threshold_of_zero_still_needs_a_real_overlap() {
        let f = fixture();
        let mut q = req(IrrUnit::Paragraph);
        q.overlap_threshold = 0.0;
        let r = compare(&f.project.conn, &q).unwrap();
        let z = row(&r, &f.z);
        // Paragraph 3 is untouched by either coder, so it stays "neither".
        assert_eq!((z.both, z.a_only, z.b_only, z.neither), (0, 3, 0, 1));
    }

    // ---------------------------------------------------------- doc scoping

    #[test]
    fn documents_default_to_the_ones_both_coders_worked_on() {
        let f = fixture();
        let conn = &f.project.conn;
        let solo = documents::create(
            conn,
            NewDocument {
                name: "Ada only".into(),
                allow_duplicate: true,
                ..new_doc(TEXT)
            },
        )
        .unwrap()
        .summary
        .id;
        apply_as(conn, ADA, &solo, 0, 10, &[&f.x]);

        let r = compare(conn, &req(IrrUnit::Paragraph)).unwrap();
        assert_eq!(r.documents.len(), 1);
        assert_eq!(r.documents[0].document_id, f.doc);

        // Asking for it by name overrides that — its units count as "neither".
        let mut q = req(IrrUnit::Paragraph);
        q.document_ids = Some(vec![f.doc.clone(), solo.clone()]);
        let both = compare(conn, &q).unwrap();
        assert_eq!(both.documents.len(), 2);
        assert_eq!(both.units, 8);

        // A document set stands for its members, as in every other view.
        let set = crate::db::sets::create_set(
            conn,
            "document",
            "Wave 1",
            std::slice::from_ref(&solo),
            None,
        )
        .unwrap();
        let mut q = req(IrrUnit::Paragraph);
        q.document_set_ids = Some(vec![set.id]);
        let via_set = compare(conn, &q).unwrap();
        assert_eq!(via_set.documents.len(), 1);
        assert_eq!(via_set.documents[0].document_id, solo);
    }

    #[test]
    fn two_of_the_same_coder_is_refused() {
        let f = fixture();
        let mut q = req(IrrUnit::Paragraph);
        q.coder_b = ADA.into();
        assert!(compare(&f.project.conn, &q).is_err());
    }

    // ------------------------------------------------------------- pooling

    #[test]
    fn pooled_kappa_is_not_the_mean_of_the_per_code_kappas() {
        let f = fixture();
        let r = compare(&f.project.conn, &req(IrrUnit::Paragraph)).unwrap();
        // 3 codes × 4 units: both 3, Ada only 4, Bob only 1, neither 4.
        assert_eq!(r.decisions, 12);
        assert!(close(r.percent_agreement, 7.0 / 12.0));
        // po = 21/36, pe = 17/36 → κ = 4/19.
        assert!(close(r.pooled_kappa.unwrap(), 4.0 / 19.0));
        assert_eq!(r.pooled_interpretation, "Fair");
        // X = 0, Y = 1, Z = 0.
        assert!(close(r.mean_kappa.unwrap(), 1.0 / 3.0));
    }

    // ------------------------------------------------------- disagreements

    #[test]
    fn disagreements_are_ordered_by_document_then_position_then_code() {
        let f = fixture();
        let r = compare(&f.project.conn, &req(IrrUnit::Paragraph)).unwrap();
        let seen: Vec<(i64, &str)> = r
            .disagreements
            .iter()
            .map(|d| (d.unit_index, d.code_name.as_str()))
            .collect();
        assert_eq!(
            seen,
            vec![(0, "Z"), (1, "X"), (1, "Z"), (2, "X"), (2, "Z")],
            "document, then position, then code order"
        );
        assert_eq!(r.disagreement_count, 5);
        let first = &r.disagreements[0];
        assert_eq!(first.who, "a");
        assert_eq!(first.coder_id, ADA);
        assert_eq!(first.snippet, "Alpha one.");
        assert_eq!((first.start, first.end), (0, 10));
        assert_eq!(first.kind, "text");
        assert!(!first.excerpt_ids.is_empty());
        let bobs = r.disagreements.iter().find(|d| d.who == "b").unwrap();
        assert_eq!(bobs.coder_id, BOB);
        assert_eq!(bobs.snippet, "Gamma three.");
    }

    #[test]
    fn coder_names_come_from_the_coders_table() {
        let f = fixture();
        let r = compare(&f.project.conn, &req(IrrUnit::Paragraph)).unwrap();
        assert_eq!(r.coder_a_name, "Ada");
        assert_eq!(r.coder_b_name, "Bob");
    }

    // ------------------------------------------------------------- image

    #[test]
    fn image_regions_are_units_under_every_mode() {
        use crate::models::{NewImageDocument, Rect};
        let project = OpenProject::in_memory("t").unwrap();
        let conn = &project.conn;
        let doc = documents::create_image(
            conn,
            NewImageDocument {
                name: "Poster".into(),
                source_path: None,
                bytes: Some(b"not-a-real-png".to_vec()),
                mime: "image/png".into(),
                width: 100,
                height: 100,
                allow_duplicate: true,
            },
        )
        .unwrap()
        .summary
        .id;
        let x = mk_code(conn, "X", None).id;
        let y = mk_code(conn, "Y", None).id;
        let region = |conn: &Connection, coder: &str, r: Rect, codes: &[&str]| {
            as_coder(conn, coder, if coder == ADA { "Ada" } else { "Bob" });
            excerpts::apply_codes(
                conn,
                ApplyCodesInput {
                    document_id: doc.clone(),
                    kind: Some("image_region".into()),
                    geometry: Some(r),
                    code_ids: codes.iter().map(|c| c.to_string()).collect(),
                    ..Default::default()
                },
            )
            .unwrap();
        };
        let top = Rect {
            x: 0.0,
            y: 0.0,
            w: 0.5,
            h: 0.5,
        };
        let bottom = Rect {
            x: 0.5,
            y: 0.5,
            w: 0.5,
            h: 0.5,
        };
        region(conn, ADA, top, &[&x, &y]);
        region(conn, BOB, top, &[&x]);
        region(conn, ADA, bottom, &[&y]);

        for unit in [IrrUnit::Paragraph, IrrUnit::Turn, IrrUnit::Excerpt] {
            let r = compare(conn, &req(unit)).unwrap();
            assert_eq!(r.units, 2, "{unit:?}");
            let x = row(&r, &x);
            assert_eq!((x.both, x.a_only, x.b_only, x.neither), (1, 0, 0, 1));
            let y = row(&r, &y);
            assert_eq!((y.both, y.a_only, y.b_only, y.neither), (0, 2, 0, 0));
        }
        let r = compare(conn, &req(IrrUnit::Excerpt)).unwrap();
        let d = &r.disagreements[0];
        assert_eq!(d.kind, "image_region");
        assert!(d.unit_excerpt_id.is_some());
    }

    // --------------------------------------------------------------- CSV

    #[test]
    fn csv_carries_the_table_the_pooled_rows_and_the_parameters() {
        let f = fixture();
        let csv = export_csv(&f.project.conn, &req(IrrUnit::Paragraph)).unwrap();
        assert_eq!(
            csv,
            "Code,Units,Both,Only Ada,Only Bob,Neither,Percent agreement,Cohen's kappa,Interpretation\n\
             X,4,1,1,1,1,0.5000,0.0000,Slight\n\
             Y,4,2,0,0,2,1.0000,1.0000,Almost perfect\n\
             Z,4,0,3,0,1,0.2500,0.0000,Slight\n\
             Pooled (all decisions),12,,,,,0.5833,0.2105,Fair\n\
             Mean of per-code kappas,,,,,,,0.3333,Fair\n\
             ,,,,,,,,\n\
             Coder A,Ada\n\
             Coder B,Bob\n\
             Unit of analysis,Paragraph\n\
             Overlap threshold,0.5000\n\
             Documents,1\n\
             Units,4\n\
             Codes,3\n\
             Disagreements,5\n\
             Document: Interview 1,4,,,,,0.5833\n"
        );
    }
}
