import { describe, expect, it, vi } from "vitest";
import {
  createLogger,
  hashToken,
  looksLikePath,
  redactPathArg,
  redactPathArgs,
  type QueuedLogEntry,
} from "./log";

describe("createLogger", () => {
  it("batches calls made within one flush window into a single sink call", async () => {
    vi.useFakeTimers();
    const sink = vi.fn();
    const log = createLogger(sink);
    log.info("a");
    log.warn("b", { x: 1 });
    log.error("c");
    expect(sink).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(sink).toHaveBeenCalledTimes(1);
    const batch = sink.mock.calls[0]?.[0] as QueuedLogEntry[];
    expect(batch.map((e) => e.message)).toEqual(["a", "b", "c"]);
    expect(batch[1]?.context).toEqual({ x: 1 });
    vi.useRealTimers();
  });

  it("splits a burst larger than the batch cap across more than one sink call", async () => {
    vi.useFakeTimers();
    const sink = vi.fn();
    const log = createLogger(sink);
    for (let i = 0; i < 45; i++) log.info(`entry ${i}`);
    await vi.runAllTimersAsync();
    expect(sink.mock.calls.length).toBeGreaterThan(1);
    const total = sink.mock.calls.reduce(
      (sum, call) => sum + (call[0] as QueuedLogEntry[]).length,
      0,
    );
    expect(total).toBe(45);
    vi.useRealTimers();
  });

  it("flush sends whatever is queued immediately, without waiting for the timer", () => {
    const sink = vi.fn();
    const log = createLogger(sink);
    log.error("urgent");
    log.flush();
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing queued is a no-op", () => {
    const sink = vi.fn();
    createLogger(sink).flush();
    expect(sink).not.toHaveBeenCalled();
  });
});

describe("looksLikePath", () => {
  it("recognizes forward- and back-slash paths", () => {
    expect(looksLikePath("/home/user/study.misket")).toBe(true);
    expect(looksLikePath("C:\\Users\\ada\\study.misket")).toBe(true);
  });

  it("rejects plain words and short strings", () => {
    expect(looksLikePath("hello")).toBe(false);
    expect(looksLikePath("ok")).toBe(false);
    expect(looksLikePath("/")).toBe(false);
  });
});

describe("hashToken", () => {
  it("is deterministic and never contains the input", () => {
    const a = hashToken("/home/user/study.misket");
    const b = hashToken("/home/user/study.misket");
    expect(a).toBe(b);
    expect(a).not.toContain("study");
  });

  it("differs for different inputs", () => {
    expect(hashToken("/a/study.misket")).not.toBe(hashToken("/b/study.misket"));
  });
});

describe("redactPathArg / redactPathArgs", () => {
  it("hashes path-shaped strings and leaves everything else untouched", () => {
    expect(redactPathArg("/home/user/study.misket")).toMatch(/^path:[0-9a-f]{8}$/);
    expect(redactPathArg("Ada Lovelace")).toBe("Ada Lovelace");
    expect(redactPathArg(42)).toBe(42);
    expect(redactPathArg(null)).toBe(null);
  });

  it("redacts only the path-shaped values of an object", () => {
    const out = redactPathArgs({ path: "/a/b/study.misket", name: "Sample study", limit: 5 });
    expect(out.path).toMatch(/^path:[0-9a-f]{8}$/);
    expect(out.name).toBe("Sample study");
    expect(out.limit).toBe(5);
  });
});
