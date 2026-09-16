import { describe, expect, it } from "vitest";
import { csvField, matrixCsv, toCsv } from "./csv";

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
});
