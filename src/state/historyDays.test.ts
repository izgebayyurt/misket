import { beforeEach, describe, expect, it } from "vitest";
import { effectiveExpanded, readDayState, toggleDay, writeDayState } from "./historyDays";

beforeEach(() => {
  localStorage.clear();
});

describe("effectiveExpanded", () => {
  const defaults = ["2026-09-17", "2026-09-10"];

  it("opens the view's own defaults when nothing was remembered", () => {
    const open = effectiveExpanded(defaults, { expanded: [], collapsed: [], at: 0 });
    expect([...open].sort()).toEqual(["2026-09-10", "2026-09-17"]);
  });

  it("adds days opened by hand", () => {
    const open = effectiveExpanded(defaults, { expanded: ["2026-09-01"], collapsed: [], at: 0 });
    expect(open.has("2026-09-01")).toBe(true);
  });

  it("lets a day closed by hand win over the default", () => {
    const open = effectiveExpanded(defaults, { expanded: [], collapsed: ["2026-09-17"], at: 0 });
    expect(open.has("2026-09-17")).toBe(false);
    expect(open.has("2026-09-10")).toBe(true);
  });
});

describe("toggleDay", () => {
  it("records a day being opened, dropping any earlier close", () => {
    const next = toggleDay({ expanded: [], collapsed: ["d"], at: 0 }, "d", true);
    expect(next).toEqual({ expanded: ["d"], collapsed: [] });
  });

  it("records a day being closed, dropping any earlier open", () => {
    const next = toggleDay({ expanded: ["d"], collapsed: [], at: 0 }, "d", false);
    expect(next).toEqual({ expanded: [], collapsed: ["d"] });
  });

  it("leaves other days alone", () => {
    const next = toggleDay({ expanded: ["a"], collapsed: ["b"], at: 0 }, "c", true);
    expect(next.expanded).toEqual(["a", "c"]);
    expect(next.collapsed).toEqual(["b"]);
  });

  it("does not stack duplicates when a day is toggled the same way twice", () => {
    let state = { expanded: [] as string[], collapsed: [] as string[], at: 0 };
    state = { ...toggleDay(state, "d", true), at: 0 };
    state = { ...toggleDay(state, "d", true), at: 0 };
    expect(state.expanded).toEqual(["d"]);
  });
});

describe("remembering per project", () => {
  it("round-trips one project's days", () => {
    writeDayState("project-a", { expanded: ["2026-09-17"], collapsed: ["2026-09-01"] });
    const read = readDayState("project-a");
    expect(read.expanded).toEqual(["2026-09-17"]);
    expect(read.collapsed).toEqual(["2026-09-01"]);
    expect(read.at).toBeGreaterThan(0);
  });

  it("keeps projects apart", () => {
    writeDayState("project-a", { expanded: ["a"], collapsed: [] });
    writeDayState("project-b", { expanded: ["b"], collapsed: [] });
    expect(readDayState("project-a").expanded).toEqual(["a"]);
    expect(readDayState("project-b").expanded).toEqual(["b"]);
  });

  it("has nothing for a project it has never seen", () => {
    expect(readDayState("nobody")).toEqual({ expanded: [], collapsed: [], at: 0 });
  });

  it("ignores a project with no id, rather than writing under an empty key", () => {
    writeDayState("", { expanded: ["a"], collapsed: [] });
    expect(readDayState("")).toEqual({ expanded: [], collapsed: [], at: 0 });
  });

  it("survives junk in storage", () => {
    localStorage.setItem("misket:historyDays", "not json");
    expect(readDayState("project-a").expanded).toEqual([]);
    localStorage.setItem("misket:historyDays", JSON.stringify({ "project-a": { nope: 1 } }));
    expect(readDayState("project-a").expanded).toEqual([]);
  });
});
