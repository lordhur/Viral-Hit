import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("correction visible des sous-titres", () => {
  it("affiche les crayons et de vrais contrôles Enregistrer / Annuler", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "viral-hit-locale" ? "fr" : null,
      setItem: () => {}, removeItem: () => {},
    });
    const React = (await import("react")).default;
    const { renderToString } = await import("react-dom/server");
    const { TranscriptPanel } = await import("../TranscriptPanel");
    const { TranscriptTextEditor } = await import("../../TranscriptTextEditor");
    const transcript = {
      language: "fr", engine: "whisper-fr", durationSec: 4,
      segments: [{ id: 1, startSec: 0, endSec: 4, text: "Bonjour les amis", words: [] }],
    };
    const panel = renderToString(React.createElement(TranscriptPanel, {
      transcript, onSeek: () => {}, onAudition: () => {}, onPick: () => {},
    }));
    expect(panel).toContain('aria-label="Modifier cette phrase"');
    expect(panel).toContain("Cliquez sur le crayon");

    const editor = renderToString(React.createElement(TranscriptTextEditor, {
      initialText: "Bonjour les amis", onSave: () => {}, onCancel: () => {},
    }));
    expect(editor).toContain("<textarea");
    expect(editor).toContain("Enregistrer");
    expect(editor).toContain("Annuler");
    expect(editor).toContain("Ctrl+Entrée");
  });
});
