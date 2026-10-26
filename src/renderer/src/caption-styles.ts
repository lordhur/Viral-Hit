import type { CaptionStyleChoice } from "../../shared/api-types";

export const CAPTION_ORDER: CaptionStyleChoice[] = ["keyword", "pop", "bubble", "hormozi", "minimal", "karaoke", "none"];
export const CAPTION_KEY: Record<CaptionStyleChoice, string> = {
  none: "captionNone",
  karaoke: "captionKaraoke",
  keyword: "captionKeyword",
  pop: "captionPop",
  hormozi: "captionHormozi",
  minimal: "captionMinimal",
  bubble: "captionBubble",
};
