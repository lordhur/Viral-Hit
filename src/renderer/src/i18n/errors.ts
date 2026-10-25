import { stripIpcError } from "../../../shared/transcribe-errors";
import { FRENCH, localizeErrorMessage } from "../../../shared/french-errors";
export { localizeErrorMessage } from "../../../shared/french-errors";

function currentLocale(): string {
  if (typeof document !== "undefined" && document.documentElement.lang) return document.documentElement.lang.toLowerCase();
  try {
    const saved = localStorage.getItem("viral-hit-locale") ?? localStorage.getItem("hotclip-locale");
    if (saved) return saved.toLowerCase();
  } catch { /* stockage indisponible */ }
  return typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "fr";
}

export function localizedError(reason: unknown): Error {
  if (!currentLocale().startsWith("fr")) return reason instanceof Error ? reason : new Error(String(reason));
  if (reason instanceof Error && /abort/i.test(reason.name)) return reason;
  const error = new Error(localizeErrorMessage(reason));
  error.name = reason instanceof Error ? reason.name : "Error";
  return error;
}

/** Raccourci pour les vues qui affichent aussi des erreurs persistantes hors API. */
export function errorText(reason: unknown, fallback?: string): string {
  return currentLocale().startsWith("fr") ? localizeErrorMessage(reason, fallback) : stripIpcError(reason instanceof Error ? reason.message : String(reason));
}

/** Notes déterministes du contrôle qualité, y compris avec l’option Ollama. */
export function gateNoteText(note: string): string {
  if (!currentLocale().startsWith("fr")) return note;
  if (/opens mid-thought/i.test(note)) return "le début semble coupé au milieu d’une idée";
  if (/ends unfinished/i.test(note)) return "la fin semble inachevée (coupure sur une virgule)";
  if (/speaker overlap/i.test(note)) return "les intervenants se coupent fréquemment la parole";
  return FRENCH.test(note) ? note : "vérification manuelle recommandée avant publication";
}
