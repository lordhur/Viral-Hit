import { localSpeechUrl } from "../core/transcribe/qwen-local";
/**
 * Viral Hit Headless CLI —— 不开桌面端,终端或 Coding Agent 直接驱动本地
 * 切片管线(与桌面端/MCP/录播监听共用 core/pipeline,产物完全一致):
 *
 *   pnpm cli transcribe <视频>                     端侧逐字转写(带缓存)
 *   pnpm cli highlights <视频> [--max-clips N]      AI 找爆点(候选 JSON)
 *   pnpm cli clip <视频> [选项]                     全托管:转写→找爆点→出片+质检
 *
 * LLM 配置走环境变量(与 MCP Server 同一套):VIRALHIT_LLM_BASE_URL /
 * VIRALHIT_LLM_MODEL / VIRALHIT_LLM_API_KEY(本地 Ollama 免 key)。
 * 模型与转写缓存和桌面 App 共享——下载一次三边都能用。
 */
import { join, basename } from "path";
import { transcribeCached, detectForPipeline, autoClip, analyzeReferenceVideo } from "../core/pipeline";
import type { ReferenceProfile } from "../core/reference";
import { loadGlossary } from "../core/glossary-store";
import { describeSubtitleImportError } from "../shared/subtitle-import";
import { localizeErrorMessage } from "../shared/french-errors";
import { userDataDir, modelsRoot, cacheDir, renderCacheDir, evidenceCacheDir, llmFromEnv } from "../core/appenv";
import { runDoctor } from "../core/doctor";
import { ensureModel } from "../core/models";
import { loadReviewMemory } from "../core/review-memory";
import { importPerformanceFile, loadPerformanceMemory, performanceReport } from "../core/performance-memory";

const USAGE = `Viral Hit CLI — clips locaux et gratuits, vos médias restent sur cet ordinateur

Usage :
  pnpm cli transcribe <chemin-de-la-vidéo>
      Transcription locale avec Whisper français par défaut et reprise des fenêtres terminées
      --engine whisper-fr|whisper-fr-small|sensevoice|paraformer|fireredasr|qwen3
      whisper-fr-small : français plus précis pour débit rapide et vocabulaire gaming (modèle local plus lourd)
      --asr-url http://127.0.0.1:8766   service local Qwen3 facultatif
      --restart-transcription          abandonne la progression du moteur actuel et recommence
      transcribe / highlights / clip acceptent --subtitles <original.srt|original.vtt>
      Importe des sous-titres UTF-8 existants sans ASR ; les temps internes sont estimés et doivent être vérifiés

  pnpm cli highlights <chemin-de-la-vidéo> [--max-clips N] [--reference vidéo-de-référence] [--json]
      Détection gratuite des moments forts, avec scores, accroches et points de coupe
      --reference : mesure le rythme d’une vidéo de référence (durée, débit, plans, accroche)
      et rapproche la sélection de ce profil sans en faire une contrainte absolue

  pnpm cli clip <chemin-de-la-vidéo> [--max-clips N] [--reference vidéo-de-référence] [--no-vertical] [--no-captions] [--auto-enhance] [--denoise|--smart-denoise] [--out dossier] [--json]
      Parcours autonome : transcription → détection → export (vertical, sous-titres, suppression des silences et loudness)
      + contrôle qualité (noir, silence, loudness, durée, coupes et vocabulaire sensible) dans clips.json
      + réparation automatique des alertes récupérables, consignée dans qa.repair
      --auto-enhance : correction locale mesurée des images trop sombres, ternes ou saturées (désactivée par défaut)
      --denoise : filtre fixe ; --smart-denoise : voix locale 48 kHz avec repli sur le filtre fixe

  pnpm cli doctor [--download]
      Diagnostic de FFmpeg, des modèles, du moteur de détection, du disque et des caches
      --download : prépare les modèles du parcours par défaut avec reprise après interruption

  pnpm cli feedback <CSV ou JSON exporté par une plateforme>
      Importe les vues, mentions J’aime, commentaires, partages et favoris pour un apprentissage local
      Accepte les en-têtes français, anglais et chinois ainsi que les nombres compacts

  pnpm cli feedback-report [--json]
      Affiche les exemples de bonnes et mauvaises performances appris localement

Configuration IA facultative (highlights / clip) :
  Le moteur gratuit intégré est utilisé par défaut, sans clé ni variable d’environnement.
  VIRALHIT_LLM_BASE_URL   endpoint OpenAI compatible d’un Ollama local explicitement choisi
  VIRALHIT_LLM_MODEL      nom du modèle local (par exemple qwen3:8b)
  VIRALHIT_LLM_API_KEY    inutile avec Ollama ; ne configurez pas un ancien jeton cloud pour le moteur intégré`;

/** 极简参数解析:布尔开关 + 带值选项,首个非选项参数是视频路径。 */
export interface CliArgs {
  command: string;
  videoPath: string;
  maxClips?: number;
  vertical: boolean;
  captions: boolean;
  autoEnhance: boolean;
  denoiseMode?: "basic" | "smart";
  outDir?: string;
  /** 对标爆款视频路径(参考画像驱动选段)。 */
  referencePath?: string;
  subtitlePath?: string;
  engineId?: string;
  localServiceUrl?: string;
  restart?: boolean;
  json: boolean;
  /** doctor 专用:把缺失的默认管线模型现在预下载好。 */
  download: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    throw new Error(USAGE);
  }
  const args: CliArgs = { command, videoPath: "", vertical: true, captions: true, autoEnhance: false, json: false, download: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--no-vertical") args.vertical = false;
    else if (a === "--no-captions") args.captions = false;
    else if (a === "--auto-enhance") args.autoEnhance = true;
    else if (a === "--denoise") args.denoiseMode = "basic";
    else if (a === "--smart-denoise") args.denoiseMode = "smart";
    else if (a === "--json") args.json = true;
    else if (a === "--download") args.download = true;
    else if (a === "--restart-transcription") args.restart = true;
    else if (a === "--engine") {
      const value = rest[++i];
      if (!["whisper-fr", "whisper-fr-small", "sensevoice", "paraformer", "fireredasr", "qwen3"].includes(value)) throw new Error("--engine attend l’un de ces moteurs : whisper-fr | whisper-fr-small | sensevoice | paraformer | fireredasr | qwen3");
      args.engineId = value;
    } else if (a === "--asr-url") {
      const value = rest[++i];
      if (!value) throw new Error("--asr-url attend une URL locale de bouclage");
      args.localServiceUrl = localSpeechUrl(value);
    }
    else if (a === "--max-clips") {
      const v = Number(rest[++i]);
      if (!Number.isFinite(v)) throw new Error("--max-clips attend un nombre");
      args.maxClips = Math.max(1, Math.min(12, Math.round(v)));
    } else if (a === "--out") {
      const v = rest[++i];
      if (!v) throw new Error("--out attend le chemin d’un dossier");
      args.outDir = v;
    } else if (a === "--reference") {
      const v = rest[++i];
      if (!v) throw new Error("--reference attend le chemin d’une vidéo de référence");
      args.referencePath = v;
    } else if (a === "--subtitles") {
      const v = rest[++i];
      if (!v?.trim() || v.startsWith("--")) throw new Error("--subtitles attend le chemin d’un fichier SRT ou WebVTT");
      args.subtitlePath = v;
    } else if (a.startsWith("--")) {
      throw new Error(`Option inconnue : ${a}\n\n${USAGE}`);
    } else if (!args.videoPath) {
      args.videoPath = a;
    }
  }
  // doctor/feedback-report 不吃路径;feedback 的位置参数是指标文件路径
  if (!args.videoPath && !["doctor", "feedback-report"].includes(args.command)) throw new Error(`Chemin de la vidéo ou du fichier de données manquant\n\n${USAGE}`);
  if (args.subtitlePath && !["transcribe", "highlights", "clip"].includes(args.command)) throw new Error("--subtitles est réservé à transcribe / highlights / clip");
  return args;
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

async function main(signal?: AbortSignal): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.command === "doctor") {
    // LLM 未配置不是错误(transcribe 用不到),按"未配置"呈现
    let llm = null;
    try {
      llm = llmFromEnv();
    } catch {
      // 保持 null
    }
    const report = await runDoctor({ modelsRoot: modelsRoot(), cacheDir: cacheDir(), renderCacheDir: renderCacheDir(), evidenceCacheDir: evidenceCacheDir(), llm, fr: true });
    const icon = { ok: "✅", warn: "⚠️", fail: "❌" } as const;
    for (const c of report.checks) {
      process.stdout.write(`${icon[c.status]} ${c.name}:${c.detail}\n`);
      if (c.fix) process.stdout.write(`   ↳ ${c.fix}\n`);
    }
    if (args.download && report.missingCoreModels.length > 0) {
      const mb = (n: number): number => Math.round(n / (1024 * 1024));
      for (const asset of report.missingCoreModels) {
        await ensureModel(modelsRoot(), asset, (p) => {
          const pct = Math.min(100, Math.round((p.downloadedBytes / p.totalBytes) * 100));
          const verb = p.phase === "extract" ? "Extraction" : "Téléchargement";
          process.stderr.write(`\r${verb} ${asset.id}:${pct}%(${mb(p.downloadedBytes)}/${mb(p.totalBytes)}MB)   `);
        });
        process.stderr.write(`\r✅ ${asset.id} est prêt${" ".repeat(24)}\n`);
      }
      process.stdout.write("Tous les modèles du parcours par défaut sont prêts.\n");
    } else if (report.missingCoreModels.length > 0) {
      process.stdout.write(`${report.missingCoreModels.length} modèle(s) du parcours par défaut ne sont pas installés ; utilisez --download pour les préparer.\n`);
    }
    if (report.checks.some((c) => c.status === "fail")) process.exitCode = 1;
    return;
  }

  if (args.command === "feedback") {
    const result = await importPerformanceFile(userDataDir(), args.videoPath);
    process.stdout.write(`${result.imported} performances importées, ${result.skipped} lignes invalides ignorées ; ${result.total} exemples sont disponibles localement.\n`);
    process.stdout.write(`${performanceReport(result.entries, false, true)}\n`);
    return;
  }

  if (args.command === "feedback-report") {
    const entries = await loadPerformanceMemory(userDataDir());
    process.stdout.write(args.json ? `${JSON.stringify(entries, null, 2)}\n` : `${performanceReport(entries, false, true)}\n`);
    return;
  }

  const glossary = await loadGlossary(userDataDir());

  // 参考画像:用户显式给的输入,分析失败要说清并按无参考继续(不静默丢)
  const loadReference = async (): Promise<ReferenceProfile | undefined> => {
    if (!args.referencePath) return undefined;
    process.stderr.write("Analyse du rythme de la vidéo de référence…\n");
    try {
      const p = await analyzeReferenceVideo(args.referencePath, {
        modelsRoot: modelsRoot(),
        cacheDir: cacheDir(),
        evidenceCacheDir: evidenceCacheDir(),
        glossary,
        signal,
      });
      const cuts = p.cutsPerMin !== null ? ` · ${p.cutsPerMin} plans/min` : "";
      const unit = p.zh ? " caractère" : " mot";
      process.stderr.write(
        `Profil de référence : ${Math.round(p.durationSec)} s · ${p.speechRate}${unit}/s · phrase moyenne ${p.avgSentenceLen}${unit}${cuts} · accroche « ${p.hookLine.slice(0, 20)} »\n`
      );
      return p;
    } catch (e) {
      process.stderr.write(`⚠ Échec de l’analyse de référence ; le traitement continue sans elle : ${localizeErrorMessage(e)}\n`);
      return undefined;
    }
  };

  if (args.command === "transcribe") {
    const t = await transcribeCached(args.videoPath, modelsRoot(), cacheDir(), glossary, signal, args.subtitlePath, { engineId: args.engineId, localServiceUrl: args.localServiceUrl, restart: args.restart });
    if (args.json) process.stdout.write(`${JSON.stringify(t, null, 2)}\n`);
    else for (const s of t.segments) process.stdout.write(`[${fmtClock(s.startSec)}] ${s.text}\n`);
    if (args.subtitlePath) process.stderr.write("Sous-titres importés ; les temps des mots dans chaque phrase sont estimés. Vérifiez les sous-titres et les coupes automatiques.\n");
    process.stderr.write(`Langue : ${t.language} · durée : ${fmtClock(t.durationSec)} · ${t.segments.length} phrases\n`);
    return;
  }

  if (args.command === "highlights") {
    const llm = llmFromEnv();
    const reference = await loadReference();
    process.stderr.write(args.subtitlePath ? "Import des sous-titres (temps des mots estimés)…\n" : "Transcription locale (avec cache)…\n");
    const transcript = await transcribeCached(args.videoPath, modelsRoot(), cacheDir(), glossary, signal, args.subtitlePath, { engineId: args.engineId, localServiceUrl: args.localServiceUrl, restart: args.restart });
    process.stderr.write("Détection des moments forts…\n");
    const candidates = await detectForPipeline(args.videoPath, transcript, {
      modelsRoot: modelsRoot(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: args.maxClips,
      reference,
      // 桌面审阅台积累的本机偏好,CLI 检测同享(只读)
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
      signal,
    });
    if (candidates.length === 0) {
      process.stderr.write("Aucun moment fort pertinent n’a été trouvé.\n");
      return;
    }
    const rows = candidates.map((c) => ({
      id: c.id,
      start: fmtClock(c.startSec),
      end: fmtClock(c.endSec),
      startSec: c.startSec,
      endSec: c.endSec,
      title: c.title,
      hook: c.hook,
      score: c.score,
      reason: c.reason,
      recommended: c.recommended,
      reviewNote: c.reviewNote || undefined,
      visualEvidence: c.visualEvidence,
      formatComparison: c.formatComparison,
    }));
    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    } else {
      for (const r of rows) {
        const mark = r.recommended ? "✅" : "⚠️ Publication déconseillée";
        process.stdout.write(`#${r.id} [${r.start}-${r.end}] score ${r.score} ${mark}\n  ${r.title}\n  Accroche : ${r.hook}\n`);
      }
    }
    return;
  }

  if (args.command === "clip") {
    const llm = llmFromEnv();
    const reference = await loadReference();
    const outcome = await autoClip(args.videoPath, {
      modelsRoot: modelsRoot(),
      cacheDir: cacheDir(),
      renderCacheDir: renderCacheDir(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: args.maxClips,
      vertical: args.vertical,
      captions: args.captions,
      autoEnhance: args.autoEnhance,
      denoiseMode: args.denoiseMode,
      subtitlePath: args.subtitlePath,
      asr: { engineId: args.engineId, localServiceUrl: args.localServiceUrl, restart: args.restart },
      signal,
      outDir: args.outDir,
      reference,
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
      fontsDir: join(__dirname, "..", "..", "resources", "fonts"),
      glossary,
      onStage: (stage) => {
        const label = { transcribing: args.subtitlePath ? "Import des sous-titres (temps des mots estimés)…" : "Transcription locale (avec cache)…", detecting: "Détection des moments forts…", exporting: "Export des clips…" }[stage];
        process.stderr.write(`${label}\n`);
      },
    });
    if (outcome.exported.length === 0) {
      process.stderr.write("Aucun clip n’est recommandé après révision. Utilisez la commande highlights pour examiner tous les candidats et leurs remarques.\n");
      return;
    }
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            outDir: outcome.outDir,
            clips: outcome.exported.map((r) => ({
              file: basename(r.path),
              path: r.path,
              durationSec: Math.round(r.durationSec * 1000) / 1000,
              colorConverted: Boolean(r.colorConverted),
              colorConversionSkipped: Boolean(r.colorConversionSkipped),
              colorInspectionFailed: Boolean(r.colorInspectionFailed),
              audioEnhancement: r.audioEnhancement ?? null,
              qa: r.qa ?? null,
            })),
          },
          null,
          2
        )}\n`
      );
      return;
    }
    process.stdout.write(`${outcome.exported.length} clip(s) exporté(s) vers ${outcome.outDir}\n`);
    for (const r of outcome.exported) {
      const c = outcome.candidates.find((x) => x.id === r.id);
      const colorNote = r.colorConverted
        ? " · HDR→SDR"
        : r.colorConversionSkipped
          ? " · conversion HDR non prise en charge pour ce chemin couleur"
          : r.colorInspectionFailed
            ? " · échec du contrôle des informations couleur"
            : "";
      const audioNote = r.audioEnhancement ? ` · audio : ${r.audioEnhancement}` : "";
      process.stdout.write(`- ${basename(r.path)} (${Math.round(r.durationSec)} s, score ${c?.score ?? "?"}${colorNote}${audioNote}) ${c?.title ?? ""}\n`);
      if (r.qa && r.qa.status === "warn") {
        process.stdout.write(`  ⚠ Contrôle qualité : ${r.qa.issues.join(" ; ")}\n`);
      }
      if (r.qa?.repair?.applied) {
        process.stdout.write(`  🔧 Réparations automatiques : ${r.qa.repair.actions.join(" ; ")}\n`);
      }
    }
    const warned = outcome.exported.filter((r) => r.qa?.status === "warn").length;
    process.stdout.write(
      warned > 0
        ? `Contrôle qualité : ${warned} clip(s) avec alerte (voir le champ qa de clips.json)\n`
        : "Contrôle qualité : tous les clips sont conformes (noir, silence, loudness, durée, coupes et vocabulaire sensible)\n"
    );
    process.stdout.write("Le fichier clips.json (titres, scores, timecodes, reçus et qualité) et une couverture JPG par clip sont inclus.\n");
    return;
  }

  throw new Error(`Commande inconnue : ${args.command}\n\n${USAGE}`);
}

// 仅作为入口执行时才跑主流程(单测只 import parseCliArgs)
if (require.main === module) {
  const abort = new AbortController();
  const cancel = (): void => abort.abort();
  const speechCommand = ["transcribe", "highlights", "clip"].includes(process.argv[2]);
  if (speechCommand) { process.once("SIGINT", cancel); process.once("SIGTERM", cancel); }
  main(abort.signal).catch((e) => {
    process.stderr.write(abort.signal.aborted ? "Arrêt demandé. Les fenêtres de transcription terminées pourront être reprises au prochain lancement.\n" : `${localizeErrorMessage(describeSubtitleImportError(e))}\n`);
    process.exitCode = abort.signal.aborted ? 130 : 1;
  }).finally(() => { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); });
}
