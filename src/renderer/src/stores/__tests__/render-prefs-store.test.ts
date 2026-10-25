import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

function storage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

async function loadPrefs(raw?: Record<string, unknown>) {
  const values = new Map<string, string>();
  if (raw) values.set("hotclip-render-prefs", JSON.stringify(raw));
  vi.resetModules();
  vi.stubGlobal("localStorage", storage(values));
  const { useRenderPrefs } = await import("../render-prefs-store");
  return { store: useRenderPrefs, values };
}

it("complète les anciennes préférences sans écraser les choix existants", async () => {
  const { store } = await loadPrefs({ clipLength: "long", vertical: false, genreId: "esports" });
  expect(store.getState().prefs).toMatchObject({
    clipLength: "long", vertical: false, genreId: "esports",
    gameId: "auto", targetPlatform: "compare", customDurationSec: 30,
  });
});

it("valide et conserve les nouveaux réglages jeu, plateforme, durée et caméra", async () => {
  const { store, values } = await loadPrefs({
    clipLength: "custom", customDurationSec: 999, gameId: "unknown", targetPlatform: "other",
  });
  expect(store.getState().prefs).toMatchObject({
    clipLength: "custom", customDurationSec: 180, gameId: "auto", targetPlatform: "compare",
  });
  store.getState().setPref({ gameId: "valorant", targetPlatform: "tiktok", customDurationSec: 24, cameraGameplay: true, vertical: true });
  expect(store.getState().prefs).toMatchObject({ gameId: "valorant", targetPlatform: "tiktok", customDurationSec: 24, cameraGameplay: true });
  expect(values.get("hotclip-render-prefs")).toContain("valorant");
  expect(values.get("hotclip-render-prefs")).toContain("cameraGameplay");
});
