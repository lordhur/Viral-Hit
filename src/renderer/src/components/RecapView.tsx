import { useCallback, useEffect, useState } from "react";
import { LuCaptions, LuCheck, LuCircleAlert, LuClock3, LuDownload, LuFilePlus2, LuLoaderCircle, LuPlay, LuRotateCcw, LuSquare, LuTrash2, LuVideo } from "react-icons/lu";
import { getApi } from "../api/provider";
import { cancelRecapJob, listRecapJobs, recapMediaUrl, startRecapJob, subscribeRecapJobs } from "../api/recap";
import type { ProductionJob, RecapJobInput } from "../../../shared/production";
import { useLocaleStore, useT } from "../i18n/store";
import { errorText } from "../i18n/errors";

function fileName(path: string): string { return path.split(/[\\/]/).pop() || path; }

export function RecapView(): React.JSX.Element {
  const t = useT("recap");
  const locale = useLocaleStore((state) => state.locale);
  const [videos, setVideos] = useState<string[]>([]);
  const [editMode, setEditMode] = useState<RecapJobInput["editMode"]>("full");
  const [audioMode, setAudioMode] = useState<RecapJobInput["audioMode"]>("narration");
  const [style, setStyle] = useState("Documentaire rythmé, narration naturelle, sans exagération");
  const [language, setLanguage] = useState(locale === "zh" ? "zh" : locale === "fr" ? "fr" : "en");
  const [context, setContext] = useState("");
  const [targetDuration, setTargetDuration] = useState("");
  const [skipAsr, setSkipAsr] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [rights, setRights] = useState(false);
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upsert = useCallback((job: ProductionJob) => {
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

  useEffect(() => {
    void listRecapJobs().then(setJobs).catch((reason) => setError(errorText(reason)));
    return subscribeRecapJobs(upsert);
  }, [upsert]);

  const addVideo = useCallback(async () => {
    setError("");
    try {
      const path = await getApi().selectMedia();
      if (path) setVideos((current) => current.includes(path) ? current : [...current, path]);
    } catch (reason) { setError(errorText(reason)); }
  }, []);

  const start = async (input?: RecapJobInput): Promise<void> => {
    setBusy(true); setError("");
    try {
      const job = await startRecapJob(input ?? {
        videos, editMode, audioMode, style, language, context, targetDuration,
        skipAsr, burnSubtitles, confirmVoiceRights: rights,
      });
      upsert(job);
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  const inputCls = "mt-1.5 w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-[13px] text-fg outline-none transition-colors placeholder:text-mut/50 focus:border-ember/60";
  const labelCls = "block text-[11px] font-semibold text-mut";

  return (
    <main className="stage flex-1 overflow-y-auto px-5 py-7 sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)]">
        <section className="rounded-3xl border border-line/80 bg-panel/55 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="icon-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"><LuCaptions className="h-5 w-5" /></div>
            <div><h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1><p className="mt-1 text-[12.5px] leading-relaxed text-mut">{t("desc")}</p></div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3"><span className="text-[12px] font-bold">{t("sources")}</span><span className="text-[11px] text-mut">{videos.length}</span></div>
            <div className="mt-2 space-y-2">
              {videos.map((path, index) => (
                <div key={path} className="flex items-center gap-2 rounded-xl border border-line bg-panel-2/70 px-3 py-2.5">
                  <LuVideo className="h-4 w-4 shrink-0 text-ember" /><span className="min-w-0 flex-1 truncate text-[12px]" title={path}>{index + 1}. {fileName(path)}</span>
                  <button type="button" title={t("remove")} onClick={() => setVideos((current) => current.filter((item) => item !== path))} className="rounded p-1 text-mut hover:text-red-300"><LuTrash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button type="button" onClick={() => void addVideo()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-3 text-[12px] font-semibold text-mut transition-colors hover:border-ember/50 hover:text-fg"><LuFilePlus2 className="h-4 w-4" />{t("addSource")}</button>
            </div>
            {videos.length > 1 && editMode !== "cut" && <p className="mt-2 text-[11px] text-amber-300">{t("multiNeedsCut")}</p>}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={labelCls}>{t("editMode")}<select className={inputCls} value={editMode} onChange={(event) => setEditMode(event.target.value as RecapJobInput["editMode"])}>
              <option value="full">{t("modeFull")}</option><option value="cut">{t("modeCut")}</option><option value="dub">{t("modeDub")}</option>
            </select></label>
            <label className={labelCls}>{t("audioMode")}<select className={inputCls} value={audioMode} disabled={editMode === "dub"} onChange={(event) => setAudioMode(event.target.value as RecapJobInput["audioMode"])}>
              <option value="narration">{t("audioNarration")}</option><option value="source-mix">{t("audioSource")}</option><option value="adopted-packet-copy">{t("audioAdopted")}</option>
            </select></label>
            <label className={labelCls}>{t("language")}<select className={inputCls} value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="fr">Français</option><option value="en">English</option><option value="zh">中文</option><option value="es">Español</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="pt">Português</option><option value="ja">日本語</option><option value="ko">한국어</option>
            </select></label>
            <label className={labelCls}>{t("duration")}<input className={inputCls} value={targetDuration} onChange={(event) => setTargetDuration(event.target.value)} placeholder="60s · 90s · 10m" disabled={editMode !== "cut"} /></label>
          </div>
          <label className={`${labelCls} mt-4`}>{t("style")}<textarea className={`${inputCls} min-h-20 resize-y`} value={style} onChange={(event) => setStyle(event.target.value)} maxLength={4000} /></label>
          <label className={`${labelCls} mt-4`}>{t("context")}<textarea className={`${inputCls} min-h-16 resize-y`} value={context} onChange={(event) => setContext(event.target.value)} placeholder={t("contextPlaceholder")} maxLength={8000} /></label>

          <div className="mt-4 grid gap-2 text-[11.5px] text-mut">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 accent-[#ff643c]" checked={skipAsr} onChange={(event) => setSkipAsr(event.target.checked)} /><span>{t("skipAsr")}</span></label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 accent-[#ff643c]" checked={burnSubtitles} onChange={(event) => setBurnSubtitles(event.target.checked)} /><span>{t("burnSubtitles")}</span></label>
            {editMode === "dub" && <label className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-amber-200"><input type="checkbox" className="mt-0.5 accent-[#ff643c]" checked={rights} onChange={(event) => setRights(event.target.checked)} /><span>{t("rights")}</span></label>}
          </div>

          {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-[12px] leading-relaxed text-red-300"><LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
          <button type="button" disabled={busy || !videos.length || (videos.length > 1 && editMode !== "cut") || (editMode === "dub" && !rights)} onClick={() => void start()} className="btn-flame mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? <LuLoaderCircle className="h-4 w-4 animate-spin" /> : <LuPlay className="h-4 w-4" />}{t("start")}
          </button>
          <p className="mt-3 text-[10.5px] leading-relaxed text-mut/80">{t("localNote")}</p>
        </section>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-bold">{t("jobs")}</h2><span className="text-[11px] text-mut">{t("resumeHint")}</span></div>
          <div className="space-y-3">
            {!jobs.length && <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[12px] leading-relaxed text-mut">{t("emptyJobs")}</div>}
            {jobs.map((job) => (
              <article key={job.id} className="overflow-hidden rounded-2xl border border-line/80 bg-panel/55">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${job.status === "completed" ? "bg-emerald-500/10 text-emerald-300" : job.status === "failed" || job.status === "interrupted" ? "bg-red-500/10 text-red-300" : "bg-ember/10 text-ember"}`}>
                      {job.status === "completed" ? <LuCheck className="h-4 w-4" /> : job.status === "running" || job.status === "queued" ? <LuLoaderCircle className="h-4 w-4 animate-spin" /> : <LuClock3 className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h3 className="truncate text-[12.5px] font-bold">{fileName(job.videos[0] || job.id)}{job.videos.length > 1 ? ` +${job.videos.length - 1}` : ""}</h3><span className="shrink-0 text-[10.5px] font-semibold text-mut">{t(job.status)}</span></div>
                      <p className="mt-1 text-[10.5px] text-mut">{new Date(job.createdAt).toLocaleString(locale)} · {job.request?.editMode || "full"}</p>
                    </div>
                  </div>
                  {job.error && <p className="mt-3 break-words rounded-lg bg-red-500/5 p-2.5 text-[10.5px] leading-relaxed text-red-300">{errorText(job.error)}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(job.status === "running" || job.status === "queued") && <button type="button" onClick={() => void cancelRecapJob(job.id).then(() => listRecapJobs().then(setJobs))} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-mut hover:text-red-300"><LuSquare className="h-3 w-3" />{t("cancel")}</button>}
                    {(job.status === "failed" || job.status === "interrupted" || job.status === "cancelled") && <button type="button" disabled={busy} onClick={() => void start(job.request ?? { videos: job.videos, workDir: job.workDir })} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-mut hover:text-fg"><LuRotateCcw className="h-3 w-3" />{t("resume")}</button>}
                    {job.finalOutput && <a href={recapMediaUrl(job.finalOutput, true)} download={fileName(job.finalOutput)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-mut hover:text-fg"><LuDownload className="h-3 w-3" />{t("download")}</a>}
                  </div>
                </div>
                {job.finalOutput && <video className="max-h-[55vh] w-full bg-black" controls preload="metadata" src={recapMediaUrl(job.finalOutput)} aria-label={t("preview")} />}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
