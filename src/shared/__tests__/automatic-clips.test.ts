import { describe, expect, it } from "vitest";
import { selectAutomaticClips } from "../automatic-clips";
import type { HighlightCandidate } from "../api-types";

function clip(id: number, startSec: number, endSec: number, score: number, patch: Partial<HighlightCandidate> = {}): HighlightCandidate {
  return {
    id,
    startSec,
    endSec,
    score,
    title: `Clip ${id}`,
    hook: "",
    text: "",
    reason: "",
    boundary: "segment",
    keywords: [],
    recommended: true,
    reviewNote: "",
    ...patch,
  };
}

describe("sélection automatique par score de viralité", () => {
  it("fait passer le meilleur score avant l’ordre chronologique et respecte la limite", () => {
    const result = selectAutomaticClips([
      clip(1, 0, 20, 78),
      clip(2, 30, 50, 99),
      clip(3, 60, 80, 91),
    ], { maxClips: 2 });
    expect(result.map((candidate) => candidate.id)).toEqual([2, 3]);
  });

  it("n’exporte ni les clips écartés ni ceux qui demandent une révision", () => {
    const result = selectAutomaticClips([
      clip(1, 0, 20, 99, { gate: "review" }),
      clip(2, 30, 50, 98, { recommended: false }),
      clip(3, 60, 80, 97, { gate: "drop" }),
      clip(4, 90, 110, 80, { gate: "publish" }),
    ]);
    expect(result.map((candidate) => candidate.id)).toEqual([4]);
  });

  it("écarte les reprises qui se chevauchent et applique le seuil facultatif", () => {
    const result = selectAutomaticClips([
      clip(1, 0, 30, 98),
      clip(2, 10, 40, 96),
      clip(3, 50, 70, 72),
      clip(4, 80, 100, 69),
    ], { minScore: 70 });
    expect(result.map((candidate) => candidate.id)).toEqual([1, 3]);
  });

  it("compare les passages réellement conservés dans les clips assemblés", () => {
    const result = selectAutomaticClips([
      clip(1, 0, 200, 99, { pieces: [{ startSec: 0, endSec: 10 }, { startSec: 190, endSec: 200 }] }),
      clip(2, 5, 15, 98),
      clip(3, 30, 50, 97),
    ]);
    expect(result.map((candidate) => candidate.id)).toEqual([1, 3]);
  });
});
