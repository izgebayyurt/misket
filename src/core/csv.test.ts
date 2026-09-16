import { describe, expect, it } from "vitest";
import { csvField, matrixCsv, parseCsv, toCsv } from "./csv";

describe("csv", () => {
  it("quotes only what needs quoting", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField(12)).toBe("12");
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("joins rows with CRLF and ends with one", () => {
    expect(toCsv([["a", "b"], [1]])).toBe("a,b\r\n1\r\n");
    expect(toCsv([])).toBe("");
  });

  it("writes a labelled matrix", () => {
    const csv = matrixCsv(
      "Code",
      ["Alpha", "Beta, again"],
      [
        { label: "Alpha", values: [2, 0] },
        { label: "Beta, again", values: [0, 3] },
      ],
    );
    expect(csv).toBe('Code,Alpha,"Beta, again"\r\nAlpha,2,0\r\n"Beta, again",0,3\r\n');
  });

  it("parses plain rows with CRLF or LF endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses quoted fields with embedded commas, quotes and newlines", () => {
    expect(parseCsv('"a,b",c\n')).toEqual([["a,b", "c"]]);
    expect(parseCsv('"say ""hi""",c\n')).toEqual([['say "hi"', "c"]]);
    expect(parseCsv('"two\nlines",c\n')).toEqual([["two\nlines", "c"]]);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["name", "parent"],
      ["Alpha", ""],
      ["Beta, again", "Alpha"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("returns no rows for empty input, one empty row for a blank line", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n")).toEqual([[""]]);
  });
});
