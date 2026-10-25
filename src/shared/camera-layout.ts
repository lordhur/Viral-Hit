/**
 * Géométrie commune à l’éditeur de cadrage et au rendu FFmpeg.
 * Les rectangles sont normalisés dans la source horizontale (0..1), afin de
 * survivre aux changements de résolution et de rester sérialisables dans les
 * préférences/projets existants.
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraGameplayLayout {
  /** Part de la hauteur verticale réservée à la caméra (le jeu prend le reste). */
  cameraHeightFrac: number;
  /** Cadre caméra choisi par l’utilisateur dans la vidéo horizontale. */
  cameraCrop: CropRect;
}

export const VERTICAL_WIDTH = 1080;
export const VERTICAL_HEIGHT = 1920;
export const MIN_CAMERA_HEIGHT_FRAC = 0.3;
export const MAX_CAMERA_HEIGHT_FRAC = 0.6;
export const DEFAULT_CAMERA_HEIGHT_FRAC = 0.4;
export const MIN_CROP_SIZE = 0.05;

/** Cadre initial adapté à une source 16:9 et une zone caméra de 40 %. */
export const DEFAULT_CAMERA_CROP: CropRect = Object.freeze({
  x: 0.3,
  y: 0.04,
  w: 0.4,
  h: 0.505936,
});

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Conserve la taille autant que possible et replace le cadre dans la source. */
export function sanitizeCropRect(value: CropRect): CropRect {
  const w = clamp(value.w, MIN_CROP_SIZE, 1);
  const h = clamp(value.h, MIN_CROP_SIZE, 1);
  return {
    x: clamp(value.x, 0, 1 - w),
    y: clamp(value.y, 0, 1 - h),
    w,
    h,
  };
}

/** Validation à la frontière IPC/préférences : une forme invalide est ignorée. */
export function normalizeCameraGameplayLayout(value: unknown): CameraGameplayLayout | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CameraGameplayLayout>;
  const crop = candidate.cameraCrop;
  if (!crop || typeof crop !== "object" || ![crop.x, crop.y, crop.w, crop.h].every(finite)) return null;
  return {
    cameraHeightFrac: finite(candidate.cameraHeightFrac)
      ? clamp(candidate.cameraHeightFrac, MIN_CAMERA_HEIGHT_FRAC, MAX_CAMERA_HEIGHT_FRAC)
      : DEFAULT_CAMERA_HEIGHT_FRAC,
    cameraCrop: sanitizeCropRect(crop),
  };
}

export function defaultCameraGameplayLayout(): CameraGameplayLayout {
  return {
    cameraHeightFrac: DEFAULT_CAMERA_HEIGHT_FRAC,
    cameraCrop: { ...DEFAULT_CAMERA_CROP },
  };
}

export function moveCropRect(crop: CropRect, dx: number, dy: number): CropRect {
  return sanitizeCropRect({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

/**
 * Ratio du cadre normalisé nécessaire pour que, une fois les dimensions de la
 * source appliquées, la caméra ait exactement les proportions de sa zone 9:16.
 */
export function normalizedCameraAspect(sourceAspect: number, cameraHeightFrac: number): number {
  const outputAspect = VERTICAL_WIDTH / (VERTICAL_HEIGHT * clamp(cameraHeightFrac, MIN_CAMERA_HEIGHT_FRAC, MAX_CAMERA_HEIGHT_FRAC));
  return outputAspect / Math.max(0.01, sourceAspect);
}

/** Redimensionnement par la poignée bas/droite, sans déformer la caméra. */
export function resizeCropRect(
  crop: CropRect,
  dw: number,
  dh: number,
  sourceAspect: number,
  cameraHeightFrac: number,
): CropRect {
  const aspect = normalizedCameraAspect(sourceAspect, cameraHeightFrac);
  const fromWidth = crop.w + dw;
  const fromHeight = (crop.h + dh) * aspect;
  const desiredW = Math.abs(dw) / Math.max(crop.w, 0.01) >= Math.abs(dh) / Math.max(crop.h, 0.01)
    ? fromWidth
    : fromHeight;
  const maxW = Math.max(0.001, Math.min(1 - crop.x, (1 - crop.y) * aspect));
  const w = clamp(desiredW, Math.min(MIN_CROP_SIZE, maxW), maxW);
  const h = w / aspect;
  return sanitizeCropRect({ ...crop, w, h });
}

/** Change la hauteur de la zone caméra tout en gardant le centre du cadrage. */
export function adaptCropToCameraHeight(
  crop: CropRect,
  cameraHeightFrac: number,
  sourceAspect: number,
): CropRect {
  const aspect = normalizedCameraAspect(sourceAspect, cameraHeightFrac);
  const centerX = crop.x + crop.w / 2;
  const centerY = crop.y + crop.h / 2;
  let w = crop.w;
  let h = w / aspect;
  if (h > 1) {
    h = 1;
    w = h * aspect;
  }
  return sanitizeCropRect({ x: centerX - w / 2, y: centerY - h / 2, w, h });
}
