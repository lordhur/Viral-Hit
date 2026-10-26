import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("aperçu vertical du Workbench", () => {
  it("affiche les deux couches et le cadre caméra choisi, pas un centre-crop", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "hotclip-render-prefs" ? JSON.stringify({
        vertical: true,
        cameraGameplay: true,
        cameraHeightFrac: 0.35,
        cameraCrop: { x: 0.1, y: 0.2, w: 0.4, h: 0.5 },
      }) : null,
      setItem: () => {},
      removeItem: () => {},
    });
    const React = (await import("react")).default;
    const { renderToString } = await import("react-dom/server");
    const { PreviewPane } = await import("../PreviewPane");
    const html = renderToString(React.createElement(PreviewPane, {
      filePath: "/tmp/source.mp4",
      durationSec: 90,
      seekSec: Number.NaN,
      onTime: () => {},
      onPrevCandidate: () => {},
      onNextCandidate: () => {},
      clip: { id: 1, startSec: 12, endSec: 32 },
      cameraAvailable: true,
    }));
    expect(html).toContain('data-preview-mode="camera-gameplay"');
    expect(html).toContain("camera-live");
    expect(html).toContain("gameplay-live");
    expect(html).toContain("height:35%");
    expect(html).toContain("height:65%");
    expect(html).toContain("left:-25%");
    expect(html).toContain("top:-40%");
    expect(html).toContain("width:250%");
    expect(html).toContain("height:200%");
  });

  it("affiche le sous-titre courant, cliquable, avec le décalage et la position d’export", async () => {
    vi.resetModules();
    const values = new Map<string, string>([
      ["hotclip-render-prefs", JSON.stringify({ captionStyle: "keyword", captionOffsetMs: 500 })],
      ["hotclip-brand", JSON.stringify({ activeId: "custom", presets: [{ id: "custom", name: "Test", style: { captionX: 0.7, captionY: 0.4 } }] })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => {},
      removeItem: () => {},
    });
    const React = (await import("react")).default;
    const { renderToString } = await import("react-dom/server");
    const { PreviewPane } = await import("../PreviewPane");
    const html = renderToString(React.createElement(PreviewPane, {
      filePath: null,
      durationSec: 90,
      seekSec: 1.75,
      onTime: () => {},
      onPrevCandidate: () => {},
      onNextCandidate: () => {},
      onEditTranscript: () => {},
      transcript: {
        language: "fr", engine: "test", durationSec: 90,
        segments: [
          { id: 7, startSec: 1, endSec: 2, text: "Bonjour les amis", words: [{ text: "Bonjour", startSec: 1, endSec: 1.4 }, { text: "les", startSec: 1.4, endSec: 1.6 }, { text: "amis", startSec: 1.6, endSec: 2 }] },
          { id: 8, startSec: 3, endSec: 4, text: "Une autre phrase", words: [] },
        ],
      },
    }));
    expect(html).toContain('data-preview-caption="7"');
    expect(html).toContain('data-caption-style="keyword"');
    expect(html).toContain("Bonjour les amis");
    expect(html).not.toContain('data-preview-caption="8"');
    expect(html).toContain("left:70%");
    expect(html).toContain("top:40%");
  });
});
