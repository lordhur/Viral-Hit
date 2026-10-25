import { stripIpcError } from "./transcribe-errors";

const GENERIC = "L’opération n’a pas abouti. Réessayez, puis ouvrez Réglages → Diagnostics si le problème persiste.";
export const FRENCH = /(?:\b(?:le|la|les|une|des|du|de|d’|d'|est|pas|pour|dans|avec|sur|au|aux|cette|votre|vous|impossible|erreur|vérifiez|choisissez|aucun|fichier|vidéo|modèle|service|réessayez|téléchargement)\b|[éèêàç])/i;

/** Messages français actionnables, sans renvoyer les réponses bilingues d’un fournisseur. */
export function localizeErrorMessage(reason: unknown, fallback = GENERIC): string {
  const raw = stripIpcError(reason instanceof Error ? reason.message : String(reason ?? ""));
  const value = raw.trim();
  if (!value) return fallback;
  if (/aborted|abort|canceled|cancelled|annulée|annulé/i.test(value)) return "Opération annulée. Les fichiers déjà produits sont conservés.";

  // Import d’URL : conserver la cause au lieu de tout remplacer par « échec ».
  if (/url:invalid(?!-)|url:http-required|unsupported url protocol|invalid (?:video )?url|enter a video url|only http\(s\)/i.test(value)) {
    return "Cette adresse est invalide. Utilisez une URL complète commençant par http:// ou https://, vers une vidéo accessible publiquement.";
  }
  if (/url:credentials|userinfo|credentials.*url|urls? containing credentials/i.test(value)) {
    return "Cette URL contient des identifiants. Pour votre sécurité, utilisez l’adresse publique de la vidéo, sans nom d’utilisateur ni mot de passe.";
  }
  if (/url:(?:local|private|loopback)|private (?:address|network)|local address|local network video urls?/i.test(value)) {
    return "Les adresses locales ou privées ne peuvent pas être importées depuis le Web. Choisissez le fichier sur cet ordinateur ou utilisez une URL publique.";
  }
  if (/url:redirect|redirect.*(?:blocked|rejected|private)/i.test(value)) {
    return "La redirection de cette adresse a été refusée par sécurité. Ouvrez la vidéo dans votre navigateur, puis copiez son adresse publique finale.";
  }
  if (/url:unsupported-platform/i.test(value)) {
    return "L’import d’URL n’est pas disponible sur cette plateforme. Importez directement le fichier vidéo local.";
  }
  if (/url:tool-download|yt-dlp download (?:failed|returned)/i.test(value)) {
    if (/401|403|404/.test(value)) return "Le composant d’import yt-dlp est refusé ou introuvable sur le serveur de téléchargement. Vérifiez la connexion puis réessayez ; il ne s’agit pas d’un refus d’accès à votre vidéo.";
    if (/429/.test(value)) return "Le téléchargement du composant yt-dlp est temporairement limité. Patientez, puis réessayez.";
    if (/5\d\d/.test(value)) return "Le serveur de téléchargement du composant yt-dlp est temporairement indisponible. Réessayez dans quelques minutes.";
    return "Impossible de télécharger ou de vérifier le composant d’import (yt-dlp). Vérifiez Internet, le proxy et l’antivirus, puis réessayez. Le composant sera conservé après une installation réussie.";
  }
  if (/url:tool-install|integrity|checksum|sha256|somme de contrôle/i.test(value)) {
    return "Le composant d’import téléchargé n’a pas passé la vérification d’intégrité. Il n’a pas été exécuté. Vérifiez la connexion puis réessayez.";
  }
  if (/failed to fetch|econnreset|etimedout|certificate|cert_|self.signed|tls/i.test(value)) {
    return "La connexion nécessaire à l’import a échoué. Vérifiez Internet, le proxy, le pare-feu et l’antivirus, puis réessayez.";
  }
  if (/url:tool-run|eacces|eperm|spawn.*yt-dlp/i.test(value)) {
    return "Le composant d’import n’a pas pu démarrer. Vérifiez que l’antivirus ne bloque pas yt-dlp, puis relancez l’import.";
  }
  if (/url:invalid-download|no (?:audio|video)|aucun flux|sans piste/i.test(value)) {
    if (/missing media path|post-processing|unsafe media path/i.test(value)) {
      return "Le téléchargement est terminé, mais Viral Hit ne retrouve pas son fichier final dans le dossier d’import. Ne déplacez pas les fichiers pendant l’import, vérifiez l’antivirus et l’espace disque, puis réessayez. Vous pouvez aussi sélectionner manuellement la vidéo téléchargée.";
    }
    return "Le fichier récupéré ne contient pas de flux audio ou vidéo exploitable. Essayez une autre URL publique ou importez directement le fichier.";
  }
  if (/url:download|yt-dlp|unsupported url|video unavailable|private video|sign in|http error 4\d\d|getaddrinfo|name or service not known|nodename nor servname/i.test(value)) {
    if (/getaddrinfo|name or service not known|nodename nor servname|dns/i.test(value)) {
      return "Impossible de joindre le site de cette vidéo. Vérifiez votre connexion Internet et l’adresse, puis réessayez.";
    }
    if (/unsupported url|no video formats|format.*not available/i.test(value)) {
      return "Ce site ou ce format de vidéo n’est pas pris en charge par l’importateur. Essayez l’adresse publique directe de la vidéo ou importez un fichier local.";
    }
    if (/401|private|sign in|login|cookies|account|connexion|members.only|abonn/i.test(value)) {
      return "Cette vidéo exige une connexion, un abonnement ou une autorisation. Viral Hit ne contourne pas ces restrictions. Utilisez une vidéo publique ou un fichier que vous êtes autorisé à importer.";
    }
    if (/drm|protected/i.test(value)) {
      return "Cette vidéo est protégée contre le téléchargement. Viral Hit ne contourne pas cette protection ; utilisez un fichier que vous êtes autorisé à importer.";
    }
    if (/403|forbidden|access denied|refus/i.test(value)) {
      return "Le site refuse l’accès à cette vidéo (HTTP 403). Elle peut être privée, réservée à une région ou soumise à une autorisation. Essayez une URL publique ou un fichier local.";
    }
    if (/404|unavailable|not found|deleted|introuvable/i.test(value)) {
      return "La vidéo est introuvable ou n’est plus disponible. Vérifiez l’adresse dans un navigateur, sans connexion à un compte, puis réessayez.";
    }
    if (/429|too many|rate limit/i.test(value)) {
      return "Le site limite temporairement les téléchargements (HTTP 429). Patientez avant de réessayer ; aucun contournement n’est effectué.";
    }
    if (/5\d\d|bad gateway|service unavailable|gateway timeout/i.test(value)) {
      return "Le site de la vidéo est temporairement indisponible. Patientez, puis réessayez ; vous pouvez aussi importer un fichier local autorisé.";
    }
    return "Le téléchargement de cette URL a échoué. Vérifiez que la vidéo est lisible publiquement dans un navigateur, sans connexion, puis réessayez. Vous pouvez aussi importer directement le fichier local.";
  }

  // Transcription, fichiers et tâches locales : les clients sans interface
  // (CLI/MCP) réutilisent ces mêmes messages au lieu d’afficher une erreur native.
  if (/speech:busy|another speech operation|déjà une (?:transcription|opération vocale)/i.test(value)) {
    return "Une transcription ou un alignement est déjà en cours. Attendez sa fin ou annulez-le avant de réessayer.";
  }
  if (/\[hotclip:model-download\]|transcribe:model-download|model download failed|downloaded file too small|bad content-range|archive did not contain|checksum mismatch/i.test(value)) {
    return "Le modèle local n’a pas pu être téléchargé ou extrait. Vérifiez Internet, le proxy et l’espace disque, puis réessayez : le téléchargement partiel sera repris sans supprimer vos projets.";
  }
  if (/\[hotclip:model-load\]|transcribe:model-load|check your config|create recognizer|onnxruntime/i.test(value)) {
    return "Le modèle local est présent mais ne peut pas être chargé. Vérifiez son dossier dans Réglages → Diagnostics, évitez les caractères spéciaux dans son chemin Windows, puis préparez à nouveau le modèle si nécessaire.";
  }
  if (/transcribe:truncated-pcm|truncated.*(?:media|audio|pcm)/i.test(value)) {
    return "Le média semble incomplet ou tronqué. Réparez ou réexportez le fichier source, puis relancez la transcription.";
  }
  if (/unknown local asr engine|moteur (?:asr|de transcription) .*non pris en charge/i.test(value)) {
    return "Ce moteur de transcription n’est pas pris en charge. Choisissez Whisper français, SenseVoice, Paraformer, FireRedASR ou le service local Qwen3.";
  }
  if (/enoent|file .*not (?:found|exist)|source .*not (?:found|exist)|文件不存在|源文件不存在/i.test(value)) {
    return "Le fichier source est introuvable ou illisible. Vérifiez son chemin et ses autorisations, puis sélectionnez-le à nouveau.";
  }

  // Service Qwen local et transcription.
  if (/qwen:loopback-required/i.test(value)) {
    return "L’adresse du service vocal local doit être exactement http://127.0.0.1:8766 (ou http://[::1]:8766), sans identifiant ni chemin.";
  }
  if (/qwen:http-503|inference-busy/i.test(value)) {
    return "Le service vocal local traite déjà un extrait. Attendez la fin de cette tâche, puis réessayez.";
  }
  if (/qwen:http-409|aligner-not-loaded/i.test(value)) {
    return "Le service vocal fonctionne, mais son module d’alignement n’est pas chargé. Redémarrez-le avec l’option --aligner ou désactivez l’alignement précis.";
  }
  if (/qwen:incompatible-service|qwen:invalid|qwen:empty-response/i.test(value)) {
    return "Le service qui répond sur ce port n’est pas compatible avec Viral Hit. Démarrez tools/qwen-speech-server.py sur le port 8766, puis vérifiez la connexion.";
  }
  if (/qwen:|127\.0\.0\.1:8766|\[::1\]:8766/i.test(value)) {
    return "Le service vocal local Qwen3 est indisponible. Dans le dossier de Viral Hit, installez ses dépendances avec « py -m pip install qwen-asr », puis lancez « py tools/qwen-speech-server.py --device cpu --aligner ». Laissez cette fenêtre ouverte et vérifiez la connexion dans les réglages.";
  }

  // Anciennes erreurs LLM et erreurs de fournisseurs optionnels.
  if (/http\s*401|http\s*403|invalid token|invalid api key|unauthorized|authentication/i.test(value)) {
    return "Le service IA externe a refusé l’accès (HTTP 401/403). Sélectionnez « Gratuit · moteur intégré » dans Réglages → IA : il fonctionne localement, sans compte, sans clé et sans appel payant.";
  }
  if (/http\s*404|model.*(?:not found|missing)/i.test(value)) {
    return "Le modèle IA demandé est introuvable. Avec Ollama, installez le modèle indiqué puis réessayez, ou choisissez le moteur gratuit intégré.";
  }
  if (/http\s*429|rate limit|quota|insufficient.balance/i.test(value)) {
    return "Le service IA est limité ou indisponible temporairement. Réessayez plus tard, ou utilisez le moteur gratuit intégré sans compte ni quota.";
  }
  if (/model response timed out|llm.*timeout/i.test(value)) {
    return "Le modèle IA a dépassé le délai de réponse. Choisissez un modèle local plus léger ou le moteur gratuit intégré.";
  }
  if (/econnrefused|cannot reach llm|llm.*unavailable/i.test(value)) {
    return "Le service IA configuré ne répond pas. Démarrez Ollama ou revenez au moteur gratuit intégré, qui fonctionne sans service supplémentaire.";
  }

  if (/enospc|no space|disk full|espace disque/i.test(value)) {
    return "L’espace disque est insuffisant. Libérez de l’espace pour les modèles et les exports, puis réessayez. Vos projets existants ne sont pas supprimés.";
  }
  if (/eacces|eperm|permission denied|access is denied/i.test(value)) {
    return "Windows refuse l’accès à un fichier ou à un dossier. Vérifiez les autorisations et l’antivirus, puis réessayez.";
  }
  if (/no.audio|without.audio|aucune piste audio/i.test(value)) {
    return "Ce média ne contient aucune piste audio transcrivable. Choisissez un fichier avec du son ou importez des sous-titres.";
  }
  if (/recap:local-setup-required/i.test(value)) {
    return "Le récap autonome est désactivé tant qu’un pipeline local complet n’est pas configuré. Aucun service MiMo payant n’est appelé par défaut. Le parcours gratuit principal reste disponible : transcription locale, détection intégrée et export des clips.";
  }

  // Les messages déjà rédigés en français (y compris ceux du cœur) restent intacts.
  if (FRENCH.test(value) && !/[A-Za-z]+\s+(?:failed|required|unavailable|denied|missing|invalid|error)\b/i.test(value)) return value;
  return fallback;
}


/** Dernier recours contextualisé : ne jamais renvoyer un détail natif anglais pour un import d’URL. */
export function localizeUrlImportError(reason: unknown): string {
  return localizeErrorMessage(reason, "L’import de cette URL a échoué sans détail exploitable. Vérifiez l’adresse et votre connexion, puis réessayez ou importez directement le fichier local.");
}
