import { describe, expect, it } from "vitest";
import { assessFrenchVirality, isFrenchTranscript } from "../highlight/french-score";
import { detectLocalFree } from "../highlight/local-free";
import type { Transcript } from "../../shared/api-types";

const strong = "Pourquoi 90 % des créateurs perdent du temps ? Voici trois erreurs à éviter. Premièrement, vérifiez les chiffres avant de publier. Ensuite, utilisez cette méthode simple : elle permet de gagner deux heures chaque semaine. Par exemple, vous pouvez préparer vos titres, puis contrôler le résultat avec une checklist précise.";
const bland = "Bonjour à tous. Nous sommes là aujourd'hui. C'est bien. Voilà, nous allons voir cela ensemble pendant un moment.";

describe("pondération de la transcription française", () => {
  it("respecte la langue déclarée et sait reconnaître un texte français sans langue", () => {
    expect(isFrenchTranscript("fr-FR", strong)).toBe(true);
    expect(isFrenchTranscript("en", strong)).toBe(false);
    expect(isFrenchTranscript("und", "Dans cette vidéo, nous allons voir pourquoi les gens ne comprennent pas cette méthode et comment faire mieux avec des exemples précis.")).toBe(true);
  });

  it("donne beaucoup plus de poids à une accroche et à un contenu actionnable", () => {
    const rich = assessFrenchVirality(strong, strong, 28);
    const empty = assessFrenchVirality(bland, bland, 28);
    expect(rich.score).toBeGreaterThan(empty.score + 15);
    expect(rich.reasons).toContain("accroche française explicite");
    expect(rich.reasons).toContain("informations et actions concrètes");
  });

  it("fait remonter le passage français utile dans les candidats du moteur gratuit", () => {
    const sentences = [
      "Bonjour à tous et bienvenue.",
      "Nous sommes contents d'être là.",
      "La journée est agréable.",
      "Nous allons parler pendant un moment.",
      "Pourquoi 90 % des créateurs perdent du temps ?",
      "Voici trois erreurs à éviter absolument.",
      "Premièrement, vérifiez les chiffres avant de publier.",
      "Ensuite, cette méthode permet de gagner deux heures avec une checklist précise.",
    ];
    const transcript: Transcript = {
      language: "fr",
      engine: "test",
      durationSec: 40,
      segments: sentences.map((text, index) => ({ id: index, startSec: index * 5, endSec: index * 5 + 4.5, text, words: [] })),
    };
    const candidates = detectLocalFree(transcript);
    expect(candidates[0]?.text).toContain("90 %");
    expect(candidates[0]?.reason).toContain("Analyse renforcée du français");
  });
});
