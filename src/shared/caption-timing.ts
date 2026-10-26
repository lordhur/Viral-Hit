/** Output-only subtitle timing adjustment; audio and edit boundaries stay unchanged. */
export const CAPTION_OFFSET_LIMIT_MS = 10_000;

export function sanitizeCaptionOffsetMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(-CAPTION_OFFSET_LIMIT_MS, Math.min(CAPTION_OFFSET_LIMIT_MS, Math.round(value)))
    : 0;
}

/** Preserve every other field (speaker, timing provenance, translated text, …). */
export function shiftCaptionTiming<T extends { startSec: number; endSec: number }>(items: T[], offsetMs: unknown): T[] {
  const offsetSec = sanitizeCaptionOffsetMs(offsetMs) / 1000;
  if (offsetSec === 0) return items;
  return items.map((item) => ({ ...item, startSec: item.startSec + offsetSec, endSec: item.endSec + offsetSec }));
}
