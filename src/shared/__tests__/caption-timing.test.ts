import { describe, expect, it } from "vitest";
import { CAPTION_OFFSET_LIMIT_MS, sanitizeCaptionOffsetMs, shiftCaptionTiming } from "../caption-timing";

describe("subtitle output timing", () => {
  it("sanitizes and bounds the manual offset", () => {
    expect(sanitizeCaptionOffsetMs(250.4)).toBe(250);
    expect(sanitizeCaptionOffsetMs(-250.4)).toBe(-250);
    expect(sanitizeCaptionOffsetMs(99_000)).toBe(CAPTION_OFFSET_LIMIT_MS);
    expect(sanitizeCaptionOffsetMs(-99_000)).toBe(-CAPTION_OFFSET_LIMIT_MS);
    expect(sanitizeCaptionOffsetMs(Number.NaN)).toBe(0);
    expect(sanitizeCaptionOffsetMs("500")).toBe(0);
  });

  it("shifts burned-caption and SRT timings without losing speaker provenance", () => {
    const words = [{ text: "Bonjour", startSec: 2, endSec: 2.5, speaker: 1, timingSource: "asr" as const }];
    expect(shiftCaptionTiming(words, 250)).toEqual([{ text: "Bonjour", startSec: 2.25, endSec: 2.75, speaker: 1, timingSource: "asr" }]);
    expect(shiftCaptionTiming(words, -500)[0].startSec).toBe(1.5);
    expect(shiftCaptionTiming(words, 0)).toBe(words);
    expect(words[0].startSec).toBe(2);
  });
});
