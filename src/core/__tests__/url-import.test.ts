import { createHash } from "crypto";
import { mkdtemp, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { checksumForAsset, importMediaUrl, parseYtDlpProgress, resolveImportedMediaPath, validateMediaUrl, ytDlpAsset } from "../url-import";
import { localizeErrorMessage, localizeUrlImportError } from "../../shared/french-errors";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

describe("résolution du fichier final yt-dlp", () => {
  async function fixture(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "viral-hit-url-import-"));
    tempDirs.push(dir);
    return dir;
  }

  it("résout un chemin relatif dans le dossier d’import, pas dans le cwd", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "Twitch [abc123].mp4"), "media");
    await expect(resolveImportedMediaPath(["Twitch [abc123].mp4"], dir)).resolves.toBe(resolve(dir, "Twitch [abc123].mp4"));
  });

  it("retrouve le fichier muxé quand le chemin après téléchargement est obsolète", async () => {
    const dir = await fixture();
    const finalPath = join(dir, "Titre renommé [twitch-42].mp4");
    await writeFile(finalPath, "merged media");
    await writeFile(join(dir, "ancien [autre].mp4"), "old media");
    const old = new Date(Date.now() - 60_000);
    await utimes(join(dir, "ancien [autre].mp4"), old, old);
    await expect(resolveImportedMediaPath([join(dir, "fragment supprimé [twitch-42].mkv")], dir, Date.now() - 1000))
      .resolves.toBe(finalPath);
  });

  it("retrouve aussi le média frais si yt-dlp n’imprime aucun chemin final", async () => {
    const dir = await fixture();
    const finalPath = join(dir, "VOD Twitch.mp4");
    await writeFile(finalPath, "fresh media");
    await expect(resolveImportedMediaPath([], dir, Date.now() - 1000)).resolves.toBe(finalPath);
  });

  it("n’utilise jamais un ancien fichier sans identifiant correspondant", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "ancien.mp4"), "old media");
    const old = new Date(Date.now() - 60_000);
    await utimes(join(dir, "ancien.mp4"), old, old);
    await expect(resolveImportedMediaPath(["disparu.mp4"], dir, Date.now() - 1000)).rejects.toThrow("url:invalid-download");
  });

  it("refuse qu’un chemin rapporté sorte du stockage géré", async () => {
    const dir = await fixture();
    await expect(resolveImportedMediaPath(["../outside.mp4"], dir)).rejects.toThrow("url:invalid-download");
  });
});

describe("import yt-dlp complet", () => {
  it.skipIf(process.platform === "win32")("récupère le MP4 réel après un chemin Twitch obsolète", async () => {
    const dir = await mkdtemp(join(tmpdir(), "viral-hit-url-e2e-"));
    tempDirs.push(dir);
    const script = [
      "#!/bin/sh",
      "out=''",
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "--output" ]; then shift; out=$1; fi',
      "  shift",
      "done",
      "dest=${out%/*}",
      'final="$dest/Twitch final [clip42].mp4"',
      'printf "merged media" > "$final"',
      'printf "[Merger] Merging formats\\n"',
      'printf "hotclip-result:%s/obsolete [clip42].mkv\\n" "$dest"',
    ].join("\n");
    const asset = ytDlpAsset();
    const checksum = createHash("sha256").update(script).digest("hex");
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/SHA2-256SUMS")) return new Response(`${checksum}  ${asset}\n`);
      if (url.endsWith(`/${asset}`)) return new Response(script);
      throw new Error(`Unexpected fake tool URL: ${url}`);
    };
    const stages: string[] = [];
    const result = await importMediaUrl("https://www.twitch.tv/example/clip/clip42", {
      toolsDir: join(dir, "tools"),
      destDir: join(dir, "imports"),
      fetchImpl: fetchImpl as typeof fetch,
      onProgress: (event) => stages.push(event.stage),
    });
    expect(result.filePath).toBe(resolve(dir, "imports", "Twitch final [clip42].mp4"));
    expect(stages).toContain("merging");
    expect(stages.at(-1)).toBe("done");
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
