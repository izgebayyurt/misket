/**
 * Every word Misket ever sends an assistant, built here as pure functions so
 * that a sceptical reader can open one file, read the prompts end to end and
 * see exactly what leaves the machine. Nothing in this module reaches the
 * network, the database or the DOM.
 *
 * Three rules the prompts share:
 *
 * - The assistant is told it is drafting for a researcher who will accept or
 *   reject its work, never that it is coding the project.
 * - Nothing is sent that the feature does not need: one passage plus a
 *   paragraph either side, or the excerpts of one code. Never a document,
 *   never the project.
 * - Everything is capped, and a cap that bites is written into the prompt as
 *   a visible note rather than silently swallowing text.
 */

import type { CodebookEntry } from "./codebook";

/** The passage itself. Roughly a page and a half. */
export const MAX_PASSAGE_CHARS = 4000;
/** The paragraph before and the paragraph after, each. */
export const MAX_CONTEXT_CHARS = 1000;
/** How many excerpts of one code are summarised or read for a definition. */
export const MAX_EXCERPTS = 40;
/** How much of any one excerpt is sent. */
export const MAX_EXCERPT_CHARS = 700;
/** How many suggestions a request may come back with. */
export const MAX_SUGGESTIONS = 5;
/** The fewest excerpts a code needs before a definition can be drafted. */
export const MIN_EXCERPTS_FOR_DEFINITION = 3;

/** A prompt, plus whether building it had to cut anything. */
export interface BuiltPrompt {
  system: string;
  user: string;
  /** Human-readable notes about what was cut; empty when nothing was. */
  truncated: string[];
}

/** One excerpt as an assistant is shown it. */
export interface ExcerptForPrompt {
  id: string;
  text: string;
  documentName: string;
}

/** `text` cut to `max` characters, on a word boundary where there is one. */
export function cap(text: string, max: number): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= max) return { text: trimmed, truncated: false };
  const hard = trimmed.slice(0, max);
  const space = hard.lastIndexOf(" ");
  return { text: (space > max * 0.6 ? hard.slice(0, space) : hard).trimEnd(), truncated: true };
}

/** The codebook as lines an assistant can quote an id back from. */
export function codebookLines(codebook: CodebookEntry[]): string {
  return codebook
    .map((c) => {
      const parts = [`- id: ${c.id}`, `  name: ${c.path}`];
      if (c.description.trim()) parts.push(`  means: ${c.description.trim()}`);
      if (c.inclusion.trim()) parts.push(`  include when: ${c.inclusion.trim()}`);
      if (c.exclusion.trim()) parts.push(`  exclude when: ${c.exclusion.trim()}`);
      return parts.join("\n");
    })
    .join("\n");
}

const SUGGEST_SYSTEM = [
  "You help a qualitative researcher code an interview or document.",
  "You never make the decision: everything you return is a suggestion the researcher will look at and either accept or throw away.",
  "Work only from the passage you are given and the codebook you are given. Do not invent facts about the wider study.",
  "Prefer an existing code. Propose a new one only when nothing in the codebook fits the passage.",
  "Be honest about weak matches: a low confidence is more useful than a confident guess.",
  "",
  `Answer with JSON and nothing else: an array of at most ${MAX_SUGGESTIONS} objects, each with`,
  '  "codeId": the id of an existing code, or null,',
  '  "newCodeName": a short name for a code that does not exist yet, or null,',
  '  "confidence": a number from 0 to 1,',
  '  "rationale": one sentence, at most 200 characters, saying what in the passage supports it.',
  "Exactly one of codeId and newCodeName is set on each object. Return [] if nothing fits.",
].join("\n");

export interface SuggestCodesInput {
  passage: string;
  /** The paragraph before the passage, if there is one. */
  contextBefore: string;
  contextAfter: string;
  codebook: CodebookEntry[];
  /** How many codes the codebook held before it was trimmed. */
  codebookTotal?: number;
}

/** "Suggest codes for this selection." */
export function suggestCodesPrompt(input: SuggestCodesInput): BuiltPrompt {
  const truncated: string[] = [];
  const passage = cap(input.passage, MAX_PASSAGE_CHARS);
  if (passage.truncated) truncated.push(`the passage was cut to ${MAX_PASSAGE_CHARS} characters`);
  const before = cap(input.contextBefore, MAX_CONTEXT_CHARS);
  const after = cap(input.contextAfter, MAX_CONTEXT_CHARS);
  const total = input.codebookTotal ?? input.codebook.length;
  if (total > input.codebook.length) {
    truncated.push(`${input.codebook.length} of ${total} codes were sent (the closest by wording)`);
  }

  const parts = ["Codebook:", input.codebook.length ? codebookLines(input.codebook) : "(empty)"];
  if (total > input.codebook.length) {
    parts.push(
      `(This is ${input.codebook.length} of ${total} codes, the ones whose wording is closest to the passage.)`,
    );
  }
  parts.push("");
  if (before.text) parts.push("Context before:", before.text, "");
  parts.push("Passage to code:", passage.text);
  if (passage.truncated) parts.push("(The passage was cut short at this point.)");
  if (after.text) parts.push("", "Context after:", after.text);
  parts.push("", "Suggest codes for the passage only, not for the context.");

  return { system: SUGGEST_SYSTEM, user: parts.join("\n"), truncated };
}

/** Excerpts as numbered, id-tagged blocks so quotes can be traced back. */
function excerptBlocks(excerpts: ExcerptForPrompt[]): {
  text: string;
  truncated: string[];
  used: ExcerptForPrompt[];
} {
  const truncated: string[] = [];
  const used = excerpts.slice(0, MAX_EXCERPTS);
  if (excerpts.length > used.length) {
    truncated.push(`${used.length} of ${excerpts.length} excerpts were sent`);
  }
  let anyCut = false;
  const blocks = used.map((e) => {
    const body = cap(e.text, MAX_EXCERPT_CHARS);
    if (body.truncated) anyCut = true;
    return `[${e.id}] (${e.documentName})\n${body.text}${body.truncated ? " …" : ""}`;
  });
  if (anyCut) truncated.push(`long excerpts were cut to ${MAX_EXCERPT_CHARS} characters`);
  return { text: blocks.join("\n\n"), truncated, used };
}

const SUMMARISE_SYSTEM = [
  "You help a qualitative researcher read back what they have coded.",
  "You are writing a first draft of a memo. The researcher will edit it, and may throw it away.",
  "Work only from the excerpts given. Never generalise beyond them and never invent a quotation.",
  "Cite every quotation with the excerpt id in square brackets, exactly as it appears in the input.",
  "",
  "Write plain prose under three short headings, in Markdown:",
  "## Themes — two to five themes, each a sentence or two.",
  "## Representative quotes — a handful of short quotations, each followed by its [id].",
  "## Tensions — places where the excerpts disagree or sit awkwardly together, or 'None apparent.'",
  "Keep the whole thing under 350 words. No preamble, no sign-off.",
].join("\n");

export interface SummariseCodeInput {
  codeName: string;
  codeDescription: string;
  excerpts: ExcerptForPrompt[];
}

/** "Summarise the excerpts under this code." */
export function summariseCodePrompt(input: SummariseCodeInput): BuiltPrompt {
  const { text, truncated } = excerptBlocks(input.excerpts);
  const parts = [`Code: ${input.codeName}`];
  if (input.codeDescription.trim()) parts.push(`Definition: ${input.codeDescription.trim()}`);
  parts.push(
    "",
    `Excerpts coded ${input.codeName} (${input.excerpts.length > MAX_EXCERPTS ? `${MAX_EXCERPTS} of ${input.excerpts.length}` : input.excerpts.length}):`,
    "",
    text,
  );
  return { system: SUMMARISE_SYSTEM, user: parts.join("\n"), truncated };
}

const DEFINITION_SYSTEM = [
  "You help a qualitative researcher write down what a code actually means, from the passages they have already coded with it.",
  "This is a draft for the researcher to edit. It is not saved unless they save it.",
  "Work only from the excerpts given. Describe what the code is doing in this data, not what the name could mean in general.",
  "",
  "Answer with JSON and nothing else, an object with four string fields:",
  '  "description": one or two sentences on what the code stands for,',
  '  "inclusion": when to apply it, concretely,',
  '  "exclusion": when not to apply it, and what to use instead if the excerpts suggest something,',
  '  "example": one short quotation from the excerpts that is the clearest instance.',
  "Leave a field as an empty string if the excerpts do not support it.",
].join("\n");

export interface DraftDefinitionInput {
  codeName: string;
  excerpts: ExcerptForPrompt[];
}

/** "Draft a definition for this code." */
export function draftDefinitionPrompt(input: DraftDefinitionInput): BuiltPrompt {
  const { text, truncated } = excerptBlocks(input.excerpts);
  const user = [
    `Code: ${input.codeName}`,
    "",
    `Excerpts already coded ${input.codeName}:`,
    "",
    text,
  ].join("\n");
  return { system: DEFINITION_SYSTEM, user, truncated };
}

/**
 * The line a drafted memo carries at its foot. A memo that came out of an
 * assistant says so in its own body, because a memo gets exported, pasted
 * into a paper and read years later far away from the history log.
 */
export function assistedMemoFooter(provider: string, model: string): string {
  return `\n\n---\n_Drafted with assistance (${provider}, ${model}) and edited by hand._`;
}
