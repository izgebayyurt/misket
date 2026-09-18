import { describe, expect, it } from "vitest";
import { parseSrt } from "./srt";
import { looksLikeVtt, parseVtt } from "./vtt";
import { cueTimecode, parseCueTime, stripCueMarkup } from "./subtitles";

const SRT = `1
00:00:04,000 --> 00:00:08,200
I had been there before.

2
00:00:09,000 --> 00:00:12,000
<v Bob>How long before?

3
00:00:12,500 --> 00:00:16,000
Years. It was
a different place then.
`;

describe("parseCueTime", () => {
  it("reads both punctuations and an optional hour", () => {
    expect(parseCueTime("00:00:04,000")).toBe(4_000);
    expect(parseCueTime("00:00:04.000")).toBe(4_000);
    expect(parseCueTime("01:02:03,500")).toBe(3_723_500);
    expect(parseCueTime("02:03.500")).toBe(123_500);
    expect(parseCueTime("00:00:01,5")).toBe(1_500);
  });

  it("refuses a line of dialogue", () => {
    for (const bad of ["", "4", "00:00:04", "Years.", "00:99:04,000", "1:2:3,4"]) {
      expect(parseCueTime(bad), bad).toBeNull();
    }
  });
});

describe("cueTimecode", () => {
  it("is mm:ss under an hour and h:mm:ss from an hour on", () => {
    expect(cueTimecode(0)).toBe("0:00");
    expect(cueTimecode(4_000)).toBe("0:04");
    expect(cueTimecode(754_000)).toBe("12:34");
    expect(cueTimecode(3_723_000)).toBe("1:02:03");
  });
});

describe("stripCueMarkup", () => {
  it("drops tags, positioning and entities", () => {
    expect(stripCueMarkup("<i>Well</i>, {\\an8}then &amp; there")).toBe("Well, then & there");
    expect(stripCueMarkup("  spaced    out  ")).toBe("spaced out");
  });
});

describe("parseSrt", () => {
  it("makes one paragraph per cue, with the timestamp in front", () => {
    const { text, anchors, cueCount } = parseSrt(SRT);
    expect(cueCount).toBe(3);
    expect(text).toBe(
      "[0:04] I had been there before.\n" +
        "[0:09] Bob: How long before?\n" +
        "[0:12] Years. It was a different place then.\n",
    );
    expect(anchors).toEqual([
      { pos: 0, ms: 4_000 },
      { pos: 32, ms: 9_000 },
      { pos: 61, ms: 12_500 },
    ]);
  });

  it("anchors each paragraph at its own first code point", () => {
    const { text, anchors } = parseSrt(SRT);
    const paragraphs = text.split("\n");
    for (const [i, anchor] of anchors.entries()) {
      expect([...text].slice(anchor.pos, anchor.pos + paragraphs[i]!.length).join("")).toBe(
        paragraphs[i],
      );
    }
  });

  it("counts code points, not UTF-16 units", () => {
    const { text, anchors } = parseSrt(
      "1\n00:00:01,000 --> 00:00:02,000\n😀 😀\n\n2\n00:00:03,000 --> 00:00:04,000\nnext\n",
    );
    // "[0:01] 😀 😀" is 10 code points; the next paragraph starts at 11.
    expect(anchors[1]!.pos).toBe(11);
    expect([...text][11]).toBe("[");
  });

  it("skips malformed cues instead of failing the file", () => {
    const { text, cueCount } = parseSrt(
      `1
00:00:01,000 --> 00:00:02,000
Good.

2
not a timing line
Dropped.

3
00:00:05,000 --> 00:00:04,000
Ends before it starts.

4
00:00:06,000 --> 00:00:07,000

5
00:00:08,000 --> 00:00:09,000
Also good.
`,
    );
    expect(cueCount).toBe(2);
    expect(text).toBe("[0:01] Good.\n[0:08] Also good.\n");
  });

  it("puts cues in time order however the file lists them", () => {
    const { text } = parseSrt(
      "2\n00:00:09,000 --> 00:00:10,000\nSecond.\n\n1\n00:00:01,000 --> 00:00:02,000\nFirst.\n",
    );
    expect(text).toBe("[0:01] First.\n[0:09] Second.\n");
  });

  it("reads hour-long timestamps", () => {
    const { text, anchors } = parseSrt("1\n01:02:03,000 --> 01:02:05,000\nLate in the day.\n");
    expect(text).toBe("[1:02:03] Late in the day.\n");
    expect(anchors).toEqual([{ pos: 0, ms: 3_723_000 }]);
  });

  it("produces text the transcript presets can read as speaker turns", () => {
    // `[00:12] Name:` is one of the built-in presets, which is the point of
    // laying the cues out this way.
    const { text } = parseSrt(SRT);
    const preset = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\][ \t]*([^:\n]{1,40}):[ \t]*/;
    const withSpeaker = text.split("\n").filter((line) => preset.test(line));
    expect(withSpeaker).toEqual(["[0:09] Bob: How long before?"]);
  });

  it("is empty for a file with no cues at all", () => {
    expect(parseSrt("")).toEqual({ text: "", anchors: [], cueCount: 0 });
    expect(parseSrt("just some prose\nover two lines\n").cueCount).toBe(0);
  });
});

const VTT = `WEBVTT - Interview 3

NOTE
Recorded on a phone; the first minute is room tone.

STYLE
::cue { color: papayawhip }

opening
00:00.000 --> 00:04.000 align:start position:10%
<v Alice>I had been <i>there</i> before.

00:04.000 --> 00:09.000
<v.loud Bob>How long before?
Really.
`;

describe("parseVtt", () => {
  it("ignores the header, notes and styles and keeps the cues", () => {
    const { text, anchors, cueCount } = parseVtt(VTT);
    expect(cueCount).toBe(2);
    expect(text).toBe(
      "[0:00] Alice: I had been there before.\n[0:04] Bob: How long before? Really.\n",
    );
    expect(anchors).toEqual([
      { pos: 0, ms: 0 },
      { pos: 39, ms: 4_000 },
    ]);
  });

  it("recognises a VTT file by its header", () => {
    expect(looksLikeVtt(VTT)).toBe(true);
    expect(looksLikeVtt("\uFEFFWEBVTT\n")).toBe(true);
    expect(looksLikeVtt(SRT)).toBe(false);
  });

  it("takes CRLF line endings and a BOM", () => {
    const { text } = parseVtt("\uFEFFWEBVTT\r\n\r\n00:00.000 --> 00:02.000\r\nHello.\r\n");
    expect(text).toBe("[0:00] Hello.\n");
  });

  it("drops a voice tag with no name and keeps the words", () => {
    const { text } = parseVtt("WEBVTT\n\n00:00.000 --> 00:02.000\n<v >Hello.\n");
    expect(text).toBe("[0:00] Hello.\n");
  });
});
