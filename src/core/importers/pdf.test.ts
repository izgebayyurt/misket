import { describe, expect, it } from "vitest";
import { joinPages } from "./pdf";

describe("joinPages", () => {
  it("separates pages with a single blank line", () => {
    expect(joinPages(["Page one.", "Page two."])).toBe("Page one.\n\nPage two.\n");
  });

  it("drops pages with only whitespace", () => {
    expect(joinPages(["Page one.", "   \n  ", "Page three."])).toBe("Page one.\n\nPage three.\n");
  });

  it("returns just a trailing newline for no pages at all", () => {
    expect(joinPages([])).toBe("\n");
  });

  it("returns just a trailing newline when every page is blank", () => {
    expect(joinPages(["", "   ", "\n"])).toBe("\n");
  });

  it("always ends with exactly one trailing newline", () => {
    expect(joinPages(["Only page.\n\n\n"])).toBe("Only page.\n");
  });

  it("matches the text importer's own separator for a single page", () => {
    expect(joinPages(["One page only."])).toBe("One page only.\n");
  });
});
