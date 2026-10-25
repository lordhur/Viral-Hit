import { describe, expect, it } from "vitest";
import { checksumForAsset, parseYtDlpProgress, validateMediaUrl, ytDlpAsset } from "../url-import";
import { localizeErrorMessage, localizeUrlImportError } from "../../shared/french-errors";

describe("URL source validation", () => {
  it("accepts ordinary HTTP(S) video pages and normalizes them", () => {
    expect(validateMediaUrl(" https://www.youtube.com/watch?v=abc ")).toBe("https://www.youtube.com/watch?v=abc");
    expect(validateMediaUrl("http://www.bilibili.com/video/BV1xx")).toBe("http://www.bilibili.com/video/BV1xx");
  });

  it.each([
    "file:///tmp/video.mp4",
    "ftp://example.com/video.mp4",
    "https://user:pass@example.com/video",
    "http://localhost:8080/video.mp4",
    "http://127.0.0.1/video.mp4",
    "http://10.0.0.8/video.mp4",
    "http://172.16.2.3/video.mp4",
    "http://192.168.1.2/video.mp4",
    "http://[::1]/video.mp4",
    "http://device.local/video.mp4",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => validateMediaUrl(url)).toThrow();
  });
});


describe("causes d’import URL localisées", () => {
  it.each([
    ["ftp://example.com/video.mp4", "url:http-required", "http://"],
    ["https://user:pass@example.com/video", "url:credentials", "identifiants"],
    ["http://127.0.0.1/video.mp4", "url:local", "adresses locales ou privées"],
  ])("conserve le code et la cause française pour %s", (url, code, expected) => {
    const validate = (): string => validateMediaUrl(url);
    expect(validate).toThrow(code);
    try { validate(); } catch (error) { expect(localizeErrorMessage(error)).toContain(expected); }
  });

  it("distingue plateforme, intégrité du composant et média récupéré", () => {
    expect(localizeErrorMessage("url:unsupported-platform freebsd/x64")).toContain("pas disponible sur cette plateforme");
    expect(localizeErrorMessage("url:tool-integrity checksum missing")).toContain("vérification d’intégrité");
    expect(localizeErrorMessage("url:invalid-download empty media file")).toContain("flux audio ou vidéo");
  });

  it("distingue le réseau, une indisponibilité et un détail inconnu", () => {
    expect(localizeErrorMessage("url:download ERROR: getaddrinfo ENOTFOUND example.com")).toContain("Impossible de joindre le site");
    expect(localizeErrorMessage("url:download ERROR: HTTP Error 503")).toContain("temporairement indisponible");
    const fallback = localizeUrlImportError("Unexpected native failure");
    expect(fallback).toContain("import de cette URL");
    expect(fallback).not.toContain("Unexpected");
  });
});

describe("yt-dlp release assets", () => {
  it("selects self-contained binaries for supported desktop targets", () => {
    expect(ytDlpAsset("darwin", "arm64")).toBe("yt-dlp_macos");
    expect(ytDlpAsset("win32", "x64")).toBe("yt-dlp.exe");
    expect(ytDlpAsset("linux", "x64")).toBe("yt-dlp_linux");
    expect(ytDlpAsset("linux", "arm64")).toBe("yt-dlp_linux_aarch64");
    expect(() => ytDlpAsset("freebsd", "x64")).toThrow(/url:unsupported-platform/);
  });

  it("reads an exact asset hash from the official checksum manifest", () => {
    const hash = "a".repeat(64);
    expect(checksumForAsset(`${"b".repeat(64)}  yt-dlp\n${hash} *yt-dlp_macos\n`, "yt-dlp_macos")).toBe(hash);
    expect(() => checksumForAsset(`${hash}  yt-dlp\n`, "yt-dlp.exe")).toThrow(/missing/);
  });
});

describe("yt-dlp progress protocol", () => {
  it("parses machine-readable byte progress without locale dependence", () => {
    expect(parseYtDlpProgress("hotclip-progress: 42.5%|425|1000|250|3")).toEqual({
      stage: "downloading-media",
      fraction: 0.425,
      downloadedBytes: 425,
      totalBytes: 1000,
      speedBytesPerSec: 250,
      etaSec: 3,
    });
    expect(parseYtDlpProgress("[download] resolving formats")).toBeNull();
  });
});
