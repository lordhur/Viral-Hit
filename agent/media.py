"""Share packaged FFmpeg binaries with the Python recap toolchain."""

from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Mapping


REPO_ROOT = Path(__file__).resolve().parents[1]
NODE_SCRIPT = r"""
const out = {};
try { out.ffmpeg = require("ffmpeg-static"); } catch {}
try { out.legacyFfmpeg = require("@ffmpeg-installer/ffmpeg").path; } catch {}
try { out.ffprobe = require("@ffprobe-installer/ffprobe").path; } catch {}
console.log(JSON.stringify(out));
"""


def _executable(path: str | Path | None) -> str | None:
    if not path:
        return None
    candidate = Path(path)
    return str(candidate) if candidate.is_file() and os.access(candidate, os.X_OK) else None


@lru_cache(maxsize=1)
def bundled_binaries() -> dict[str, str]:
    binaries: dict[str, str] = {}
    values: dict[str, object] = {}
    node = shutil.which("node")
    if node:
        try:
            result = subprocess.run([node, "-e", NODE_SCRIPT], cwd=REPO_ROOT, text=True, capture_output=True, timeout=12, check=False)
            parsed = json.loads(result.stdout) if result.returncode == 0 else {}
            values = parsed if isinstance(parsed, dict) else {}
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
            values = {}
        for name in ("ffmpeg", "ffprobe"):
            path = _executable(values.get(name))
            if path:
                binaries[name] = path
    if "ffmpeg" not in binaries:
        cache = REPO_ROOT / ".cache" / "media-python" / "imageio_ffmpeg" / "binaries"
        candidates = sorted(cache.glob("ffmpeg-*"), reverse=True) if cache.is_dir() else []
        for candidate in candidates:
            path = _executable(candidate)
            if path:
                binaries["ffmpeg"] = path
                break
    if "ffmpeg" not in binaries:
        legacy = _executable(values.get("legacyFfmpeg"))
        if legacy:
            binaries["ffmpeg"] = legacy
    return binaries


def media_environment(base: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return a child-process env; never mutate the parent's global environment."""
    env = dict(os.environ if base is None else base)
    binaries = bundled_binaries()
    ffmpeg = env.get("VIRALHIT_FFMPEG") or env.get("FFMPEG_PATH") or env.get("FFMPEG_BINARY") or binaries.get("ffmpeg")
    ffprobe = env.get("VIRALHIT_FFPROBE") or env.get("FFPROBE_PATH") or env.get("FFPROBE_BINARY") or binaries.get("ffprobe")
    if ffmpeg:
        env["FFMPEG_BINARY"] = ffmpeg
    if ffprobe:
        env["FFPROBE_BINARY"] = ffprobe
    directories = list(dict.fromkeys(str(Path(path).parent) for path in (ffmpeg, ffprobe) if path))
    if directories:
        env["PATH"] = os.pathsep.join([*directories, env.get("PATH", "")])
    return env
