/**
 * Headless 运行环境(CLI 与 MCP Server 共用):不经 Electron 启动时的
 * 用户数据目录定位与 LLM 环境变量配置。路径与桌面端 app.getPath("userData")
 * 完全一致——模型/转写缓存/热词词表下载配置一次,桌面、CLI、MCP 三边共用。
 */
import { homedir } from "os";
import { join } from "path";
import { resolveModelsRoot } from "./app-settings";
import type { LlmConfig } from "../shared/api-types";

/** 与 Electron 的 app.getPath("userData") 同路径——模型/缓存两边共享。 */
export function userDataDir(platform: NodeJS.Platform = process.platform): string {
  if (process.env.VIRALHIT_DATA_DIR?.trim()) return join(process.env.VIRALHIT_DATA_DIR.trim());
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Viral Hit");
  if (platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Viral Hit");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "viral-hit");
}

/** AI 模型根目录(转写/取景/镜头检测模型,首次自动下载);用户在设置里改过则听他的。 */
export const modelsRoot = (): string => resolveModelsRoot(userDataDir());

/** 转写结果本地缓存目录(同文件重开秒进)。 */
export const cacheDir = (): string => join(userDataDir(), "transcript-cache");

/** 可复用基础成片缓存(有界 LRU,与转写缓存分开管理)。 */
export const renderCacheDir = (): string => join(userDataDir(), "render-cache");

/** Reusable source-analysis evidence (small JSON index, independently bounded/clearable). */
export const evidenceCacheDir = (): string => join(userDataDir(), "evidence-index");

/**
 * 成片落地目录:<导出根目录>/<片名>/。
 * 根目录默认是系统「影片」下的 Viral Hit(新手在文件管理器里找得到),用户在
 * 界面上改过就以他选的为准(issue #3)。空串/空白一律视为「没选过」。
 */
export function clipOutDir(chosen: string | null | undefined, videosDir: string, sourceName: string): string {
  const root = typeof chosen === "string" && chosen.trim() ? chosen.trim() : join(videosDir, "Viral Hit");
  return join(root, sourceName);
}

/** LLM 配置来自环境变量;缺配置时给 Agent/用户一段能照做的指引。 */
export function llmFromEnv(): LlmConfig {
  const baseUrl = process.env.VIRALHIT_LLM_BASE_URL || process.env.HOTCLIP_LLM_BASE_URL || "";
  const model = process.env.VIRALHIT_LLM_MODEL || process.env.HOTCLIP_LLM_MODEL || "";
  const rawProvider = process.env.VIRALHIT_LLM_PROVIDER || "openai-compatible";
  const allowed = ["openai-compatible", "openai", "anthropic", "gemini", "mimo", "ollama"] as const;
  const provider = allowed.find((item) => item === rawProvider);
  if (!provider) throw new Error(`Unsupported VIRALHIT_LLM_PROVIDER: ${rawProvider}`);
  if (!baseUrl || !model) {
    throw new Error(
      "Missing LLM configuration: set VIRALHIT_LLM_BASE_URL and VIRALHIT_LLM_MODEL (HOTCLIP_LLM_* remains supported for legacy setups)."
    );
  }
  return {
    baseUrl,
    apiKey: process.env.VIRALHIT_LLM_API_KEY ?? process.env.HOTCLIP_LLM_API_KEY ?? (provider === "ollama" ? "ollama" : ""),
    model,
    provider,
  };
}
