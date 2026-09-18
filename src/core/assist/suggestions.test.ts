import { describe, expect, it } from "vitest";
import { extractJson, parseDefinition, parseSuggestions } from "./suggestions";

const known = new Set(["c1", "c2"]);

describe("extractJson", () => {
  it("reads bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads JSON out of a fenced block", () => {
    expect(extractJson('Here you go:\n```json\n[{"a":1}]\n```\nHope that helps.')).toEqual([
      { a: 1 },
    ]);
  });

  it("reads JSON with prose in front of it", () => {
    expect(extractJson('Sure! [{"codeId":"c1"}]')).toEqual([{ codeId: "c1" }]);
  });

  it("gives up quietly on prose", () => {
    expect(extractJson("I am afraid I cannot help with that.")).toBeUndefined();
  });

  it("gives up quietly on truncated JSON", () => {
    expect(extractJson('[{"codeId":"c1", "rat')).toBeUndefined();
  });
});

describe("parseSuggestions", () => {
  it("reads a well-formed answer", () => {
    const raw = JSON.stringify([
      { codeId: "c1", newCodeName: null, confidence: 0.8, rationale: "Mentions waiting." },
      { codeId: null, newCodeName: "Corridor care", confidence: 0.4, rationale: "New theme." },
    ]);
    expect(parseSuggestions(raw, known)).toEqual([
      { codeId: "c1", newCodeName: null, confidence: 0.8, rationale: "Mentions waiting." },
      { codeId: null, newCodeName: "Corridor care", confidence: 0.4, rationale: "New theme." },
    ]);
  });

  it("drops an id that is not in the codebook rather than trusting it", () => {
    const raw = '[{"codeId":"made-up","confidence":0.9,"rationale":"x"}]';
    expect(parseSuggestions(raw, known)).toEqual([]);
  });

  it("does not turn a bad id into a new code", () => {
    const raw = '[{"codeId":"nope","newCodeName":"Something","confidence":0.9,"rationale":"x"}]';
    expect(parseSuggestions(raw, known)).toEqual([]);
  });

  it("accepts snake_case keys and a 0-100 confidence", () => {
    const raw = '[{"code_id":"c2","confidence":75,"reason":"Close enough."}]';
    expect(parseSuggestions(raw, known)).toEqual([
      { codeId: "c2", newCodeName: null, confidence: 0.75, rationale: "Close enough." },
    ]);
  });

  it("falls back to 0.5 when the confidence is missing or nonsense", () => {
    const raw = '[{"codeId":"c1"},{"codeId":"c2","confidence":"high"}]';
    expect(parseSuggestions(raw, known).map((s) => s.confidence)).toEqual([0.5, 0.5]);
  });

  it("clamps a confidence outside the range", () => {
    const raw = '[{"codeId":"c1","confidence":-3},{"codeId":"c2","confidence":1000}]';
    expect(parseSuggestions(raw, known).map((s) => s.confidence)).toEqual([0, 1]);
  });

  it("unwraps an object that holds the array", () => {
    const raw = '{"suggestions":[{"codeId":"c1","confidence":0.5,"rationale":"x"}]}';
    expect(parseSuggestions(raw, known)).toHaveLength(1);
  });

  it("accepts a single suggestion returned bare", () => {
    expect(parseSuggestions('{"codeId":"c1","confidence":0.5,"rationale":"x"}', known)).toHaveLength(
      1,
    );
  });

  it("keeps the same code only once", () => {
    const raw = '[{"codeId":"c1","rationale":"a"},{"codeId":"c1","rationale":"b"}]';
    expect(parseSuggestions(raw, known)).toHaveLength(1);
  });

  it("keeps at most five", () => {
    const raw = JSON.stringify(
      Array.from({ length: 12 }, (_, i) => ({ newCodeName: `New ${i}`, confidence: 0.5 })),
    );
    expect(parseSuggestions(raw, known)).toHaveLength(5);
  });

  it("is an empty list, not an error, for prose", () => {
    expect(parseSuggestions("I could not decide.", known)).toEqual([]);
  });

  it("skips entries that are neither a known code nor a name", () => {
    expect(parseSuggestions('[{"confidence":0.9},"nonsense",null,42]', known)).toEqual([]);
  });

  it("survives an empty string", () => {
    expect(parseSuggestions("", known)).toEqual([]);
  });
});

describe("parseDefinition", () => {
  it("reads the four fields", () => {
    const raw = `\`\`\`json
{"description":"Delays.","inclusion":"Any wait.","exclusion":"Not travel.","example":"Four hours."}
\`\`\``;
    expect(parseDefinition(raw)).toEqual({
      description: "Delays.",
      inclusion: "Any wait.",
      exclusion: "Not travel.",
      example: "Four hours.",
    });
  });

  it("fills missing fields with empty strings", () => {
    expect(parseDefinition('{"description":"Delays."}')).toEqual({
      description: "Delays.",
      inclusion: "",
      exclusion: "",
      example: "",
    });
  });

  it("is null when nothing usable came back", () => {
    expect(parseDefinition("sorry, no")).toBeNull();
    expect(parseDefinition('{"description":"","inclusion":""}')).toBeNull();
    expect(parseDefinition("[1,2,3]")).toBeNull();
  });

  it("ignores non-string values", () => {
    expect(parseDefinition('{"description":42,"inclusion":"Any wait."}')).toEqual({
      description: "",
      inclusion: "Any wait.",
      exclusion: "",
      example: "",
    });
  });
});
