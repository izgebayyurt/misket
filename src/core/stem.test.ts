import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stem } from "./stem";

describe("stem", () => {
  it("passes short words through lowercased", () => {
    expect(stem("Is")).toBe("is");
    expect(stem("a")).toBe("a");
  });

  it("reduces common inflections to a shared stem", () => {
    const pairs: [string, string][] = [
      ["running", "runs"],
      ["connected", "connection"],
      ["coding", "coded"],
      ["codes", "coding"],
      ["interviews", "interviewing"],
    ];
    for (const [a, b] of pairs) {
      expect(stem(a), `${a} and ${b} should share a stem`).toBe(stem(b));
    }
  });

  it("matches step 1a/1b examples from the Porter paper", () => {
    expect(stem("caresses")).toBe("caress");
    expect(stem("ponies")).toBe("poni");
    expect(stem("ties")).toBe("ti");
    expect(stem("caress")).toBe("caress");
    expect(stem("cats")).toBe("cat");
    expect(stem("feed")).toBe("feed");
    expect(stem("agreed")).toBe("agre");
    expect(stem("plastered")).toBe("plaster");
    expect(stem("bled")).toBe("bled");
    expect(stem("motoring")).toBe("motor");
    expect(stem("sing")).toBe("sing");
    expect(stem("conflated")).toBe("conflat");
    expect(stem("troubled")).toBe("troubl");
    expect(stem("sized")).toBe("size");
    expect(stem("hopping")).toBe("hop");
    expect(stem("tanned")).toBe("tan");
    expect(stem("falling")).toBe("fall");
    expect(stem("hissing")).toBe("hiss");
    expect(stem("fizzed")).toBe("fizz");
    expect(stem("failing")).toBe("fail");
    expect(stem("filing")).toBe("file");
  });

  it("matches the step 1c example", () => {
    expect(stem("happy")).toBe("happi");
    expect(stem("sky")).toBe("sky");
  });

  it("is idempotent on words with no recognized suffix", () => {
    for (const w of ["misket", "qualcoder", "hello", "zzz"]) {
      expect(stem(w)).toBe(stem(stem(w)));
    }
  });

  it("matches the shared fixture also used by the Rust stemmer's test", () => {
    const fixturePath = path.resolve(__dirname, "../../fixtures/stems.json");
    const pairs: [string, string][] = JSON.parse(readFileSync(fixturePath, "utf-8"));
    expect(pairs.length).toBeGreaterThan(0);
    const mismatches = pairs
      .map(([word, expected]) => [word, expected, stem(word)] as const)
      .filter(([, expected, got]) => expected !== got);
    expect(mismatches).toEqual([]);
  });
});
