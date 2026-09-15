import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baseName, extensionOf, importFile } from "./index";

const fixtures = path.resolve(__dirname, "../../../fixtures");
const read = (name: string) => new Uint8Array(readFileSync(path.join(fixtures, name)));

describe("importers", () => {
  it("splits extension and base name", () => {
    expect(extensionOf("/a/b/Interview One.DOCX")).toBe("docx");
    expect(extensionOf("C:\\x\\notes.md")).toBe("md");
    expect(extensionOf("noext")).toBe("");
    expect(baseName("/a/b/Interview One.docx")).toBe("Interview One");
    expect(baseName(".hidden")).toBe(".hidden");
  });

  it("imports txt and md as raw text", async () => {
    const txt = await importFile("sample.txt", read("sample.txt"));
    expect(txt.sourceFormat).toBe("txt");
    expect(txt.text).toContain("first interview");
    const md = await importFile("sample.md", read("sample.md"));
    expect(md.sourceFormat).toBe("md");
    expect(md.text.startsWith("# Field notes")).toBe(true);
  });

  it("extracts paragraphs from docx", async () => {
    const doc = await importFile("sample.docx", read("sample.docx"));
    expect(doc.sourceFormat).toBe("docx");
    expect(doc.text).toBe("Hello from Word.\nSecond paragraph with émoji 😀.\n");
  });

  it("rejects unknown extensions", async () => {
    await expect(importFile("x.pdf", new Uint8Array())).rejects.toThrow(/Unsupported/);
  });
});
