import { expect, it, vi } from "vitest";

it("migrates legacy credentials out of durable browser storage", async () => {
  const values = new Map<string, string>([
    ["viral-hit-llm", JSON.stringify({ baseUrl: "https://api.openai.com/v1", model: "model", apiKey: "legacy-main-secret", provider: "openai" })],
    ["hotclip-prefilter", JSON.stringify({ enabled: true, baseUrl: "http://localhost:11434/v1", model: "local", apiKey: "legacy-prefilter-secret" })],
    ["hotclip-vision", JSON.stringify({ enabled: false, baseUrl: "http://localhost:11434/v1", model: "vision", apiKey: "legacy-vision-secret" })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  try {
    const { useLlmStore } = await import("../llm-store");
    expect(useLlmStore.getState().config.apiKey).toBe("legacy-main-secret");
    expect(JSON.parse(values.get("viral-hit-llm")!).apiKey).toBe("");
    expect(JSON.parse(values.get("hotclip-prefilter")!).apiKey).toBeUndefined();
    expect(JSON.parse(values.get("hotclip-vision")!).apiKey).toBeUndefined();

    useLlmStore.getState().setConfig({ apiKey: "session-main-secret" });
    useLlmStore.getState().setPrefilter({ apiKey: "session-prefilter-secret" });
    useLlmStore.getState().setVision({ apiKey: "session-vision-secret" });
    expect(useLlmStore.getState().config.apiKey).toBe("session-main-secret");
    expect(JSON.parse(values.get("viral-hit-llm")!).apiKey).toBe("");
    expect(JSON.parse(values.get("hotclip-prefilter")!).apiKey).toBeUndefined();
    expect(JSON.parse(values.get("hotclip-vision")!).apiKey).toBeUndefined();
    expect([...values.values()].join(" ")).not.toContain("session-");
  } finally {
    vi.unstubAllGlobals();
  }
});
