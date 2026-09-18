import { describe, expect, it } from "vitest";
import { mediaUrlFor, serverUrlWith, thumbnailUrlFor } from "./media";

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

  it("addresses an excerpt's captured frame on its own path", () => {
    expect(thumbnailUrlFor("e-1", false)).toBe("misket-media://localhost/thumbnail/e-1");
    expect(thumbnailUrlFor("e-1", true)).toBe("http://misket-media.localhost/thumbnail/e-1");
  });
});

describe("the loopback media server", () => {
  const info = { origin: "http://127.0.0.1:53421", token: "tok en" };

  it("carries this run's token in the query, escaped", () => {
    expect(serverUrlWith(info, "/document/abc")).toBe(
      "http://127.0.0.1:53421/document/abc?t=tok%20en",
    );
  });

  it("builds nothing at all until the backend has answered", () => {
    // A `<video src>` of "null" would be a request for a file called null;
    // the viewer waits instead.
    expect(serverUrlWith(null, "/document/abc")).toBeNull();
  });
});
