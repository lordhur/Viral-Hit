import { utilityDensity } from "../../shared/utility-density";

export interface FrenchViralityAssessment {
  /** Contribution propre au texte français, avant normalisation des candidats. */
  score: number;
  reasons: string[];
}

const FRENCH_STOPWORDS = /(?:\b(?:le|la|les|des|une|dans|pour|avec|vous|nous|mais|donc|parce|comme|sur|pas|plus|est|sont|fait|faire|cela|cette|ceci|aux|du)\b)/gi;
const STRONG_HOOK = /(?:\b(?:incroyable|jamais|personne|interdit|secret|erreurs?|vérité|gratuit|urgent|attention|meilleur(?:e)?|pire|important(?:e)?|problèmes?|solutions?|astuces?|conseils?|méthodes?|techniques?|pièges?|évitez?|gagner|perdre|réussir)\b)/gi;
const CURIOSITY = /(?:\b(?:pourquoi|comment|combien|voici|voilà|quel(?:le)?s?|ce\s+(?:que|qui)|la\s+raison|le\s+problème)\b)/gi;
const DIRECT_ADDRESS = /(?:\b(?:vous|tu|ton|ta|tes|votre|vos)\b)/i;
const INFORMATION = /(?:\b(?:parce\s+que|par\s+exemple|ensuite|enfin|premièrement|deuxièmement|étapes?|conseils?|méthodes?|astuces?|résultats?|preuves?|chiffres?|données?|solutions?|permet|faut|devez|pouvez|grâce)\b)/gi;
const STRUCTURE = /(?:\b(?:d['’]abord|ensuite|puis|enfin|donc|ainsi|premièrement|deuxièmement|troisièmement)\b)/gi;
const NUMBER = /(?:\d+(?:[.,]\d+)?\s?(?:%|€|\$|secondes?|minutes?|heures?|jours?|mois|ans?)?)/gi;
const WORD = /[a-zà-ÿ0-9]+(?:['’][a-zà-ÿ]+)?/gi;
const IGNORED_WORDS = new Set([
  "alors", "avec", "aux", "c'est", "ce", "cela", "cette", "comme", "dans", "des", "donc", "elle", "elles", "est", "et", "faire", "fait", "il", "ils", "les", "leur", "mais", "même", "nous", "par", "pas", "plus", "pour", "que", "qui", "sur", "une", "vous",
]);

function count(text: string, expression: RegExp): number {
  return text.match(expression)?.length ?? 0;
}

function lexicalDiversity(text: string): number {
  const words = (text.toLocaleLowerCase("fr").match(WORD) ?? [])
    .filter((word) => word.length > 2 && !IGNORED_WORDS.has(word));
  if (words.length < 12) return 0;
  const diversity = new Set(words).size / words.length;
  return diversity >= 0.62 ? 3 : diversity >= 0.48 ? 1.5 : 0;
}

/** Ne déduit le français du texte que si le moteur n’a pas fourni de langue. */
export function isFrenchTranscript(language: string | undefined, text: string): boolean {
  const normalized = (language ?? "").trim().toLocaleLowerCase();
  if (normalized && !["und", "unknown", "auto"].includes(normalized)) return normalized.startsWith("fr");
  const sample = text.slice(0, 6000).toLocaleLowerCase("fr");
  const stopwords = count(sample, FRENCH_STOPWORDS);
  return stopwords >= 7 || (stopwords >= 4 && /[àâçéèêëîïôûùüÿœ]/i.test(sample));
}

/**
 * Analyse déterministe du fond français : accroche, promesse claire, densité
 * d’information, progression, vocabulaire et débit. Elle ne prétend pas prédire
 * les vues ; elle fournit un signal textuel suffisamment fort pour ne pas être
 * noyé sous les seuls pics audio/vidéo du moteur gratuit.
 */
export function assessFrenchVirality(
  text: string,
  openingText = text,
  durationSec?: number,
): FrenchViralityAssessment {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { score: 0, reasons: [] };
  const opening = openingText.replace(/\s+/g, " ").trim().slice(0, 180);
  const reasons: string[] = [];
  let score = 0;

  const hook = Math.min(9, count(opening, STRONG_HOOK) * 3 + count(opening, CURIOSITY) * 2);
  const question = /[?？]/.test(opening) ? 3 : 0;
  const address = DIRECT_ADDRESS.test(opening) ? 2 : 0;
  if (hook + question + address > 0) {
    score += hook + question + address;
    reasons.push("accroche française explicite");
  }

  const information = Math.min(10, count(clean, INFORMATION) * 1.6);
  if (information > 0) {
    score += information;
    reasons.push("informations et actions concrètes");
  }
  const structure = Math.min(5, count(clean, STRUCTURE) * 1.25);
  if (structure >= 1.25) {
    score += structure;
    reasons.push("raisonnement structuré");
  }
  const utility = Math.min(8, utilityDensity(clean).score * 0.9);
  if (utility >= 1) score += utility;
  const numbers = Math.min(3, count(opening, NUMBER) * 1.5 + count(clean, NUMBER) * 0.35);
  if (numbers > 0) score += numbers;
  score += lexicalDiversity(clean);

  if (durationSec && durationSec > 0) {
    const words = clean.match(WORD)?.length ?? 0;
    const rate = words / durationSec;
    if (rate >= 1.4 && rate <= 3.8) score += 2;
    else if (rate < 0.75) score -= 2;
    else if (rate > 5.2) score -= 1;
  }
  if (/[.!?…]$/.test(clean)) score += 1;
  return { score: Math.max(-4, Math.min(42, score)), reasons: reasons.slice(0, 3) };
}
