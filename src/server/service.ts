import { mkdir, writeFile } from "fs/promises";
import { basename, extname, join, resolve } from "path";
import type {
  ExportOptions,
  HighlightCandidate,
  LlmConfig,
  MediaInfo,
  SessionCheckpoint,
  SpeechRunOptions,
  Transcript,
} from "../shared/api-types";
import { ASR_CATALOG } from "../shared/asr-catalog";
import { QUALITY_CRF } from "../shared/api-types";
import { applyGlossaryToTranscript } from "../shared/glossary";
import { wordsInPieces } from "../shared/pieces";
import { probeMedia } from "../core/probe";
import { cacheDir, evidenceCacheDir, modelsRoot, renderCacheDir } from "../core/appenv";
import { transcribeCached, analyzeReferenceVideo } from "../core/pipeline";
import { detectHighlights } from "../core/highlight/detect";
import { collectSignalsEvidence, collectVisionEvidence } from "../core/media-evidence";
import { reviewCandidatesVision } from "../core/highlight/review-vision";
import { collectEmotionSignal } from "../core/emotion";
import { collectDanmakuSignal, danmakuHeatCurve, readDanmakuItems } from "../core/danmaku";
import { collectVoiceEmotionSignal } from "../core/voice-emotion";
import { planColorRender } from "../core/color";
import { loadReviewMemory, recordReview } from "../core/review-memory";
import {
  clearPerformanceMemory,
  importPerformanceFile,
  loadPerformanceMemory,
  summarizePerformance,
} from "../core/performance-memory";
import { summarizeExperiments } from "../core/experiments";
import {
  buildPerformanceTemplate,
  clearPublishMetrics,
  loadPublishLedger,
} from "../core/publish-ledger";
import {
  closeProject,
  createProject,
  deleteProject,
  openProject,
  projectWorkspace,
  relinkProject,
  renameProject,
  saveProject,
} from "../core/project-workspace";
import { clearSessionCheckpoint, readSessionCheckpoint, saveSessionCheckpoint } from "../core/session-checkpoint";
import { loadGlossary, saveGlossary } from "../core/glossary-store";
import { importSubtitleText } from "../core/subtitle-import";
import { importMediaUrl } from "../core/url-import";
import { extractPeaks } from "../core/audio-peaks";
import { composeContactSheetJpeg } from "../core/contact-sheet";
import { extractFilmstrip } from "../core/filmstrip";
import { loudnessCurve, motionCurve } from "../core/signals";
import { listModels } from "../core/llm-models";
import { exportClips, sanitizeFilename, type ExportClipSpec, type ExportRenderOptions } from "../core/export";
import { ExportTaskRunner, optionalExportStep } from "../core/export-task";
import { sliceWords } from "../core/subtitle";
import { collectClipSegments, translateSegments, clipTranslationLines } from "../core/translate";
import { generatePublishCopies } from "../core/publish";
import { generateVariantPlans, expandClipSpecs, VARIANT_TOTAL_MAX } from "../core/variants";
import { chatComplete } from "../core/highlight/detect";
import { createClipAligner } from "../core/align";
import { snapContextAround } from "../core/shots";
import { exportNeedsTranscript } from "../shared/export-transcript";
import { sanitizeSensitiveWords } from "../core/sensitive-words";
import { validPlatformIds } from "../shared/platform-specs";
import { sanitizeBrand } from "../core/brand";
import { runDoctor } from "../core/doctor";
import { clearRenderCache } from "../core/render-cache";
import { clearEvidenceIndex } from "../core/evidence-index";
import { ensureModel, isModelInstalled, FIRERED_MODEL, PARAFORMER_MODEL, SENSEVOICE_MODEL, WHISPER_FR_MODEL } from "../core/models";
import { inspectModels, moveModelsDir } from "../core/models-inventory";
import { defaultModelsRoot, readAppSettings, writeAppSettings } from "../core/app-settings";
import { qwenHealth } from "../core/transcribe/qwen-local";
import { generateAiBgm } from "../core/bgm-ai";
import { previewTranscriptAlignment } from "../core/transcript-alignment";
import { assertInside, defaultExportDir, serverDataDir, serverRoot } from "./config";
import type { EventHub } from "./events";
import { localizeErrorMessage, localizeUrlImportError } from "../shared/french-errors";

const ASR_ASSETS = { "whisper-fr": WHISPER_FR_MODEL, sensevoice: SENSEVOICE_MODEL, paraformer: PARAFORMER_MODEL, fireredasr: FIRERED_MODEL } as const;

function stringArg(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} : valeur obligatoire`);
  return value;
}

function llmArg(value: unknown): LlmConfig {
  const config = value as LlmConfig;
  if (!config || typeof config.baseUrl !== "string" || !config.baseUrl.trim() || typeof config.model !== "string" || !config.model.trim()) {
    throw new Error("Configurez d’abord un fournisseur IA, son URL de base et son modèle, ou utilisez le moteur gratuit intégré");
  }
  return {
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
    apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
    ...(config.provider ? { provider: config.provider } : {}),
  };
}

function optionalLlm(value: unknown): LlmConfig | null {
  try { return value ? llmArg(value) : null; } catch { return null; }
}

/** Real local backend for the browser adapter. All paths are confined to managed data. */
export class LocalService {
  private transcribeAbort: AbortController | null = null;
  private urlAbort: AbortController | null = null;
  private alignmentAbort: AbortController | null = null;
  private diagnosticsAbort: AbortController | null = null;
  private exports = new ExportTaskRunner();
  private signals = new Map<string, Promise<unknown>>();

  constructor(private hub: EventHub) {}

  private data(): string { return serverDataDir(); }
  private managed(path: string): string { return assertInside(this.data(), path); }

  private async media(path: unknown): Promise<string> {
    return this.managed(stringArg(path, "Chemin source"));
  }

  private async warmSignals(filePath: string): Promise<any> {
    const media = await probeMedia(filePath).catch(() => null);
    const analysis = media?.hasVideo ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) } : {};
    const key = `${filePath}|${media?.videoStreamIndex ?? "none"}`;
    let pending = this.signals.get(key);
    if (!pending) {
      pending = collectSignalsEvidence({ videoPath: filePath, evidenceDir: evidenceCacheDir(), analysis }).catch(() => undefined);
      this.signals.set(key, pending);
      if (this.signals.size > 4) this.signals.delete(this.signals.keys().next().value!);
    }
    return pending;
  }

  private async transcribe(filePath: string, engineId: unknown, _apiKey: unknown, options: SpeechRunOptions = {}): Promise<Transcript> {
    if (this.transcribeAbort || this.alignmentAbort) throw new Error("Une transcription ou un alignement est déjà en cours");
    const source = await this.media(filePath);
    const selected = typeof engineId === "string" ? engineId : "whisper-fr";
    if (selected === "elevenlabs") throw new Error("La transcription ElevenLabs est réservée à l’application de bureau ; utilisez un moteur local gratuit dans le navigateur");
    const abort = new AbortController();
    this.transcribeAbort = abort;
    try {
      const asr = {
        ...options,
        engineId: selected,
        signal: abort.signal,
        onProgress: (progress: unknown) => this.hub.emit("transcribe", progress),
      };
      return await transcribeCached(source, modelsRoot(), cacheDir(), await loadGlossary(this.data()), abort.signal, undefined, asr);
    } finally {
      if (this.transcribeAbort === abort) this.transcribeAbort = null;
    }
  }

  private async detect(args: unknown[]): Promise<unknown> {
    let transcript = args[0] as Transcript;
    const llm = llmArg(args[1]);
    if (!transcript || !Array.isArray(transcript.segments)) throw new Error("Une transcription est requise");
    const filePath = typeof args[2] === "string" && args[2] ? await this.media(args[2]) : undefined;
    const diarize = args[3] === true;
    if (diarize) throw new Error("La séparation des intervenants nécessite actuellement l’application de bureau");
    const pf = args[4] as { baseUrl?: unknown; model?: unknown } | null | undefined;
    const prefilter = pf && typeof pf.baseUrl === "string" && typeof pf.model === "string" && pf.baseUrl && pf.model
      ? { baseUrl: pf.baseUrl, model: pf.model } : null;
    const length = args[6] === "short" || args[6] === "long" || args[6] === "standard" ? args[6] : undefined;
    const products = Array.isArray(args[7]) ? args[7].filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim().slice(0, 30)).slice(0, 20) : [];
    const referencePath = typeof args[8] === "string" && args[8] ? await this.media(args[8]) : undefined;
    let reference;
    let referenceError: string | undefined;
    if (referencePath) {
      try {
        reference = await analyzeReferenceVideo(referencePath, { modelsRoot: modelsRoot(), cacheDir: cacheDir(), evidenceCacheDir: evidenceCacheDir(), glossary: await loadGlossary(this.data()) });
      } catch (error) { referenceError = error instanceof Error ? error.message : String(error); }
    }
    const genre = args[9] as { id?: string; custom?: string } | null | undefined;
    const brief = args[10] as { focus?: string; exclude?: string } | null | undefined;
    let signals = filePath ? await this.warmSignals(filePath) : undefined;
    let visionStats;
    let emotionStats;
    let danmakuStats;
    let voiceStats;
    let reviewVisionCfg: { baseUrl: string; model: string; apiKey?: string } | null = null;
    let reviewAnalysis;
    if (filePath) {
      const media = await probeMedia(filePath).catch(() => null);
      if (media && media.durationSec > 1) {
        const danmaku = await collectDanmakuSignal(filePath, media.durationSec);
        if (danmaku) {
          signals = { loudPeaks: [], cutDense: [], ...signals, danmakuPeaks: danmaku.danmakuPeaks };
          danmakuStats = danmaku.stats;
        }
        const voice = await collectVoiceEmotionSignal({ videoPath: filePath, durationSec: media.durationSec, modelsRoot: modelsRoot(), signals }).catch(() => null);
        if (voice && (voice.voiceEmotionPeaks.length || voice.audioEventPeaks.length)) {
          signals = { loudPeaks: [], cutDense: [], ...signals, voiceEmotionPeaks: voice.voiceEmotionPeaks, audioEventPeaks: voice.audioEventPeaks };
          voiceStats = voice.stats;
        }
      }
      if (media?.hasVideo) {
        reviewAnalysis = { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) };
        const emotion = await collectEmotionSignal({ videoPath: filePath, durationSec: media.durationSec, modelsRoot: modelsRoot(), signals, analysis: reviewAnalysis }).catch(() => null);
        if (emotion) {
          signals = { loudPeaks: [], cutDense: [], ...signals, emotionPeaks: emotion.emotionPeaks };
          emotionStats = emotion.stats;
        }
        const raw = args[5] as { baseUrl?: unknown; model?: unknown; apiKey?: unknown } | null | undefined;
        if (raw && typeof raw.baseUrl === "string" && raw.baseUrl && typeof raw.model === "string" && raw.model) {
          reviewVisionCfg = { baseUrl: raw.baseUrl, model: raw.model, apiKey: typeof raw.apiKey === "string" && raw.apiKey ? raw.apiKey : undefined };
          const vision = await collectVisionEvidence({
            videoPath: filePath, durationSec: media.durationSec, config: reviewVisionCfg, signals,
            scan: args[11] === true, fontFile: join(serverRoot(), "resources", "fonts", "SourceHanSansSC-Bold.otf"),
            evidenceDir: evidenceCacheDir(), analysis: reviewAnalysis,
          }).catch(() => null);
          if (vision) {
            signals = { loudPeaks: [], cutDense: [], ...signals, visualPeaks: vision.visualPeaks, visualNotes: vision.visualNotes };
            visionStats = { ...vision.stats, ...(vision.visualNotes.length ? { notes: vision.visualNotes } : {}) };
          }
        }
      }
    }
    const outcome = await detectHighlights(
      transcript, llm, undefined, signals, prefilter, length, products, reference,
      await loadReviewMemory(this.data()), genre ?? undefined, brief ?? undefined, await loadPerformanceMemory(this.data()),
    );
    let candidates = outcome.candidates;
    if (filePath && reviewVisionCfg && candidates.length) {
      const reviewed = await reviewCandidatesVision({ videoPath: filePath, candidates, config: reviewVisionCfg,
        fontFile: join(serverRoot(), "resources", "fonts", "SourceHanSansSC-Bold.otf"), analysis: reviewAnalysis }).catch(() => null);
      if (reviewed) {
        candidates = reviewed.candidates;
        visionStats = { ...(visionStats ?? { framesTotal: 0, framesScored: 0, peakCount: 0 }), candidatesReviewed: reviewed.stats.reviewed, candidatesAdjusted: reviewed.stats.boosted + reviewed.stats.demoted };
      }
    }
    return { candidates, transcript: undefined, funnel: outcome.funnel, vision: visionStats, emotion: emotionStats,
      danmaku: danmakuStats, voice: voiceStats, reference: reference ?? null, referenceError };
  }

  private async export(filePath: unknown, rawClips: unknown, rawOptions: unknown): Promise<unknown> {
    const source = await this.media(filePath);
    const clips = rawClips as HighlightCandidate[];
    if (!Array.isArray(clips) || !clips.length) throw new Error("Aucun clip sélectionné");
    const opts = (rawOptions ?? {}) as ExportOptions;
    if (opts.outDir) assertInside(join(this.data(), "exports"), opts.outDir);
    const outDir = opts.outDir || join(defaultExportDir(), sanitizeFilename(basename(source, extname(source)), "video"));
    const transcript = opts.transcript;
    const style = opts.captionStyle && opts.captionStyle !== "none" && transcript ? opts.captionStyle : undefined;
    if (style === "bubble") throw new Error("Les sous-titres Bulle nécessitent l’application de bureau ; choisissez un autre style dans le navigateur");

    return this.exports.run(async (signal) => {
      const preparing = (preparation: "translation" | "publish" | "variants" | "media"): void => {
        signal.throwIfAborted();
        this.hub.emit("export", { current: 0, total: clips.length, clipId: clips[0].id, stage: "preparing", preparation });
      };
      const muteTerms = sanitizeSensitiveWords(opts.muteTerms);
      const needWords = Boolean(transcript) && exportNeedsTranscript({ ...opts, captionStyle: style ?? "none", muteTerms });
      const allWords = transcript ? transcript.segments.flatMap((segment) => segment.words).sort((a, b) => a.startSec - b.startSec) : null;
      const wordsFor = (clip: HighlightCandidate) => {
        if (!transcript || !needWords) return undefined;
        const words = sliceWords(transcript, clip.startSec, clip.endSec);
        return clip.pieces && clip.pieces.length > 1 ? wordsInPieces(words, clip.pieces) : words;
      };

      preparing("media");
      let translations: Map<number, string> | null = null;
      let translatable: ReturnType<typeof collectClipSegments> = [];
      const translate = opts.translate;
      if (translate?.targetLang && translate.llm?.provider !== "builtin" && translate.llm?.baseUrl && translate.llm.model && transcript) {
        translatable = collectClipSegments(transcript, clips);
        preparing("translation");
        translations = await optionalExportStep(signal, () => translateSegments(translatable, translate.targetLang, translate.llm, chatComplete, signal));
      }
      const copySources = clips.map((clip) => ({ id: clip.id, title: clip.title, hook: clip.hook, text: clip.text, keywords: clip.keywords, saveWorthy: Boolean(clip.utility) }));
      const zh = Boolean(transcript?.language.toLowerCase().startsWith("zh"));
      let publishCopies: Map<number, import("../core/publish").PublishCopy> | null = null;
      if (opts.publishCopy?.llm?.provider !== "builtin" && opts.publishCopy?.llm?.baseUrl && opts.publishCopy.llm.model) {
        preparing("publish");
        publishCopies = await optionalExportStep(signal, () => generatePublishCopies(copySources, zh, opts.publishCopy!.llm, chatComplete, signal));
      }
      let variantPlans: Map<number, import("../core/variants").VariantPackaging[]> | null = null;
      if (opts.variants?.llm?.provider !== "builtin" && opts.variants?.llm?.baseUrl && opts.variants.llm.model && Number(opts.variants.count) >= 2) {
        preparing("variants");
        variantPlans = await optionalExportStep(signal, () => generateVariantPlans(copySources, Math.min(Number(opts.variants!.count), VARIANT_TOTAL_MAX), zh, opts.variants!.llm, chatComplete, signal));
      }
      preparing("media");
      const alignWords = opts.preciseAlign && needWords && transcript && transcript.engine !== "paraformer-local" ? createClipAligner(modelsRoot(), signal) : undefined;
      const baseSpecs: ExportClipSpec[] = clips.map((clip) => ({
        id: clip.id, title: clip.title, startSec: clip.startSec, endSec: clip.endSec,
        pieces: clip.pieces && clip.pieces.length > 1 ? clip.pieces : undefined,
        snapContext: allWords ? snapContextAround(allWords, clip.startSec, clip.endSec) : undefined,
        manualBounds: clip.manualBounds === true, words: wordsFor(clip), keywords: clip.keywords,
        translation: translations ? clipTranslationLines(translatable, translations, clip.startSec - 1.5, clip.endSec + 1.5) : undefined,
        publish: publishCopies?.get(clip.id),
        meta: { hook: clip.hook, score: clip.score, reason: clip.reason, text: clip.text, recommended: clip.recommended,
          reviewNote: clip.reviewNote, visualEvidence: clip.visualEvidence, scoreDims: clip.scoreDims, teaser: clip.teaser },
      }));
      const specs = variantPlans ? expandClipSpecs(baseSpecs, variantPlans, Boolean(opts.publishCopy?.llm?.baseUrl && opts.publishCopy.llm.model), !opts.flashForward) : baseSpecs;
      const render: ExportRenderOptions = {
        vertical: Boolean(opts.vertical), captionStyle: style,
        jumpCut: Boolean(opts.jumpCut && transcript), keepBreath: Boolean(opts.keepBreath), speakerLabels: opts.speakerLabels !== false,
        templateJitter: Boolean(opts.templateJitter), cleanFillers: Boolean(opts.cleanFillers && transcript), cutRetakes: Boolean(opts.cutRetakes && transcript),
        autoZoom: Boolean(opts.autoZoom), autoEnhance: Boolean(opts.autoEnhance), sfx: Boolean(opts.sfx),
        bgmPath: opts.bgmPath ? this.managed(opts.bgmPath) : undefined, genreId: opts.genreId, alignWords,
        trimUi: Boolean(opts.trimUi), titleCard: Boolean(opts.titleCard), openingHook: Boolean(opts.openingHook),
        normalizeLoudness: Boolean(opts.normalizeLoudness), denoise: Boolean(opts.denoise), denoiseMode: opts.denoiseMode === "smart" ? "smart" : "basic",
        muteTerms: muteTerms.length ? muteTerms : undefined, compilation: Boolean(opts.compilation), coldOpen: Boolean(opts.coldOpen), alsoLandscape: Boolean(opts.alsoLandscape),
        flashForward: Boolean(opts.flashForward), faceTrack: true, snapToShots: true, brand: sanitizeBrand(opts.brand),
        crf: QUALITY_CRF[opts.quality && opts.quality in QUALITY_CRF ? opts.quality : "high"], translateLang: translations ? translate!.targetLang : undefined,
        subtitleFile: Boolean(opts.subtitleFile), timeline: Boolean(opts.timeline), jianyingDraft: Boolean(opts.jianyingDraft),
        aigcLabel: Boolean(opts.aigcLabel), evidencePack: Boolean(opts.evidencePack),
        aiCover: opts.aiCover?.llm?.baseUrl && opts.aiCover.llm.apiKey && (opts.aiCover.tier === "volume" || opts.aiCover.tier === "premium")
          ? { tier: opts.aiCover.tier, baseUrl: opts.aiCover.llm.baseUrl, apiKey: opts.aiCover.llm.apiKey, zh } : undefined,
        publishPack: Array.isArray(opts.publishPack) ? validPlatformIds(opts.publishPack.filter((item): item is string => typeof item === "string")) : undefined,
        seriesPack: Boolean(opts.seriesPack), modelsRoot: modelsRoot(), fontsDir: join(serverRoot(), "resources", "fonts"),
        renderCacheDir: renderCacheDir(), evidenceCacheDir: evidenceCacheDir(),
      };
      return exportClips(source, specs, outDir, render, (progress) => this.hub.emit("export", progress), signal);
    });
  }

  private async diagnostics(value: unknown, locale: unknown): Promise<unknown> {
    const report = await runDoctor({ modelsRoot: modelsRoot(), cacheDir: cacheDir(), renderCacheDir: renderCacheDir(),
      evidenceCacheDir: evidenceCacheDir(), toolsDir: join(this.data(), "tools", "yt-dlp"), llm: optionalLlm(value), zh: locale === "zh", fr: locale === "fr" });
    return { checks: report.checks, missingCoreModels: report.missingCoreModels.length, generatedAt: new Date().toISOString() };
  }

  async invoke(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "projectWorkspaceGet": return projectWorkspace(this.data());
      case "projectCreate": {
        const checkpoint = args[0] as SessionCheckpoint;
        if (checkpoint?.file?.path) this.managed(checkpoint.file.path);
        return createProject(this.data(), checkpoint, typeof args[1] === "string" ? args[1] : undefined);
      }
      case "projectOpen": return openProject(this.data(), stringArg(args[0], "Identifiant du projet"));
      case "projectSave": return saveProject(this.data(), stringArg(args[0], "Identifiant du projet"), args[1]);
      case "projectRename": return renameProject(this.data(), stringArg(args[0], "Identifiant du projet"), stringArg(args[1], "Nom du projet"));
      case "projectDelete": return deleteProject(this.data(), stringArg(args[0], "Identifiant du projet"));
      case "projectRelink": {
        const file = args[1] as MediaInfo & { path: string };
        return relinkProject(this.data(), stringArg(args[0], "Identifiant du projet"), { ...file, path: this.managed(file.path) });
      }
      case "projectClose": return closeProject(this.data());
      case "sessionCheckpointGet": return readSessionCheckpoint(this.data());
      case "sessionCheckpointSave": return saveSessionCheckpoint(this.data(), args[0]);
      case "sessionCheckpointClear": return clearSessionCheckpoint(this.data());
      case "probeMedia": return probeMedia(await this.media(args[0]));
      case "listAsrEngines": return Promise.all(ASR_CATALOG.map(async (facts) => ({
        ...facts,
        installed: facts.id in ASR_ASSETS ? await isModelInstalled(modelsRoot(), ASR_ASSETS[facts.id as keyof typeof ASR_ASSETS]) : false,
      })));
      case "transcribeMedia": return this.transcribe(stringArg(args[0], "Source"), args[1], args[2], (args[3] ?? {}) as SpeechRunOptions);
      case "cancelTranscribe": this.transcribeAbort?.abort(); return undefined;
      case "checkLocalSpeech": return qwenHealth(stringArg(args[0], "Adresse du service vocal"));
      case "previewAlignment": {
        if (this.alignmentAbort || this.transcribeAbort) throw new Error("Une transcription ou un alignement est déjà en cours");
        const controller = new AbortController(); this.alignmentAbort = controller;
        try { return await previewTranscriptAlignment(await this.media(args[0]), args[1] as Transcript, args[2] as any, modelsRoot(), controller.signal); }
        finally { if (this.alignmentAbort === controller) this.alignmentAbort = null; }
      }
      case "cancelAlignment": this.alignmentAbort?.abort(); return undefined;
      case "importSubtitle": return importSubtitleText(await this.media(args[0]), stringArg(args[1], "Texte des sous-titres"), args[2] === "vtt" ? "vtt" : "srt");
      case "detectHighlights": return this.detect(args);
      case "exportClips": return this.export(args[0], args[1], args[2]);
      case "cancelExport": this.exports.cancel(); return undefined;
      case "importMediaUrl": {
        if (this.urlAbort) throw new Error("Un autre import d’URL est déjà en cours");
        const controller = new AbortController(); this.urlAbort = controller;
        try { return await importMediaUrl(stringArg(args[0], "URL du média"), { toolsDir: join(this.data(), "tools", "yt-dlp"),
          destDir: join(this.data(), "uploads"), signal: controller.signal, onProgress: (event) => this.hub.emit("url-import", event) }); }
        catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          throw new Error(localizeUrlImportError(error));
        }
        finally { if (this.urlAbort === controller) this.urlAbort = null; }
      }
      case "cancelUrlImport": this.urlAbort?.abort(); return undefined;
      case "getAudioPeaks": return extractPeaks(await this.media(args[0]), Number(args[1]), Number(args[2]));
      case "timelineData": {
        const source = await this.media(args[0]); const duration = Number(args[1]);
        if (!(duration > 0)) throw new Error("Une durée positive est requise");
        const media = await probeMedia(source); const analysis = media.hasVideo ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) } : {};
        const bins = Math.min(720, Math.max(120, Math.round(duration / 5)));
        const [signals, items, thumbs] = await Promise.all([
          this.warmSignals(source), readDanmakuItems(source).catch(() => null), extractFilmstrip(source, duration, 8, analysis).catch(() => []),
        ]);
        return { loudness: signals?.loudnessSamples ? loudnessCurve(signals.loudnessSamples, duration, bins) : [],
          motion: signals?.motionSamples ? motionCurve(signals.motionSamples, duration, bins) : [],
          danmaku: items ? danmakuHeatCurve(items, duration, bins) : [], thumbs, binSec: duration / bins };
      }
      case "contactSheet": {
        const source = await this.media(args[0]); const from = Math.max(0, Number(args[1])); const to = Number(args[2]);
        if (!(to > from)) throw new Error("Une plage de planche-contact valide est requise");
        const span = to - from; const pad = Math.min(0.3, span / 10); const usable = span - 2 * pad;
        const times = Array.from({ length: 9 }, (_, i) => from + pad + (usable * (i + 0.5)) / 9);
        const media = await probeMedia(source); const b64 = await composeContactSheetJpeg(source, times,
          { fontFile: join(serverRoot(), "resources", "fonts", "SourceHanSansSC-Bold.otf"), videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }).catch(() => null);
        return b64 ? `data:image/jpeg;base64,${b64}` : "";
      }
      case "listLlmModels": return listModels(stringArg(args[0], "URL de base"), typeof args[1] === "string" ? args[1] : "", args[2] as LlmConfig["provider"]);
      case "recordReview": return recordReview(this.data(), { at: new Date().toISOString(), video: basename(stringArg(args[0], "Source")),
        kept: args[1] as any, rejected: args[2] as any });
      case "performanceGet": {
        const [entries, items] = await Promise.all([loadPerformanceMemory(this.data()), loadPublishLedger(this.data())]);
        const measured = items.filter((item) => item.metricsImportedAt).length;
        return summarizePerformance(entries, { total: items.length, measured, awaitingMetrics: items.length - measured, recent: items.slice(-8).reverse() }, summarizeExperiments(items, entries));
      }
      case "performanceImport": {
        const result = await importPerformanceFile(this.data(), await this.media(args[0]));
        return { imported: result.imported, skipped: result.skipped, total: result.total, correlation: result.correlation };
      }
      case "performanceTemplate": {
        const pending = (await loadPublishLedger(this.data())).filter((item) => !item.metricsImportedAt);
        if (!pending.length) return null;
        const path = join(this.data(), "exports", "viral-hit-performance.csv"); await mkdir(join(this.data(), "exports"), { recursive: true });
        await writeFile(path, buildPerformanceTemplate(pending), "utf8"); return { count: pending.length, path };
      }
      case "performanceClear": await Promise.all([clearPerformanceMemory(this.data()), clearPublishMetrics(this.data())]); return undefined;
      case "diagnosticsRun": return this.diagnostics(args[0], args[1]);
      case "diagnosticsClearRenderCache": await clearRenderCache(renderCacheDir()); return this.diagnostics(args[0], args[1]);
      case "diagnosticsClearEvidenceIndex": this.signals.clear(); await clearEvidenceIndex(evidenceCacheDir()); return this.diagnostics(args[0], args[1]);
      case "diagnosticsPrepareModels": {
        if (this.diagnosticsAbort) throw new Error("La préparation des modèles est déjà en cours");
        const before = await runDoctor({ modelsRoot: modelsRoot(), cacheDir: cacheDir(), renderCacheDir: renderCacheDir(), evidenceCacheDir: evidenceCacheDir(), llm: optionalLlm(args[0]), zh: args[1] === "zh", fr: args[1] === "fr" });
        const controller = new AbortController(); this.diagnosticsAbort = controller;
        try {
          for (let i = 0; i < before.missingCoreModels.length; i++) {
            const asset = before.missingCoreModels[i];
            await ensureModel(modelsRoot(), asset, (progress) => this.hub.emit("diagnostics", { modelId: asset.id, current: i + 1,
              total: before.missingCoreModels.length, phase: progress.phase, fraction: progress.totalBytes > 0 ? Math.min(1, progress.downloadedBytes / progress.totalBytes) : 0 }), controller.signal);
          }
          return await this.diagnostics(args[0], args[1]);
        } finally { if (this.diagnosticsAbort === controller) this.diagnosticsAbort = null; }
      }
      case "diagnosticsCancelRepair": this.diagnosticsAbort?.abort(); return undefined;
      case "defaultOutDir": return defaultExportDir();
      case "modelsInfo": return inspectModels(modelsRoot(), defaultModelsRoot(this.data()));
      case "moveModelsDir": {
        const target = assertInside(this.data(), stringArg(args[0], "Dossier des modèles"));
        const landed = await moveModelsDir(modelsRoot(), target);
        writeAppSettings(this.data(), { ...readAppSettings(this.data()), modelsDir: landed === defaultModelsRoot(this.data()) ? undefined : landed });
        return landed;
      }
      case "generateBgm": {
        const config = llmArg(args[0]);
        return generateAiBgm({ baseUrl: config.baseUrl, apiKey: config.apiKey, genreId: typeof args[1] === "string" ? args[1] : undefined, destDir: join(this.data(), "assets") });
      }
      case "glossaryGet": return loadGlossary(this.data());
      case "glossarySet": return saveGlossary(this.data(), args[0] as any);
      case "watchStatus": return { running: false, dir: null };
      case "webhookStatus": return { running: false, port: null, dir: null };
      case "automationTasksGet": return [];
      case "checkUpdate": return null;
      case "watchStart": case "watchStop": case "webhookStart": case "webhookStop":
      case "automationTaskRetry": case "automationTaskCancel": case "automationTasksClear":
        throw new Error("L’automatisation par surveillance ou webhook est disponible dans l’application de bureau et via MCP, pas dans cette session navigateur");
      default: throw new Error(`Méthode API locale inconnue : ${method}`);
    }
  }

  stop(): void {
    this.transcribeAbort?.abort(); this.urlAbort?.abort(); this.alignmentAbort?.abort(); this.diagnosticsAbort?.abort(); this.exports.cancel();
  }
}
