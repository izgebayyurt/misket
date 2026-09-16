import { describe, expect, it } from "vitest";
import { parseCodebookFile, previewCodebookImport, sniffCodebookFormat } from "./codebookImport";

const jsonDoc = JSON.stringify({
  format: "misket-codebook",
  version: 1,
  codes: [
    { id: "a", parentId: null, name: "Attitudes", color: "#D9534F", description: "Top theme" },
    { id: "b", parentId: "a", name: "Positive", color: "#5CB85C", description: "", shortcut: "p" },
  ],
});

describe("sniffCodebookFormat", () => {
  it("recognizes JSON by a leading brace, else CSV", () => {
    expect(sniffCodebookFormat(jsonDoc)).toBe("json");
    expect(sniffCodebookFormat("  \n" + jsonDoc)).toBe("json");
    expect(sniffCodebookFormat("name,parent,color,description,shortcut\n")).toBe("csv");
  });
});

describe("parseCodebookFile: JSON", () => {
  it("resolves each code's full path via parentId, root to leaf", () => {
    const { format, entries } = parseCodebookFile(jsonDoc);
    expect(format).toBe("json");
    expect(entries).toEqual([
      {
        path: ["Attitudes"],
        color: "#D9534F",
        description: "Top theme",
        inclusion: "",
        exclusion: "",
        shortcut: undefined,
      },
      {
        path: ["Attitudes", "Positive"],
        color: "#5CB85C",
        description: "",
        inclusion: "",
        exclusion: "",
        shortcut: "p",
      },
    ]);
  });

  it("rejects a document missing the misket-codebook format tag", () => {
    expect(() => parseCodebookFile('{"codes":[]}')).toThrow(/misket-codebook/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseCodebookFile("{not json")).toThrow(/Invalid JSON/);
  });
});

describe("parseCodebookFile: CSV", () => {
  it("splits the parent column on ' / ' into a nested path", () => {
    const csv =
      "name,parent,color,description,shortcut\n" +
      "Theme,,#5CB85C,A top theme,t\n" +
      "Leaf,Theme / Sub,,Deepest level,\n";
    const { format, entries } = parseCodebookFile(csv);
    expect(format).toBe("csv");
    expect(entries).toEqual([
      {
        path: ["Theme"],
        color: "#5CB85C",
        description: "A top theme",
        inclusion: "",
        exclusion: "",
        shortcut: "t",
      },
      {
        path: ["Theme", "Sub", "Leaf"],
        color: undefined,
        description: "Deepest level",
        inclusion: "",
        exclusion: "",
        shortcut: undefined,
      },
    ]);
  });

  it("rejects a bad header", () => {
    expect(() => parseCodebookFile("name,parent\nAlpha,\n")).toThrow(/Expected CSV header/);
  });

  it("reports the row number for a missing name", () => {
    expect(() =>
      parseCodebookFile("name,parent,color,description,shortcut\nAlpha,,,,\n,Alpha,,,\n"),
    ).toThrow(/Row 3/);
  });

  it("ignores a trailing blank line", () => {
    const { entries } = parseCodebookFile("name,parent,color,description,shortcut\nAlpha,,,,\n\n");
    expect(entries).toHaveLength(1);
  });

  it("reads the definition-field CSV header and still accepts the legacy one", () => {
    const { entries } = parseCodebookFile(
      "name,parent,color,description,inclusion,exclusion,shortcut\n" +
        "Trust,,,Trusting the service,Names trust,Not satisfaction,t\n",
    );
    expect(entries[0]).toMatchObject({
      path: ["Trust"],
      description: "Trusting the service",
      inclusion: "Names trust",
      exclusion: "Not satisfaction",
      shortcut: "t",
    });

    const legacy = parseCodebookFile(
      "name,parent,color,description,shortcut\nDoubt,,,Hesitation,d\n",
    );
    expect(legacy.entries[0]).toMatchObject({
      description: "Hesitation",
      inclusion: "",
      exclusion: "",
      shortcut: "d",
    });
  });
});

describe("previewCodebookImport", () => {
  it("counts matched vs new entries by full path, case-insensitively", () => {
    const csv =
      "name,parent,color,description,shortcut\n" +
      "greeting,,,,\n" + // matches existing "Greeting" (case-insensitive)
      "Farewell,,,,\n"; // new
    const preview = previewCodebookImport(csv, ["Greeting", "Greeting / Formal"]);
    expect(preview).toEqual({ format: "csv", totalCodes: 2, matchedCount: 1, newCount: 1 });
  });
});
