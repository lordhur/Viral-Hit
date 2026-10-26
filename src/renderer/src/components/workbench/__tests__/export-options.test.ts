import { describe, expect, it } from "vitest";
import { RENDER_PREF_DEFAULTS } from "../../../stores/render-prefs-store";
import { buildRenderToggles } from "../export-options";

describe("normal render options", () => {
  it("never restores legacy clip-title overlays and carries subtitle timing", () => {
    const options = buildRenderToggles({
      prefs: { ...RENDER_PREF_DEFAULTS, titleCard: true, openingHook: true, captionOffsetMs: 250 },
      config: { provider: "builtin", baseUrl: "builtin", model: "builtin", apiKey: "" },
      brandState: { presets: [], activeId: "default" },
      diarize: false,
      transcript: null,
      atlasReady: false,
    });
    expect(options.titleCard).toBe(false);
    expect(options.openingHook).toBe(false);
    expect(options.captionOffsetMs).toBe(250);
  });
});
