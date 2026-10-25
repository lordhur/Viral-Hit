import type { DetectBrief, HighlightCandidate } from "../../shared/api-types";
import { clipDurationSec } from "../../shared/pieces";
import { compareGamingFormats, resolveGameProfile, selectedPlatformFit } from "../../shared/gaming-formats";

export function hasGamingFormatContext(brief?: DetectBrief | null, genreId?: string): boolean {
  const selectedGame = brief?.gameId?.trim();
  return Boolean(
    (selectedGame && selectedGame !== "auto")
    || ((selectedGame === "auto" || !selectedGame) && ["game", "esports", "vtuber"].includes(genreId ?? "")),
  );
}

/**
 * Add a bounded game/platform fit signal before the common score normalization.
 * The comparison remains structured for the UI; no live-performance claim is
 * appended to the candidate's editorial reason.
 */
export function applyGamingFormatSignal(
  candidates: HighlightCandidate[],
  brief?: DetectBrief | null,
  genreId?: string,
): HighlightCandidate[] {
  if (!hasGamingFormatContext(brief, genreId)) return candidates;
  return candidates.map((candidate) => {
    const formatComparison = compareGamingFormats({
      gameId: brief?.gameId,
      gameName: brief?.gameName,
      targetPlatform: brief?.targetPlatform,
      text: candidate.text,
      openingText: candidate.hook || candidate.text,
      durationSec: clipDurationSec(candidate),
    });
    // At most ±8 raw points: format fit informs ranking but cannot erase the
    // underlying French content, audiovisual evidence or quality review.
    const adjustment = Math.max(-8, Math.min(8, (selectedPlatformFit(formatComparison) - 50) * 0.16));
    return {
      ...candidate,
      score: Math.max(1, Math.min(99, Math.round(candidate.score + adjustment))),
      formatComparison,
    };
  });
}

/** Prompt context for optional LLM engines; deterministic scoring still runs afterwards. */
export function gamingFormatPromptSection(
  brief: DetectBrief | undefined,
  genreId: string | undefined,
  zh: boolean,
): string {
  if (!hasGamingFormatContext(brief, genreId)) return "";
  const profile = resolveGameProfile(brief?.gameId, brief?.gameName);
  const formats = profile.formats.map((format) => format.label).join(zh ? "、" : ", ");
  const platform = brief?.targetPlatform === "tiktok" ? "TikTok" : brief?.targetPlatform === "instagram" ? "Instagram Reels" : "TikTok and Instagram Reels";
  if (zh) {
    return `\n\n【游戏与平台格式】游戏:${profile.label};目标:${platform}。重点识别这类游戏常见短片结构:${formats}。只根据素材中真实存在的台词、事件和完整节奏选段;不得编造赛事结果或平台数据。时长由内容完整性和格式决定,不要为了套模板截断动作或解释。`;
  }
  return `\n\n[Game and platform format] Game: ${profile.label}; target: ${platform}. Recognize these established short-form gaming structures: ${formats}. Select only dialogue, events and complete rhythms actually present in the source; never invent match outcomes or platform metrics. Let content completeness and the format drive duration rather than cutting an action or explanation to fit a template.`;
}
