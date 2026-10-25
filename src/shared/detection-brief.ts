import type { DetectBrief, TargetPlatform } from "./api-types";
import { CUSTOM_GAME_ID, GAME_PROFILES } from "./gaming-formats";

const GAME_IDS = new Set(["auto", CUSTOM_GAME_ID, ...GAME_PROFILES.map((profile) => profile.id)]);
const PLATFORMS = new Set<TargetPlatform>(["compare", "tiktok", "instagram"]);

function cleanText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** Shared Electron/HTTP boundary validation for detection intent. */
export function sanitizeDetectBrief(value: unknown): DetectBrief | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const brief: DetectBrief = {
    focus: cleanText(raw.focus, 300),
    exclude: cleanText(raw.exclude, 300),
    gameName: cleanText(raw.gameName, 60),
  };
  if (typeof raw.gameId === "string" && GAME_IDS.has(raw.gameId)) brief.gameId = raw.gameId;
  if (typeof raw.targetPlatform === "string" && PLATFORMS.has(raw.targetPlatform as TargetPlatform)) {
    brief.targetPlatform = raw.targetPlatform as TargetPlatform;
  }
  const duration = Number(raw.customDurationSec);
  if (Number.isFinite(duration)) brief.customDurationSec = Math.max(5, Math.min(180, Math.round(duration)));
  return Object.values(brief).some((entry) => entry !== undefined) ? brief : undefined;
}
