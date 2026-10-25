/**
 * 环境自检(doctor):首跑失败的三大元凶——模型没下好、ffmpeg 不可用、
 * LLM 端点没配——一条命令全查清,能自动修的给出修法。检查逻辑与渲染
 * 分离(纯数据结果),CLI 先用,桌面端设置页以后可直接复用。
 */
import { readFile, readdir, stat } from "fs/promises";
import { statfs } from "fs/promises";
import { dirname, join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import type { LlmConfig } from "../shared/api-types";
import { localizeErrorMessage } from "../shared/french-errors";
import { resolveFfmpegPath, resolveFfprobePath } from "./binaries";
import {
  isModelInstalled,
  modelDir,
  type ModelAsset,
  SENSEVOICE_MODEL,
  WHISPER_FR_MODEL,
  PARAFORMER_MODEL,
  FIRERED_MODEL,
  YUNET_MODEL,
  EMOTION_MODEL,
  PUNCT_MODEL,
  TRANSNETV2_MODEL,
  SEGMENTATION_MODEL,
  SPEAKER_EMBEDDING_MODEL,
  SILERO_VAD_MODEL,
  DPDFNET_SPEECH_ENHANCEMENT_MODEL,
} from "./models";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  /** 稳定机器标识,桌面端据此本地化名称。 */
  id: string;
  /** 检查项名称(用户可读)。 */
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** 能照做的修复建议(没有则省略)。 */
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** 默认管线要用但还没装的模型——`--download` 的预下载对象。 */
  missingCoreModels: ModelAsset[];
}

/** 模型清单:core=默认管线必经(clip 一条龙会自动触发下载)。 */
type DoctorLabel = { zh: string; en: string; fr: string };
const MODEL_ROWS: Array<{ asset: ModelAsset; label: DoctorLabel; core: boolean }> = [
  { asset: WHISPER_FR_MODEL, label: { zh: "法语转写 Whisper(默认档)", en: "French Whisper transcription (default)", fr: "Transcription française Whisper (défaut)" }, core: true },
  { asset: SENSEVOICE_MODEL, label: { zh: "转写 SenseVoice(多语种快速档)", en: "SenseVoice transcription (fast multilingual)", fr: "Transcription SenseVoice (multilingue rapide)" }, core: false },
  { asset: YUNET_MODEL, label: { zh: "人脸检测 YuNet(竖屏取景)", en: "YuNet face detection (vertical framing)", fr: "Détection des visages YuNet (cadrage vertical)" }, core: true },
  { asset: EMOTION_MODEL, label: { zh: "表情识别 FER+(爆点信号)", en: "FER+ facial emotion (highlight signal)", fr: "Émotions du visage FER+ (moments forts)" }, core: true },
  { asset: TRANSNETV2_MODEL, label: { zh: "镜头检测 TransNetV2(切点吸附)", en: "TransNetV2 shot detection (cut snapping)", fr: "Détection des plans TransNetV2 (coupes précises)" }, core: true },
  { asset: SILERO_VAD_MODEL, label: { zh: "语音活动检测(安全切点)", en: "Speech activity detection (safe cuts)", fr: "Détection de l’activité vocale (coupes sûres)" }, core: true },
  { asset: PARAFORMER_MODEL, label: { zh: "转写 Paraformer(更准档)", en: "Paraformer transcription (accurate)", fr: "Transcription Paraformer (précise)" }, core: false },
  { asset: FIRERED_MODEL, label: { zh: "转写 FireRedASR2(最准档)", en: "FireRedASR2 transcription (highest accuracy)", fr: "Transcription FireRedASR2 (haute précision)" }, core: false },
  { asset: PUNCT_MODEL, label: { zh: "标点恢复(更准档转写需要)", en: "Punctuation restoration", fr: "Restauration de la ponctuation" }, core: false },
  { asset: SEGMENTATION_MODEL, label: { zh: "说话人分离·分段", en: "Speaker diarization segmentation", fr: "Segmentation des intervenants" }, core: false },
  { asset: SPEAKER_EMBEDDING_MODEL, label: { zh: "说话人分离·声纹", en: "Speaker diarization embeddings", fr: "Empreintes vocales des intervenants" }, core: false },
  { asset: DPDFNET_SPEECH_ENHANCEMENT_MODEL, label: { zh: "智能人声增强 DPDFNet(48kHz)", en: "DPDFNet smart dialogue enhancement (48kHz)", fr: "Amélioration locale de la voix DPDFNet (48 kHz)" }, core: false },
];

function doctorText(fr: boolean, zh: boolean, frText: string, zhText: string, enText: string): string {
  return fr ? frText : zh ? zhText : enText;
}

const MB = 1024 * 1024;
const fmtMB = (bytes: number): string => `${Math.max(1, Math.round(bytes / MB))}MB`;
const fmtGB = (bytes: number): string => `${(bytes / (1024 * MB)).toFixed(1)}GB`;

/** 目录递归总大小;不存在按 0 算。 */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) {
      try {
        total += (await stat(p)).size;
      } catch {
        // 竞态删除:忽略
      }
    }
  }
  return total;
}

/** 真实的版本探测:跑 `bin -version` 取首行。 */
async function probeVersionReal(bin: string): Promise<string> {
  const { stdout } = await execFileAsync(bin, ["-version"], { maxBuffer: 1024 * 1024 });
  return stdout;
}

/** ffmpeg/ffprobe 可用性:能解析到路径且 -version 跑得动。 */
async function checkBinary(
  name: string,
  resolve: () => string,
  probe: (bin: string) => Promise<string>,
  zh: boolean,
  fr: boolean
): Promise<DoctorCheck> {
  try {
    const bin = resolve();
    const stdout = await probe(bin);
    const firstLine = stdout.split("\n")[0]?.trim() ?? "";
    return { id: `binary:${name}`, name, status: "ok", detail: firstLine || doctorText(fr, zh, "Disponible", "可用", "Available") };
  } catch (e) {
    return {
      id: `binary:${name}`,
      name,
      status: "fail",
      detail: fr ? localizeErrorMessage(e, `L’outil média ${name} est introuvable ou inutilisable.`) : e instanceof Error ? e.message : String(e),
      fix: doctorText(fr, zh, "Lancez « Mettre à jour Viral Hit » pour restaurer les outils médias intégrés.", "重新安装应用以恢复内置媒体工具", "Reinstall the app to restore its bundled media tools"),
    };
  }
}

/** 单个模型状态:已装(实际体积)/有断点(续传量)/未装(自动下载量)。 */
async function checkModel(
  modelsRoot: string,
  row: { asset: ModelAsset; label: DoctorLabel; core: boolean },
  zh: boolean,
  fr: boolean
): Promise<{ check: DoctorCheck; missing: boolean }> {
  const { asset, core } = row;
  const label = row.label[fr ? "fr" : zh ? "zh" : "en"];
  if (await isModelInstalled(modelsRoot, asset)) {
    const size = await dirSize(modelDir(modelsRoot, asset));
    return { check: { id: `model:${asset.id}`, name: label, status: "ok", detail: doctorText(fr, zh, `Installé (${fmtMB(size)})`, `已安装(${fmtMB(size)})`, `Installed (${fmtMB(size)})`) }, missing: false };
  }
  let partial = 0;
  try {
    partial = (await stat(join(modelsRoot, `${asset.id}.download.tar.bz2`))).size;
  } catch {
    // 无断点文件
  }
  const resume = partial > 0 ? doctorText(fr, zh, ` ; reprise du téléchargement partiel de ${fmtMB(partial)}`, `,已有断点 ${fmtMB(partial)} 会续传`, `; ${fmtMB(partial)} partial download will resume`) : "";
  if (core) {
    return {
      check: {
        id: `model:${asset.id}`,
        name: label,
        status: "warn",
        detail: doctorText(fr, zh, `Non installé (environ ${fmtMB(asset.approxBytes)}${resume})`, `未安装(约 ${fmtMB(asset.approxBytes)}${resume})`, `Not installed (about ${fmtMB(asset.approxBytes)}${resume})`),
        fix: doctorText(fr, zh, "Préparez-le maintenant ou laissez la première utilisation le télécharger gratuitement.", "现在预下载,或等首次使用时自动下载", "Prepare it now, or let first use download it automatically"),
      },
      missing: true,
    };
  }
  return {
    check: { id: `model:${asset.id}`, name: label, status: "ok", detail: doctorText(fr, zh, `Non installé (facultatif ; téléchargement à la première utilisation, environ ${fmtMB(asset.approxBytes)}${resume})`, `未安装(可选,用到时自动下载,约 ${fmtMB(asset.approxBytes)}${resume})`, `Not installed (optional; downloads on first use, about ${fmtMB(asset.approxBytes)}${resume})`) },
    missing: false,
  };
}

/** LLM 配置与端点连通性:区分成功、兼容路由、凭据和网络故障。 */
async function checkLlm(llm: LlmConfig | null, zh: boolean, fr = false): Promise<DoctorCheck> {
  if (llm?.provider === "builtin") {
    return {
      id: "llm",
      name: doctorText(fr, zh, "Moteur gratuit intégré", "免费内置检测", "Built-in free detection"),
      status: "ok",
      detail: doctorText(fr, zh, "Prêt · aucune clé, aucun service réseau", "已就绪 · 无需令牌或网络服务", "Ready · no token or network service"),
    };
  }
  if (!llm) {
    return {
      id: "llm",
      name: doctorText(fr, zh, "Configuration IA", "LLM 配置", "LLM configuration"),
      status: "warn",
      detail: doctorText(fr, zh, "Aucun service configuré ; la transcription et la détection intégrée restent locales et gratuites.", "未配置(转写不需要;找爆点/出片需要)", "Not configured (transcription works without it; highlights need it)"),
      fix: doctorText(fr, zh, "Choisissez « Gratuit · moteur intégré » ou un modèle Ollama local dans les réglages IA.", "在 AI 模型设置中选择供应商并填写模型;CLI 可设置 HOTCLIP_LLM_BASE_URL 与 HOTCLIP_LLM_MODEL", "Choose a provider and model in AI model settings; CLI users can set HOTCLIP_LLM_BASE_URL and HOTCLIP_LLM_MODEL"),
    };
  }
  const endpointName = doctorText(fr, zh, "Service IA configuré", "LLM 端点", "LLM endpoint");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const response = await fetch(`${llm.baseUrl.replace(/\/$/, "")}/models`, {
        signal: ctrl.signal,
        headers: llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : undefined,
      });
      if (response.status === 401 || response.status === 403) {
        return {
          id: "llm",
          name: endpointName,
          status: "fail",
          detail: doctorText(fr, zh, `Le service IA refuse l’accès (HTTP ${response.status}).`, `端点拒绝凭据(HTTP ${response.status})`, `Endpoint rejected credentials (HTTP ${response.status})`),
          fix: doctorText(fr, zh, "Sélectionnez « Gratuit · moteur intégré » ou vérifiez votre service Ollama local ; aucune clé payante n’est nécessaire.", "在 AI 模型设置中更新或移除失效的 API Key", "Update or remove the expired API key in AI model settings"),
        };
      }
      if (!response.ok) {
        return {
          id: "llm",
          name: endpointName,
          status: "warn",
          detail: doctorText(fr, zh, `Le service répond, mais la liste des modèles renvoie HTTP ${response.status}.`, `端点可达,但模型清单返回 HTTP ${response.status}`, `Endpoint is reachable, but the model list returned HTTP ${response.status}`),
          fix: doctorText(fr, zh, "Vérifiez que l’adresse du service local contient le préfixe compatible OpenAI approprié.", "检查接口地址是否包含正确的 OpenAI 兼容前缀", "Check that the Base URL includes the correct OpenAI-compatible prefix"),
        };
      }
    } finally {
      clearTimeout(timer);
    }
    return { id: "llm", name: endpointName, status: "ok", detail: doctorText(fr, zh, `${llm.model} @ ${llm.baseUrl} est accessible`, `${llm.model} @ ${llm.baseUrl} 可达`, `${llm.model} @ ${llm.baseUrl} is reachable`) };
  } catch {
    return {
      id: "llm",
      name: endpointName,
      status: "warn",
      detail: doctorText(fr, zh, `Impossible de joindre ${llm.baseUrl}`, `${llm.baseUrl} 连不上`, `Cannot reach ${llm.baseUrl}`),
      fix: doctorText(fr, zh, "Vérifiez que le service local est démarré et que l’adresse et le port sont corrects.", "确认服务已启动且地址端口正确", "Confirm the service is running and the address and port are correct"),
    };
  }
}

/** 磁盘余量:模型全家桶 ~1.5GB + 出片工作区,低于 3GB 提醒。 */
async function checkDisk(modelsRoot: string, zh: boolean, fr: boolean): Promise<DoctorCheck | null> {
  try {
    const s = await statfs(modelsRoot).catch(() => statfs(dirname(modelsRoot)));
    const free = s.bavail * s.bsize;
    const name = doctorText(fr, zh, "Espace disque", "磁盘空间", "Disk space");
    if (free < 3 * 1024 * MB) {
      return {
        id: "disk",
        name,
        status: "warn",
        detail: doctorText(fr, zh, `Seulement ${fmtGB(free)} disponibles`, `可用仅 ${fmtGB(free)}`, `Only ${fmtGB(free)} available`),
        fix: doctorText(fr, zh, "Libérez de l’espace : les modèles principaux nécessitent environ 1,5 Go, plus l’espace de travail des exports.", "清理磁盘:核心模型约 1.5GB,出片还需工作空间", "Free disk space; core models need about 1.5GB plus export workspace"),
      };
    }
    return { id: "disk", name, status: "ok", detail: doctorText(fr, zh, `${fmtGB(free)} disponibles`, `可用 ${fmtGB(free)}`, `${fmtGB(free)} available`) };
  } catch {
    // statfs 不可用(老 Node/罕见文件系统):跳过而不是误报
    return null;
  }
}

/** 地址导入工具是可选能力:缺失不告警;已缓存但校验不一致必须明确提示。 */
async function checkDownloader(toolsDir: string, zh: boolean, fr: boolean): Promise<DoctorCheck> {
  const binary = join(toolsDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const checksumFile = `${binary}.sha256`;
  const name = doctorText(fr, zh, "Import de vidéos par URL (yt-dlp)", "网络视频下载器", "Network video downloader");
  try {
    const [bytes, expected] = await Promise.all([readFile(binary), readFile(checksumFile, "utf8")]);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected.trim().toLowerCase()) {
      return {
        id: "downloader",
        name,
        status: "warn",
        detail: doctorText(fr, zh, "La vérification d’intégrité du composant local a échoué.", "本地缓存校验不一致", "Cached tool failed integrity verification"),
        fix: doctorText(fr, zh, "Relancez un import d’URL : le composant endommagé sera supprimé, téléchargé à nouveau et vérifié.", "下次从地址导入时会自动删除损坏缓存并重新下载、校验", "The next URL import will remove the damaged cache, redownload it, and verify it"),
      };
    }
    return { id: "downloader", name, status: "ok", detail: doctorText(fr, zh, "Installé et vérifié", "已安装且校验通过", "Installed and verified") };
  } catch {
    return { id: "downloader", name, status: "ok", detail: doctorText(fr, zh, "Non installé ; téléchargement et vérification automatiques au premier import d’URL.", "尚未安装(首次从地址导入时自动下载并校验)", "Not installed yet (first URL import downloads and verifies it)") };
  }
}

/**
 * 跑全部自检。llm 传 null 表示未配置(CLI 侧从环境变量解析后传入,
 * 便于单测与桌面端各自接线)。
 */
export async function runDoctor(opts: {
  modelsRoot: string;
  cacheDir: string;
  /** Optional bounded base-render cache; desktop passes it for size/control visibility. */
  renderCacheDir?: string;
  /** Optional bounded source-analysis evidence index. */
  evidenceCacheDir?: string;
  /** 桌面地址导入工具目录;CLI 未提供时跳过此可选检查。 */
  toolsDir?: string;
  llm: LlmConfig | null;
  /** 测试注入口:替换 ffmpeg/ffprobe 路径解析——单测不依赖 runner 的二进制环境。 */
  resolveBinaries?: { ffmpeg: () => string; ffprobe: () => string };
  /**
   * 测试注入口:替换 `bin -version` 探测——Windows runner 没有 /bin/echo
   * 这类可当假二进制的路径,注入后单测彻底不碰真进程。
   */
  probeBinaryVersion?: (bin: string) => Promise<string>;
  /** 缺省中文;桌面英文界面传 false。 */
  zh?: boolean;
  /** Libellés français pour le nouveau moteur intégré. */
  fr?: boolean;
}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const missingCoreModels: ModelAsset[] = [];

  const bins = opts.resolveBinaries ?? { ffmpeg: resolveFfmpegPath, ffprobe: resolveFfprobePath };
  const probe = opts.probeBinaryVersion ?? probeVersionReal;
  const fr = opts.fr === true;
  const zh = !fr && opts.zh !== false;
  checks.push(await checkBinary("ffmpeg", bins.ffmpeg, probe, zh, fr));
  checks.push(await checkBinary("ffprobe", bins.ffprobe, probe, zh, fr));
  if (opts.toolsDir) checks.push(await checkDownloader(opts.toolsDir, zh, fr));

  for (const row of MODEL_ROWS) {
    const { check, missing } = await checkModel(opts.modelsRoot, row, zh, fr);
    checks.push(check);
    if (missing) missingCoreModels.push(row.asset);
  }

  checks.push(await checkLlm(opts.llm, zh, fr));

  const disk = await checkDisk(opts.modelsRoot, zh, fr);
  if (disk) checks.push(disk);

  const cacheBytes = await dirSize(opts.cacheDir);
  checks.push({
    id: "cache",
    name: doctorText(fr, zh, "Cache de transcription", "转写缓存", "Transcript cache"),
    status: "ok",
    detail: cacheBytes > 0
      ? doctorText(fr, zh, `${fmtMB(cacheBytes)} · réouverture immédiate du même fichier`, `${fmtMB(cacheBytes)}(同文件重开秒进)`, `${fmtMB(cacheBytes)} (reopens the same file instantly)`)
      : doctorText(fr, zh, "Vide ; il se remplira après la première transcription.", "空(转写后自动积累)", "Empty (builds automatically after transcription)"),
  });

  if (opts.renderCacheDir) {
    const renderCacheBytes = await dirSize(opts.renderCacheDir);
    checks.push({
      id: "render-cache",
      name: doctorText(fr, zh, "Cache de rendu", "基础渲染缓存", "Render cache"),
      status: "ok",
      detail: renderCacheBytes > 0
        ? doctorText(fr, zh, `${fmtMB(renderCacheBytes)} · étapes réutilisées, limite automatique de 1 Go`, `${fmtMB(renderCacheBytes)}(重复导出直接复用,自动限制为 1GB)`, `${fmtMB(renderCacheBytes)} (reused for repeat exports; automatically limited to 1GB)`)
        : doctorText(fr, zh, "Vide ; il se remplira pendant les exports.", "空(导出后按需积累)", "Empty (builds as clips are exported)"),
    });
  }

  if (opts.evidenceCacheDir) {
    const evidenceBytes = await dirSize(opts.evidenceCacheDir);
    checks.push({
      id: "evidence-index",
      name: doctorText(fr, zh, "Index de preuves multimédias", "多模态证据索引", "Multimodal evidence index"),
      status: "ok",
      detail: evidenceBytes > 0
        ? doctorText(fr, zh, `${fmtMB(evidenceBytes)} · preuves réutilisées entre les tâches, limite automatique de 64 Mo`, `${fmtMB(evidenceBytes)}(运动/镜头/视觉证据跨任务复用,自动限制为 64MB)`, `${fmtMB(evidenceBytes)} (motion/shot/vision evidence reused across jobs; automatically limited to 64MB)`)
        : doctorText(fr, zh, "Vide ; il se remplira pendant les analyses.", "空(分析素材后按需积累)", "Empty (builds as sources are analyzed)"),
    });
  }

  return { checks, missingCoreModels };
}
