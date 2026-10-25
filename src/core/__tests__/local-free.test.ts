import { describe, expect, it, vi } from "vitest";
import { detectHighlights } from "../highlight/detect";
import type { Transcript } from "../../shared/api-types";

const BUILTIN = { baseUrl: "builtin://local-free", apiKey: "", model: "regles-locales", provider: "builtin" as const };

function transcript(): Transcript {
  const sentences = [
    "Bonjour à tous et bienvenue dans cette émission.",
    "Voici trois erreurs qui font perdre du temps chaque semaine.",
    "Premièrement, il faut vérifier les chiffres avant de publier.",
    "Cette méthode simple permet d’éviter 80 % des problèmes.",
    "Ensuite, gardez toujours une copie locale de votre travail.",
    "Vous pouvez ainsi récupérer votre projet sans payer un service.",
  ];
  let start = 0;
  return {
    language: "fr",
    engine: "test",
    durationSec: 39,
    segments: sentences.map((text, index) => {
      const end = start + 5;
      const segment = { id: index + 1, startSec: start, endSec: end, text, words: [] };
      start = end + 1;
      return segment;
    }),
  };
}

describe("moteur de détection gratuit intégré", () => {
  it("produit des extraits réels sans aucun appel réseau", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const source = transcript();
    const result = await detectHighlights(source, BUILTIN);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(8);
    expect(result.candidates[0]?.reason).toMatch(/Sélection locale/);
    expect(result.candidates[0]?.title).not.toMatch(/LLM|cloud/i);
    for (const clip of result.candidates) {
      expect(clip.startSec).toBeGreaterThanOrEqual(0);
      expect(clip.endSec).toBeLessThanOrEqual(source.durationSec);
      expect(clip.text.length).toBeGreaterThan(0);
      expect(source.segments.some((segment) => clip.text.includes(segment.text))).toBe(true);
    }
    fetchSpy.mockRestore();
  });

  it("respecte les exclusions du brief et ne réclame pas de jeton", async () => {
    const source = transcript();
    const result = await detectHighlights(source, BUILTIN, undefined, undefined, null, "standard", [], undefined, [], undefined, {
      exclude: "copie locale",
    });
    expect(result.candidates.every((clip) => !clip.text.includes("copie locale"))).toBe(true);
  });
});
