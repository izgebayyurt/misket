import { describe, expect, it } from "vitest";
import type { CodebookEntry } from "./codebook";
import {
  MAX_EXCERPTS,
  MAX_EXCERPT_CHARS,
  MAX_PASSAGE_CHARS,
  assistedMemoFooter,
  cap,
  codebookLines,
  draftDefinitionPrompt,
  suggestCodesPrompt,
  summariseCodePrompt,
  type ExcerptForPrompt,
} from "./prompts";

function entry(id: string, path: string, extra: Partial<CodebookEntry> = {}): CodebookEntry {
  return { id, path, description: "", inclusion: "", exclusion: "", ...extra };
}

function excerpt(id: string, text: string): ExcerptForPrompt {
  return { id, text, documentName: "Interview 1" };
}

describe("cap", () => {
  it("leaves short text alone", () => {
    expect(cap("  hello  ", 20)).toEqual({ text: "hello", truncated: false });
  });

  it("cuts on a word boundary when there is one nearby", () => {
    expect(cap("one two three four", 14)).toEqual({ text: "one two three", truncated: true });
  });

  it("cuts hard when a single word is longer than the cap", () => {
    expect(cap("a".repeat(30), 10)).toEqual({ text: "a".repeat(10), truncated: true });
  });
});

describe("codebookLines", () => {
  it("writes the id, the path and only the definition parts that exist", () => {
    const lines = codebookLines([
      entry("c1", "Care > Waiting", { description: "Delays", exclusion: "Not travel time" }),
    ]);
    expect(lines).toBe(
      ["- id: c1", "  name: Care > Waiting", "  means: Delays", "  exclude when: Not travel time"].join(
        "\n",
      ),
    );
  });
});

describe("suggestCodesPrompt", () => {
  const codebook = [entry("c1", "Waiting"), entry("c2", "Staffing")];

  it("sends the passage, the context and the codebook, and nothing else", () => {
    const p = suggestCodesPrompt({
      passage: "I waited four hours.",
      contextBefore: "She arrived at nine.",
      contextAfter: "Then a nurse came.",
      codebook,
    });
    expect(p.user).toContain("I waited four hours.");
    expect(p.user).toContain("Context before:");
    expect(p.user).toContain("She arrived at nine.");
    expect(p.user).toContain("Then a nurse came.");
    expect(p.user).toContain("- id: c1");
    expect(p.truncated).toEqual([]);
  });

  it("leaves out an empty context rather than sending an empty heading", () => {
    const p = suggestCodesPrompt({
      passage: "Alone.",
      contextBefore: "",
      contextAfter: "   ",
      codebook,
    });
    expect(p.user).not.toContain("Context before:");
    expect(p.user).not.toContain("Context after:");
  });

  it("says so in the prompt and in `truncated` when the passage is cut", () => {
    const p = suggestCodesPrompt({
      passage: "word ".repeat(2000),
      contextBefore: "",
      contextAfter: "",
      codebook,
    });
    expect(p.user).toContain("cut short");
    expect(p.truncated[0]).toContain(String(MAX_PASSAGE_CHARS));
  });

  it("says how much of the codebook was sent when it was trimmed", () => {
    const p = suggestCodesPrompt({
      passage: "x",
      contextBefore: "",
      contextAfter: "",
      codebook,
      codebookTotal: 900,
    });
    expect(p.truncated).toEqual(["2 of 900 codes were sent (the closest by wording)"]);
    expect(p.user).toContain("This is 2 of 900 codes");
  });

  it("copes with an empty codebook", () => {
    const p = suggestCodesPrompt({
      passage: "x",
      contextBefore: "",
      contextAfter: "",
      codebook: [],
    });
    expect(p.user).toContain("(empty)");
  });

  it("asks for JSON and for at most five suggestions", () => {
    const p = suggestCodesPrompt({ passage: "x", contextBefore: "", contextAfter: "", codebook });
    expect(p.system).toContain("at most 5");
    expect(p.system).toContain("JSON");
  });
});

describe("summariseCodePrompt", () => {
  it("tags every excerpt with its id so quotes can be traced", () => {
    const p = summariseCodePrompt({
      codeName: "Waiting",
      codeDescription: "Delays in care",
      excerpts: [excerpt("e1", "Four hours."), excerpt("e2", "Nobody came.")],
    });
    expect(p.user).toContain("[e1] (Interview 1)");
    expect(p.user).toContain("[e2] (Interview 1)");
    expect(p.user).toContain("Definition: Delays in care");
    expect(p.truncated).toEqual([]);
  });

  it("caps the number of excerpts and says so", () => {
    const many = Array.from({ length: MAX_EXCERPTS + 5 }, (_, i) => excerpt(`e${i}`, "text"));
    const p = summariseCodePrompt({ codeName: "W", codeDescription: "", excerpts: many });
    expect(p.truncated).toEqual([`${MAX_EXCERPTS} of ${many.length} excerpts were sent`]);
    expect(p.user).not.toContain(`[e${MAX_EXCERPTS}]`);
  });

  it("caps a long excerpt and says so", () => {
    const p = summariseCodePrompt({
      codeName: "W",
      codeDescription: "",
      excerpts: [excerpt("e1", "x ".repeat(2000))],
    });
    expect(p.truncated).toEqual([`long excerpts were cut to ${MAX_EXCERPT_CHARS} characters`]);
  });
});

describe("draftDefinitionPrompt", () => {
  it("asks for the four fields as JSON and sends only this code's excerpts", () => {
    const p = draftDefinitionPrompt({
      codeName: "Waiting",
      excerpts: [excerpt("e1", "Four hours.")],
    });
    expect(p.system).toContain('"inclusion"');
    expect(p.system).toContain('"exclusion"');
    expect(p.system).toContain('"example"');
    expect(p.user).toContain("Code: Waiting");
    expect(p.user).toContain("[e1]");
  });
});

describe("assistedMemoFooter", () => {
  it("names the provider and model in the memo body itself", () => {
    expect(assistedMemoFooter("anthropic", "claude-sonnet-5")).toContain(
      "(anthropic, claude-sonnet-5)",
    );
  });
});
