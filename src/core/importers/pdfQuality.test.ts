import { describe, expect, it } from "vitest";
import { classifyPdfQuality, looksScanned, scannedPdfMessage } from "./pdfQuality";

describe("classifyPdfQuality", () => {
  it("classifies a normal text PDF as text", () => {
    const stats = classifyPdfQuality([1200, 980, 1500]);
    expect(stats.classification).toBe("text");
    expect(stats.totalPages).toBe(3);
    expect(stats.emptyPages).toBe(0);
    expect(looksScanned(stats)).toBe(false);
  });

  it("classifies a fully scanned PDF (no text on any page) as empty", () => {
    const stats = classifyPdfQuality([0, 0, 0]);
    expect(stats.classification).toBe("empty");
    expect(stats.emptyPages).toBe(3);
    expect(looksScanned(stats)).toBe(true);
  });

  it("classifies a PDF with zero pages as empty", () => {
    const stats = classifyPdfQuality([]);
    expect(stats.classification).toBe("empty");
    expect(stats.totalPages).toBe(0);
    expect(stats.avgCharsPerPage).toBe(0);
  });

  it("classifies a PDF where more than half the pages are empty as sparse", () => {
    // 3 of 5 pages empty (60%), the rest have plenty of text.
    const stats = classifyPdfQuality([500, 0, 0, 0, 600]);
    expect(stats.classification).toBe("sparse");
    expect(stats.emptyPages).toBe(3);
    expect(looksScanned(stats)).toBe(true);
  });

  it("classifies a PDF with low average characters per page as sparse even with no empty pages", () => {
    // Every page has a little text (e.g. a caption or watermark) but well
    // under the per-page threshold.
    const stats = classifyPdfQuality([5, 8, 3, 10]);
    expect(stats.classification).toBe("sparse");
    expect(stats.emptyPages).toBe(0);
    expect(looksScanned(stats)).toBe(true);
  });

  it("does not classify as sparse when both the average and empty-page fraction are fine", () => {
    // One empty page out of 5 (20%) is within tolerance, and the average
    // across the rest is well above the sparse threshold.
    const stats = classifyPdfQuality([300, 0, 400, 350, 500]);
    expect(stats.classification).toBe("text");
  });

  it("sits exactly on the empty-page-fraction boundary as text (must exceed, not equal)", () => {
    // 2 of 4 pages empty is exactly 50%, and the average across all 4 pages
    // is high; the boundary is "greater than", not "at least".
    const stats = classifyPdfQuality([1000, 0, 1000, 0]);
    expect(stats.emptyPages / stats.totalPages).toBe(0.5);
    expect(stats.classification).toBe("text");
  });

  it("computes avgCharsPerPage across all pages, not just non-empty ones", () => {
    const stats = classifyPdfQuality([100, 0]);
    expect(stats.avgCharsPerPage).toBe(50);
  });
});

describe("scannedPdfMessage", () => {
  it("mentions the empty-page count when pages are literally empty", () => {
    const stats = classifyPdfQuality([0, 0, 500]);
    expect(scannedPdfMessage(stats)).toBe(
      "This PDF looks scanned: 2 of 3 pages have no text layer.",
    );
  });

  it("handles a one-page PDF", () => {
    const stats = classifyPdfQuality([0]);
    expect(scannedPdfMessage(stats)).toBe(
      "This PDF looks scanned: 1 of 1 pages have no text layer.",
    );
  });

  it("describes low-density text when no page is fully empty", () => {
    const stats = classifyPdfQuality([5, 8, 3, 10]);
    expect(scannedPdfMessage(stats)).toMatch(/only about \d+ characters of text each/);
  });
});
