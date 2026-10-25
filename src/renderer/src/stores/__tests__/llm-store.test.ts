import { expect, it, vi } from "vitest";

function storage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

it("migre les anciens identifiants cloud vers le moteur gratuit sans les conserver", async () => {
  const values = new Map<string, string>([
    ["viral-hit-llm", JSON.stringify({ baseUrl: "https://api.openai.com/v1", model: "model", apiKey: "legacy-main-secret", provider: "openai" })],
    ["hotclip-prefilter", JSON.stringify({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "local", apiKey: "legacy-prefilter-secret" })],
    ["hotclip-vision", JSON.stringify({ enabled: false, baseUrl: "http://localhost:11434/v1", model: "vision", apiKey: "legacy-vision-secret" })],
  ]);
  vi.resetModules();
  vi.stubGlobal("localStorage", storage(values));
  try {
    const { useLlmStore, isLlmReady } = await import("../llm-store");
    expect(useLlmStore.getState().config).toMatchObject({ provider: "builtin", apiKey: "", baseUrl: "builtin://local-free" });
    expect(isLlmReady(useLlmStore.getState().config)).toBe(true);
    expect(JSON.parse(values.get("viral-hit-llm")!).apiKey).toBe("");
    expect(JSON.parse(values.get("hotclip-prefilter")!).apiKey).toBeUndefined();
    expect(JSON.parse(values.get("hotclip-vision")!).apiKey).toBeUndefined();
    expect(useLlmStore.getState().vision.apiKey).toBeUndefined();

    useLlmStore.getState().setVision({ apiKey: "session-vision-secret" });
    expect(useLlmStore.getState().vision.apiKey).toBeUndefined();
    expect([...values.values()].join(" ")).not.toContain("session-vision-secret");

    useLlmStore.getState().setConfig({ apiKey: "session-main-secret" });
    expect(useLlmStore.getState().config.apiKey).toBe("");
    expect(useLlmStore.getState().config.provider).toBe("builtin");
    expect([...values.values()].join(" ")).not.toContain("session-main-secret");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("conserve Ollama local et désactive les anciens préfiltres cloud", async () => {
  const values = new Map<string, string>([
    ["viral-hit-llm", JSON.stringify({ baseUrl: "http://localhost:11434/v1", model: "qwen3:4b", apiKey: "", provider: "ollama" })],
    ["hotclip-prefilter", JSON.stringify({ enabled: true, baseUrl: "https://paid.example/v1", model: "cloud", apiKey: "secret" })],
  ]);
  vi.resetModules();
  vi.stubGlobal("localStorage", storage(values));
  try {
    const { useLlmStore } = await import("../llm-store");
    expect(useLlmStore.getState().config).toMatchObject({ provider: "ollama", model: "qwen3:4b", apiKey: "" });
    expect(useLlmStore.getState().prefilter.enabled).toBe(false);
    expect(useLlmStore.getState().prefilter.baseUrl).toBe("http://localhost:11434/v1");
    expect([...values.values()].join(" ")).not.toContain("paid.example");
  } finally {
    vi.unstubAllGlobals();
  }
});
