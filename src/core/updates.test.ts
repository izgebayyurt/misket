import { describe, expect, it } from "vitest";
import { isNewerVersion, shouldShowUpdateBanner } from "./updates";

describe("isNewerVersion", () => {
  it("recognises a plain newer version", () => {
    expect(isNewerVersion("0.2.0", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.2.1")).toBe(true);
    expect(isNewerVersion("0.2.0", "1.0.0")).toBe(true);
  });

  it("rejects an older or equal version", () => {
    expect(isNewerVersion("0.3.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.3.0")).toBe(false);
  });

  it("pads shorter version strings with zeros", () => {
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2", "1.2.1")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2")).toBe(false);
  });

  it("ignores a leading v", () => {
    expect(isNewerVersion("v0.2.0", "v0.3.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "v0.3.0")).toBe(true);
  });

  it("treats a pre-release as older than the same numbers without one", () => {
    expect(isNewerVersion("0.3.0-beta.1", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.3.0", "0.3.0-beta.1")).toBe(false);
  });

  it("compares two pre-releases of the same numbers lexically", () => {
    expect(isNewerVersion("0.3.0-beta.1", "0.3.0-beta.2")).toBe(true);
    expect(isNewerVersion("0.3.0-beta.2", "0.3.0-beta.1")).toBe(false);
  });

  it("never treats a malformed candidate as newer", () => {
    expect(isNewerVersion("0.2.0", "not-a-version")).toBe(false);
    expect(isNewerVersion("0.2.0", "")).toBe(false);
  });

  it("treats any valid candidate as newer than a malformed current version", () => {
    expect(isNewerVersion("not-a-version", "0.1.0")).toBe(true);
  });
});

describe("shouldShowUpdateBanner", () => {
  it("shows the banner for a newer, unskipped version", () => {
    expect(
      shouldShowUpdateBanner({
        currentVersion: "0.2.0",
        latestVersion: "0.3.0",
        skippedVersion: null,
      }),
    ).toBe(true);
  });

  it("hides the banner for the exact version already skipped", () => {
    expect(
      shouldShowUpdateBanner({
        currentVersion: "0.2.0",
        latestVersion: "0.3.0",
        skippedVersion: "0.3.0",
      }),
    ).toBe(false);
  });

  it("shows the banner again for a version after the one skipped", () => {
    expect(
      shouldShowUpdateBanner({
        currentVersion: "0.2.0",
        latestVersion: "0.3.1",
        skippedVersion: "0.3.0",
      }),
    ).toBe(true);
  });

  it("hides the banner when there is nothing newer", () => {
    expect(
      shouldShowUpdateBanner({
        currentVersion: "0.3.0",
        latestVersion: "0.3.0",
        skippedVersion: undefined,
      }),
    ).toBe(false);
  });
});
