import type { GamingFormatComparison, PlatformFormatFit, TargetPlatform } from "./api-types";

/**
 * Editorial gaming-format references, not live platform metrics. The catalog
 * makes game-specific expectations explicit and every score is computed from
 * the clip's actual transcript, opening and duration. It never claims views,
 * retention or a probability of going viral.
 */
export interface GamingFormatProfile {
  id: string;
  label: string;
  keywords: string[];
  tiktokWeight: number;
  instagramWeight: number;
  tiktokDuration: [number, number];
  instagramDuration: [number, number];
}

export interface GameProfile {
  id: string;
  label: string;
  terms: string[];
  formats: GamingFormatProfile[];
}

interface GameSeed {
  id: string;
  label: string;
  terms: string[];
  skillLabel: string;
  skillTerms: string[];
  utilityLabel: string;
  utilityTerms: string[];
  specialLabel: string;
  specialTerms: string[];
}

const COMMON_SKILL = ["clutch", "ace", "outplay", "1v2", "1v3", "1v4", "1v5", "comeback", "incroyable"];
const COMMON_UTILITY = ["astuce", "conseil", "guide", "tuto", "technique", "strategie", "comment faire", "il faut"];
const COMMON_FUNNY = ["fail", "rate", "mdr", "xd", "drole", "rage", "bug", "chaos", "erreur", "oh non"];
const COMMON_SPECIAL = ["defi", "challenge", "record", "speedrun", "no hit", "secret", "nouveaute", "decouverte"];

function formats(seed: GameSeed): GamingFormatProfile[] {
  return [
    {
      id: "skill", label: seed.skillLabel, keywords: [...COMMON_SKILL, ...seed.skillTerms],
      tiktokWeight: 10, instagramWeight: 8, tiktokDuration: [8, 30], instagramDuration: [10, 40],
    },
    {
      id: "utility", label: seed.utilityLabel, keywords: [...COMMON_UTILITY, ...seed.utilityTerms],
      tiktokWeight: 6, instagramWeight: 10, tiktokDuration: [20, 60], instagramDuration: [20, 60],
    },
    {
      id: "funny", label: "Fail / réaction", keywords: COMMON_FUNNY,
      tiktokWeight: 9, instagramWeight: 7, tiktokDuration: [6, 24], instagramDuration: [8, 30],
    },
    {
      id: "special", label: seed.specialLabel, keywords: [...COMMON_SPECIAL, ...seed.specialTerms],
      tiktokWeight: 8, instagramWeight: 8, tiktokDuration: [12, 45], instagramDuration: [15, 60],
    },
  ];
}

function game(seed: GameSeed): GameProfile {
  return { id: seed.id, label: seed.label, terms: seed.terms, formats: formats(seed) };
}

export const GENERIC_GAME_PROFILE = game({
  id: "auto", label: "Jeu vidéo", terms: ["gameplay", "jeu", "joueur", "equipe", "partie"],
  skillLabel: "Clutch / exploit", skillTerms: ["pentakill", "victoire", "win"],
  utilityLabel: "Astuce / explication", utilityTerms: ["build", "meta", "debutant"],
  specialLabel: "Défi / découverte", specialTerms: ["easter egg", "cache"],
});

export const GAME_PROFILES: GameProfile[] = [
  game({
    id: "league-of-legends", label: "League of Legends", terms: ["league of legends", "lol", "champion", "lane", "riot"],
    skillLabel: "Outplay / teamfight", skillTerms: ["pentakill", "quadrakill", "triple kill", "teamfight", "baron", "dragon", "gank"],
    utilityLabel: "Astuce champion / macro", utilityTerms: ["matchup", "runes", "macro", "wave", "patch", "main"],
    specialLabel: "Comeback / défi", specialTerms: ["remontada", "urf", "arena", "mode"],
  }),
  game({
    id: "valorant", label: "Valorant", terms: ["valorant", "agent", "spike", "round", "radiant"],
    skillLabel: "Clutch / ace", skillTerms: ["headshot", "retake", "defuse", "one tap", "spike"],
    utilityLabel: "Lineup / tactique", utilityTerms: ["lineup", "smoke", "flash", "crosshair", "map", "post plant"],
    specialLabel: "Défi d’agent / rang", specialTerms: ["radiant", "immortal", "premier", "custom"],
  }),
  game({
    id: "counter-strike", label: "Counter-Strike 2", terms: ["counter strike", "cs2", "csgo", "bombe", "round"],
    skillLabel: "Clutch / ace", skillTerms: ["headshot", "retake", "defuse", "one tap", "awp", "flick"],
    utilityLabel: "Grenade / tactique", utilityTerms: ["smoke", "flash", "molotov", "crosshair", "map", "economie"],
    specialLabel: "Défi / rang", specialTerms: ["faceit", "premier", "global", "wingman"],
  }),
  game({
    id: "fortnite", label: "Fortnite", terms: ["fortnite", "battle royale", "epic games", "zone"],
    skillLabel: "Victoire / clutch", skillTerms: ["top 1", "victoire royale", "couronne", "elimination", "build fight"],
    utilityLabel: "Astuce / méta", utilityTerms: ["arme", "loot", "rotation", "zone", "parametres", "zero build"],
    specialLabel: "Défi / nouveauté", specialTerms: ["skin", "saison", "chapitre", "evenement", "map"],
  }),
  game({
    id: "minecraft", label: "Minecraft", terms: ["minecraft", "minecraft", "serveur", "survie", "craft"],
    skillLabel: "Build / transformation", skillTerms: ["construction", "build", "avant apres", "transformation", "mega base"],
    utilityLabel: "Astuce / redstone", utilityTerms: ["redstone", "farm", "enchantement", "craft", "tutoriel"],
    specialLabel: "Survie / défi", specialTerms: ["hardcore", "100 jours", "modpack", "speedrun", "seed"],
  }),
  game({
    id: "gta", label: "GTA / GTA RP", terms: ["gta", "grand theft auto", "rp", "los santos"],
    skillLabel: "Stunt / poursuite", skillTerms: ["stunt", "poursuite", "police", "braquage", "course", "drift"],
    utilityLabel: "Astuce / activité", utilityTerms: ["argent", "business", "mission", "online", "vehicule"],
    specialLabel: "Scène RP / impro", specialTerms: ["roleplay", "gta rp", "personnage", "histoire", "impro"],
  }),
  game({
    id: "ea-fc", label: "EA Sports FC", terms: ["ea fc", "fifa", "ultimate team", "fut", "match"],
    skillLabel: "But / geste technique", skillTerms: ["but", "skill move", "finesse", "bicycle", "arret", "penalty"],
    utilityLabel: "Tactique / équipe", utilityTerms: ["tactique", "formation", "joueur", "equipe", "meta", "defense"],
    specialLabel: "Pack / réaction", specialTerms: ["pack", "draft", "rival", "champions", "sbc"],
  }),
  game({
    id: "rocket-league", label: "Rocket League", terms: ["rocket league", "rl", "voiture", "terrain"],
    skillLabel: "But mécanique / save", skillTerms: ["flip reset", "musty", "double tap", "ceiling", "save", "but", "freestyle"],
    utilityLabel: "Mécanique / entraînement", utilityTerms: ["training", "rotation", "boost", "controle", "mecanique"],
    specialLabel: "Freestyle / défi", specialTerms: ["freestyle", "ranked", "grand champion", "ssl"],
  }),
  game({
    id: "apex-legends", label: "Apex Legends", terms: ["apex", "apex legends", "legende", "squad"],
    skillLabel: "Clutch / escouade", skillTerms: ["squad wipe", "kraber", "movement", "champion", "finisher"],
    utilityLabel: "Légende / positionnement", utilityTerms: ["legende", "arme", "rotation", "zone", "ranked", "meta"],
    specialLabel: "Défi / nouveau contenu", specialTerms: ["saison", "prestige", "badge", "20 kills", "4k"],
  }),
  game({
    id: "call-of-duty", label: "Call of Duty", terms: ["call of duty", "cod", "warzone", "multi"],
    skillLabel: "Clutch / éliminations", skillTerms: ["nuke", "killstreak", "headshot", "quickscope", "warzone", "victoire"],
    utilityLabel: "Classe / réglages", utilityTerms: ["loadout", "classe", "arme", "accessoire", "sensibilite", "meta"],
    specialLabel: "Défi / nouveau contenu", specialTerms: ["camo", "saison", "zombie", "mastery", " resurgence"],
  }),
  game({
    id: "overwatch", label: "Overwatch 2", terms: ["overwatch", "heros", "payload", "equipe"],
    skillLabel: "Teamfight / ultimate", skillTerms: ["ultimate", "team kill", "nano", "teamfight", "save", "potg"],
    utilityLabel: "Héros / composition", utilityTerms: ["heros", "counter", "composition", "main", "meta", "role"],
    specialLabel: "Défi / rang", specialTerms: ["ranked", "champion", "grandmaster", "stadium"],
  }),
  game({
    id: "elden-ring", label: "Elden Ring", terms: ["elden ring", "fromsoftware", "souls", "boss"],
    skillLabel: "Boss / exploit", skillTerms: ["boss", "no hit", "parry", "esquive", "malenia", "radahn"],
    utilityLabel: "Build / astuce boss", utilityTerms: ["build", "arme", "cendre", "rune", "stats", "talisman"],
    specialLabel: "No-hit / défi", specialTerms: ["level 1", "rl1", "speedrun", "sans degats", "dlc"],
  }),
  game({
    id: "roblox", label: "Roblox", terms: ["roblox", "robux", "serveur", "obby"],
    skillLabel: "Exploit / parcours", skillTerms: ["obby", "parcours", "record", "victoire", "pro"],
    utilityLabel: "Astuce / code", utilityTerms: ["code", "objet", "farm", "debutant", "astuce"],
    specialLabel: "Défi / secret", specialTerms: ["tycoon", "simulator", "mise a jour", "secret", "100 jours"],
  }),
];

export const CUSTOM_GAME_ID = "custom";

export function resolveGameProfile(gameId?: string, gameName?: string): GameProfile {
  if (gameId && gameId !== "auto" && gameId !== CUSTOM_GAME_ID) {
    const known = GAME_PROFILES.find((profile) => profile.id === gameId);
    if (known) return known;
  }
  const customLabel = gameName?.trim().slice(0, 60);
  return customLabel ? { ...GENERIC_GAME_PROFILE, id: CUSTOM_GAME_ID, label: customLabel } : GENERIC_GAME_PROFILE;
}

function normalize(value: string): string {
  return ` ${value
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function matchingTerms(text: string, keywords: string[]): string[] {
  const haystack = normalize(text);
  return keywords.filter((keyword) => haystack.includes(normalize(keyword)));
}

function durationScore(durationSec: number, range: [number, number]): { score: number; inside: boolean } {
  if (!(durationSec > 0)) return { score: 5, inside: false };
  if (durationSec >= range[0] && durationSec <= range[1]) return { score: 16, inside: true };
  const distance = durationSec < range[0] ? range[0] - durationSec : durationSec - range[1];
  return { score: distance <= 5 ? 10 : distance <= 15 ? 4 : 0, inside: false };
}

function openingScore(opening: string): number {
  const sample = opening.slice(0, 180);
  let score = 0;
  if (/[?！？]/.test(sample)) score += 3;
  if (matchingTerms(sample, ["wow", "incroyable", "attention", "regarde", "jamais", "personne", "enfin", "comment"]).length > 0) score += 3;
  if (matchingTerms(sample, ["tu", "vous", "ton", "ta", "votre"]).length > 0) score += 2;
  return score;
}

function platformFit(
  profile: GameProfile,
  format: GamingFormatProfile,
  platform: "tiktok" | "instagram",
  text: string,
  opening: string,
  durationSec: number,
): PlatformFormatFit {
  const hits = matchingTerms(text, format.keywords);
  const openingHits = matchingTerms(opening.slice(0, 180), format.keywords);
  const gameHits = matchingTerms(text, profile.terms);
  const duration = durationScore(durationSec, platform === "tiktok" ? format.tiktokDuration : format.instagramDuration);
  const reasons: string[] = [];
  if (hits.length > 0) reasons.push(`marqueurs « ${hits.slice(0, 2).join(", ")} »`);
  if (openingHits.length > 0) reasons.push("format annoncé dès l’ouverture");
  if (duration.inside) reasons.push(`durée de ${Math.round(durationSec)} s adaptée au repère`);
  if (hits.length === 0) reasons.push("peu de marqueurs textuels ; contrôle visuel conseillé");

  let score = 30
    + Math.min(25, hits.length * 8)
    + (openingHits.length > 0 ? 7 : 0)
    + duration.score
    + openingScore(opening)
    + (platform === "tiktok" ? format.tiktokWeight : format.instagramWeight)
    + Math.min(5, gameHits.length * 2);
  // Without actual format evidence, duration alone must not produce a high score.
  if (hits.length === 0) score = Math.min(61, score);
  return {
    platform,
    score: Math.max(1, Math.min(97, Math.round(score))),
    formatId: format.id,
    formatLabel: format.label,
    reasons: reasons.slice(0, 3),
  };
}

export function compareGamingFormats(input: {
  gameId?: string;
  gameName?: string;
  targetPlatform?: TargetPlatform;
  text: string;
  openingText?: string;
  durationSec: number;
}): GamingFormatComparison {
  const profile = resolveGameProfile(input.gameId, input.gameName);
  const opening = input.openingText?.trim() || input.text.slice(0, 180);
  const best = (platform: "tiktok" | "instagram"): PlatformFormatFit =>
    profile.formats
      .map((format) => platformFit(profile, format, platform, input.text, opening, input.durationSec))
      .sort((a, b) => b.score - a.score || a.formatId.localeCompare(b.formatId))[0]!;
  return {
    gameId: profile.id,
    gameLabel: profile.label,
    targetPlatform: input.targetPlatform ?? "compare",
    method: "local-format-heuristic",
    tiktok: best("tiktok"),
    instagram: best("instagram"),
  };
}

/** Platform used for ranking; compare mode uses the average of both fits. */
export function selectedPlatformFit(comparison: GamingFormatComparison): number {
  if (comparison.targetPlatform === "tiktok") return comparison.tiktok.score;
  if (comparison.targetPlatform === "instagram") return comparison.instagram.score;
  return (comparison.tiktok.score + comparison.instagram.score) / 2;
}
