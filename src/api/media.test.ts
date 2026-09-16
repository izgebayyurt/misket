import { describe, expect, it } from "vitest";
import { mediaUrlFor } from "./media";

describe("mediaUrl", () => {
  it("uses the custom scheme on Linux and macOS", () => {
    expect(mediaUrlFor("abc-123", false)).toBe("misket-media://localhost/document/abc-123");
  });

  it("uses the localhost host on Windows, as Tauri maps custom schemes there", () => {
    expect(mediaUrlFor("abc-123", true)).toBe("http://misket-media.localhost/document/abc-123");
  });

  it("escapes anything unexpected in an id", () => {
    expect(mediaUrlFor("a/b?c", false)).toBe("misket-media://localhost/document/a%2Fb%3Fc");
  });
});
