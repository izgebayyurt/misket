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
}
