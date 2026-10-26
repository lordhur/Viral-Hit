"""Viral Hit unified command line: clipping, narrated recaps and diagnostics."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any, Sequence

from .env import load_local_env
from .media import media_environment
from .providers import LLMConfig, ProviderError, config_from_env
from .recap import RecapAgent, RecapAgentError, RecapOptions, produce_recap


APP_NAME = "viral-hit"


def _default_work_dir(video: Path) -> Path:
    root = Path(os.environ.get("VIRALHIT_DATA_DIR", Path.home() / ".local" / "share" / "viral-hit"))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe_stem = "".join(char if char.isalnum() or char in "-_" else "-" for char in video.stem)[:60] or "video"
    return root / "runs" / f"{stamp}-{safe_stem}"


def _clip_environment(config: LLMConfig) -> dict[str, str]:
    env = os.environ.copy()
    base_url = config.base_url
    if config.provider == "gemini" and "generativelanguage.googleapis.com" in base_url and "/openai" not in base_url:
        base_url = f"{base_url}/openai"
    env["VIRALHIT_LLM_PROVIDER"] = config.provider
    env["VIRALHIT_LLM_BASE_URL"] = base_url
    env["VIRALHIT_LLM_MODEL"] = config.model
    env["VIRALHIT_LLM_API_KEY"] = config.api_key
    # Backward-compatible bridge into the imported clipping core.
    env["HOTCLIP_LLM_BASE_URL"] = base_url
    env["HOTCLIP_LLM_MODEL"] = config.model
    env["HOTCLIP_LLM_API_KEY"] = config.api_key
    return env


def _pnpm_command() -> list[str]:
    executable = shutil.which("pnpm")
    if executable:
        return [executable]
    corepack = shutil.which("corepack")
    if corepack:
        return [corepack, "pnpm"]
    raise ProviderError("pnpm is required (install Node.js with Corepack, then run: corepack pnpm install)")


def run_clip(args: argparse.Namespace) -> dict[str, Any]:
    video = Path(args.video).expanduser().resolve()
    if not video.is_file():
        raise RecapAgentError(f"Source video is not readable: {video}")
    config = config_from_env()
    command = [*_pnpm_command(), "cli", "clip", str(video), "--json", "--max-clips", str(args.max_clips)]
    if args.out:
        command += ["--out", str(Path(args.out).expanduser().resolve())]
    if args.reference:
        command += ["--reference", str(Path(args.reference).expanduser().resolve())]
    if not args.vertical:
        command.append("--no-vertical")
    if not args.captions:
        command.append("--no-captions")
    if args.subtitles:
        command += ["--subtitles", str(Path(args.subtitles).expanduser().resolve())]
    if args.auto_enhance:
        command.append("--auto-enhance")
    if args.denoise:
        command.append("--smart-denoise" if args.denoise == "smart" else "--denoise")
    result = subprocess.run(command, cwd=Path(__file__).resolve().parents[1], env=media_environment(_clip_environment(config)), text=True, capture_output=True, check=False)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if result.returncode != 0:
        raise RecapAgentError(f"Clipping failed with exit code {result.returncode}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"status": "completed", "output": result.stdout.strip()}


def _doctor(*, as_json: bool) -> int:
    checks: list[dict[str, Any]] = []
    child_env = media_environment()
    for name in ("node", "ffmpeg", "ffprobe", "python3"):
        configured = child_env.get(f"{name.upper()}_BINARY")
        path = configured if configured and os.path.isfile(configured) and os.access(configured, os.X_OK) else shutil.which(name, path=child_env.get("PATH"))
        checks.append({"name": name, "ok": bool(path), "detail": path or "not found in configured binaries or PATH"})
    pnpm = shutil.which("pnpm") or shutil.which("corepack")
    checks.append({"name": "pnpm/corepack", "ok": bool(pnpm), "detail": pnpm or "not found"})
    checks.append({"name": "recap skills", "ok": (Path(__file__).resolve().parents[1] / "recap" / "skills" / "video-recap" / "scripts" / "recap.py").is_file(), "detail": "bundled"})
    try:
        config = config_from_env(require_model=False)
        llm = {"ok": bool(config.model), "provider": config.provider, "model": config.model or "not configured", "base_url": config.base_url, "api_key": "configured" if config.api_key else "not configured"}
    except ProviderError as exc:
        llm = {"ok": False, "detail": str(exc)}
    checks.append({"name": "creative LLM", **llm})
    checks.append({"name": "MiMo media understanding", "ok": bool(os.environ.get("MIMO_API_KEY")), "detail": "MIMO_API_KEY configured" if os.environ.get("MIMO_API_KEY") else "required for the default recap ASR/VLM path; --skip-asr is available"})
    report = {"name": APP_NAME, "ok": all(item["ok"] for item in checks if item["name"] not in {"creative LLM", "MiMo media understanding"}), "checks": checks}
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("Viral Hit — local environment check")
        for item in checks:
            print(f"{'✓' if item['ok'] else '○'} {item['name']}: {item.get('detail') or item.get('model') or item.get('provider')}")
        print("\nNo credential values are displayed. Configure models in .env or your shell; see .env.example.")
    return 0 if report["ok"] else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog=APP_NAME, description="Local-first agent for viral clips and narrated video recaps")
    parser.add_argument("--version", action="version", version="%(prog)s 0.1.0")
    sub = parser.add_subparsers(dest="command", required=True)

    clip = sub.add_parser("clip", help="transcribe, find highlights, render and QC short clips")
    clip.add_argument("video")
    clip.add_argument("--max-clips", type=int, default=6, choices=range(1, 13), metavar="1..12")
    clip.add_argument("--out")
    clip.add_argument("--reference", help="optional viral reference video")
    clip.add_argument("--subtitles", help="existing UTF-8 SRT or WebVTT; skips ASR")
    clip.add_argument("--no-vertical", dest="vertical", action="store_false", default=True)
    clip.add_argument("--no-captions", dest="captions", action="store_false", default=True)
    clip.add_argument("--auto-enhance", action="store_true")
    clip.add_argument("--denoise", choices=("basic", "smart"))

    recap = sub.add_parser("recap", help="autonomously plan, narrate, assemble and QC a video recap")
    recap.add_argument("videos", nargs="+")
    recap.add_argument("--work-dir", help="resumable run directory (default: local Viral Hit data dir)")
    recap.add_argument("--edit-mode", choices=("full", "cut", "dub"), default="full")
    recap.add_argument("--audio-mode", choices=("narration", "source-mix", "adopted-packet-copy"), default="narration")
    recap.add_argument("--style", default="documentary", help="free-form creative guidance")
    recap.add_argument("--language", default="fr", help="language for narration and creative artefacts")
    recap.add_argument("--context", default="")
    recap.add_argument("--target-duration", default="", help="examples: 60s, 90s, 10m")
    recap.add_argument("--output-dir")
    recap.add_argument("--skip-asr", action="store_true")
    recap.add_argument("--burn-subtitles", action=argparse.BooleanOptionalAction, default=None)
    recap.add_argument("--require-final-qc", action=argparse.BooleanOptionalAction, default=True)
    recap.add_argument("--confirm-voice-rights", action="store_true", help="required for dub; confirms media and speaker-cloning rights")
    recap.add_argument("--max-repairs", type=int, default=2, choices=range(0, 4), metavar="0..3")

    doctor = sub.add_parser("doctor", help="check local binaries and non-secret provider status")
    doctor.add_argument("--json", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    load_local_env()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "doctor":
            return _doctor(as_json=args.json)
        if args.command == "clip":
            run_clip(args)
            return 0
        if args.command == "recap":
            videos = tuple(Path(value).expanduser().resolve() for value in args.videos)
            work_dir = Path(args.work_dir).expanduser().resolve() if args.work_dir else _default_work_dir(videos[0])
            options = RecapOptions(
                videos=videos,
                work_dir=work_dir,
                edit_mode=args.edit_mode,
                audio_mode=args.audio_mode,
                style=args.style,
                language=args.language,
                context=args.context,
                target_duration=args.target_duration,
                output_dir=Path(args.output_dir).expanduser().resolve() if args.output_dir else None,
                skip_asr=args.skip_asr,
                burn_subtitles=args.burn_subtitles,
                require_final_qc=args.require_final_qc,
                confirm_voice_rights=args.confirm_voice_rights,
                max_repairs=args.max_repairs,
            )
            config = config_from_env()
            receipt = RecapAgent(config).produce(options)
            print(json.dumps(receipt.public, ensure_ascii=False, indent=2))
            for warning in receipt.warnings:
                print(f"Warning: {warning}", file=sys.stderr)
            return 0
        parser.error("unknown command")
    except (ProviderError, RecapAgentError, OSError) as exc:
        print(f"viral-hit: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
