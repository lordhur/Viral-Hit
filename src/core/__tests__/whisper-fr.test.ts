import { describe, expect, it } from "vitest";
import { ASR_CATALOG } from "../../shared/asr-catalog";
import { WHISPER_FR_MODEL, WHISPER_FR_SMALL_MODEL } from "../models";
import { whisperWords } from "../transcribe/whisper";

describe("transcription française Whisper", () => {
  it("est le moteur local gratuit par défaut", () => {
    expect(ASR_CATALOG[0]).toMatchObject({ id: "whisper-fr", kind: "local", langs: ["fr"], uploads: false });
    expect(WHISPER_FR_MODEL).toMatchObject({
      id: "whisper-base-multilingual",
      extractedDir: "sherpa-onnx-whisper-base",
      approxBytes: 207_557_382,
    });
    expect(WHISPER_FR_MODEL.url).toContain("sherpa-onnx-whisper-base.tar.bz2");
  });

  it("propose un niveau Small local plus précis sans remplacer le choix existant", () => {
    expect(ASR_CATALOG[0]?.id).toBe("whisper-fr");
    expect(ASR_CATALOG.find((engine) => engine.id === "whisper-fr-small")).toMatchObject({
      kind: "local", langs: ["fr"], uploads: false, accuracy: 3, sizeMB: 610,
    });
    expect(WHISPER_FR_SMALL_MODEL).toMatchObject({
      id: "whisper-small-multilingual",
      extractedDir: "sherpa-onnx-whisper-small",
      approxBytes: 639_387_718,
    });
    expect(WHISPER_FR_SMALL_MODEL.url).toContain("sherpa-onnx-whisper-small.tar.bz2");
  });

  it("conserve le texte français et marque honnêtement les temps estimés", () => {
    const words = whisperWords({ text: "Bonjour à tous, voici la vérité !" }, 4, 10);
    expect(words.map((word) => word.text)).toEqual(["Bonjour", "à", "tous,", "voici", "la", "vérité!"]);
    expect(words[0]?.startSec).toBe(4);
    expect(words.at(-1)?.endSec).toBeLessThanOrEqual(10);
    expect(words.every((word) => word.timingSource === "estimated")).toBe(true);
  });

  it("privilégie les horodatages natifs lorsqu’ils sont disponibles", () => {
    const words = whisperWords({ text: "Bonjour", tokens: ["Bonjour"], timestamps: [0.5] }, 2, 4);
    expect(words[0]).toMatchObject({ text: "Bonjour", startSec: 2.5, timingSource: "native" });
  });
});
