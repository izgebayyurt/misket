//! Text normalization and code-point helpers.
//!
//! Document text is normalized once at import and never changed afterwards,
//! so excerpt offsets (Unicode code points, end-exclusive) stay valid forever.

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

/// Strip a BOM, convert CRLF/CR to LF, and apply NFC normalization.
pub fn normalize(input: &str) -> String {
    let s = input.strip_prefix('\u{FEFF}').unwrap_or(input);
    let s = s.replace("\r\n", "\n").replace('\r', "\n");
    s.nfc().collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// [`normalize`], plus where every code point of the input ended up.
///
/// The returned map has one entry per code point boundary of `input`
/// (`cp_len(input) + 1` of them, so an end offset maps too): `map[i]` is the
/// code point offset in the normalized text that input offset `i` became.
/// It is what an offset written against a file *as shipped* has to be run
/// through before it can index the text Misket stores — a REFI-QDA
/// `startPosition` counted over a CRLF file, for instance.
///
/// BOM removal and the CRLF/CR collapse are exact. NFC is mapped by chunking
/// the text before every ASCII character: no canonical composition ever has
/// an ASCII character as its second half, so splitting there can never change
/// what NFC produces, and ordinary prose (words separated by ASCII spaces)
/// gets a chunk per word. Inside a chunk whose length NFC did not change the
/// mapping is exact too; inside one it did shorten — a run of non-ASCII
/// combining sequences with no ASCII in it — an interior offset is clamped to
/// the chunk, which is the best a single monotone map can do for a boundary
/// that fell inside a combining sequence.
pub fn normalize_mapped(input: &str) -> (String, Vec<i64>) {
    // 1. The BOM: one code point that simply goes away.
    let (body, bom) = match input.strip_prefix('\u{FEFF}') {
        Some(rest) => (rest, true),
        None => (input, false),
    };

    // 2. Line endings, exactly: a CRLF pair collapses onto one LF, a lone CR
    //    becomes one LF.
    let mut folded = String::with_capacity(body.len());
    let mut to_folded: Vec<i64> = Vec::with_capacity(body.chars().count() + 1);
    let mut folded_cp = 0i64;
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        to_folded.push(folded_cp);
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
                // The LF of a CRLF lands on the same output position as the CR.
                to_folded.push(folded_cp);
            }
            folded.push('\n');
        } else {
            folded.push(c);
        }
        folded_cp += 1;
    }
    to_folded.push(folded_cp);

    // 3. NFC, chunk by chunk.
    let mut out = String::with_capacity(folded.len());
    let mut to_out: Vec<i64> = Vec::with_capacity(to_folded.len());
    let mut out_start = 0i64;
    for (chunk_start, chunk) in ascii_chunks(&folded) {
        let composed: String = chunk.nfc().collect();
        let in_len = cp_len(chunk);
        let out_len = cp_len(&composed);
        for i in 0..in_len {
            debug_assert_eq!(to_out.len() as i64, chunk_start + i);
            to_out.push(out_start + i.min(out_len));
        }
        out.push_str(&composed);
        out_start += out_len;
    }
    to_out.push(out_start);

    // Compose the two maps into one, from the original input's offsets.
    let mut map: Vec<i64> = Vec::with_capacity(to_folded.len() + usize::from(bom));
    if bom {
        map.push(0);
    }
    for folded_cp in &to_folded {
        map.push(to_out[*folded_cp as usize]);
    }
    (out, map)
}

/// `(code point offset, slice)` for each run that starts at an ASCII
/// character (or at the start of the text) and stops before the next one.
fn ascii_chunks(text: &str) -> impl Iterator<Item = (i64, &str)> {
    let mut bounds: Vec<(i64, usize)> = vec![];
    for (cp, (byte, c)) in text.char_indices().enumerate() {
        if c.is_ascii() || cp == 0 {
            bounds.push((cp as i64, byte));
        }
    }
    let mut chunks: Vec<(i64, &str)> = Vec::with_capacity(bounds.len());
    for (i, (cp, byte)) in bounds.iter().enumerate() {
        let end = bounds.get(i + 1).map(|(_, b)| *b).unwrap_or(text.len());
        chunks.push((*cp, &text[*byte..end]));
    }
    chunks.into_iter()
}

/// UTF-16 code unit offsets of every code point boundary: `map[i]` is where
/// code point `i` begins, and the last entry is the whole length. This is the
/// Rust side of `src/core/offsets.ts`, for formats that count in UTF-16 code
/// units (REFI-QDA selections, anything born in .NET or JavaScript).
pub fn utf16_offsets(text: &str) -> Vec<i64> {
    let mut map = Vec::with_capacity(text.chars().count() + 1);
    let mut units = 0i64;
    for c in text.chars() {
        map.push(units);
        units += c.len_utf16() as i64;
    }
    map.push(units);
    map
}

/// The UTF-16 offset of code point `cp`, clamped to the text.
pub fn cp_to_utf16(map: &[i64], cp: i64) -> i64 {
    let last = map.len().saturating_sub(1);
    map[(cp.max(0) as usize).min(last)]
}

/// The code point offset a UTF-16 offset falls on, rounded down when it lands
/// inside a surrogate pair and clamped to the text.
pub fn utf16_to_cp(map: &[i64], units: i64) -> i64 {
    match map.binary_search(&units.max(0)) {
        Ok(i) => i as i64,
        // Between two boundaries: the code point that contains it.
        Err(0) => 0,
        Err(i) => (i as i64 - 1).min(map.len() as i64 - 1),
    }
}

/// Number of Unicode code points.
pub fn cp_len(text: &str) -> i64 {
    text.chars().count() as i64
}

/// Slice by code point offsets `[start, end)`. Returns `None` if out of range.
pub fn cp_slice(text: &str, start: i64, end: i64) -> Option<&str> {
    if start < 0 || end < start {
        return None;
    }
    let (start, end) = (start as usize, end as usize);
    let mut byte_start = None;
    let mut byte_end = None;
    for (cp_idx, (byte_idx, _)) in text.char_indices().enumerate() {
        if cp_idx == start {
            byte_start = Some(byte_idx);
        }
        if cp_idx == end {
            byte_end = Some(byte_idx);
            break;
        }
    }
    let total = text.chars().count();
    if byte_start.is_none() && start == total {
        byte_start = Some(text.len());
    }
    if byte_end.is_none() && end == total {
        byte_end = Some(text.len());
    }
    match (byte_start, byte_end) {
        (Some(s), Some(e)) => text.get(s..e),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_handles_bom_line_endings_and_nfc() {
        assert_eq!(normalize("\u{FEFF}a\r\nb\rc\n"), "a\nb\nc\n");
        // e + combining acute -> precomposed é
        assert_eq!(normalize("e\u{0301}"), "\u{00E9}");
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn hash_is_stable() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn code_point_helpers_count_astral_and_cjk_as_one() {
        let s = "a😀漢b";
        assert_eq!(cp_len(s), 4);
        assert_eq!(cp_slice(s, 1, 2), Some("😀"));
        assert_eq!(cp_slice(s, 1, 3), Some("😀漢"));
        assert_eq!(cp_slice(s, 0, 4), Some(s));
        assert_eq!(cp_slice(s, 4, 4), Some(""));
        assert_eq!(cp_slice(s, 3, 5), None);
        assert_eq!(cp_slice(s, -1, 2), None);
        assert_eq!(cp_slice(s, 2, 1), None);
    }

    #[test]
    fn utf16_offsets_count_astral_as_two_units() {
        let s = "a😀漢b";
        let map = utf16_offsets(s);
        assert_eq!(map, vec![0, 1, 3, 4, 5]);
        assert_eq!(cp_to_utf16(&map, 0), 0);
        assert_eq!(cp_to_utf16(&map, 2), 3);
        assert_eq!(cp_to_utf16(&map, 4), 5);
        // Clamped rather than panicking on an offset from a foreign file.
        assert_eq!(cp_to_utf16(&map, 99), 5);
        assert_eq!(cp_to_utf16(&map, -1), 0);
        for (units, cp) in [(0, 0), (1, 1), (2, 1), (3, 2), (4, 3), (5, 4), (99, 4)] {
            assert_eq!(utf16_to_cp(&map, units), cp, "utf16 {units}");
        }
        // Round trip on every boundary.
        for cp in 0..=cp_len(s) {
            assert_eq!(utf16_to_cp(&map, cp_to_utf16(&map, cp)), cp);
        }
    }

    #[test]
    fn normalize_mapped_agrees_with_normalize_and_tracks_crlf() {
        for input in [
            "",
            "plain",
            "a\r\nb\r\nc",
            "\u{FEFF}a\r\nb\rc\n",
            "e\u{0301}clair",
            "a😀漢b\r\n漢字",
            "\r\n\r\n",
        ] {
            let (text, map) = normalize_mapped(input);
            assert_eq!(text, normalize(input), "{input:?}");
            assert_eq!(map.len() as i64, cp_len(input) + 1, "{input:?}");
            assert_eq!(*map.last().unwrap(), cp_len(&text), "{input:?}");
            assert!(
                map.windows(2).all(|w| w[0] <= w[1]),
                "{input:?} not monotone"
            );
        }

        // CRLF: every offset after a pair shifts back by one per pair, and
        // both halves of the pair land on the LF.
        let (text, map) = normalize_mapped("ab\r\ncd\r\ne");
        assert_eq!(text, "ab\ncd\ne");
        assert_eq!(map, vec![0, 1, 2, 2, 3, 4, 5, 5, 6, 7]);

        // A BOM is one code point that disappears.
        let (text, map) = normalize_mapped("\u{FEFF}hi");
        assert_eq!(text, "hi");
        assert_eq!(map, vec![0, 0, 1, 2]);

        // NFC composes two code points into one; the following text keeps
        // mapping exactly, because the chunk boundary is the ASCII "c".
        let (text, map) = normalize_mapped("e\u{0301}clair");
        assert_eq!(text, "\u{00E9}clair");
        assert_eq!(map, vec![0, 1, 1, 2, 3, 4, 5, 6]);

        // CJK and astral text is left alone, so offsets pass straight through
        // even though the chunk is a single non-ASCII run.
        let (text, map) = normalize_mapped("漢字 😀\r\n漢");
        assert_eq!(text, "漢字 😀\n漢");
        assert_eq!(map, vec![0, 1, 2, 3, 4, 4, 5, 6]);
    }

    #[test]
    fn a_refi_offset_over_a_crlf_file_lands_on_the_right_words() {
        // What an importer really does: UTF-16 units over the file as
        // shipped, then the normalization's own index map.
        let raw = "Ada said:\r\n“😀 é works”\r\nbye";
        let units = utf16_offsets(raw);
        let (text, map) = normalize_mapped(raw);
        let quote_start_units = raw
            .find('“')
            .map(|b| raw[..b].encode_utf16().count() as i64);
        let quote_end_units = raw
            .find("”")
            .map(|b| raw[..b].encode_utf16().count() as i64 + 1);
        let start = map[utf16_to_cp(&units, quote_start_units.unwrap()) as usize];
        let end = map[utf16_to_cp(&units, quote_end_units.unwrap()) as usize];
        assert_eq!(cp_slice(&text, start, end), Some("“😀 é works”"));
    }
}
