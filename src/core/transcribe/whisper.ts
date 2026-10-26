/** Transcription française locale : Whisper Base multilingue via sherpa-onnx. */
import { join } from "path";
import { rebuildWords } from "../../shared/edit-transcript";
import { WHISPER_FR_MODEL, WHISPER_FR_SMALL_MODEL } from "../models";
import { SherpaOfflineEngine, tokensToWords, type SherpaResult } from "./sherpa-offline";
import type { TranscriptWord } from "./types";

/** Conserve les temps natifs quand ils existent ; sinon marque explicitement une estimation. */
export function whisperWords(result: SherpaResult, startSec: number, endSec: number): TranscriptWord[] {
  if ((result.tokens?.length ?? 0) > 0 && (result.timestamps?.length ?? 0) > 0) {
    return tokensToWords(result, startSec, endSec);
  }
  return rebuildWords(result.text, startSec, endSec).map((word) => ({ ...word, timingSource: "estimated" as const }));
}

export class WhisperFrenchEngine extends SherpaOfflineEngine {
  constructor(modelsRoot: string) {
    super(
      {
        id: "whisper-fr-local",
        label: "Whisper Base · français local gratuit",
        asset: WHISPER_FR_MODEL,
        tokensFile: "base-tokens.txt",
        buildModelConfig: (dir) => ({
          whisper: {
            encoder: join(dir, "base-encoder.int8.onnx"),
            decoder: join(dir, "base-decoder.int8.onnx"),
            // Le forced French prompt évite une détection hasardeuse sur de courts extraits.
            language: "fr",
            task: "transcribe",
            tailPaddings: 300,
          },
        }),
        language: "fr",
        mapWords: whisperWords,
      },
      modelsRoot,
    );
  }
}

/** Larger multilingual decoder for fast French speech and gaming vocabulary. */
export class WhisperFrenchSmallEngine extends SherpaOfflineEngine {
  constructor(modelsRoot: string) {
    super(
      {
        id: "whisper-fr-small-local",
        label: "Whisper Small · français précis local gratuit",
        asset: WHISPER_FR_SMALL_MODEL,
        tokensFile: "small-tokens.txt",
        buildModelConfig: (dir) => ({
          whisper: {
            encoder: join(dir, "small-encoder.int8.onnx"),
            decoder: join(dir, "small-decoder.int8.onnx"),
            language: "fr",
            task: "transcribe",
            tailPaddings: 300,
          },
        }),
        language: "fr",
        mapWords: whisperWords,
      },
      modelsRoot,
    );
  }
}
