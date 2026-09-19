import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Runs the same check as `pnpm i18n:check` (scripts/i18n-extract.mjs) inside
 * `pnpm test`, so a missing/unused key fails CI the same way a broken test
 * would, not just a separate script someone has to remember to run.
 */
describe("i18n:check", () => {
  it("finds no missing or unused keys in the locale resources", () => {
    const script = path.resolve(__dirname, "../../scripts/i18n-extract.mjs");
    expect(() => execFileSync("node", [script], { stdio: "pipe" })).not.toThrow();
  });
});
