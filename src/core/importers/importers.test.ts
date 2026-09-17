import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { baseName, extensionOf, imageMimeForPath, importFile, SUPPORTED_EXTENSIONS } from "./index";
import { configurePdfWorker, linesFromItems } from "./pdf";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// Node has no Web Worker; pdf.js falls back to importing the worker module.
configurePdfWorker(
  createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
);

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

  it("extracts lines and pages from a pdf", async () => {
    const doc = await importFile("sample.pdf", read("sample.pdf"));
    expect(doc.sourceFormat).toBe("pdf");
    expect(doc.text).toBe("Hello from a PDF.\nSecond line on page one.\n\nPage two starts here.\n");
    // A normal PDF's text layer classifies as "text", not scanned.
    expect(doc.pdfQuality?.classification).toBe("text");
  });

  it("classifies a scanned PDF (image page, no text layer) as empty", async () => {
    const doc = await importFile("scanned.pdf", read("scanned.pdf"));
    expect(doc.sourceFormat).toBe("pdf");
    expect(doc.text.trim()).toBe("");
    expect(doc.pdfQuality?.classification).toBe("empty");
    expect(doc.pdfQuality?.totalPages).toBe(1);
    expect(doc.pdfQuality?.emptyPages).toBe(1);
    // Kept around so the import flow can offer OCR on it.
    expect(doc.pdfBytes?.length).toBeGreaterThan(0);
  });

  it("groups positioned runs into lines with spaces at gaps", () => {
    const run = (str: string, x: number, y: number, width = str.length * 5): TextItem =>
      ({
        str,
        transform: [1, 0, 0, 1, x, y],
        width,
        height: 10,
        dir: "ltr",
        fontName: "F1",
        hasEOL: false,
      }) as TextItem;
    const text = linesFromItems([
      run("world", 70, 700), // out of order on purpose
      run("Hello", 10, 701), // baseline within tolerance of 700
      run("Below", 10, 680),
      run("same", 40, 700, 20),
      run("tight", 96, 700), // touches "world" (ends at 95): no space
    ]);
    expect(text).toBe("Hello same worldtight\nBelow");
  });

  it("recognises image extensions by their MIME type", () => {
    expect(imageMimeForPath("/a/b/Poster.PNG")).toBe("image/png");
    expect(imageMimeForPath("shot.jpg")).toBe("image/jpeg");
    expect(imageMimeForPath("shot.jpeg")).toBe("image/jpeg");
    expect(imageMimeForPath("diagram.webp")).toBe("image/webp");
    expect(imageMimeForPath("notes.txt")).toBeNull();
    expect(imageMimeForPath("scan.gif")).toBeNull();
    expect(imageMimeForPath("noext")).toBeNull();
    // Every image extension is offered in the file dialog.
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      expect(SUPPORTED_EXTENSIONS).toContain(ext);
    }
  });

  it("rejects unknown extensions", async () => {
    await expect(importFile("x.rtf", new Uint8Array())).rejects.toThrow(/Unsupported/);
    // Images are imported by the hook, not parsed into text here.
    await expect(importFile("x.png", new Uint8Array())).rejects.toThrow(/Unsupported/);
  });
});
