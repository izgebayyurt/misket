//! A small Porter-style stemmer for English, used to group word forms
//! together in word-frequency counts and to match whole words by stem in
//! search. It follows the classic five-step suffix-stripping algorithm
//! (Porter, 1980) closely enough for practical grouping; it is not a
//! certified reference implementation and does not handle every rule (e.g.
//! step 2's rarely-used "logi" -> "log" variant some later revisions add).
//!
//! Ported line-for-line in `src/core/stem.ts` so the two stay aligned — do
//! not change one without the other, and re-run both test suites against
//! `fixtures/stems.json` after any change.

/// A consonant is any letter other than a/e/i/o/u, and 'y' preceded by a
/// vowel (so 'y' at the very start, or after a consonant, counts as a
/// consonant itself — the standard Porter definition).
fn is_consonant(chars: &[char], i: usize) -> bool {
    match chars[i] {
        'a' | 'e' | 'i' | 'o' | 'u' => false,
        'y' => i == 0 || !is_consonant(chars, i - 1),
        _ => true,
    }
}

fn is_vowel(chars: &[char], i: usize) -> bool {
    !is_consonant(chars, i)
}

/// Porter's "m": the number of consonant-vowel-consonant sequences in the
/// `[c](vc)^m[v]` decomposition of a word, after skipping any leading
/// consonants.
fn measure(chars: &[char]) -> usize {
    let mut i = 0;
    while i < chars.len() && is_consonant(chars, i) {
        i += 1;
    }
    let mut m = 0;
    loop {
        while i < chars.len() && is_vowel(chars, i) {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        while i < chars.len() && is_consonant(chars, i) {
            i += 1;
        }
        m += 1;
        if i >= chars.len() {
            break;
        }
    }
    m
}

fn contains_vowel(chars: &[char]) -> bool {
    (0..chars.len()).any(|i| is_vowel(chars, i))
}

fn ends_double_consonant(chars: &[char]) -> bool {
    let n = chars.len();
    n >= 2 && chars[n - 1] == chars[n - 2] && is_consonant(chars, n - 1)
}

/// Ends in consonant-vowel-consonant, where the last consonant is not w, x or y.
fn ends_cvc(chars: &[char]) -> bool {
    let n = chars.len();
    n >= 3
        && is_consonant(chars, n - 3)
        && is_vowel(chars, n - 2)
        && is_consonant(chars, n - 1)
        && !matches!(chars[n - 1], 'w' | 'x' | 'y')
}

fn ends_with(chars: &[char], suffix: &str) -> bool {
    let s: Vec<char> = suffix.chars().collect();
    chars.len() >= s.len() && chars[chars.len() - s.len()..] == s[..]
}

fn replace_suffix(chars: &[char], suffix_len: usize, with: &str) -> Vec<char> {
    let mut out: Vec<char> = chars[..chars.len() - suffix_len].to_vec();
    out.extend(with.chars());
    out
}

/// Measure of the stem left after removing `suffix_len` trailing chars.
fn stem_measure(chars: &[char], suffix_len: usize) -> usize {
    measure(&chars[..chars.len() - suffix_len])
}

fn stem_contains_vowel(chars: &[char], suffix_len: usize) -> bool {
    contains_vowel(&chars[..chars.len() - suffix_len])
}

/// Try each `(suffix, replacement)` rule in order; apply the first one whose
/// suffix matches, but only replace if the stem measure is above
/// `min_measure`. Stops at the first suffix match either way (a later rule
/// is never tried once an earlier suffix matches, even if its condition
/// fails) — this is how Porter's own rule tables are meant to be read.
fn apply_first_match(chars: &mut Vec<char>, rules: &[(&str, &str)], min_measure: usize) {
    for (suffix, replacement) in rules {
        if ends_with(chars, suffix) {
            let len = suffix.chars().count();
            if stem_measure(chars, len) > min_measure {
                *chars = replace_suffix(chars, len, replacement);
            }
            return;
        }
    }
}

const STEP2: &[(&str, &str)] = &[
    ("ational", "ate"),
    ("tional", "tion"),
    ("enci", "ence"),
    ("anci", "ance"),
    ("izer", "ize"),
    ("abli", "able"),
    ("alli", "al"),
    ("entli", "ent"),
    ("eli", "e"),
    ("ousli", "ous"),
    ("ization", "ize"),
    ("ation", "ate"),
    ("ator", "ate"),
    ("alism", "al"),
    ("iveness", "ive"),
    ("fulness", "ful"),
    ("ousness", "ous"),
    ("aliti", "al"),
    ("iviti", "ive"),
    ("biliti", "ble"),
];

const STEP3: &[(&str, &str)] = &[
    ("icate", "ic"),
    ("ative", ""),
    ("alize", "al"),
    ("iciti", "ic"),
    ("ical", "ic"),
    ("ful", ""),
    ("ness", ""),
];

/// Step 4 suffixes, in the order Porter lists them (longer/more specific
/// ones first where they overlap, e.g. "ement" before "ment" before "ent").
/// "ion" is handled separately right after, since it has an extra condition
/// (preceded by 's' or 't').
const STEP4: &[&str] = &[
    "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent", "ou", "ism",
    "ate", "iti", "ous", "ive", "ize",
];

/// Reduce an English word to a rough stem, case-insensitively. Words of two
/// letters or fewer are returned lowercased and otherwise unchanged — the
/// algorithm's conditions aren't meaningful on them (and stemming "is" or
/// "as" would just be noise for word-frequency grouping).
pub fn stem(word: &str) -> String {
    let lower = word.to_lowercase();
    let mut chars: Vec<char> = lower.chars().collect();
    if chars.len() <= 2 {
        return lower;
    }

    // Step 1a: plural/possessive-ish endings.
    if ends_with(&chars, "sses") {
        chars = replace_suffix(&chars, 4, "ss");
    } else if ends_with(&chars, "ies") {
        chars = replace_suffix(&chars, 3, "i");
    } else if ends_with(&chars, "ss") {
        // unchanged
    } else if ends_with(&chars, "s") {
        chars = replace_suffix(&chars, 1, "");
    }

    // Step 1b: -eed/-ed/-ing, with cleanup when -ed/-ing was removed.
    let mut cleanup = false;
    if ends_with(&chars, "eed") {
        if stem_measure(&chars, 3) > 0 {
            chars = replace_suffix(&chars, 3, "ee");
        }
    } else if ends_with(&chars, "ed") && stem_contains_vowel(&chars, 2) {
        chars = replace_suffix(&chars, 2, "");
        cleanup = true;
    } else if ends_with(&chars, "ing") && stem_contains_vowel(&chars, 3) {
        chars = replace_suffix(&chars, 3, "");
        cleanup = true;
    }
    if cleanup {
        if ends_with(&chars, "at") || ends_with(&chars, "bl") || ends_with(&chars, "iz") {
            chars.push('e');
        } else if ends_double_consonant(&chars)
            && !matches!(chars[chars.len() - 1], 'l' | 's' | 'z')
        {
            chars.pop();
        } else if measure(&chars) == 1 && ends_cvc(&chars) {
            chars.push('e');
        }
    }

    // Step 1c: trailing y after a consonant-free-of-vowel stem becomes i.
    if ends_with(&chars, "y") && stem_contains_vowel(&chars, 1) {
        let n = chars.len();
        chars[n - 1] = 'i';
    }

    // Step 2 & 3: derivational suffixes, one rule each, guarded by m > 0.
    apply_first_match(&mut chars, STEP2, 0);
    apply_first_match(&mut chars, STEP3, 0);

    // Step 4: further suffixes, guarded by m > 1.
    let mut applied = false;
    for suffix in STEP4 {
        if ends_with(&chars, suffix) {
            if stem_measure(&chars, suffix.chars().count()) > 1 {
                chars = replace_suffix(&chars, suffix.chars().count(), "");
                applied = true;
            }
            break;
        }
    }
    if !applied && ends_with(&chars, "ion") {
        let n = chars.len();
        if n > 3 && matches!(chars[n - 4], 's' | 't') && stem_measure(&chars, 3) > 1 {
            chars = replace_suffix(&chars, 3, "");
        }
    }

    // Step 5a: trailing e, guarded by m > 1, or m == 1 and not cvc.
    if ends_with(&chars, "e") {
        let m = stem_measure(&chars, 1);
        if m > 1 || (m == 1 && !ends_cvc(&chars[..chars.len() - 1])) {
            chars = replace_suffix(&chars, 1, "");
        }
    }

    // Step 5b: double l at the end, guarded by m > 1.
    if measure(&chars) > 1 && chars.last() == Some(&'l') && ends_double_consonant(&chars) {
        chars.pop();
    }

    chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;

    #[test]
    fn short_words_pass_through_lowercased() {
        assert_eq!(stem("Is"), "is");
        assert_eq!(stem("a"), "a");
    }

    #[test]
    fn common_inflections_reduce_to_a_shared_stem() {
        for (a, b) in [
            ("running", "runs"),
            ("connected", "connection"),
            ("coding", "coded"),
            ("codes", "coding"),
            ("interviews", "interviewing"),
        ] {
            assert_eq!(stem(a), stem(b), "{a} and {b} should share a stem");
        }
    }

    #[test]
    fn step_1a_and_1b_examples_from_the_porter_paper() {
        assert_eq!(stem("caresses"), "caress");
        assert_eq!(stem("ponies"), "poni");
        assert_eq!(stem("ties"), "ti");
        assert_eq!(stem("caress"), "caress");
        assert_eq!(stem("cats"), "cat");
        assert_eq!(stem("feed"), "feed");
        assert_eq!(stem("agreed"), "agre");
        assert_eq!(stem("plastered"), "plaster");
        assert_eq!(stem("bled"), "bled");
        assert_eq!(stem("motoring"), "motor");
        assert_eq!(stem("sing"), "sing");
        assert_eq!(stem("conflated"), "conflat");
        assert_eq!(stem("troubled"), "troubl");
        assert_eq!(stem("sized"), "size");
        assert_eq!(stem("hopping"), "hop");
        assert_eq!(stem("tanned"), "tan");
        assert_eq!(stem("falling"), "fall");
        assert_eq!(stem("hissing"), "hiss");
        assert_eq!(stem("fizzed"), "fizz");
        assert_eq!(stem("failing"), "fail");
        assert_eq!(stem("filing"), "file");
    }

    #[test]
    fn step_1c_example() {
        assert_eq!(stem("happy"), "happi");
        assert_eq!(stem("sky"), "sky");
    }

    #[test]
    fn is_idempotent_on_words_with_no_recognized_suffix() {
        for w in ["misket", "qualcoder", "hello", "zzz"] {
            assert_eq!(stem(w), stem(&stem(w)));
        }
    }

    /// A shared fixture of `[word, expectedStem]` pairs, loaded by both this
    /// test and `src/core/stem.test.ts`, so the Rust and TypeScript
    /// stemmers are checked against exactly the same examples.
    #[test]
    fn matches_the_shared_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/stems.json");
        let text =
            fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
        let pairs: Vec<(String, String)> = serde_json::from_str(&text).unwrap();
        assert!(!pairs.is_empty());
        let mismatches: HashMap<&str, String> = pairs
            .iter()
            .filter_map(|(word, expected)| {
                let got = stem(word);
                if &got != expected {
                    Some((word.as_str(), got))
                } else {
                    None
                }
            })
            .collect();
        assert!(mismatches.is_empty(), "stem mismatches: {mismatches:?}");
    }
}
