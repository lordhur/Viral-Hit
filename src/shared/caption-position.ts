export const CAPTION_X_BOUNDS = { min: 0.15, max: 0.85 } as const;
export const CAPTION_Y_BOUNDS = { min: 0.15, max: 0.9 } as const;

export function boundedCaptionFraction(value: unknown, bounds: { min: number; max: number }): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(bounds.min, Math.min(bounds.max, value))
    : undefined;
}
