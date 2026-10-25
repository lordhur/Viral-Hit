import type { HighlightCandidate } from "./api-types";

export interface AutomaticClipSelectionOptions {
  /** Nombre maximal de fichiers générés sans intervention (1..12, 6 par défaut). */
  maxClips?: number;
  /** Seuil facultatif sur le score de viralité normalisé. */
  minScore?: number;
}

function ranges(candidate: HighlightCandidate): Array<{ startSec: number; endSec: number }> {
  return candidate.pieces && candidate.pieces.length > 1
    ? candidate.pieces
    : [{ startSec: candidate.startSec, endSec: candidate.endSec }];
}

function overlapsSignificantly(a: HighlightCandidate, b: HighlightCandidate): boolean {
  const aRanges = ranges(a);
  const bRanges = ranges(b);
  const aDuration = Math.max(0.001, aRanges.reduce((sum, range) => sum + range.endSec - range.startSec, 0));
  const bDuration = Math.max(0.001, bRanges.reduce((sum, range) => sum + range.endSec - range.startSec, 0));
  let overlap = 0;
  for (const left of aRanges) {
    for (const right of bRanges) {
      overlap += Math.max(0, Math.min(left.endSec, right.endSec) - Math.max(left.startSec, right.startSec));
    }
  }
  return overlap / Math.min(aDuration, bDuration) > 0.2;
}

/**
 * Sélection unique du mode automatique : score décroissant, clips recommandés
 * et pubables uniquement, puis suppression des reprises largement chevauchantes.
 * L’ordre chronologique ne doit jamais évincer un meilleur score avant export.
 */
export function selectAutomaticClips(
  candidates: HighlightCandidate[],
  options: AutomaticClipSelectionOptions = {},
): HighlightCandidate[] {
  const maxClips = Math.max(1, Math.min(12, Math.round(options.maxClips ?? 6)));
  const minScore = Number.isFinite(options.minScore) ? Number(options.minScore) : Number.NEGATIVE_INFINITY;
  const ranked = candidates
    .filter((candidate) =>
      candidate.recommended &&
      (candidate.gate === undefined || candidate.gate === "publish") &&
      Number.isFinite(candidate.score) && candidate.score >= minScore &&
      Number.isFinite(candidate.startSec) && Number.isFinite(candidate.endSec) && candidate.endSec > candidate.startSec
    )
    .sort((a, b) => b.score - a.score || a.startSec - b.startSec || a.endSec - b.endSec || a.id - b.id);
  const selected: HighlightCandidate[] = [];
  for (const candidate of ranked) {
    if (selected.some((other) => overlapsSignificantly(candidate, other))) continue;
    selected.push(candidate);
    if (selected.length >= maxClips) break;
  }
  return selected;
}
