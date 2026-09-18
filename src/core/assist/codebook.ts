/**
 * Choosing which codes to show an assistant, and nothing else.
 *
 * A codebook can run to thousands of codes; sending all of them costs money
 * and buries the passage. Up to `MAX_CODEBOOK_CODES` the whole book goes, in
 * its own order. Past that, codes are ranked by plain keyword overlap with
 * the passage — no embeddings, no network, nothing the reader cannot check by
 * eye — and the survivors are put back in codebook order so the list still
 * reads as a codebook.
 */

import { stem } from "@/core/stem";

/** One code as an assistant is shown it: no colours, no ids beyond the key. */
export interface CodebookEntry {
  id: string;
  /** The full path, `Parent > Child`, which is how coders name codes. */
  path: string;
  description: string;
  inclusion: string;
  exclusion: string;
}

/** How many codes are ever sent in one request. */
export const MAX_CODEBOOK_CODES = 200;

/** Words too common to say anything about which code fits. */
const NOISE = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "not",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "were",
  "with",
  "you",
  "your",
]);

/** The words of `text`, lowercased, stemmed, with the noise dropped. */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    if (raw.length < 3 || NOISE.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/**
 * How many of the passage's words this code's text also uses. A code's name
 * counts double: a code called "Waiting times" matching the word "waiting" is
 * a stronger signal than the same word buried in its exclusion note.
 */
export function overlap(passageTerms: Set<string>, entry: CodebookEntry): number {
  const name = terms(entry.path);
  const body = terms(`${entry.description} ${entry.inclusion} ${entry.exclusion}`);
  let score = 0;
  for (const t of passageTerms) {
    if (name.has(t)) score += 2;
    else if (body.has(t)) score += 1;
  }
  return score;
}

/**
 * At most `max` codes: the whole book when it fits, else the ones whose words
 * the passage actually uses, back in codebook order.
 */
export function trimCodebook(
  entries: CodebookEntry[],
  passage: string,
  max: number = MAX_CODEBOOK_CODES,
): CodebookEntry[] {
  if (max <= 0) return [];
  if (entries.length <= max) return entries;
  const passageTerms = terms(passage);
  const ranked = entries
    .map((entry, index) => ({ entry, index, score: overlap(passageTerms, entry) }))
    // Ties keep codebook order, so the result is stable for the same input.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max);
  ranked.sort((a, b) => a.index - b.index);
  return ranked.map((r) => r.entry);
}
