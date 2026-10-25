import type { ClipLength, DetectBrief, HighlightCandidate } from "../../shared/api-types";
import { utilityDensity, utilityBoost } from "../../shared/utility-density";
import type { Transcript, TranscriptSegment } from "../transcribe/types";
import type { MediaSignals } from "../signals";
import type { EvidenceClass } from "../genre";
import { CLIP_LENGTH_RANGES } from "./prompt";
import { fuseMoments, MOMENT_WEIGHTS, topMoments } from "./moments";
import { endingUnfinished, openingDangles } from "./gate";
import { assessFrenchVirality, isFrenchTranscript } from "./french-score";

/**
 * Sélection 100 % locale, sans modèle ni requête réseau.
 *
 * Elle privilégie des fenêtres de phrases complètes, puis les classe à partir de
 * signaux déterministes (structure, information, produits, rythme et preuves
 * audio/vidéo déjà calculées). Les titres reprennent les paroles réelles : ce
 * moteur ne prétend pas écrire comme un LLM et ne peut donc pas en inventer.
 */
export interface LocalFreeOptions {
  length?: ClipLength;
  products?: string[];
  signals?: MediaSignals | null;
  evidence?: EvidenceClass;
  brief?: DetectBrief | null;
}

const STRONG_TEXT = /(?:\b(?:incroyable|jamais|personne|toujours|interdit|secret|erreur|vérité|gratuit|urgent|attention|pourquoi|comment|meilleur|pire|important|problème|solution|découvrir|comprendre|éviter|réussir|gagner|perdre)\b|\b(?:amazing|never|nobody|always|secret|mistake|truth|free|urgent|why|how|best|worst|important|problem|solution)\b|居然|竟然|千万|秘密|错误|真相|免费|为什么|怎么|最好|最差|重要|问题|解决|方法|技巧)/gi;
const QUESTION_OR_EMOTION = /[?!？！]|\b(?:wow|incroyable|attention|bravo)\b|我去|太棒|没想到/gi;
const NUMBER = /(?:\d+(?:[.,]\d+)?\s?(?:%|€|\$|secondes?|minutes?|heures?|jours?|ans?)?)/gi;
const MAX_UNITS_PER_WINDOW = 120;

function matchCount(text: string, expression: RegExp): number {
  return text.match(expression)?.length ?? 0;
}

function terms(value: string | undefined): string[] {
  return (value ?? "")
    .toLocaleLowerCase()
    .split(/[\s,;，；、]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 24);
}

function compact(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function segmentScore(
  segment: TranscriptSegment,
  products: string[],
  focus: string[],
  exclude: string[],
): number {
  const text = segment.text.toLocaleLowerCase();
  if (!text.trim()) return -20;
  let score = 0;
  score += Math.min(8, matchCount(text, STRONG_TEXT) * 2.5);
  score += Math.min(4, matchCount(text, QUESTION_OR_EMOTION) * 1.5);
  score += Math.min(3, matchCount(text, NUMBER) * 0.7);
  score += Math.min(6, utilityDensity(segment.text).score * 0.8);
  score += products.some((product) => text.includes(product)) ? 7 : 0;
  score += focus.some((term) => text.includes(term)) ? 9 : 0;
  score -= exclude.some((term) => text.includes(term)) ? 30 : 0;
  // Les formules de protocole seules font rarement un clip autonome.
  if (/^(?:bonjour|salut|hello|hi|大家好|欢迎来到).{0,24}[.!！]?$/i.test(segment.text.trim())) score -= 8;
  return score;
}

function makeCandidate(
  segments: TranscriptSegment[],
  score: number,
  products: string[],
  french?: ReturnType<typeof assessFrenchVirality>,
): HighlightCandidate | null {
  const selected = segments.filter((segment) => segment.text.trim());
  const first = selected[0];
  const last = selected[selected.length - 1];
  if (!first || !last || last.endSec <= first.startSec) return null;
  const text = selected.map((segment) => segment.text.trim()).join(" ");
  const utility = utilityDensity(text);
  const keywords = products.filter((product) => text.toLocaleLowerCase().includes(product));
  for (const hit of utility.hits) {
    if (keywords.length < 8 && !keywords.some((keyword) => keyword.toLocaleLowerCase() === hit.toLocaleLowerCase())) keywords.push(hit);
  }
  const strongest = [...selected].sort((a, b) => {
    const utilityDiff = utilityDensity(b.text).score - utilityDensity(a.text).score;
    return utilityDiff || b.text.length - a.text.length;
  })[0] ?? first;
  const baseReason = utility.score >= 4
    ? "Sélection locale : passage informatif, concret et facile à retrouver."
    : "Sélection locale : phrases complètes, rythme et éléments marquants de la transcription.";
  const frenchReason = french && french.score > 0
    ? ` Analyse renforcée du français : ${french.reasons.length > 0 ? french.reasons.join(", ") : "contenu et débit pris en compte"}.`
    : "";
  return {
    id: 0,
    startSec: first.startSec,
    endSec: last.endSec,
    text,
    title: compact(strongest.text, 58),
    hook: compact(first.text, 110),
    score: Math.max(1, Math.min(99, Math.round(score + utilityBoost(utility.score)))),
    reason: `${baseReason}${frenchReason}`,
    boundary: "segment",
    keywords: keywords.slice(0, 8),
    recommended: true,
    reviewNote: "",
    ...(utility.score > 0 ? { utility } : {}),
  };
}

function textCandidates(transcript: Transcript, options: LocalFreeOptions): HighlightCandidate[] {
  const range = CLIP_LENGTH_RANGES[options.length ?? "standard"];
  const segments = transcript.segments
    .filter((segment) => Number.isFinite(segment.startSec) && Number.isFinite(segment.endSec) && segment.endSec > segment.startSec && segment.text.trim())
    .sort((a, b) => a.startSec - b.startSec);
  if (!segments.length) return [];
  const products = (options.products ?? []).map((product) => product.trim().toLocaleLowerCase()).filter(Boolean);
  const focus = terms(options.brief?.focus);
  const exclude = terms(options.brief?.exclude);
  const french = isFrenchTranscript(transcript.language, segments.map((segment) => segment.text).join(" "));
  const scores = segments.map((segment) => segmentScore(segment, products, focus, exclude));
  const candidates: HighlightCandidate[] = [];
  const totalStart = segments[0]!.startSec;
  const totalEnd = segments[segments.length - 1]!.endSec;

  for (let start = 0; start < segments.length; start++) {
    const window: TranscriptSegment[] = [];
    let rawScore = 0;
    for (let end = start; end < segments.length && window.length < MAX_UNITS_PER_WINDOW; end++) {
      const segment = segments[end]!;
      const previous = window[window.length - 1];
      // Ne pas réunir deux conversations séparées par un long silence.
      if (previous && segment.startSec - previous.endSec > 8) break;
      const nextEnd = segment.endSec;
      const nextDuration = nextEnd - segments[start]!.startSec;
      if (window.length && nextDuration > range.maxSec) break;
      // Une phrase ASR très longue reste entière plutôt que d'inventer une coupure.
      if (!window.length && nextDuration > range.maxSec * 1.5) continue;
      window.push(segment);
      rawScore += scores[end]!;
      const duration = nextEnd - segments[start]!.startSec;
      if (duration + 0.001 < range.minSec && end < segments.length - 1) continue;
      const text = window.map((item) => item.text).join(" ");
      // En français, le fond du passage devient un signal de premier plan :
      // il représente jusqu’à environ deux fois le poids des anciens indices
      // textuels agrégés, tout en gardant une marge pour éviter les scores plafonds.
      const frenchAssessment = french
        ? assessFrenchVirality(text, window[0]?.text ?? text, duration)
        : undefined;
      let score = (french ? 40 + Math.min(16, rawScore) : 53 + Math.min(30, rawScore))
        + (frenchAssessment ? frenchAssessment.score * 0.85 : 0);
      if (openingDangles(text)) score -= 5;
      if (endingUnfinished(text)) score -= 5;
      if (duration >= range.minSec && duration <= range.maxSec) score += 4;
      // Un léger bonus pour les ouvertures qui portent déjà le sujet.
      score += Math.max(0, Math.min(3, scores[start]! * 0.2));
      const candidate = makeCandidate(window, score, products, frenchAssessment);
      if (candidate) candidates.push(candidate);
      if (totalEnd - totalStart < range.minSec) break;
    }
  }
  return candidates;
}

function signalCandidates(transcript: Transcript, options: LocalFreeOptions): HighlightCandidate[] {
  if (!options.signals) return [];
  const range = CLIP_LENGTH_RANGES[options.length ?? "standard"];
  const moments = topMoments(fuseMoments(options.signals, transcript.durationSec, {
    weights: MOMENT_WEIGHTS[options.evidence === "visual" ? "visual" : "reaction"],
    minSec: range.minSec,
    maxSec: range.maxSec,
  }), 6);
  const maxHeat = Math.max(1, ...moments.map((moment) => moment.heat));
  const french = isFrenchTranscript(transcript.language, transcript.segments.map((segment) => segment.text).join(" "));
  return moments.map((moment, index) => {
    const text = transcript.segments
      .filter((segment) => segment.endSec > moment.startSec && segment.startSec < moment.endSec)
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ");
    const frenchAssessment = french && text
      ? assessFrenchVirality(text, text, moment.endSec - moment.startSec)
      : undefined;
    const heatScore = (moment.heat / maxHeat) * (frenchAssessment ? 18 : 30);
    const score = frenchAssessment
      ? 45 + heatScore + frenchAssessment.score * 0.75
      : 58 + heatScore;
    return {
      id: 0,
      startSec: moment.startSec,
      endSec: moment.endSec,
      text,
      title: text ? compact(text, 58) : `Moment fort ${index + 1}`,
      hook: compact(text, 110),
      score: Math.max(1, Math.min(99, Math.round(score))),
      reason: frenchAssessment
        ? `Sélection locale : transcription française et pics média combinés (${frenchAssessment.reasons.join(", ") || "contenu analysé"}).`
        : "Sélection locale : convergence de pics audio, visuels ou de réaction.",
      boundary: "signal" as const,
      signalEvidence: moment.evidence,
      keywords: [],
      recommended: true,
      reviewNote: "",
    } satisfies HighlightCandidate;
  });
}

/** Retourne des candidats non dédupliqués ; detect.ts applique le filtre anti-chevauchement commun. */
export function detectLocalFree(transcript: Transcript, options: LocalFreeOptions = {}): HighlightCandidate[] {
  const fromText = textCandidates(transcript, options);
  const fromSignals = signalCandidates(transcript, options);
  // Les preuves de signal complètent toujours le texte ; pour un média pauvre en
  // paroles elles deviennent naturellement la seule source de candidats.
  return [...fromText, ...fromSignals]
    .sort((a, b) => b.score - a.score || a.startSec - b.startSec || a.endSec - b.endSec)
    .slice(0, 80);
}
