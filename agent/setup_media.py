"""Install a modern optional FFmpeg binary into the ignored local media cache."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / ".cache" / "media-python"
VERSION = "0.6.0"


def cached_ffmpeg() -> Path | None:
    directory = TARGET / "imageio_ffmpeg" / "binaries"
    for candidate in sorted(directory.glob("ffmpeg-*"), reverse=True) if directory.is_dir() else []:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def main() -> int:
    TARGET.mkdir(parents=True, exist_ok=True)
    existing = cached_ffmpeg()
    if existing and (TARGET / f"imageio_ffmpeg-{VERSION}.dist-info").is_dir():
        print(f"FFmpeg already present; download skipped: {existing}")
        return 0
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--upgrade", "--only-binary=:all:", "--no-deps", "--target", str(TARGET), f"imageio-ffmpeg=={VERSION}"],
        cwd=ROOT,
        check=True,
    )
    from agent.media import bundled_binaries

    bundled_binaries.cache_clear()
    ffmpeg = bundled_binaries().get("ffmpeg")
    if not ffmpeg or not os.access(ffmpeg, os.X_OK):
        raise RuntimeError("imageio-ffmpeg installed without a usable platform binary")
    print(ffmpeg)
    subprocess.run([ffmpeg, "-version"], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
