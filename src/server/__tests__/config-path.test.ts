import { describe, expect, it } from "vitest";
import { posix, win32 } from "path";
import { isPathInside } from "../config";

describe("server path containment", () => {
  it("accepts Windows static files with native backslashes", () => {
    const root = "C:\\Users\\User\\AppData\\Local\\Programs\\ViralHit\\dist\\renderer";
    expect(isPathInside(root, win32.resolve(root, "index.html"), win32)).toBe(true);
    expect(isPathInside(root, win32.resolve(root, "assets", "index.js"), win32)).toBe(true);
  });

  it("rejects Windows traversal, sibling prefixes and other drives", () => {
    const root = "C:\\ViralHit\\dist\\renderer";
    expect(isPathInside(root, win32.resolve(root, "..", "secret.txt"), win32)).toBe(false);
    expect(isPathInside(root, "C:\\ViralHit\\dist\\renderer-private\\secret.txt", win32)).toBe(false);
    expect(isPathInside(root, "D:\\secret.txt", win32)).toBe(false);
  });

  it("keeps POSIX containment behavior", () => {
    const root = "/opt/viral-hit/dist/renderer";
    expect(isPathInside(root, posix.resolve(root, "index.html"), posix)).toBe(true);
    expect(isPathInside(root, posix.resolve(root, "..", "secret.txt"), posix)).toBe(false);
    expect(isPathInside(root, "/opt/viral-hit/dist/renderer-private/file", posix)).toBe(false);
  });
});
