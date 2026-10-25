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
});
