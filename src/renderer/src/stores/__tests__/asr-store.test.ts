import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

function storage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

async function migrated(engineId: string) {
  const values = new Map<string, string>([
    ["hotclip-asr", JSON.stringify({ state: { engineId, localServiceUrl: "http://127.0.0.1:8766", keys: { elevenlabs: "secret" } }, version: 1 })],
  ]);
  vi.resetModules();
  vi.stubGlobal("localStorage", storage(values));
  const { useAsrStore } = await import("../asr-store");
  await useAsrStore.persist.rehydrate();
  return { state: useAsrStore.getState(), values };
}

it("remplace les anciens défauts inadaptés ou payants par Whisper français", async () => {
  for (const engineId of ["sensevoice", "elevenlabs", ""]) {
    const { state, values } = await migrated(engineId);
    expect(state.engineId).toBe("whisper-fr");
    expect(state.keys.elevenlabs).toBeUndefined();
    expect([...values.values()].join(" ")).not.toContain("secret");
  }
});

it("préserve un autre moteur local explicitement choisi", async () => {
  const { state } = await migrated("qwen3");
  expect(state.engineId).toBe("qwen3");
});
