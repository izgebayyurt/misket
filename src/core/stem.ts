/**
 * A small Porter-style stemmer for English, used to group word forms
 * together when "Match word forms" is on (find-in-document, project search)
 * and by the word-frequency view. Follows the classic five-step
 * suffix-stripping algorithm (Porter, 1980) closely enough for practical
 * matching; it is not a certified reference implementation.
 *
 * Ported line-for-line from `crates/misket-core/src/text/stem.rs` so the two
 * stay aligned — do not change one without the other, and re-run both test
 * suites against `fixtures/stems.json` after any change.
 */

function isConsonant(chars: string[], i: number): boolean {
  switch (chars[i]) {
    case "a":
    case "e":
    case "i":
    case "o":
    case "u":
      return false;
    case "y":
      return i === 0 || !isConsonant(chars, i - 1);
    default:
      return true;
  }
}

function isVowel(chars: string[], i: number): boolean {
  return !isConsonant(chars, i);
}

/** Porter's "m": the number of consonant-vowel-consonant sequences in the
 * `[c](vc)^m[v]` decomposition of a word, after skipping leading consonants. */
function measure(chars: string[]): number {
  let i = 0;
  while (i < chars.length && isConsonant(chars, i)) i++;
  let m = 0;
  for (;;) {
    while (i < chars.length && isVowel(chars, i)) i++;
    if (i >= chars.length) break;
    while (i < chars.length && isConsonant(chars, i)) i++;
    m++;
    if (i >= chars.length) break;
  }
  return m;
}

function containsVowel(chars: string[]): boolean {
  for (let i = 0; i < chars.length; i++) if (isVowel(chars, i)) return true;
  return false;
}

function endsDoubleConsonant(chars: string[]): boolean {
  const n = chars.length;
  return n >= 2 && chars[n - 1] === chars[n - 2] && isConsonant(chars, n - 1);
}

/** Ends in consonant-vowel-consonant, where the last consonant is not w, x or y. */
function endsCvc(chars: string[]): boolean {
  const n = chars.length;
  return (
    n >= 3 &&
    isConsonant(chars, n - 3) &&
    isVowel(chars, n - 2) &&
    isConsonant(chars, n - 1) &&
    !["w", "x", "y"].includes(chars[n - 1]!)
  );
}

function endsWith(chars: string[], suffix: string): boolean {
  return (
    chars.length >= suffix.length && chars.slice(chars.length - suffix.length).join("") === suffix
  );
}

function replaceSuffix(chars: string[], suffixLen: number, withStr: string): string[] {
  return [...chars.slice(0, chars.length - suffixLen), ...withStr.split("")];
}

function stemMeasure(chars: string[], suffixLen: number): number {
  return measure(chars.slice(0, chars.length - suffixLen));
}

function stemContainsVowel(chars: string[], suffixLen: number): boolean {
  return containsVowel(chars.slice(0, chars.length - suffixLen));
}

/**
 * Try each `[suffix, replacement]` rule in order; apply the first one whose
 * suffix matches, but only replace if the stem measure is above
 * `minMeasure`. Stops at the first suffix match either way.
 */
function applyFirstMatch(chars: string[], rules: [string, string][], minMeasure: number): string[] {
  for (const [suffix, replacement] of rules) {
    if (endsWith(chars, suffix)) {
      if (stemMeasure(chars, suffix.length) > minMeasure) {
        return replaceSuffix(chars, suffix.length, replacement);
      }
      return chars;
    }
  }
  return chars;
}

const STEP2: [string, string][] = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["abli", "able"],
  ["alli", "al"],
  ["entli", "ent"],
  ["eli", "e"],
  ["ousli", "ous"],
  ["ization", "ize"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
];

const STEP3: [string, string][] = [
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
];

/** Step 4 suffixes, in the order Porter lists them (longer/more specific
 * ones first where they overlap, e.g. "ement" before "ment" before "ent").
 * "ion" is handled separately right after, since it has an extra condition
 * (preceded by 's' or 't'). */
const STEP4 = [
  "al",
  "ance",
  "ence",
  "er",
  "ic",
  "able",
  "ible",
  "ant",
  "ement",
  "ment",
  "ent",
  "ou",
  "ism",
  "ate",
  "iti",
  "ous",
  "ive",
  "ize",
];

/**
 * Reduce an English word to a rough stem, case-insensitively. Words of two
 * letters or fewer are returned lowercased and otherwise unchanged.
 */
export function stem(word: string): string {
  const lower = word.toLowerCase();
  let chars = Array.from(lower);
  if (chars.length <= 2) return lower;

  // Step 1a: plural/possessive-ish endings.
  if (endsWith(chars, "sses")) {
    chars = replaceSuffix(chars, 4, "ss");
  } else if (endsWith(chars, "ies")) {
    chars = replaceSuffix(chars, 3, "i");
  } else if (endsWith(chars, "ss")) {
    // unchanged
  } else if (endsWith(chars, "s")) {
    chars = replaceSuffix(chars, 1, "");
  }

  // Step 1b: -eed/-ed/-ing, with cleanup when -ed/-ing was removed.
  let cleanup = false;
  if (endsWith(chars, "eed")) {
    if (stemMeasure(chars, 3) > 0) chars = replaceSuffix(chars, 3, "ee");
  } else if (endsWith(chars, "ed") && stemContainsVowel(chars, 2)) {
    chars = replaceSuffix(chars, 2, "");
    cleanup = true;
  } else if (endsWith(chars, "ing") && stemContainsVowel(chars, 3)) {
    chars = replaceSuffix(chars, 3, "");
    cleanup = true;
  }
  if (cleanup) {
    if (endsWith(chars, "at") || endsWith(chars, "bl") || endsWith(chars, "iz")) {
      chars = [...chars, "e"];
    } else if (endsDoubleConsonant(chars) && !["l", "s", "z"].includes(chars[chars.length - 1]!)) {
      chars = chars.slice(0, -1);
    } else if (measure(chars) === 1 && endsCvc(chars)) {
      chars = [...chars, "e"];
    }
  }

  // Step 1c: trailing y after a consonant-free-of-vowel stem becomes i.
  if (endsWith(chars, "y") && stemContainsVowel(chars, 1)) {
    chars = [...chars.slice(0, -1), "i"];
  }

  // Step 2 & 3: derivational suffixes, one rule each, guarded by m > 0.
  chars = applyFirstMatch(chars, STEP2, 0);
  chars = applyFirstMatch(chars, STEP3, 0);

  // Step 4: further suffixes, guarded by m > 1.
  let applied = false;
  for (const suffix of STEP4) {
    if (endsWith(chars, suffix)) {
      if (stemMeasure(chars, suffix.length) > 1) {
        chars = replaceSuffix(chars, suffix.length, "");
        applied = true;
      }
      break;
    }
  }
  if (!applied && endsWith(chars, "ion")) {
    const n = chars.length;
    if (n > 3 && ["s", "t"].includes(chars[n - 4]!) && stemMeasure(chars, 3) > 1) {
      chars = replaceSuffix(chars, 3, "");
    }
  }

  // Step 5a: trailing e, guarded by m > 1, or m == 1 and not cvc.
  if (endsWith(chars, "e")) {
    const m = stemMeasure(chars, 1);
    if (m > 1 || (m === 1 && !endsCvc(chars.slice(0, -1)))) {
      chars = replaceSuffix(chars, 1, "");
    }
  }

  // Step 5b: double l at the end, guarded by m > 1.
  if (measure(chars) > 1 && chars[chars.length - 1] === "l" && endsDoubleConsonant(chars)) {
    chars = chars.slice(0, -1);
  }

  return chars.join("");
}
