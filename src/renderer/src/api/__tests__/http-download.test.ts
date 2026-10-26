import { describe, expect, it } from "vitest";
import { mediaDownloadUrl, mediaUrl } from "../http";

describe("téléchargement navigateur des clips exportés", () => {
  it("ajoute un vrai paramètre de requête sans modifier le chemin du fichier", () => {
    const path = "/exports/Clip final.mp4";
    const value = mediaDownloadUrl(path);
    const url = new URL(value, "http://viral-hit.local");
    expect(value).toBe("/api/media/view/download/%2Fexports%2FClip%20final.mp4?download=1");
    expect(url.searchParams.get("download")).toBe("1");
    expect(value).not.toContain("&download=1");
    expect(decodeURIComponent(url.pathname.split("/").at(-1) ?? "")).toBe(path);
  });

  it("conserve des vues distinctes pour la source et les deux couches verticales", () => {
    const source = mediaUrl("/source.mp4", "main");
    expect(mediaUrl("/source.mp4", "camera-live")).not.toBe(source);
    expect(mediaUrl("/source.mp4", "gameplay-live")).not.toBe(source);
  });
});
