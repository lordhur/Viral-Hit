import { describe, expect, it } from "vitest";
import type { HighlightCandidate, Transcript } from "../../shared/api-types";
import { compareGamingFormats } from "../../shared/gaming-formats";
import { sanitizeDetectBrief } from "../../shared/detection-brief";
import { applyGamingFormatSignal, hasGamingFormatContext } from "../highlight/gaming-format";
import { resolveClipLengthRange } from "../highlight/prompt";
import { clipLengthBounds, detectHighlights } from "../highlight/detect";

function candidate(id: number, text: string): HighlightCandidate {
  return {
    id, startSec: id * 40, endSec: id * 40 + 20, text,
    title: text.slice(0, 30), hook: text, score: 60, reason: "test",
    boundary: "segment", keywords: [], recommended: true, reviewNote: "",
  };
}

describe("comparaison locale des formats gaming", () => {
  it("reconnaît un clutch Valorant et compare réellement les deux plateformes", () => {
    const result = compareGamingFormats({
      gameId: "valorant", text: "Regarde ce clutch en 1v3 : je retake et defuse la spike !",
      durationSec: 20,
    });
    expect(result.gameLabel).toBe("Valorant");
    expect(result.tiktok.formatLabel).toBe("Clutch / ace");
    expect(result.tiktok.score).toBeGreaterThan(80);
    expect(result.instagram.score).toBeGreaterThan(75);
    expect(result.tiktok.reasons.join(" ")).toContain("clutch");
    expect(result.method).toBe("local-format-heuristic");
  });

  it("peut favoriser un tutoriel sur Instagram sans inventer de métriques", () => {
    const result = compareGamingFormats({
      gameId: "valorant", targetPlatform: "instagram",
      text: "Voici une astuce de lineup smoke pour le post plant : il faut viser cette zone.",
      durationSec: 45,
    });
    expect(result.instagram.formatLabel).toBe("Lineup / tactique");
    expect(result.instagram.score).toBeGreaterThan(result.tiktok.score);
    expect(result.targetPlatform).toBe("instagram");
  });

  it("plafonne un passage sans marqueur et mesure l’effet de la durée", () => {
    const empty = compareGamingFormats({ gameId: "minecraft", text: "Nous sommes là et nous parlons tranquillement.", durationSec: 20 });
    expect(empty.tiktok.score).toBeLessThanOrEqual(61);
    expect(empty.tiktok.reasons.join(" ")).toContain("contrôle visuel");
    const short = compareGamingFormats({ gameId: "fortnite", text: "Quel clutch pour cette victoire royale !", durationSec: 18 });
    const long = compareGamingFormats({ gameId: "fortnite", text: "Quel clutch pour cette victoire royale !", durationSec: 89 });
    expect(short.tiktok.score).toBeGreaterThan(long.tiktok.score);
  });

  it("n’applique pas le profil gaming à une interview générale", () => {
    const list = [candidate(0, "Une discussion de fond.")];
    expect(hasGamingFormatContext({ gameId: "auto" }, "interview")).toBe(false);
    expect(applyGamingFormatSignal(list, { gameId: "auto" }, "interview")).toBe(list);
    const gaming = applyGamingFormatSignal(list, { gameId: "valorant" }, "auto");
    expect(gaming[0]?.formatComparison?.gameLabel).toBe("Valorant");
  });

  it("fait remonter le clip correspondant au jeu avant la normalisation commune", () => {
    const ranked = applyGamingFormatSignal([
      candidate(0, "Nous discutons tranquillement de la journée."),
      candidate(1, "Incroyable clutch en 1v3 avec un headshot pour retake !"),
    ], { gameId: "counter-strike", targetPlatform: "tiktok" }, "game");
    expect(ranked[1]?.score).toBeGreaterThan(ranked[0]?.score ?? 100);
    expect(ranked[1]?.formatComparison?.tiktok.formatLabel).toBe("Clutch / ace");
  });

  it("relie le contexte au parcours gratuit de bout en bout", async () => {
    const transcript: Transcript = {
      language: "fr", engine: "test", durationSec: 30,
      segments: [
        { id: 0, startSec: 0, endSec: 7, text: "Regarde ce clutch en 1v3 sur Valorant !", words: [] },
        { id: 1, startSec: 7, endSec: 15, text: "Je retake, je defuse la spike et le round est gagné.", words: [] },
        { id: 2, startSec: 15, endSec: 22, text: "Cette victoire est incroyable.", words: [] },
      ],
    };
    const outcome = await detectHighlights(
      transcript,
      { provider: "builtin", baseUrl: "builtin", model: "builtin", apiKey: "" },
      undefined, undefined, undefined, "auto", [], undefined, undefined,
      { id: "game" }, { gameId: "valorant", targetPlatform: "compare", maxClips: 1 },
    );
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates.every((item) => item.formatComparison?.gameLabel === "Valorant")).toBe(true);
  });
});

describe("durée et validation du brief", () => {
  it("offre un mode automatique large et une cible personnalisée bornée", () => {
    expect(resolveClipLengthRange("auto")).toEqual({ minSec: 6, maxSec: 90 });
    expect(resolveClipLengthRange("custom", 30)).toEqual({ minSec: 25, maxSec: 35 });
    expect(resolveClipLengthRange("custom", 5)).toEqual({ minSec: 4, maxSec: 7 });
    expect(resolveClipLengthRange("custom", 999)).toEqual({ minSec: 168, maxSec: 180 });
    expect(resolveClipLengthRange("short")).toEqual({ minSec: 10, maxSec: 30 });
    expect(clipLengthBounds("custom", 30)).toEqual({ lo: 25, hi: 35 });
  });

  it("nettoie le jeu, la plateforme, les textes et la durée à la frontière", () => {
    expect(sanitizeDetectBrief({
      focus: "  clutch  ", gameId: "valorant", gameName: "  Custom  ", targetPlatform: "tiktok", customDurationSec: 31.4, maxClips: 7.6,
    })).toEqual({ focus: "clutch", gameId: "valorant", gameName: "Custom", targetPlatform: "tiktok", customDurationSec: 31, maxClips: 8 });
    expect(sanitizeDetectBrief({ gameId: "not-a-game", targetPlatform: "other", customDurationSec: -4, maxClips: 0 }))
      .toEqual({ customDurationSec: 5 });
    expect(sanitizeDetectBrief({ maxClips: 99 })).toEqual({ maxClips: 12 });
    expect(sanitizeDetectBrief(null)).toBeUndefined();
  });
});
