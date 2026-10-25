import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { parseEnv } from "util";
import { userDataDir } from "../core/appenv";

/** Load the project's optional .env without overriding the real process env. */
export function loadLocalEnv(root = process.cwd()): void {
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  try {
    const values = parseEnv(readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    throw new Error(`Cannot parse .env: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function serverDataDir(): string {
  const configured = process.env.VIRALHIT_DATA_DIR?.trim();
  return configured ? resolve(configured) : userDataDir();
}

export function serverRoot(): string {
  return process.env.VIRALHIT_PROJECT_ROOT?.trim() ? resolve(process.env.VIRALHIT_PROJECT_ROOT.trim()) : resolve(__dirname, "../..");
}

export function defaultExportDir(): string {
  return join(serverDataDir(), "exports");
}

type PathSemantics = Pick<typeof import("path"), "relative" | "isAbsolute" | "sep">;
const nativePathSemantics: PathSemantics = { relative, isAbsolute, sep };

/** Containment without assuming POSIX separators (Windows uses backslashes). */
export function isPathInside(root: string, candidate: string, paths: PathSemantics = nativePathSemantics): boolean {
  const child = paths.relative(root, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${paths.sep}`) && !paths.isAbsolute(child));
}

export function assertInside(root: string, candidate: string): string {
  if (!isAbsolute(candidate)) throw new Error("An absolute local path is required");
  const normalizedRoot = resolve(root);
  const normalized = resolve(candidate);
  if (!isPathInside(normalizedRoot, normalized)) {
    throw new Error("This browser session only accesses files inside the Viral Hit data directory");
  }
  return normalized;
}

export function runtimeTempDir(): string {
  return join(process.env.TMPDIR ?? (process.platform === "win32" ? homedir() : "/tmp"), "viral-hit");
}
