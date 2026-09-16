import { describe, expect, it } from "vitest";
import { absoluteTime, kindGroup, kindLabel, relativeTime } from "./activity";

describe("kindLabel", () => {
  it("reads a dotted, underscored kind as a sentence", () => {
    expect(kindLabel("code.created")).toBe("Code created");
    expect(kindLabel("code.merged_into")).toBe("Code merged into");
    expect(kindLabel("descriptor.field_created")).toBe("Descriptor field created");
    expect(kindLabel("undo")).toBe("Undo");
  });

  it("leaves something it cannot read alone", () => {
    expect(kindLabel("")).toBe("");
    expect(kindLabel("  ")).toBe("  ");
  });
});

describe("kindGroup", () => {
  it("is the part before the dot", () => {
    expect(kindGroup("excerpt.split")).toBe("excerpt");
    expect(kindGroup("redo")).toBe("redo");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-03-10T12:00:00Z");

  it("counts back in minutes, hours and days", () => {
    expect(relativeTime("2026-03-10T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-03-10T11:48:00Z", now)).toBe("12m ago");
    expect(relativeTime("2026-03-10T07:00:00Z", now)).toBe("5h ago");
    expect(relativeTime("2026-03-07T12:00:00Z", now)).toBe("3d ago");
  });

  it("falls back to a date once it is a month old", () => {
    expect(relativeTime("2025-12-01T12:00:00Z", now)).toBe(
      new Date("2025-12-01T12:00:00Z").toLocaleDateString(),
    );
  });

  it("does not throw on nonsense", () => {
    expect(relativeTime("not a date", now)).toBe("–");
    expect(absoluteTime("not a date")).toBe("not a date");
  });
});
