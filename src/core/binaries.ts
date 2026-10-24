import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

/**
 * Bundled binary resolution (ffmpeg / ffprobe).
 * Explicit environment paths win, then modern npm/cached binaries, then PATH.
 * Packaged desktop apps rewrite asar paths to their unpacked twin.
 */

/** Rewrite an asar-internal path to its unpacked twin (no-op outside asar). Pure. */
export function toUnpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

function usable(path: string | null | undefined): path is string {
  return Boolean(path && (path === "ffmpeg" || path === "ffprobe" || existsSync(toUnpackedPath(path))));
}

function imageioFfmpeg(): string | null {
  const roots = [process.env.VIRALHIT_PROJECT_ROOT, process.cwd()].filter((root): root is string => Boolean(root));
  for (const root of roots) {
    const directory = join(resolve(root), ".cache", "media-python", "imageio_ffmpeg", "binaries");
    try {
      const binary = readdirSync(directory)
        .filter((name) => /^ffmpeg-.+(?:\.exe)?$/i.test(name))
        .sort()
        .reverse()
        .map((name) => join(directory, name))
        .find((path) => existsSync(path));
      if (binary) return binary;
    } catch { /* optional local media cache */ }
  }
  return null;
}

/** Resolve ffmpeg without trusting a package postinstall to have succeeded. */
export function resolveFfmpegPath(): string {
  const explicit = process.env.VIRALHIT_FFMPEG || process.env.FFMPEG_PATH;
  if (usable(explicit)) return toUnpackedPath(explicit);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modern = require("ffmpeg-static") as string | null;
    if (usable(modern)) return toUnpackedPath(modern!);
  } catch { /* optional package/platform */ }
  const cached = imageioFfmpeg();
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require("@ffmpeg-installer/ffmpeg") as { path?: string };
    if (usable(installer.path)) return toUnpackedPath(installer.path!);
  } catch { /* optional package/platform */ }
  return "ffmpeg";
}

/** Resolve ffprobe with the same explicit/bundled/PATH precedence. */
export function resolveFfprobePath(): string {
  const explicit = process.env.VIRALHIT_FFPROBE || process.env.FFPROBE_PATH;
  if (usable(explicit)) return toUnpackedPath(explicit);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { path } = require("@ffprobe-installer/ffprobe") as { path: string };
    if (usable(path)) return toUnpackedPath(path);
  } catch { /* optional package/platform */ }
  return "ffprobe";
}
