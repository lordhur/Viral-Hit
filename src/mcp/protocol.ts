/**
 * HotClip MCP 协议层(stdio JSON-RPC 2.0,零依赖手写):
 * 「本地 MCP 切片器」——让 Claude 等 Agent 直接驱动本地切片管线:
 * "给我这个 4 小时录播,切 10 条爆点" → 转写/检测/出片全在用户机器上跑。
 *
 * 只实现 MCP 需要的最小面:initialize / tools/list / tools/call / ping。
 * 本文件是纯逻辑(消息进→响应出,工具执行通过注入),可完整单测;
 * stdin/stdout 与真实管线在 server.ts。
 */

import { describeSubtitleImportError } from "../shared/subtitle-import";
import { localizeErrorMessage } from "../shared/french-errors";

/** MCP 协议版本(2024-11-05 基线,客户端普遍兼容)。 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** 工具执行注入点:返回给 Agent 的文本(抛错→isError 响应)。 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "clip_video",
    description:
      "Parcours autonome et gratuit : transcrit une longue vidéo locale, détecte les moments forts et exporte des clips verticaux prêts à publier. Retourne le dossier de sortie, les titres, scores et timecodes. Sans subtitlePath, le modèle Whisper français est téléchargé au premier usage. Aucun jeton n’est requis avec le moteur intégré ; Ollama reste une option locale explicite.",
    inputSchema: {
      type: "object",
      properties: {
        videoPath: { type: "string", description: "Chemin absolu de la vidéo locale" },
        engineId: { type: "string", enum: ["whisper-fr", "whisper-fr-small", "sensevoice", "paraformer", "fireredasr", "qwen3"], description: "Moteur ASR local : whisper-fr par défaut, whisper-fr-small pour un français plus précis ; qwen3 nécessite son service local optionnel." },
        localServiceUrl: { type: "string", description: "Adresse du service Qwen3 local facultatif, uniquement sur 127.0.0.1 ou ::1 ; http://127.0.0.1:8766 par défaut." },
        restart: { type: "boolean", description: "Recommence la transcription sans réutiliser la progression du moteur actuel ; la reprise est activée par défaut." },
        subtitlePath: { type: "string", description: "Chemin absolu facultatif de sous-titres SRT/WebVTT UTF-8 alignés sur le média (5 Mo maximum, une piste, sans chevauchement). Ignore l’ASR ; les temps des mots dans les phrases sont estimés et doivent être vérifiés." },
        maxClips: { type: "number", description: "Nombre maximal de clips à exporter (1 à 12 ; 6 par défaut)" },
        vertical: { type: "boolean", description: "Export vertical 9:16 (true par défaut)" },
        captions: { type: "boolean", description: "Incruste les sous-titres dynamiques (true par défaut)" },
        autoEnhance: { type: "boolean", description: "Mesure localement les images conservées et corrige avec modération les sources trop sombres, ternes ou saturées (false par défaut ; aucun modèle supplémentaire)" },
        denoiseMode: { type: "string", enum: ["basic", "smart"], description: "Nettoyage audio facultatif : basic pour le filtre fixe, smart pour la voix locale 48 kHz avec repli automatique sur basic" },
        outDir: { type: "string", description: "Dossier de sortie (par défaut, à côté de la source dans <nom>-hotclip/)" },
        referencePath: { type: "string", description: "Vidéo locale de référence facultative : mesure sa durée, son débit, ses phrases, ses plans et son accroche pour guider la sélection sans contrainte absolue ; en cas d’échec, continue sans référence" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "detect_highlights",
    description:
      "Détecte les moments forts sans exporter : transcription puis sélection locale gratuite, avec timecodes, titres, accroches, scores et raisons en JSON. Aucun jeton n’est requis avec le moteur intégré.",
    inputSchema: {
      type: "object",
      properties: {
        videoPath: { type: "string", description: "Chemin absolu de la vidéo locale" },
        engineId: { type: "string", enum: ["whisper-fr", "whisper-fr-small", "sensevoice", "paraformer", "fireredasr", "qwen3"], description: "Moteur ASR local : whisper-fr par défaut, whisper-fr-small pour un français plus précis ; qwen3 nécessite son service local optionnel." },
        localServiceUrl: { type: "string", description: "Adresse du service Qwen3 local facultatif, uniquement sur 127.0.0.1 ou ::1 ; http://127.0.0.1:8766 par défaut." },
        restart: { type: "boolean", description: "Recommence la transcription sans réutiliser la progression du moteur actuel ; la reprise est activée par défaut." },
        subtitlePath: { type: "string", description: "Chemin absolu facultatif de sous-titres SRT/WebVTT UTF-8 alignés sur le média (5 Mo maximum, une piste, sans chevauchement). Ignore l’ASR ; les temps des mots dans les phrases sont estimés et doivent être vérifiés." },
        maxClips: { type: "number", description: "Nombre maximal de candidats (1 à 12 ; 6 par défaut)" },
        referencePath: { type: "string", description: "Vidéo locale de référence facultative dont le rythme guide les candidats ; en cas d’échec, continue sans référence" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "transcribe_video",
    description:
      "Importe des sous-titres ou transcrit localement en français avec Whisper par défaut. Les résultats sont mis en cache et les fenêtres terminées peuvent être reprises. Aucune configuration IA ni clé payante n’est nécessaire.",
    inputSchema: {
      type: "object",
      properties: {
        videoPath: { type: "string", description: "Chemin absolu du fichier vidéo ou audio local" },
        engineId: { type: "string", enum: ["whisper-fr", "whisper-fr-small", "sensevoice", "paraformer", "fireredasr", "qwen3"], description: "Moteur ASR local : whisper-fr par défaut, whisper-fr-small pour un français plus précis ; qwen3 nécessite son service local optionnel." },
        localServiceUrl: { type: "string", description: "Adresse du service Qwen3 local facultatif, uniquement sur 127.0.0.1 ou ::1 ; http://127.0.0.1:8766 par défaut." },
        restart: { type: "boolean", description: "Recommence la transcription sans réutiliser la progression du moteur actuel ; la reprise est activée par défaut." },
        subtitlePath: { type: "string", description: "Sous-titres SRT/WebVTT UTF-8 facultatifs permettant d’ignorer l’ASR (5 Mo maximum, sans chevauchement) ; les temps internes sont estimés et doivent être vérifiés." },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "recap_video",
    description: "Démarre un récapitulatif vidéo narré autonome. L’agent planifie à partir de preuves temporelles, reprend les étapes déterministes, effectue le rendu et le contrôle final. Retourne un identifiant durable à surveiller avec production_jobs. Le parcours local complet ASR/VLM/TTS doit être configuré ; aucun service payant n’est appelé par défaut.",
    inputSchema: {
      type: "object",
      properties: {
        videos: { type: "array", items: { type: "string" }, description: "Un à quarante chemins médias locaux absolus ; plusieurs sources exigent editMode=cut" },
        workDir: { type: "string", description: "Dossier de travail facultatif permettant la reprise" },
        editMode: { type: "string", enum: ["full", "cut", "dub"] },
        audioMode: { type: "string", enum: ["narration", "source-mix", "adopted-packet-copy"] },
        style: { type: "string" }, language: { type: "string" }, context: { type: "string" }, targetDuration: { type: "string" },
        outputDir: { type: "string" }, skipAsr: { type: "boolean" }, burnSubtitles: { type: "boolean" },
        confirmVoiceRights: { type: "boolean", description: "Obligatoire pour dub : confirme les droits sur le média et le clonage de la voix" },
      },
      required: ["videos"],
    },
  },
  {
    name: "production_jobs",
    description: "Liste les productions durables, leur état, leur sortie, leur dossier de travail et un résumé d’erreur sécurisé.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "cancel_production_job",
    description: "Annule une production en cours. Les artefacts terminés restent dans son dossier de travail pour une reprise ultérieure.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Identifiant de production retourné par recap_video" } }, required: ["id"] },
  },
];

/** 参数校验:必填与类型(浅校验够用——工具实现里还有业务检查)。 */
export function validateToolArgs(tool: McpToolDef, args: Record<string, unknown>): string | null {
  const schema = tool.inputSchema as { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] };
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") return `Paramètre obligatoire manquant : ${key}`;
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties?.[key];
    if (!spec?.type || value === undefined) continue;
    const actual = typeof value;
    if (spec.type === "number" && actual !== "number") return `Le paramètre ${key} doit être de type number`;
    if (spec.type === "string" && actual !== "string") return `Le paramètre ${key} doit être de type string`;
    if (spec.type === "boolean" && actual !== "boolean") return `Le paramètre ${key} doit être de type boolean`;
    if (spec.type === "array" && !Array.isArray(value)) return `Le paramètre ${key} doit être un tableau`;
    if (spec.type === "array" && Array.isArray(value) && value.some((item) => typeof item !== "string")) return `Le paramètre ${key} doit être un tableau de chaînes`;
    if (spec.enum && !spec.enum.includes(value)) return `Le paramètre ${key} doit valoir ${spec.enum.join(" ou ")}`;
  }
  return null;
}

function result(id: JsonRpcMessage["id"], payload: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result: payload };
}

function rpcError(id: JsonRpcMessage["id"], code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolText(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/**
 * 处理一条 JSON-RPC 消息;返回响应对象,通知(无 id 的 notification)返回 null。
 */
export async function handleMcpMessage(
  msg: JsonRpcMessage,
  execute: ToolExecutor,
  serverVersion: string
): Promise<Record<string, unknown> | null> {
  const method = msg.method ?? "";
  // 通知不需要响应(initialized / cancelled 等)
  if (msg.id === undefined && method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return result(msg.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "viral-hit", version: serverVersion },
      });
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return result(msg.id, toolText(`Outil inconnu : ${name}`, true));
      const invalid = validateToolArgs(tool, args);
      if (invalid) return result(msg.id, toolText(invalid, true));
      try {
        return result(msg.id, toolText(await execute(name, args)));
      } catch (e) {
        return result(msg.id, toolText(localizeErrorMessage(describeSubtitleImportError(e)), true));
      }
    }
    default:
      return rpcError(msg.id, -32601, `Méthode introuvable : ${method}`);
  }
}
