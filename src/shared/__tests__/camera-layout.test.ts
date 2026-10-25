import { describe, expect, it } from "vitest";
import {
  adaptCropToCameraHeight,
  DEFAULT_CAMERA_HEIGHT_FRAC,
  defaultCameraGameplayLayout,
  moveCropRect,
  normalizeCameraGameplayLayout,
  normalizedCameraAspect,
  resizeCropRect,
} from "../camera-layout";

describe("cadrage caméra normalisé", () => {
  it("valide les préférences et replace un cadre hors limites", () => {
    const result = normalizeCameraGameplayLayout({
      cameraHeightFrac: 4,
      cameraCrop: { x: 0.95, y: -0.2, w: 0.4, h: 0.3 },
    });
    expect(result?.cameraHeightFrac).toBe(0.6);
    expect(result?.cameraCrop.x).toBeCloseTo(0.6);
    expect(result?.cameraCrop.y).toBe(0);
    expect(result?.cameraCrop.w).toBe(0.4);
    expect(normalizeCameraGameplayLayout({ cameraCrop: { x: "non" } })).toBeNull();
  });

  it("déplace sans sortir de la source", () => {
    const crop = { x: 0.2, y: 0.2, w: 0.4, h: 0.5 };
    expect(moveCropRect(crop, 2, -2)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.5 });
    expect(moveCropRect(crop, -2, 2)).toEqual({ x: 0, y: 0.5, w: 0.4, h: 0.5 });
  });

  it("redimensionne en conservant les proportions de la zone caméra", () => {
    const initial = defaultCameraGameplayLayout().cameraCrop;
    const resized = resizeCropRect(initial, 0.08, 0, 16 / 9, DEFAULT_CAMERA_HEIGHT_FRAC);
    expect(resized.w).toBeGreaterThan(initial.w);
    expect(resized.w / resized.h).toBeCloseTo(normalizedCameraAspect(16 / 9, DEFAULT_CAMERA_HEIGHT_FRAC), 6);
    expect(resized.x + resized.w).toBeLessThanOrEqual(1);
    expect(resized.y + resized.h).toBeLessThanOrEqual(1);
  });

  it("respecte les limites même en redimensionnant depuis le coin inférieur droit", () => {
    const resized = resizeCropRect({ x: 0.95, y: 0.95, w: 0.05, h: 0.05 }, 1, 1, 16 / 9, 0.4);
    expect(resized.x + resized.w).toBeLessThanOrEqual(1);
    expect(resized.y + resized.h).toBeLessThanOrEqual(1);
    expect(resized.w).toBeGreaterThan(0);
    expect(resized.h).toBeGreaterThan(0);
  });

  it("adapte le cadre quand la hauteur de la caméra change, sans déplacer son centre", () => {
    const initial = { x: 0.2, y: 0.25, w: 0.4, h: 0.3 };
    const adapted = adaptCropToCameraHeight(initial, 0.5, 16 / 9);
    expect(adapted.x + adapted.w / 2).toBeCloseTo(initial.x + initial.w / 2, 6);
    expect(adapted.y + adapted.h / 2).toBeCloseTo(initial.y + initial.h / 2, 6);
    expect(adapted.w / adapted.h).toBeCloseTo(normalizedCameraAspect(16 / 9, 0.5), 6);
  });
});
