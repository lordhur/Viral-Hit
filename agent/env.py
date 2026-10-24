"""Minimal .env loader for the standalone CLI (no third-party dependency)."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
from typing import MutableMapping


_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"{path}:{number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        if not _KEY.fullmatch(key):
            raise ValueError(f"{path}:{number}: invalid environment variable name")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            try:
                value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{number}: invalid double-quoted value") from exc
        elif len(value) >= 2 and value[0] == value[-1] == "'":
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        values[key] = value
    return values


def load_local_env(environ: MutableMapping[str, str] | None = None, path: Path | None = None) -> None:
    """Load only missing keys; real shell environment always has priority."""
    target = os.environ if environ is None else environ
    file = path or Path(__file__).resolve().parents[1] / ".env"
    if not file.is_file():
        return
    for key, value in read_env_file(file).items():
        if key not in target:
            target[key] = value
