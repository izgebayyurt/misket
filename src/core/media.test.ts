import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import {
  clampPosition,
  downsamplePeaks,
  formatDuration,
  formatRangeLabel,
  formatTimecode,
  isCodableRange,
  isVideoMime,
  MEDIA_EXTENSIONS,
  mediaMimeForExtension,
  MIN_RANGE_MS,
  parseTimecode,
  peakSlice,
  setInPoint,
  waveformPath,
  setOutPoint,
  unsupportedHint,
} from "./media";

describe("timecodes", () => {
  it("reads as minutes, seconds and tenths, matching the Rust label", () => {
    expect(formatTimecode(0)).toBe("0:00.0");
    expect(formatTimecode(999)).toBe("0:00.9");
    expect(formatTimecode(1_000)).toBe("0:01.0");
    expect(formatTimecode(62_450)).toBe("1:02.4");
    expect(formatTimecode(3_600_000)).toBe("1:00:00.0");
    expect(formatTimecode(3_723_500)).toBe("1:02:03.5");
  });

  it("never shows a negative or non-finite position", () => {
    expect(formatTimecode(-5)).toBe("0:00.0");
    expect(formatTimecode(NaN)).toBe("0:00.0");
    expect(formatTimecode(Infinity)).toBe("0:00.0");
  });

  it("labels a range exactly as the excerpt snapshot does", () => {
    expect(formatRangeLabel(62_450, 69_000)).toBe("[1:02.4–1:09.0]");
  });

  it("drops the tenths for a document listing", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(62_450)).toBe("1:02");
    expect(formatDuration(3_723_500)).toBe("1:02:04");
  });

  it("parses what the inspector's time fields accept", () => {
    expect(parseTimecode("1:02.4")).toBe(62_400);
    expect(parseTimecode(" 0:00.0 ")).toBe(0);
    expect(parseTimecode("90")).toBe(90_000);
    expect(parseTimecode("1:02:03")).toBe(3_723_000);
    expect(parseTimecode("")).toBeNull();
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
    expect(parseTimecode("-5")).toBeNull();
  });

  it("clamps a position into the recording", () => {
    expect(clampPosition(-10, 5_000)).toBe(0);
    expect(clampPosition(9_000, 5_000)).toBe(5_000);
    expect(clampPosition(1_234.6, 5_000)).toBe(1_235);
    expect(clampPosition(NaN, 5_000)).toBe(0);
  });
});

describe("in and out points", () => {
  const duration = 60_000;

  it("sets an in-point and pushes the out-point ahead of it", () => {
    expect(setInPoint(null, 1_000, duration)).toEqual({
      startMs: 1_000,
      endMs: 1_000 + MIN_RANGE_MS,
    });
    // An existing out-point is kept when it is already later.
    expect(setInPoint({ startMs: 0, endMs: 9_000 }, 2_000, duration)).toEqual({
      startMs: 2_000,
      endMs: 9_000,
    });
    // An in-point after the out-point drags the out-point along.
    expect(setInPoint({ startMs: 0, endMs: 1_000 }, 5_000, duration)).toEqual({
      startMs: 5_000,
      endMs: 5_000 + MIN_RANGE_MS,
    });
  });

  it("sets an out-point and keeps it after the in-point", () => {
    expect(setOutPoint(null, 5_000, duration)).toEqual({
      startMs: 5_000 - MIN_RANGE_MS,
      endMs: 5_000,
    });
    expect(setOutPoint({ startMs: 1_000, endMs: 2_000 }, 9_000, duration)).toEqual({
      startMs: 1_000,
      endMs: 9_000,
    });
    // An out-point before the in-point moves the in-point back.
    expect(setOutPoint({ startMs: 8_000, endMs: 9_000 }, 3_000, duration)).toEqual({
      startMs: 3_000 - MIN_RANGE_MS,
      endMs: 3_000,
    });
  });

  it("refuses points with no room for a range", () => {
    // The very end of the recording cannot be an in-point.
    expect(setInPoint(null, duration, duration)).toBeNull();
    expect(setInPoint({ startMs: 1, endMs: 2 }, duration, duration)).toEqual({
      startMs: 1,
      endMs: 2,
    });
    // The very start cannot be an out-point.
    expect(setOutPoint(null, 0, duration)).toBeNull();
  });

  it("only sends a range that the backend will accept", () => {
    expect(isCodableRange(null, duration)).toBe(false);
    expect(isCodableRange({ startMs: 5, endMs: 5 }, duration)).toBe(false);
    expect(isCodableRange({ startMs: 9, endMs: 5 }, duration)).toBe(false);
    expect(isCodableRange({ startMs: 0, endMs: 60_001 }, duration)).toBe(false);
    expect(isCodableRange({ startMs: 0, endMs: 60_000 }, duration)).toBe(true);
    // With no duration known, only the ordering can be checked.
    expect(isCodableRange({ startMs: 0, endMs: 10 }, 0)).toBe(true);
  });
});

describe("waveform peaks", () => {
  it("keeps the loudest sample of each slice", () => {
    const samples = [0, 0.5, -0.9, 0.1, 0.2, 0.3];
    expect(downsamplePeaks(samples, 3)).toEqual([0.5, 0.9, 0.3]);
  });

  it("rounds to two decimals and clamps into 0..1", () => {
    expect(downsamplePeaks([0.126, -1.4], 2)).toEqual([0.13, 1]);
  });

  it("never invents peaks it has no samples for", () => {
    expect(downsamplePeaks([], 100)).toEqual([]);
    expect(downsamplePeaks([0.4, 0.8], 100)).toEqual([0.4, 0.8]);
    // Asking for no peaks still gives one, covering the whole clip.
    expect(downsamplePeaks([0.4, 0.8], 0)).toEqual([0.8]);
  });

  it("covers every sample, whatever the bucket arithmetic", () => {
    const samples = Array.from({ length: 1_000 }, (_, i) => (i === 733 ? 1 : 0.01));
    const peaks = downsamplePeaks(samples, 97);
    expect(peaks).toHaveLength(97);
    expect(Math.max(...peaks)).toBe(1);
  });

  it("slices the peaks an excerpt covers", () => {
    const peaks = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    expect(peakSlice(peaks, 0, 1_000, 10_000)).toEqual([0.1]);
    expect(peakSlice(peaks, 5_000, 7_000, 10_000)).toEqual([0.6, 0.7]);
    // A stretch shorter than one peak still gets one.
    expect(peakSlice(peaks, 5_000, 5_010, 10_000)).toEqual([0.6]);
    expect(peakSlice(peaks, 0, 10_000, 10_000)).toEqual(peaks);
    expect(peakSlice(null, 0, 10, 10_000)).toEqual([]);
    expect(peakSlice(peaks, 0, 10, 0)).toEqual([]);
    expect(peakSlice(peaks, 10, 10, 10_000)).toEqual([]);
  });
});

describe("the waveform path", () => {
  it("draws an envelope around a centre line, in peak coordinates", () => {
    // Two peaks: the path runs along the top left-to-right, then back along
    // the bottom, so it closes into a filled shape.
    expect(waveformPath([1, 0.5])).toBe("M 0 -1 L 1 -0.5 L 1 0.5 L 0 1 Z");
  });

  it("keeps a silent stretch visible", () => {
    // A flat zero would be an invisible zero-height shape.
    expect(waveformPath([0])).toBe("M 0 -0.02 L 0 0.02 Z");
  });

  it("clamps anything out of range and draws nothing from nothing", () => {
    expect(waveformPath([2, -1])).toBe("M 0 -1 L 1 -0.02 L 1 0.02 L 0 1 Z");
    expect(waveformPath([])).toBe("");
  });
});

describe("file types", () => {
  it("maps every extension it advertises to a MIME type", () => {
    for (const ext of MEDIA_EXTENSIONS) {
      expect(mediaMimeForExtension(ext), ext).not.toBeNull();
    }
    expect(mediaMimeForExtension("MP4")).toBe("video/mp4");
    expect(mediaMimeForExtension("txt")).toBeNull();
  });

  it("tells audio from video", () => {
    expect(isVideoMime("video/mp4")).toBe(true);
    expect(isVideoMime("audio/mpeg")).toBe(false);
  });

  it("explains a file that will not play instead of showing a black player", () => {
    const t = i18n.t.bind(i18n);
    expect(unsupportedHint("a.mkv", "mkv", t)).toContain("container");
    expect(unsupportedHint("a.mkv", "mkv", t)).toContain("MP4");
    expect(unsupportedHint("a.mp4", "mp4", t)).toContain("codec");
    expect(unsupportedHint("a.rtf", "rtf", t)).toContain("not an audio or video file");
  });
});
