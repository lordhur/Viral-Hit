import type { DiagnosticsCheck } from "../../../shared/api-types";

const MODEL_NAMES: Array<[RegExp, string]> = [
  [/whisper/i, "Transcription française Whisper (défaut)"],
  [/sensevoice/i, "Transcription SenseVoice (défaut)"],
  [/yunet/i, "Détection des visages YuNet (cadrage vertical)"],
  [/emotion|fer/i, "Émotions du visage FER+ (moments forts)"],
  [/transnet/i, "Détection des plans TransNetV2"],
  [/silero|vad/i, "Détection de l’activité vocale"],
  [/paraformer/i, "Transcription Paraformer (précision)"],
  [/firered/i, "Transcription FireRedASR2 (haute précision)"],
  [/punct/i, "Restauration de la ponctuation"],
  [/segmentation/i, "Segmentation des intervenants"],
  [/speaker|embedding/i, "Empreintes vocales des intervenants"],
  [/dpdf|enhancement/i, "Amélioration locale de la voix DPDFNet (48 kHz)"],
];

function size(raw: string): string {
  return raw.match(/[\d.,]+\s?[MG]B/i)?.[0]?.replace("MB", "Mo").replace("GB", "Go") ?? "";
}

function modelName(check: DiagnosticsCheck): string {
  return MODEL_NAMES.find(([pattern]) => pattern.test(check.id))?.[1] ?? check.name;
}

function detail(check: DiagnosticsCheck): string {
  const raw = check.detail;
  if (check.id.startsWith("binary:")) {
    if (check.status !== "ok") return "Outil média introuvable ou inutilisable sur cette installation.";
    const version = raw.match(/(?:ffmpeg|ffprobe)\s+version\s+([^\s]+)/i)?.[1];
    return version ? `Disponible · version ${version}` : "Disponible et opérationnel.";
  }
  if (check.id.startsWith("model:")) {
    const amount = size(raw);
    if (/not installed|未安装/i.test(raw)) {
      const optional = /optional|可选/i.test(raw);
      const resume = /partial|断点/i.test(raw);
      return `${optional ? "Modèle facultatif non installé" : "Modèle non installé"}${amount ? ` · environ ${amount}` : ""}. Téléchargement local gratuit à la première utilisation${resume ? ", avec reprise du téléchargement partiel" : ""}.`;
    }
    return `Installé${amount ? ` · ${amount}` : ""}.`;
  }
  if (check.id === "llm") {
    if (/Prêt ·/.test(raw)) return raw;
    if (/401|403|rejected|拒绝/i.test(raw)) return "Le service IA refuse les identifiants enregistrés (HTTP 401/403).";
    if (/HTTP\s+\d+/i.test(raw)) return `Le service répond, mais la liste des modèles renvoie ${raw.match(/HTTP\s+\d+/i)?.[0] ?? "une erreur"}.`;
    if (/cannot reach|连不上/i.test(raw)) return "Le service Ollama configuré est injoignable.";
    if (/not configured|未配置/i.test(raw)) return "Aucun moteur configuré.";
    return "Le service Ollama est disponible.";
  }
  if (check.id === "disk") {
    const amount = size(raw);
    return check.status === "ok" ? `Espace disponible : ${amount || "suffisant"}.` : `Espace disponible faible${amount ? ` : ${amount}` : ""}. Les modèles et exports ont besoin d’espace supplémentaire.`;
  }
  if (check.id === "cache") return /empty|空/i.test(raw) ? "Cache vide ; il se remplira après la première transcription." : `${size(raw) || "Données présentes"} · les transcriptions déjà calculées sont réutilisées.`;
  if (check.id === "render-cache") return /empty|空/i.test(raw) ? "Cache vide ; les prochains exports pourront réutiliser les étapes déjà calculées." : `${size(raw) || "Données présentes"} · cache de rendu régénérable, limité automatiquement.`;
  if (check.id === "evidence-index") return /empty|空/i.test(raw) ? "Index vide ; les preuves visuelles et audio seront réutilisées après les premières analyses." : `${size(raw) || "Données présentes"} · preuves régénérables réutilisées entre les tâches.`;
  if (check.id === "downloader") {
    if (/integrity|校验/i.test(raw)) return "La vérification d’intégrité du composant d’import a échoué.";
    if (/not installed|尚未/i.test(raw)) return "Non installé ; téléchargement et vérification automatiques au premier import d’URL.";
    return "Composant d’import installé et vérifié.";
  }
  return "Contrôle terminé.";
}

function name(check: DiagnosticsCheck): string {
  if (check.id.startsWith("model:")) return modelName(check);
  if (check.id === "llm") return /Prêt ·/.test(check.detail) ? check.name : "Moteur de détection";
  if (check.id === "disk") return "Espace disque";
  if (check.id === "cache") return "Cache de transcription";
  if (check.id === "render-cache") return "Cache de rendu";
  if (check.id === "evidence-index") return "Index de preuves multimédias";
  if (check.id === "downloader") return "Import de vidéos par URL (yt-dlp)";
  return check.name;
}

function fix(check: DiagnosticsCheck): string | undefined {
  if (!check.fix) return undefined;
  if (check.id.startsWith("binary:")) return "Lancez « Mettre à jour Viral Hit » pour vérifier les outils intégrés. Vos projets, modèles et réglages seront conservés.";
  if (check.id.startsWith("model:")) return "Cliquez sur « Préparer les modèles » ou lancez une transcription : le téléchargement est gratuit et reprend après interruption.";
  if (check.id === "llm") return "Choisissez le moteur gratuit intégré, ou installez et démarrez Ollama avec le modèle indiqué.";
  if (check.id === "disk") return "Libérez de l’espace disque, puis relancez le diagnostic.";
  if (check.id === "downloader") return "Relancez un import d’URL : le composant endommagé sera supprimé, téléchargé à nouveau et vérifié.";
  return "Relancez le contrôle après avoir vérifié la configuration locale.";
}

/** Le cœur fournit des identifiants stables ; l’UI française ne dépend pas de ses phrases anglaises/chinoises. */
export function localizeDoctorCheck(check: DiagnosticsCheck): DiagnosticsCheck {
  return { ...check, name: name(check), detail: detail(check), fix: fix(check) };
}
