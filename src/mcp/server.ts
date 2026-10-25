/**
 * HotClip MCP Server 入口(stdio):
 *   npx tsx src/mcp/server.ts
 * 在 Claude Code / Claude Desktop 里注册后,Agent 可直接调用本地切片管线
 * (转写/找爆点/出片全在本机,素材不出电脑)。协议逻辑见 protocol.ts,
 * 管线实现与桌面端/录播监听共用 core/pipeline.ts。
 *
 * LLM 配置走环境变量:HOTCLIP_LLM_BASE_URL / HOTCLIP_LLM_MODEL /
 * HOTCLIP_LLM_API_KEY(本地 Ollama 端点可省 key)。
 * 模型与转写缓存目录与桌面 App 共享(下载一次两边都能用)。
 */
import { createInterface } from "readline";
import { join, basename } from "path";
import { transcribeCached, detectForPipeline, autoClip, analyzeReferenceVideo } from "../core/pipeline";
import type { ReferenceProfile } from "../core/reference";
import { loadGlossary } from "../core/glossary-store";
import { userDataDir, modelsRoot, cacheDir, renderCacheDir, evidenceCacheDir, llmFromEnv } from "../core/appenv";
import { loadReviewMemory } from "../core/review-memory";
import { loadPerformanceMemory } from "../core/performance-memory";
import { handleMcpMessage, type JsonRpcMessage } from "./protocol";
import { JobManager } from "../server/jobs";
import { localizeErrorMessage } from "../shared/french-errors";
import { EventHub } from "../server/events";
import { loadLocalEnv, serverRoot } from "../server/config";
import type { RecapJobInput } from "../shared/production";

loadLocalEnv(serverRoot());
const productionJobs = new JobManager(new EventHub());
void productionJobs.load().catch((error) => process.stderr.write(`Historique des productions : ${localizeErrorMessage(error)}\n`));

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function clampClips(n: unknown): number | undefined {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(1, Math.min(12, Math.round(v))) : undefined;
}

/**
 * 参考画像(与 CLI --reference 同一语义):用户显式给的输入,分析失败要在
 * 回执里说清并按无参考继续,不静默丢。note 直接拼进工具回执开头。
 */
async function loadReference(refPath: unknown): Promise<{ profile?: ReferenceProfile; note: string }> {
  if (typeof refPath !== "string" || !refPath.trim()) return { note: "" };
  try {
    const p = await analyzeReferenceVideo(refPath, {
      modelsRoot: modelsRoot(),
      cacheDir: cacheDir(),
      evidenceCacheDir: evidenceCacheDir(),
      glossary: await loadGlossary(userDataDir()),
    });
    const cuts = p.cutsPerMin !== null ? ` · ${p.cutsPerMin} plans/min` : "";
    const unit = p.zh ? " caractère" : " mot";
    return {
      profile: p,
      note: `Profil de référence : ${Math.round(p.durationSec)} s · ${p.speechRate}${unit}/s · phrase moyenne ${p.avgSentenceLen}${unit}${cuts} · accroche « ${p.hookLine.slice(0, 20)} »\n`,
    };
  } catch (e) {
    return { note: `⚠ Échec de l’analyse de référence ; le traitement continue sans elle : ${localizeErrorMessage(e)}\n` };
  }
}

/** 工具实现:返回给 Agent 的文本。 */
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "recap_video") {
    const job = await productionJobs.startRecap(args as unknown as RecapJobInput, false);
    return JSON.stringify({ job, message: "Récapitulatif démarré. Surveillez production_jobs avec cet identifiant ; les artefacts du dossier workDir permettent la reprise." }, null, 2);
  }
  if (name === "production_jobs") {
    await productionJobs.load();
    return JSON.stringify({ jobs: productionJobs.list() }, null, 2);
  }
  if (name === "cancel_production_job") {
    await productionJobs.load();
    return JSON.stringify({ id: String(args.id), cancelled: await productionJobs.cancel(String(args.id)) });
  }
  const videoPath = String(args.videoPath);

  if (name === "transcribe_video") {
    const t = await transcribeCached(videoPath, modelsRoot(), cacheDir(), await loadGlossary(userDataDir()), undefined, typeof args.subtitlePath === "string" ? args.subtitlePath : undefined, { engineId: typeof args.engineId === "string" ? args.engineId : undefined, localServiceUrl: typeof args.localServiceUrl === "string" ? args.localServiceUrl : undefined, restart: args.restart === true });
    const lines = t.segments.map((s) => `[${fmtClock(s.startSec)}] ${s.text}`).join("\n");
    const capped = lines.length > 60_000 ? `${lines.slice(0, 60_000)}\n… (tronqué)` : lines;
    return `Moteur : ${t.engine} · langue : ${t.language} · durée : ${fmtClock(t.durationSec)} · ${t.segments.length} phrases\n${args.subtitlePath ? "Sous-titres importés ; les temps internes sont estimés et doivent être vérifiés.\n" : ""}${capped}`;
  }

  if (name === "detect_highlights") {
    const llm = llmFromEnv();
    const ref = await loadReference(args.referencePath);
    const transcript = await transcribeCached(videoPath, modelsRoot(), cacheDir(), await loadGlossary(userDataDir()), undefined, typeof args.subtitlePath === "string" ? args.subtitlePath : undefined, { engineId: typeof args.engineId === "string" ? args.engineId : undefined, localServiceUrl: typeof args.localServiceUrl === "string" ? args.localServiceUrl : undefined, restart: args.restart === true });
    const candidates = await detectForPipeline(videoPath, transcript, {
      modelsRoot: modelsRoot(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: clampClips(args.maxClips),
      reference: ref.profile,
      // 桌面审阅台积累的本机偏好,MCP 检测同享(只读)
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
    });
    if (candidates.length === 0) return `${ref.note}Aucun moment fort pertinent n’a été trouvé.`;
    return ref.note + JSON.stringify(
      candidates.map((c) => ({
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
      })),
      null,
      2
    );
  }

  if (name === "clip_video") {
    const llm = llmFromEnv();
    const ref = await loadReference(args.referencePath);
    const outcome = await autoClip(videoPath, {
      modelsRoot: modelsRoot(),
      cacheDir: cacheDir(),
      renderCacheDir: renderCacheDir(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: clampClips(args.maxClips),
      vertical: args.vertical !== false,
      captions: args.captions !== false,
      autoEnhance: args.autoEnhance === true,
      denoiseMode: args.denoiseMode === "smart" ? "smart" : args.denoiseMode === "basic" ? "basic" : undefined,
      subtitlePath: typeof args.subtitlePath === "string" ? args.subtitlePath : undefined,
      asr: { engineId: typeof args.engineId === "string" ? args.engineId : undefined, localServiceUrl: typeof args.localServiceUrl === "string" ? args.localServiceUrl : undefined, restart: args.restart === true },
      outDir: typeof args.outDir === "string" && args.outDir.trim() ? args.outDir : undefined,
      fontsDir: join(process.cwd(), "resources", "fonts"),
      glossary: await loadGlossary(userDataDir()),
      reference: ref.profile,
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
    });
    if (outcome.exported.length === 0) {
      return `${ref.note}Aucun clip n’est recommandé après révision. Utilisez detect_highlights pour examiner tous les candidats et leurs remarques.`;
    }
    const list = outcome.exported
      .map((r) => {
        const c = outcome.candidates.find((x) => x.id === r.id);
        // 出片质检告警直接随条目回给 Agent——Agent 只需复核告警条,不用逐条回放
        const qaNote = r.qa && r.qa.status === "warn" ? `\n  ⚠ Contrôle qualité : ${r.qa.issues.join(" ; ")}` : "";
        // 修复循环干过活也要说(裁边/响度重归一,机器改了什么必须可见)
        const fixNote = r.qa?.repair?.applied ? `\n  🔧 Réparations automatiques : ${r.qa.repair.actions.join(" ; ")}` : "";
        const colorNote = r.colorConverted
          ? " · HDR→SDR"
          : r.colorConversionSkipped
            ? " · conversion HDR non prise en charge pour ce chemin couleur"
            : r.colorInspectionFailed
              ? " · échec du contrôle des informations couleur"
              : "";
        const audioNote = r.audioEnhancement ? ` · audio : ${r.audioEnhancement}` : "";
        return `- ${basename(r.path)} (${Math.round(r.durationSec)} s, score ${c?.score ?? "?"}${colorNote}${audioNote}) ${c?.title ?? ""}${qaNote}${fixNote}`;
      })
      .join("\n");
    const warned = outcome.exported.filter((r) => r.qa?.status === "warn").length;
    const qaLine =
      warned > 0
        ? `Contrôle qualité : ${warned} clip(s) avec alerte (voir les entrées et le champ qa de clips.json)`
        : "Contrôle qualité : tous les clips sont conformes (noir, silence, loudness, durée, coupes et vocabulaire sensible)";
    return `${ref.note}${outcome.exported.length} clip(s) exporté(s) vers ${outcome.outDir}\n${list}\n${qaLine}\nLe fichier clips.json (titres, scores, timecodes, reçus et qualité) et une couverture JPG par clip sont inclus.`;
  }

  throw new Error(`Outil non implémenté : ${name}`);
}

// ---- stdio 主循环:一行一条 JSON-RPC ----
export function startServer(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const version = (require("../../package.json") as { version: string }).version;
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(text) as JsonRpcMessage;
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } })}\n`);
      return;
    }
    void handleMcpMessage(msg, executeTool, version).then((res) => {
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    });
  });
  process.stderr.write("Serveur MCP Viral Hit prêt (stdio)\n");
}

startServer();
