import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { LuCrop, LuRotateCcw, LuCheck, LuX } from "react-icons/lu";
import { getApi } from "../api/provider";
import { useT } from "../i18n/store";
import { useRenderPrefs } from "../stores/render-prefs-store";
import { ModalShell } from "./ui";
import {
  adaptCropToCameraHeight,
  cameraCropPercentStyle,
  DEFAULT_CAMERA_HEIGHT_FRAC,
  defaultCameraGameplayLayout,
  MAX_CAMERA_HEIGHT_FRAC,
  MIN_CAMERA_HEIGHT_FRAC,
  moveCropRect,
  resizeCropRect,
  sanitizeCropRect,
  type CropRect,
} from "../../../shared/camera-layout";

interface DragState {
  mode: "move" | "resize";
  pointerX: number;
  pointerY: number;
  width: number;
  height: number;
  crop: CropRect;
}

function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** Éditeur du cadre caméra ; la géométrie enregistrée est celle du rendu FFmpeg. */
export function CameraLayoutModal({
  filePath,
  durationSec,
  onClose,
}: {
  filePath: string;
  durationSec: number;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT("highlights");
  const tc = useT("common");
  const { prefs, setPref } = useRenderPrefs();
  const [crop, setCrop] = useState<CropRect>(() => ({ ...prefs.cameraCrop }));
  const [cameraHeightFrac, setCameraHeightFrac] = useState(prefs.cameraHeightFrac);
  const [sourceAspect, setSourceAspect] = useState(16 / 9);
  const [previewSec, setPreviewSec] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(durationSec);
  const [videoError, setVideoError] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const gameplayRef = useRef<HTMLVideoElement>(null);

  const seekAll = (seconds: number): void => {
    const next = Math.max(0, Math.min(previewDuration || seconds, seconds));
    setPreviewSec(next);
    for (const video of [sourceRef.current, cameraRef.current, gameplayRef.current]) {
      if (video && Number.isFinite(video.duration)) video.currentTime = Math.min(next, Math.max(0, video.duration - 0.05));
    }
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent): void => {
      const dx = (event.clientX - drag.pointerX) / Math.max(1, drag.width);
      const dy = (event.clientY - drag.pointerY) / Math.max(1, drag.height);
      setCrop(drag.mode === "move"
        ? moveCropRect(drag.crop, dx, dy)
        : resizeCropRect(drag.crop, dx, dy, sourceAspect, cameraHeightFrac));
    };
    const onUp = (): void => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [cameraHeightFrac, drag, sourceAspect]);

  const beginDrag = (mode: DragState["mode"]) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const box = editorRef.current?.getBoundingClientRect();
    if (!box) return;
    setDrag({ mode, pointerX: event.clientX, pointerY: event.clientY, width: box.width, height: box.height, crop });
  };

  const changeHeight = (next: number): void => {
    setCameraHeightFrac(next);
    setCrop((current) => adaptCropToCameraHeight(current, next, sourceAspect));
  };

  const reset = (): void => {
    const initial = defaultCameraGameplayLayout();
    setCameraHeightFrac(DEFAULT_CAMERA_HEIGHT_FRAC);
    setCrop(adaptCropToCameraHeight(initial.cameraCrop, DEFAULT_CAMERA_HEIGHT_FRAC, sourceAspect));
  };

  const apply = (): void => {
    setPref({
      vertical: true,
      cameraGameplay: true,
      autoZoom: false,
      cameraCrop: sanitizeCropRect(crop),
      cameraHeightFrac,
    });
    onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <div
        className="card rise-in flex max-h-[94vh] w-full max-w-5xl flex-col overflow-y-auto rounded-2xl p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <LuCrop className="h-5 w-5 text-ember" />
              {t("cameraLayoutTitle")}
            </h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mut">{t("cameraLayoutDesc")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tc("cancel")} className="rounded-lg border border-line p-1.5 text-mut hover:border-mut hover:text-fg">
            <LuX className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="min-w-0">
            <p className="mb-2 text-[11.5px] font-bold text-fg/85">{t("cameraLayoutSource")}</p>
            <div
              ref={editorRef}
              className="relative w-full overflow-hidden rounded-xl border border-line bg-black"
              style={{ aspectRatio: sourceAspect }}
            >
              <video
                ref={sourceRef}
                src={getApi().mediaUrl(filePath, "camera-edit")}
                className="absolute inset-0 h-full w-full"
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  if (video.videoWidth > 0 && video.videoHeight > 0) {
                    const aspect = video.videoWidth / video.videoHeight;
                    setSourceAspect(aspect);
                    setCrop((current) => adaptCropToCameraHeight(current, cameraHeightFrac, aspect));
                  }
                  if (Number.isFinite(video.duration)) setPreviewDuration(video.duration);
                  video.currentTime = Math.min(previewSec, Math.max(0, video.duration - 0.05));
                }}
                onError={() => setVideoError(true)}
                onCanPlay={() => setVideoError(false)}
              />
              <div
                role="presentation"
                onPointerDown={beginDrag("move")}
                className={`absolute touch-none border-2 border-ember bg-ember/5 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)] ${drag?.mode === "move" ? "cursor-grabbing" : "cursor-grab"}`}
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              >
                <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[9px] font-bold tracking-wider text-white">
                  {t("cameraLabel")}
                </span>
                <div
                  role="presentation"
                  aria-label={t("cameraResizeHandle")}
                  onPointerDown={beginDrag("resize")}
                  className="absolute -bottom-2 -right-2 h-6 w-6 cursor-nwse-resize rounded-full border-2 border-white bg-ember shadow-lg"
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-mut">{t("cameraLayoutHint")}</p>
            {videoError && <p className="mt-2 text-[11px] text-amber-300">{t("cameraLayoutVideoError")}</p>}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[11px] text-mut">
                <span className="mb-1.5 flex justify-between gap-2">
                  <span>{t("cameraHeight")}</span>
                  <strong className="text-fg">{Math.round(cameraHeightFrac * 100)} %</strong>
                </span>
                <input
                  type="range"
                  min={Math.round(MIN_CAMERA_HEIGHT_FRAC * 100)}
                  max={Math.round(MAX_CAMERA_HEIGHT_FRAC * 100)}
                  step={1}
                  value={Math.round(cameraHeightFrac * 100)}
                  onChange={(event) => changeHeight(Number(event.target.value) / 100)}
                  className="w-full accent-ember"
                />
              </label>
              <label className="text-[11px] text-mut">
                <span className="mb-1.5 flex justify-between gap-2">
                  <span>{t("cameraLayoutTime")}</span>
                  <strong className="font-mono text-fg">{clock(previewSec)}</strong>
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, previewDuration)}
                  step={0.1}
                  value={Math.min(previewSec, Math.max(0.1, previewDuration))}
                  onChange={(event) => seekAll(Number(event.target.value))}
                  className="w-full accent-ember"
                />
              </label>
            </div>
          </section>

          <section className="min-w-0">
            <p className="mb-2 text-[11.5px] font-bold text-fg/85">{t("cameraLayoutPreview")}</p>
            <div className="relative mx-auto aspect-[9/16] h-[390px] max-w-full overflow-hidden rounded-xl border-[1.5px] border-ember/60 bg-black shadow-[0_0_22px_-8px_rgba(255,100,40,0.55)]">
              <div className="absolute inset-x-0 top-0 overflow-hidden border-b border-white/25" style={{ height: `${cameraHeightFrac * 100}%` }}>
                <video
                  ref={cameraRef}
                  src={getApi().mediaUrl(filePath, "camera-preview")}
                  className="absolute max-w-none"
                  style={cameraCropPercentStyle(crop)}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(previewSec, Math.max(0, event.currentTarget.duration - 0.05)); }}
                />
                <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[8px] font-bold text-white/80">{t("cameraLabel")}</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ height: `${(1 - cameraHeightFrac) * 100}%` }}>
                <video
                  ref={gameplayRef}
                  src={getApi().mediaUrl(filePath, "gameplay-preview")}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(previewSec, Math.max(0, event.currentTarget.duration - 0.05)); }}
                />
                <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[8px] font-bold text-white/80">{t("gameplayLabel")}</span>
              </div>
            </div>
            <p className="mt-2 text-center font-mono text-[10px] text-mut">1080 × 1920</p>
          </section>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[11.5px] text-mut hover:border-mut hover:text-fg">
            <LuRotateCcw className="h-3.5 w-3.5" />
            {t("cameraLayoutReset")}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-[12px] text-mut hover:border-mut hover:text-fg">{tc("cancel")}</button>
            <button type="button" onClick={apply} className="btn-flame inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold text-white">
              <LuCheck className="h-3.5 w-3.5" />
              {t("cameraLayoutApply")}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
