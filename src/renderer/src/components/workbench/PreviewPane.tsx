/**
 * Source 16:9 + aperçu vertical synchronisé. En mode caméra/gameplay, le 9:16
 * reprend le cadre manuel et les hauteurs du rendu au lieu d'un centre-crop.
 * La lecture ciblée s'arrête à la fin du candidat affiché.
 */
import { useEffect, useRef, useState } from "react";
import { LuPlay, LuPause, LuSkipBack, LuSkipForward } from "react-icons/lu";
import { getApi } from "../../api/provider";
import { useT } from "../../i18n/store";
import { useRenderPrefs } from "../../stores/render-prefs-store";
import { cameraCropPercentStyle } from "../../../../shared/camera-layout";

export interface PreviewTransportCommand {
  id: number;
  action: "toggle" | "back5" | "forward5" | "audition";
  startSec?: number;
  endSec?: number;
}

export interface PreviewClipRange {
  id: number;
  startSec: number;
  endSec: number;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function PreviewPane({
  filePath,
  durationSec,
  seekSec,
  onTime,
  onPrevCandidate,
  onNextCandidate,
  transportCommand,
  clip = null,
  cameraAvailable = true,
  compact = false,
}: {
  filePath: string | null;
  durationSec: number;
  /** External seek request from the timeline/candidate list (NaN = none). */
  seekSec: number;
  onTime: (sec: number) => void;
  onPrevCandidate: () => void;
  onNextCandidate: () => void;
  transportCommand?: PreviewTransportCommand | null;
  clip?: PreviewClipRange | null;
  cameraAvailable?: boolean;
  compact?: boolean;
}): React.JSX.Element {
  const t = useT("workbench");
  const { prefs } = useRenderPrefs();
  const mainRef = useRef<HTMLVideoElement>(null);
  const auditionEnd = useRef<number | null>(null);
  const cropRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const gameplayRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  // Distinct path segments prevent Chromium from sharing one media buffer
  // between the source and the synchronized vertical views.
  const src = filePath ? getApi().mediaUrl(filePath, "main") : "";
  const cropSrc = filePath ? getApi().mediaUrl(filePath, "crop") : "";
  const cameraSrc = filePath ? getApi().mediaUrl(filePath, "camera-live") : "";
  const gameplaySrc = filePath ? getApi().mediaUrl(filePath, "gameplay-live") : "";
  const cameraMode = cameraAvailable && prefs.vertical && prefs.cameraGameplay;
  const [mainErrCode, setMainErrCode] = useState(0);

  const endForTime = (seconds: number): number | null =>
    clip && seconds >= clip.startSec && seconds < clip.endSec ? clip.endSec : null;

  // A newly focused/restored clip opens at its own beginning, even before the
  // user presses Play. Boundary edits also refresh the audition end.
  useEffect(() => {
    const video = mainRef.current;
    if (!video) return;
    if (!clip) {
      auditionEnd.current = null;
      return;
    }
    auditionEnd.current = clip.endSec;
    video.currentTime = Math.max(0, Math.min(durationSec, clip.startSec));
  }, [clip?.id, clip?.startSec, clip?.endSec, durationSec]);

  // External seek request (timeline/candidate focus). Seeks inside the focused
  // clip remain bounded; seeks elsewhere still allow inspecting the source.
  useEffect(() => {
    const video = mainRef.current;
    if (!video || !Number.isFinite(seekSec)) return;
    const next = Math.max(0, Math.min(durationSec, seekSec));
    auditionEnd.current = endForTime(next);
    video.currentTime = next;
  }, [seekSec]);

  const syncVertical = (): void => {
    const main = mainRef.current;
    if (!main) return;
    for (const vertical of [cropRef.current, cameraRef.current, gameplayRef.current]) {
      if (!vertical) continue;
      if (Math.abs(vertical.currentTime - main.currentTime) > 0.3) vertical.currentTime = main.currentTime;
      if (main.paused !== vertical.paused) {
        if (main.paused) vertical.pause();
        else void vertical.play().catch(() => {});
      }
    }
  };

  const syncVerticalMetadata = (vertical: HTMLVideoElement): void => {
    const main = mainRef.current;
    if (!main || !Number.isFinite(vertical.duration)) return;
    vertical.currentTime = Math.min(main.currentTime, Math.max(0, vertical.duration - 0.05));
  };

  const togglePlay = (): void => {
    const video = mainRef.current;
    if (!video) return;
    if (video.paused) {
      // Replaying after the end restarts the focused clip, not the full VOD.
      if (clip && (video.currentTime < clip.startSec || video.currentTime >= clip.endSec - 0.05)) {
        video.currentTime = clip.startSec;
        auditionEnd.current = clip.endSec;
      } else {
        auditionEnd.current = endForTime(video.currentTime);
      }
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  useEffect(() => {
    const video = mainRef.current;
    if (!video || !transportCommand) return;
    auditionEnd.current = null;
    if (transportCommand.action === "audition" && Number.isFinite(transportCommand.startSec) && Number.isFinite(transportCommand.endSec)) {
      video.currentTime = Math.max(0, transportCommand.startSec!);
      auditionEnd.current = Math.min(durationSec, transportCommand.endSec!);
      void video.play().catch(() => { auditionEnd.current = null; });
      return;
    }
    if (transportCommand.action === "toggle") {
      togglePlay();
      return;
    }
    const delta = transportCommand.action === "back5" ? -5 : 5;
    const next = Math.max(0, Math.min(durationSec, video.currentTime + delta));
    video.currentTime = next;
    auditionEnd.current = endForTime(next);
  }, [durationSec, transportCommand]);

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className={`flex gap-2.5 ${compact ? "h-[132px]" : "h-[236px]"}`}>
        {/* Source */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-line/60 bg-black">
          {src && mainErrCode === 0 ? (
            <video
              ref={mainRef}
              src={src}
              className="h-full w-full object-contain"
              playsInline
              onClick={togglePlay}
              onPlay={() => {
                setPlaying(true);
                syncVertical();
              }}
              onPause={() => {
                setPlaying(false);
                syncVertical();
              }}
              onSeeked={syncVertical}
              onTimeUpdate={(event) => {
                const sec = event.currentTarget.currentTime;
                if (auditionEnd.current !== null && sec >= auditionEnd.current) {
                  mainRef.current?.pause();
                  auditionEnd.current = null;
                }
                setNow(sec);
                onTime(sec);
                syncVertical();
              }}
              onCanPlay={() => setMainErrCode(0)}
              onError={(event) => {
                setPlaying(false);
                setMainErrCode(event.currentTarget.error?.code ?? 0);
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-mut">
              {mainErrCode > 0 ? t("previewReadFailed").replace("{code}", String(mainErrCode)) : t("noPreview")}
            </div>
          )}
          <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] text-fg/70">
            {t("sourcePreview")}
          </span>
        </div>

        {/* Final 9:16 geometry: manual camera above gameplay, or center crop. */}
        <div
          className="relative w-[133px] shrink-0 overflow-hidden rounded-xl border-[1.5px] border-ember/60 bg-black shadow-[0_0_22px_-6px_rgba(255,100,40,0.5)]"
          data-preview-mode={cameraMode ? "camera-gameplay" : "center-crop"}
          aria-label={cameraMode ? t("verticalCameraPreview") : t("verticalPreview")}
        >
          {src ? cameraMode ? (
            <>
              <div className="absolute inset-x-0 top-0 overflow-hidden border-b border-white/25" style={{ height: `${prefs.cameraHeightFrac * 100}%` }}>
                <video
                  ref={cameraRef}
                  src={cameraSrc}
                  className="absolute max-w-none"
                  style={cameraCropPercentStyle(prefs.cameraCrop)}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(event) => syncVerticalMetadata(event.currentTarget)}
                />
              </div>
              <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ height: `${(1 - prefs.cameraHeightFrac) * 100}%` }}>
                <video
                  ref={gameplayRef}
                  src={gameplaySrc}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(event) => syncVerticalMetadata(event.currentTarget)}
                />
              </div>
            </>
          ) : (
            <video
              ref={cropRef}
              src={cropSrc}
              muted
              playsInline
              preload="auto"
              className="h-full w-full object-cover"
              onLoadedMetadata={(event) => syncVerticalMetadata(event.currentTarget)}
            />
          ) : (
            <div className="h-full bg-gradient-to-b from-panel-2 to-panel" />
          )}
          <span className="pointer-events-none absolute right-0 bottom-1.5 left-0 bg-black/35 py-0.5 text-center text-[9px] text-fg/70">
            {cameraMode ? t("verticalCameraPreview") : t("verticalPreview")}
          </span>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onPrevCandidate}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-mut transition-colors hover:border-mut hover:text-fg"
        >
          <LuSkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!src}
          title={clip ? t("playFocusedClip") : undefined}
          className="flame-gradient flex h-8 w-8 items-center justify-center rounded-lg text-white disabled:opacity-40"
        >
          {playing ? <LuPause className="h-4 w-4" /> : <LuPlay className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onNextCandidate}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-mut transition-colors hover:border-mut hover:text-fg"
        >
          <LuSkipForward className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[12px] tabular-nums">
          {formatClock(now)} <span className="text-mut/50">/ {formatClock(durationSec)}</span>
        </span>
      </div>
    </div>
  );
}
