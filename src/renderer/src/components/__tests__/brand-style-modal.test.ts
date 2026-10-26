import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("../ui", () => ({ ModalShell: ({ children }: { children: ReactNode }) => children }));
afterEach(() => vi.unstubAllGlobals());

describe("subtitle style and position dialog", () => {
  it("shows free output positioning and timing without a clip-title preview", async () => {
    vi.resetModules();
    const values = new Map<string, string>([
      ["hotclip-brand", JSON.stringify({ activeId: "custom", presets: [{ id: "custom", name: "Test", style: { captionX: 0.7, captionY: 0.4 } }] })],
      ["hotclip-render-prefs", JSON.stringify({ captionOffsetMs: 250 })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    const React = (await import("react")).default;
    const { renderToString } = await import("react-dom/server");
    const { BrandStyleModal } = await import("../BrandStyleModal");
    const html = renderToString(React.createElement(BrandStyleModal, { onClose: () => {} }));
    expect(html).toContain("Caption style");
    expect(html).toContain("left:70%");
    expect(html).toContain("top:40%");
    expect(html).toContain('id="caption-offset"');
    expect(html).toContain('value="250"');
    expect(html).not.toContain("AI title card");
  });
});
