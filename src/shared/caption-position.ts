import type { BrandStyle, CaptionStyleChoice } from "./api-types";

export const CAPTION_X_BOUNDS = { min: 0.15, max: 0.85 } as const;
export const CAPTION_Y_BOUNDS = { min: 0.15, max: 0.9 } as const;
export const CAPTION_PRESET_Y: Record<"low" | "standard" | "high", number> = { low: 0.78, standard: 0.708, high: 0.635 };

export function boundedCaptionFraction(value: unknown, bounds: { min: number; max: number }): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(bounds.min, Math.min(bounds.max, value))
    : undefined;
}

/** Shared 9:16 preview geometry; manual values win over preset/style defaults. */
export function captionDisplayPosition(style?: BrandStyle, captionStyle: CaptionStyleChoice = "keyword"): { x: number; y: number } {
  const preset = style?.captionPosition ?? "standard";
  return {
    x: boundedCaptionFraction(style?.captionX, CAPTION_X_BOUNDS) ?? 0.5,
    y: boundedCaptionFraction(style?.captionY, CAPTION_Y_BOUNDS) ?? (captionStyle === "hormozi" ? 0.6 : CAPTION_PRESET_Y[preset]),
  };
}
