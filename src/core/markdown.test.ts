import { describe, expect, it } from "vitest";
import { markdownTable, mdCell } from "./markdown";

describe("mdCell", () => {
  it("escapes pipes and backslashes", () => {
    expect(mdCell("a | b")).toBe("a \\| b");
    expect(mdCell("back\\slash")).toBe("back\\\\slash");
  });

  it("folds line breaks into <br> and drops blank lines", () => {
    expect(mdCell("one\n\ntwo\r\nthree")).toBe("one<br>two<br>three");
    expect(mdCell("  padded  ")).toBe("padded");
    expect(mdCell("")).toBe("");
  });
});

describe("markdownTable", () => {
  it("writes a padded pipe table", () => {
    const table = markdownTable(
      "Case",
      ["Access", "Cost"],
      [
        { label: "Interview 1", values: ["Waited months", ""] },
        { label: "Interview 2", values: ["", "Fees"] },
      ],
    );
    expect(table.split("\n")).toEqual([
      "| Case        | Access        | Cost |",
      "| ----------- | ------------- | ---- |",
      "| Interview 1 | Waited months |      |",
      "| Interview 2 |               | Fees |",
    ]);
  });

  it("keeps the separator at least three dashes wide", () => {
    expect(markdownTable("A", ["B"], []).split("\n")[1]).toBe("| --- | --- |");
  });
});
