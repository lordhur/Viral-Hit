/** Persisted transcription-engine choice (catalog id from shared/asr-catalog). */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AsrState {
  engineId: string;
  localServiceUrl: string;
  setLocalServiceUrl: (url: string) => void;
  /** Per-engine cloud API keys (persisted locally, sent per call). */
  keys: Record<string, string>;
  setEngineId: (id: string) => void;
  setKey: (engineId: string, key: string) => void;
}

export const useAsrStore = create<AsrState>()(
  persist(
    (set) => ({
      engineId: "whisper-fr",
      localServiceUrl: "http://127.0.0.1:8766",
      setLocalServiceUrl: (localServiceUrl) => set({ localServiceUrl }),
      keys: {},
      setEngineId: (engineId) => set({ engineId: engineId === "elevenlabs" ? "whisper-fr" : engineId }),
      setKey: (engineId, key) => {
        if (engineId === "elevenlabs") return;
        set((s) => ({ keys: { ...s.keys, [engineId]: key } }));
      },
    }),
    {
      name: "hotclip-asr",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persisted) => {
        const state = persisted as AsrState;
        const keys = { ...(state.keys ?? {}) };
        delete keys.elevenlabs;
        return {
          ...state,
          // L'ancien défaut SenseVoice ne reconnaît pas le français. Whisper devient
          // le défaut migré ; un choix Paraformer/FireRed/Qwen explicite est préservé.
          engineId: !state.engineId || state.engineId === "elevenlabs" || state.engineId === "sensevoice" ? "whisper-fr" : state.engineId,
          localServiceUrl: state.localServiceUrl || "http://127.0.0.1:8766",
          keys,
        };
      },
    }
  )
);
