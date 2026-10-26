import { afterEach, describe, expect, it } from "vitest";
import { llmFromEnv } from "../appenv";

const KEYS = ["VIRALHIT_LLM_PROVIDER", "VIRALHIT_LLM_BASE_URL", "VIRALHIT_LLM_MODEL", "VIRALHIT_LLM_API_KEY", "HOTCLIP_LLM_BASE_URL", "HOTCLIP_LLM_MODEL", "HOTCLIP_LLM_API_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("configuration LLM sans service payant", () => {
  it("utilise le moteur intégré par défaut et ignore les anciens secrets cloud", () => {
    for (const key of KEYS) delete process.env[key];
    process.env.HOTCLIP_LLM_BASE_URL = "https://paid.example/v1";
    process.env.HOTCLIP_LLM_MODEL = "legacy";
    process.env.HOTCLIP_LLM_API_KEY = "secret";
    expect(llmFromEnv()).toEqual({ baseUrl: "builtin://local-free", apiKey: "", model: "regles-locales", provider: "builtin" });
  });

  it("conserve Ollama lorsqu’il est explicitement configuré", () => {
    process.env.VIRALHIT_LLM_PROVIDER = "ollama";
    process.env.VIRALHIT_LLM_BASE_URL = "http://127.0.0.1:11434/v1";
    process.env.VIRALHIT_LLM_MODEL = "qwen3:4b";
    expect(llmFromEnv()).toMatchObject({ provider: "ollama", model: "qwen3:4b", apiKey: "" });
  });
});
