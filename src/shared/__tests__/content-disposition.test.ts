import { describe, expect, it } from "vitest";
import { attachmentContentDisposition } from "../content-disposition";

describe("nom de fichier au téléchargement", () => {
  it("conserve le nom UTF-8 tout en fournissant un fallback ASCII valide", () => {
    const header = attachmentContentDisposition("01-Œuvre 🎬.mp4");
    expect(header).toContain("attachment;");
    expect(header).toContain("filename*=UTF-8''01-%C5%92uvre%20%F0%9F%8E%AC.mp4");
    expect(header).not.toContain("🎬");
    expect(header).not.toContain("Œ");
    expect(header).toMatch(/^[\x20-\x7e]+$/);
  });

  it("neutralise les sauts de ligne et les guillemets", () => {
    const header = attachmentContentDisposition("clip\"\r\n injected.mp4");
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("clip_");
    expect(header).toContain("injected.mp4");
  });
});
