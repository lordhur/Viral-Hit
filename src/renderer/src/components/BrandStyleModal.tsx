/**
 * 品牌样式模板:高亮色/字号/字幕位置/logo 水印,一次配置每条切片复用。
 * 多套命名预设持久化在本机;"默认"预设只读,一改自动分叉,永远可回退。
 * 右侧 9:16 迷你画布实时预览当前参数的成片效果。
 */
import { useRef, useState } from "react";
import { LuPalette, LuX, LuPlus, LuTrash2, LuImage, LuCheck, LuMove, LuRotateCcw } from "react-icons/lu";
import { useT } from "../i18n/store";
import { getApi } from "../api/provider";
import { useBrandStore, activeBrandStyle, SWATCHES } from "../stores/brand-store";
import { useRenderPrefs } from "../stores/render-prefs-store";
import { CAPTION_KEY, CAPTION_ORDER } from "../caption-styles";
import { CAPTION_X_BOUNDS, CAPTION_Y_BOUNDS } from "../../../shared/caption-position";
import { CAPTION_OFFSET_LIMIT_MS, sanitizeCaptionOffsetMs } from "../../../shared/caption-timing";
import { FONT_SCALE_CHOICES, type BrandStyle, type BrandWatermark } from "../../../shared/api-types";
import { ModalShell } from "./ui";

/** Preview caption center (fractions match the actual ASS/web output). */
const PREVIEW_BASELINE: Record<"low" | "standard" | "high", number> = { low: 0.78, standard: 0.708, high: 0.635 };

function fileBase(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function BrandStyleModal({ onClose, filePath }: { onClose: () => void; filePath?: string }): React.JSX.Element {
  const t = useT("brand");
  const ts = useT("settings");
  const { prefs, setPref } = useRenderPrefs();
  const { presets, activeId, setActive, updateActiveStyle, addPreset, removePreset } = useBrandStore();
  const active = presets.find((p) => p.id === activeId) ?? presets[0];
  const style: BrandStyle = active.style;
  const [picking, setPicking] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const highlight = style.highlightColor ?? "#FF6E0D";
  const fontScale = style.fontScale ?? 1;
  const position = style.captionPosition ?? "standard";
  const captionX = style.captionX ?? 0.5;
  const captionY = style.captionY ?? PREVIEW_BASELINE[position];
  const previewSrc = filePath ? getApi().mediaUrl(filePath, "caption-style") : "";
  const wm = style.watermark;

  const setFreePosition = (x: number, y: number): void => {
    updateActiveStyle({
      captionX: Math.max(CAPTION_X_BOUNDS.min, Math.min(CAPTION_X_BOUNDS.max, x)),
      captionY: Math.max(CAPTION_Y_BOUNDS.min, Math.min(CAPTION_Y_BOUNDS.max, y)),
      captionPosition: undefined,
    });
  };
  const moveCaption = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    setFreePosition((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  const setWatermark = (patch: Partial<BrandWatermark> | null): void => {
    if (patch === null) {
      updateActiveStyle({ watermark: undefined });
      return;
    }
    const base: BrandWatermark = wm ?? { path: "", corner: "top-right", opacity: 0.85 };
    updateActiveStyle({ watermark: { ...base, ...patch } });
  };

  const pickLogo = async (): Promise<void> => {
    setPicking(true);
    try {
      const path = await getApi().selectImage();
      if (path) setWatermark({ path });
    } finally {
      setPicking(false);
    }
  };

  const chip = (selected: boolean): string =>
    `rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
      selected ? "border-ember/60 bg-ember/10 text-fg" : "border-line text-mut hover:border-mut hover:text-fg"
    }`;

  return (
    <ModalShell onClose={onClose}>
      <div
        className="card rise-in flex max-h-[92vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <LuPalette className="h-4.5 w-4.5 text-ember" />
              {t("title")}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-mut">{t("desc")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line p-1.5 text-mut transition-colors hover:border-mut hover:text-fg"
          >
            <LuX className="h-4 w-4" />
          </button>
        </div>

        {/* 预设切换 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {presets.map((p) => (
            <button key={p.id} type="button" onClick={() => setActive(p.id)} className={chip(p.id === activeId)}>
              {p.id === "default" ? t("defaultPreset") : p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => addPreset(t("newPresetName"))}
            title={t("addPreset")}
            className="rounded-lg border border-dashed border-line p-1.5 text-mut transition-colors hover:border-mut hover:text-fg"
          >
            <LuPlus className="h-3.5 w-3.5" />
          </button>
          {activeId !== "default" && (
            <button
              type="button"
              onClick={() => removePreset(activeId)}
              title={t("removePreset")}
              className="rounded-lg border border-line p-1.5 text-mut transition-colors hover:border-red-400 hover:text-red-400"
            >
              <LuTrash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-5 md:flex-row">
          {/* 左:参数 */}
          <div className="min-w-0 flex-1 space-y-4">
            <section>
              <h3 className="text-[12px] font-bold text-mut">{t("captionStyle")}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {CAPTION_ORDER.map((value) => (
                  <button key={value} type="button" onClick={() => setPref({ captionStyle: value })} className={chip(prefs.captionStyle === value)}>
                    {ts(CAPTION_KEY[value])}
                  </button>
                ))}
              </div>
            </section>

            {/* 高亮色 */}
            <section>
              <h3 className="text-[12px] font-bold text-mut">{t("highlight")}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateActiveStyle({ highlightColor: c })}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-110 ${
                      highlight.toUpperCase() === c ? "border-fg" : "border-transparent"
                    }`}
                    style={{ background: c }}
                  >
                    {highlight.toUpperCase() === c && <LuCheck className="h-3.5 w-3.5 text-white drop-shadow" />}
                  </button>
                ))}
                {/* 自定义取色 */}
                <label
                  className="relative flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 text-[11px] text-mut transition-colors hover:border-mut hover:text-fg"
                  title={t("customColor")}
                >
                  <span className="h-3.5 w-3.5 rounded-full" style={{ background: highlight }} />
                  {highlight.toUpperCase()}
                  <input
                    type="color"
                    value={highlight}
                    onChange={(e) => updateActiveStyle({ highlightColor: e.target.value.toUpperCase() })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </section>

            {/* 字号 */}
            <section>
              <h3 className="text-[12px] font-bold text-mut">{t("fontSize")}</h3>
              <div className="mt-2 flex gap-2">
                {(
                  [
                    ["sizeSmall", FONT_SCALE_CHOICES.small],
                    ["sizeStandard", FONT_SCALE_CHOICES.standard],
                    ["sizeLarge", FONT_SCALE_CHOICES.large],
                  ] as const
                ).map(([key, v]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateActiveStyle({ fontScale: v === 1 ? undefined : v })}
                    className={chip(Math.abs(fontScale - v) < 0.01)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </section>

            {/* 字幕位置 */}
            <section>
              <h3 className="text-[12px] font-bold text-mut">{t("position")}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ["posLow", "low"],
                    ["posStandard", "standard"],
                    ["posHigh", "high"],
                  ] as const
                ).map(([key, v]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateActiveStyle({ captionPosition: v === "standard" ? undefined : v, captionX: undefined, captionY: undefined })}
                    className={chip(style.captionX === undefined && style.captionY === undefined && position === v)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mut"><LuMove className="h-3.5 w-3.5" />{t("dragHint")}</p>
              <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 text-[11px] text-mut">
                <label htmlFor="caption-x">{t("horizontal")}</label>
                <input id="caption-x" aria-label={t("horizontal")} type="range" min={CAPTION_X_BOUNDS.min} max={CAPTION_X_BOUNDS.max} step={0.01} value={captionX}
                  onChange={(e) => setFreePosition(Number(e.target.value), captionY)} className="w-full accent-ember" />
                <span className="w-9 text-right font-mono">{Math.round(captionX * 100)}%</span>
                <label htmlFor="caption-y">{t("vertical")}</label>
                <input id="caption-y" aria-label={t("vertical")} type="range" min={CAPTION_Y_BOUNDS.min} max={CAPTION_Y_BOUNDS.max} step={0.01} value={captionY}
                  onChange={(e) => setFreePosition(captionX, Number(e.target.value))} className="w-full accent-ember" />
                <span className="w-9 text-right font-mono">{Math.round(captionY * 100)}%</span>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-bold text-mut">{t("timing")}</h3>
                <button type="button" onClick={() => setPref({ captionOffsetMs: 0 })} className="inline-flex items-center gap-1 text-[11px] text-mut hover:text-fg">
                  <LuRotateCcw className="h-3 w-3" />{t("timingReset")}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setPref({ captionOffsetMs: sanitizeCaptionOffsetMs(prefs.captionOffsetMs - 100) })} className={chip(false)}>-100 ms</button>
                <input aria-label={t("timing")} type="range" min={-CAPTION_OFFSET_LIMIT_MS} max={CAPTION_OFFSET_LIMIT_MS} step={50} value={prefs.captionOffsetMs}
                  onChange={(e) => setPref({ captionOffsetMs: Number(e.target.value) })} className="min-w-0 flex-1 accent-ember" />
                <button type="button" onClick={() => setPref({ captionOffsetMs: sanitizeCaptionOffsetMs(prefs.captionOffsetMs + 100) })} className={chip(false)}>+100 ms</button>
                <label className="sr-only" htmlFor="caption-offset">{t("timing")}</label>
                <input id="caption-offset" type="number" min={-CAPTION_OFFSET_LIMIT_MS} max={CAPTION_OFFSET_LIMIT_MS} step={50} value={prefs.captionOffsetMs}
                  onChange={(e) => setPref({ captionOffsetMs: sanitizeCaptionOffsetMs(e.target.valueAsNumber) })} className="w-20 rounded-lg border border-line bg-panel px-2 py-1.5 text-right font-mono text-[12px]" />
                <span className="text-[11px] text-mut">ms</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-mut">{t("timingHint")}</p>
            </section>

            {/* 水印 */}
            <section>
              <h3 className="text-[12px] font-bold text-mut">{t("watermark")}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void pickLogo()}
                  disabled={picking}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-mut transition-colors hover:border-mut hover:text-fg disabled:opacity-50"
                >
                  <LuImage className="h-3.5 w-3.5" />
                  {wm?.path ? fileBase(wm.path) : t("pickLogo")}
                </button>
                {wm?.path && (
                  <button
                    type="button"
                    onClick={() => setWatermark(null)}
                    className="rounded-lg border border-line p-1.5 text-mut transition-colors hover:border-red-400 hover:text-red-400"
                    title={t("removeLogo")}
                  >
                    <LuTrash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {wm?.path && (
                <div className="mt-2.5 space-y-2.5">
                  <div className="flex gap-2">
                    {(
                      [
                        ["cornerTl", "top-left"],
                        ["cornerTr", "top-right"],
                        ["cornerBl", "bottom-left"],
                        ["cornerBr", "bottom-right"],
                      ] as const
                    ).map(([key, v]) => (
                      <button key={key} type="button" onClick={() => setWatermark({ corner: v })} className={chip(wm.corner === v)}>
                        {t(key)}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2.5 text-[11.5px] text-mut">
                    {t("opacity")}
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={Math.round(wm.opacity * 100)}
                      onChange={(e) => setWatermark({ opacity: Number(e.target.value) / 100 })}
                      className="accent-[--color-ember]"
                    />
                    <span className="font-mono">{Math.round(wm.opacity * 100)}%</span>
                  </label>
                </div>
              )}
            </section>
          </div>

          {/* 右:9:16 迷你预览 */}
          <div className="mx-auto w-36 shrink-0 md:mx-0">
            <div ref={previewRef} className="relative aspect-9/16 overflow-hidden rounded-xl border border-line bg-gradient-to-b from-panel-2 to-black/70">
              {previewSrc && <video src={previewSrc} muted playsInline preload="auto" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
              {/* Dragging updates the same fractions consumed by ASS and web captions. */}
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none text-center font-extrabold leading-tight active:cursor-grabbing"
                style={{
                  left: `${captionX * 100}%`, top: `${captionY * 100}%`, fontSize: `${9 * fontScale}px`,
                  width: `${Math.min(92, 200 * Math.min(captionX, 1 - captionX))}%`,
                  textShadow: "0 1px 3px #000, 0 0 2px #000",
                }}
                onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
                onPointerMove={moveCaption}
                onPointerUp={() => { dragging.current = false; }}
                onPointerCancel={() => { dragging.current = false; }}
              >
                <span className="text-white">{t("previewSaid")}</span>
                <span style={{ color: highlight }}>{t("previewHighlight")}</span>
              </div>
              {/* 水印示意 */}
              {wm?.path && (
                <div
                  className="absolute flex h-5 w-9 items-center justify-center rounded-xs border border-white/30 text-[6px] text-white/80"
                  style={{
                    opacity: wm.opacity,
                    ...(wm.corner.includes("top") ? { top: "4%" } : { bottom: "4%" }),
                    ...(wm.corner.includes("left") ? { left: "5%" } : { right: "5%" }),
                  }}
                >
                  LOGO
                </div>
              )}
            </div>
            <p className="mt-1.5 text-center text-[10.5px] text-mut/80">{t("previewNote")}</p>
          </div>
        </div>

        {/* 底部 */}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-dashed border-line pt-4">
          <p className="text-[11.5px] text-mut">{t("applyNote")}</p>
          <button
            type="button"
            onClick={onClose}
            className="btn-flame inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-[13px] font-bold text-white"
          >
            <LuCheck className="h-4 w-4" />
            {t("done")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export { activeBrandStyle };
