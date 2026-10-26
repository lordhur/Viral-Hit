/**
 * LLM connection settings. Non-secret preferences persist; credentials are memory-only.
 * Durable CLI/MCP/recap credentials belong in the environment, never localStorage.
 */
import { create } from "zustand";
import type { LlmConfig, LlmProvider } from "../../../shared/api-types";
import { isLocalBaseUrl } from "../../../shared/llm-preflight";

const STORAGE_KEY = "viral-hit-llm";
const LEGACY_STORAGE_KEY = "hotclip-llm";
const PREFILTER_KEY = "hotclip-prefilter";
const VISION_KEY = "hotclip-vision";

/** 两级漏斗第一级的本地端点设置(默认 Ollama + qwen3:4b,默认关)。 */
export interface PrefilterSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** 云端端点的 API Key(本地 Ollama 留空即可)。 */
  apiKey?: string;
}

export const PREFILTER_DEFAULTS: PrefilterSettings = {
  enabled: false,
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3:4b",
};

/** 视觉爆点信号的端侧 VL 端点设置(默认 Ollama + qwen3.5:4b,默认关)。 */
export const VISION_DEFAULTS: PrefilterSettings = {
  enabled: false,
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3.5:4b",
};

function loadLocalEndpoint(key: string, defaults: PrefilterSettings): PrefilterSettings {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PrefilterSettings>;
      // One-time migration: an existing key may finish this session, but is immediately removed from durable storage.
      localStorage.setItem(key, JSON.stringify({ ...p, apiKey: undefined }));
      const baseUrl = typeof p.baseUrl === "string" && p.baseUrl ? p.baseUrl : defaults.baseUrl;
      // Les anciens préfiltres/visions cloud sont désactivés lors de la migration
      // gratuite. Seul un service boucle locale peut être contacté par l’interface.
      if (!isLocalBaseUrl(baseUrl)) {
        localStorage.setItem(key, JSON.stringify({ ...defaults, enabled: false, apiKey: undefined }));
        return { ...defaults, enabled: false };
      }
      return {
        enabled: p.enabled === true,
        baseUrl,
        model: typeof p.model === "string" && p.model ? p.model : defaults.model,
        apiKey: undefined,
      };
    }
  } catch {
    /* 回落默认 */
  }
  return { ...defaults };
}

export interface LlmPreset {
  id: string;
  label: string;
  baseUrl: string;
  provider?: LlmProvider;
  /** 出厂建议模型。模型 id 会随厂商换代失效——UI 上的「拉取模型」才是准的。 */
  model: string;
  /** 申请 key 的地址;本地端点为空。 */
  keyUrl: string;
}

/**
 * 供应商预设。base_url 都对着各家官方文档核过(2026-08);模型只是起点——
 * 厂商换代很快(deepseek-chat 已于 2026-07-24 下线),所以 UI 提供「拉取模型」
 * 直接问端点要真实清单,不指望这里的名字长期有效。
 */
export const BUILTIN_LLM_CONFIG: LlmConfig = {
  baseUrl: "builtin://local-free",
  apiKey: "",
  model: "regles-locales",
  provider: "builtin",
};

export const LLM_PRESET_LIST: LlmPreset[] = [
  {
    id: "builtin",
    label: "Gratuit · moteur intégré",
    baseUrl: BUILTIN_LLM_CONFIG.baseUrl,
    model: BUILTIN_LLM_CONFIG.model,
    provider: "builtin",
    keyUrl: "",
  },
  {
    id: "atlas",
    label: "Atlas Cloud",
    baseUrl: "https://api.atlascloud.ai/v1",
    model: "qwen/qwen3.5-flash",
    keyUrl: "https://www.atlascloud.ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek 官方",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "dashscope",
    label: "阿里云百炼(通义千问)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    // 智谱的兼容路径就到 v4 为止,后面直接接 /chat/completions(不带 /v1)
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "moonshot",
    label: "月之暗面 Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.5",
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-flash",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    model: "gpt-5.6-luna",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    provider: "anthropic",
    model: "",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    provider: "gemini",
    model: "",
    keyUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "mimo",
    label: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    provider: "mimo",
    model: "",
    keyUrl: "https://platform.xiaomimimo.com",
  },
  {
    id: "ollama",
    label: "Ollama · local gratuit",
    baseUrl: "http://localhost:11434/v1",
    provider: "ollama",
    model: "qwen3:8b",
    keyUrl: "",
  },
];

/** Seuls les choix réellement gratuits sont proposés dans l’interface grand public. */
export const LLM_FREE_PRESET_LIST = LLM_PRESET_LIST.filter((preset) => preset.provider === "builtin" || preset.provider === "ollama");

/** 按 baseUrl 认出当前选的是哪家(用户改过 baseUrl 就认不出,返回 undefined)。 */
export function presetForBaseUrl(baseUrl: string): LlmPreset | undefined {
  return LLM_PRESET_LIST.find((p) => p.baseUrl === baseUrl);
}

/** Presets conservés pour la compatibilité ; le moteur intégré est le défaut. */
export const LLM_PRESETS = {
  builtin: LLM_PRESET_LIST.find((preset) => preset.id === "builtin")!,
  atlas: LLM_PRESET_LIST.find((preset) => preset.id === "atlas")!,
  ollama: LLM_PRESET_LIST.find((preset) => preset.id === "ollama")!,
} as const;

function load(): LlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LlmConfig>;
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      if (parsed.provider === "builtin" || parsed.baseUrl === BUILTIN_LLM_CONFIG.baseUrl) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(BUILTIN_LLM_CONFIG));
        return { ...BUILTIN_LLM_CONFIG };
      }
      if (parsed.provider === "ollama" && typeof parsed.baseUrl === "string" && typeof parsed.model === "string" && isLocalBaseUrl(parsed.baseUrl)) {
        const local = { baseUrl: parsed.baseUrl, apiKey: "", model: parsed.model, provider: "ollama" as const };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
        return local;
      }
      // Migration unique et déterministe : une ancienne configuration Atlas/cloud
      // ne doit plus produire de 401 ni lancer un appel payant au démarrage.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(BUILTIN_LLM_CONFIG));
      return { ...BUILTIN_LLM_CONFIG };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...BUILTIN_LLM_CONFIG };
}

interface LlmState {
  config: LlmConfig;
  setConfig: (partial: Partial<LlmConfig>) => void;
  prefilter: PrefilterSettings;
  setPrefilter: (partial: Partial<PrefilterSettings>) => void;
  vision: PrefilterSettings;
  setVision: (partial: Partial<PrefilterSettings>) => void;
}

export const useLlmStore = create<LlmState>((set, get) => ({
  config: load(),
  setConfig: (partial) => {
    const candidate = { ...get().config, ...partial };
    const config: LlmConfig = candidate.provider === "builtin"
      ? { ...BUILTIN_LLM_CONFIG }
      : candidate.provider === "ollama" && isLocalBaseUrl(candidate.baseUrl) && candidate.model.trim()
        ? { baseUrl: candidate.baseUrl, apiKey: "", model: candidate.model, provider: "ollama" }
        : { ...BUILTIN_LLM_CONFIG };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, apiKey: "" }));
    } catch {
      /* persistence is best-effort */
    }
    set({ config });
  },
  prefilter: loadLocalEndpoint(PREFILTER_KEY, PREFILTER_DEFAULTS),
  setPrefilter: (partial) => {
    const prefilter = { ...get().prefilter, ...partial, apiKey: undefined };
    try {
      localStorage.setItem(PREFILTER_KEY, JSON.stringify({ ...prefilter, apiKey: undefined }));
    } catch {
      /* persistence is best-effort */
    }
    set({ prefilter });
  },
  vision: loadLocalEndpoint(VISION_KEY, VISION_DEFAULTS),
  setVision: (partial) => {
    const vision = { ...get().vision, ...partial, apiKey: undefined };
    try {
      localStorage.setItem(VISION_KEY, JSON.stringify({ ...vision, apiKey: undefined }));
    } catch {
      /* persistence is best-effort */
    }
    set({ vision });
  },
}));

/** Le moteur intégré est toujours prêt ; Ollama ne demande aucun jeton. */
export function isLlmReady(config: LlmConfig): boolean {
  if (config.provider === "builtin") return true;
  if (config.provider === "ollama") return Boolean(config.model && isLocalBaseUrl(config.baseUrl));
  return false;
}
