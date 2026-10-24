"""Autonomous, evidence-bound orchestration of the bundled Video Recap skills.

The upstream skills deliberately pause so a coding agent can make creative decisions.
This module fills those pauses with a structured LLM planner, writes auditable JSON,
and resumes the same deterministic pipeline. It never manufactures media timestamps:
every proposed cut or narration window must come from the local evidence bundle and is
still validated by the downstream skills.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
from typing import Any, Callable, Mapping, Sequence

from .media import media_environment
from .providers import LLMConfig, ProviderError, complete_json, config_from_env


REPO_ROOT = Path(__file__).resolve().parents[1]
RECAP_ENTRY = REPO_ROOT / "recap" / "skills" / "video-recap" / "scripts" / "recap.py"
MAX_EVIDENCE_CHARS = 180_000


class RecapAgentError(RuntimeError):
    pass


@dataclass(frozen=True)
class RecapOptions:
    videos: tuple[Path, ...]
    work_dir: Path
    edit_mode: str = "full"
    audio_mode: str = "narration"
    style: str = "documentary"
    language: str = "fr"
    context: str = ""
    target_duration: str = ""
    output_dir: Path | None = None
    skip_asr: bool = False
    burn_subtitles: bool | None = None
    require_final_qc: bool = True
    confirm_voice_rights: bool = False
    max_repairs: int = 2


@dataclass(frozen=True)
class RecapReceipt:
    work_dir: Path
    final_output: Path | None
    status: str
    phases: tuple[str, ...]
    warnings: tuple[str, ...]

    @property
    def public(self) -> dict[str, Any]:
        return {
            "work_dir": str(self.work_dir),
            "final_output": str(self.final_output) if self.final_output else None,
            "status": self.status,
            "phases": list(self.phases),
            "warnings": list(self.warnings),
        }


def _read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def _evidence(work_dir: Path, names: Sequence[str]) -> str:
    """Load bounded local evidence without sending binary media to the planner."""
    sections: list[str] = []
    remaining = MAX_EVIDENCE_CHARS
    for name in names:
        path = work_dir / name
        if not path.is_file() or remaining <= 0:
            continue
        if path.suffix.lower() == ".json":
            value = _read_json(path)
            text = json.dumps(value, ensure_ascii=False, separators=(",", ":")) if value is not None else ""
        else:
            text = path.read_text(encoding="utf-8", errors="replace")
        if not text:
            continue
        chunk = text[:remaining]
        if len(chunk) < len(text):
            chunk += "\n[Evidence truncated locally at the safety limit; use earlier chunks and available timing anchors.]"
        sections.append(f"\n--- {name} ---\n{chunk}")
        remaining -= len(chunk)
    if not sections:
        raise RecapAgentError(f"No readable evidence bundle was produced in {work_dir}")
    return "".join(sections)


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not float(value) >= 0:
        raise RecapAgentError(f"Invalid {label}: expected a non-negative finite number")
    result = float(value)
    if result == float("inf") or result != result:
        raise RecapAgentError(f"Invalid {label}: expected a finite number")
    return result


def validate_narration(value: Any) -> list[dict[str, Any]]:
    """Validate shape/order before spending any TTS credits; timing gates run again later."""
    if not isinstance(value, list) or not value:
        raise RecapAgentError("The planner must return a non-empty narration array")
    clean: list[dict[str, Any]] = []
    previous_end = -1.0
    for index, row in enumerate(value[:500]):
        if not isinstance(row, dict):
            raise RecapAgentError(f"Narration row {index + 1} is not an object")
        start = _number(row.get("start"), f"narration[{index}].start")
        end = _number(row.get("end"), f"narration[{index}].end")
        text = str(row.get("narration", "")).strip()
        if end <= start:
            raise RecapAgentError(f"Narration row {index + 1} has end <= start")
        if start < previous_end:
            raise RecapAgentError(f"Narration row {index + 1} overlaps or is out of order")
        if not text or len(text) > 3000:
            raise RecapAgentError(f"Narration row {index + 1} has invalid text length")
        # The bundled readability gate reserves em dashes as a hard blocker.
        text = re.sub(r"\s*—+\s*", ", ", text)
        text = re.sub(r"\s*–\s*", " - ", text)
        text = re.sub(r"[ \t]{2,}", " ", text).strip(" ,")
        item: dict[str, Any] = {
            "start": round(start, 3),
            "end": round(end, 3),
            "narration": text,
            "pause_after_ms": max(0, min(5000, int(row.get("pause_after_ms", 250)))),
            "overlaps_speech": bool(row.get("overlaps_speech", True)),
        }
        if row.get("emotion"):
            item["emotion"] = str(row["emotion"])[:160]
        clean.append(item)
        previous_end = end
    return clean


def validate_clip_plan(value: Any, *, multi_source: bool, source_ids: set[str]) -> dict[str, Any]:
    rows = value.get("clips") if isinstance(value, dict) else value
    if not isinstance(rows, list) or not rows:
        raise RecapAgentError("The planner must return a non-empty clip_plan.clips array")
    clips: list[dict[str, Any]] = []
    for index, row in enumerate(rows[:200]):
        if not isinstance(row, dict):
            raise RecapAgentError(f"Clip row {index + 1} is not an object")
        start = _number(row.get("start"), f"clips[{index}].start")
        end = _number(row.get("end"), f"clips[{index}].end")
        if end <= start:
            raise RecapAgentError(f"Clip row {index + 1} has end <= start")
        clip: dict[str, Any] = {"start": round(start, 3), "end": round(end, 3), "reason": str(row.get("reason", "evidence-based story beat"))[:1000]}
        source_id = str(row.get("source_id", "")).strip()
        if multi_source:
            if source_id not in source_ids:
                raise RecapAgentError(f"Clip row {index + 1} needs a valid source_id from the source manifest")
            clip["source_id"] = source_id
        clips.append(clip)
    result: dict[str, Any] = {"clips": clips}
    if isinstance(value, dict) and value.get("target_duration"):
        result["target_duration"] = str(value["target_duration"])
    return result


SYSTEM_PROMPT = """You are the creative director inside Viral Hit, a local video-production agent.
Return ONLY JSON. Your job is to make auditable creative decisions from the supplied local evidence.
Hard rules:
- Never invent a timestamp, quotation, person, event, visual detail or source_id.
- Use only times and facts explicitly supported by the evidence. When uncertain, choose a safer shorter range or omit it.
- Do not cut through a spoken sentence. Prefer provided sentence/quiet boundary anchors.
- Narration uses the timeline requested in the prompt: SOURCE for full mode, OUTPUT after a cut.
- Keep complete thoughts and natural spoken sentences. No placeholders, Markdown, em dashes, hashtags or calls to invent facts.
- Give original audio, action and silence an intentional role; do not plaster narration over every moment.
- All creative text must be in the requested language, while JSON keys remain in English.
- The deterministic validator is authoritative: your output is a draft, not permission to bypass its gates.
"""


class CreativePlanner:
    def __init__(self, config: LLMConfig):
        self.config = config

    def _request(self, instruction: str, evidence: str) -> dict[str, Any]:
        result = complete_json(self.config, SYSTEM_PROMPT, f"{instruction}\n\nLOCAL EVIDENCE:\n{evidence}", max_tokens=12_000)
        if not isinstance(result, dict):
            raise RecapAgentError("The creative planner must return a JSON object")
        return result

    def plan_full(self, work_dir: Path, options: RecapOptions) -> dict[str, Any]:
        evidence = _evidence(work_dir, (
            "agent_narration_brief.md", "timeline_fusion.json", "asr_writing_chunks.json",
            "speech_boundary_anchors.json", "silence_periods.json", "background_research.json",
        ))
        instruction = f"""Create the full-mode narration package in {options.language}.
Style guidance (verbatim): {options.style}
Additional user context: {options.context or 'none'}
Return an object with:
- narration: array of {{start,end,narration,pause_after_ms,overlaps_speech,emotion}} in SOURCE seconds;
- story_plan: an object following director_intent/beats principles;
- visual_audio_board: an object describing picture/audio ownership;
- style_card: an object capturing voice, pacing and evidence intent;
- packaging_plan: an object with title, viewer_promise, first_line and selling_points.
Narration windows must fit the evidence's safe timing windows and text budgets. Do not output source code."""
        result = self._request(instruction, evidence)
        result["narration"] = validate_narration(result.get("narration"))
        return result

    def plan_cut(self, work_dir: Path, options: RecapOptions, source_ids: set[str]) -> dict[str, Any]:
        evidence = _evidence(work_dir, (
            "agent_narration_brief.md", "multi_source_manifest.json", "multi_source_clip_brief.md",
            "timeline_fusion.json", "asr_writing_chunks.json", "speech_boundary_anchors.json",
            "silence_periods.json", "background_research.json",
        ))
        # Multi-source briefs live in per-source directories; add their evidence explicitly.
        if source_ids:
            source_sections = []
            for source_id in sorted(source_ids):
                source_dir = work_dir / "sources" / source_id
                if source_dir.is_dir():
                    source_sections.append(_evidence(source_dir, ("agent_narration_brief.md", "timeline_fusion.json", "speech_boundary_anchors.json")))
            evidence += "\n" + "\n".join(source_sections)[:MAX_EVIDENCE_CHARS]
        instruction = f"""Create the first-pass CUT plan in {options.language}.
Style guidance (verbatim): {options.style}
Additional user context: {options.context or 'none'}
Target duration: {options.target_duration or 'choose the shortest coherent duration supported by evidence'}
Valid source_ids: {sorted(source_ids) if source_ids else 'single source; omit source_id'}
Return an object with:
- clip_plan: {{target_duration, clips:[{{start,end,reason,source_id?}}]}} in SOURCE seconds;
- story_plan: director intent, selected hypothesis and change-based beats;
- visual_audio_board: initial picture/audio decisions for those beats;
- style_card: voice, pacing and evidence intent.
Every clip must correspond to concrete evidence and safe boundaries. Preserve reactions and complete audio anchors, not just isolated quotes."""
        result = self._request(instruction, evidence)
        result["clip_plan"] = validate_clip_plan(result.get("clip_plan"), multi_source=bool(source_ids), source_ids=source_ids)
        if options.target_duration:
            result["clip_plan"]["target_duration"] = options.target_duration
        return result

    def plan_cut_narration(self, work_dir: Path, options: RecapOptions) -> dict[str, Any]:
        evidence = _evidence(work_dir, (
            "agent_narration_brief.md", "multi_source_output_brief.md", "clip_plan_validated.json",
            "timeline_fusion.json", "asr_writing_chunks.json", "speech_boundary_anchors_output.json",
            "edit-map.json", "recap_story_plan.json", "visual_audio_board.json", "style_card.json",
        ))
        instruction = f"""The picture is now cut. Write second-pass narration in {options.language} using OUTPUT seconds only.
Style guidance (verbatim): {options.style}
Return an object with narration (same array contract), plus updated visual_audio_board and packaging_plan.
Respect output-time speech anchors and quiet windows. Leave important original dialogue untouched. Do not reuse SOURCE timestamps as OUTPUT timestamps."""
        result = self._request(instruction, evidence)
        result["narration"] = validate_narration(result.get("narration"))
        return result

    def repair_narration(self, work_dir: Path, options: RecapOptions, report: Any) -> list[dict[str, Any]]:
        evidence = _evidence(work_dir, (
            "narration.json", "narration_lint.json", "agent_narration_brief.md",
            "speech_boundary_anchors_output.json", "speech_boundary_anchors.json",
            "clip_plan_validated.json", "timeline_fusion.json",
        ))
        instruction = f"""Repair narration.json in {options.language}; do not change unaffected text unnecessarily.
The deterministic lint report is: {json.dumps(report, ensure_ascii=False)[:30000]}
Return one JSON object with a single narration array. Fix every error, including time bounds, overlap, sentence boundaries and text budgets. Keep the requested timeline."""
        result = self._request(instruction, evidence)
        return validate_narration(result.get("narration"))


class RecapAgent:
    def __init__(
        self,
        config: LLMConfig,
        *,
        planner: CreativePlanner | None = None,
        runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
    ):
        self.config = config
        self.planner = planner or CreativePlanner(config)
        self.runner = runner or subprocess.run

    def _command(self, options: RecapOptions) -> list[str]:
        command = [sys.executable, str(RECAP_ENTRY), *(str(path) for path in options.videos),
                   "--work-dir", str(options.work_dir), "--edit-mode", options.edit_mode,
                   "--audio-mode", options.audio_mode, "--style", options.style]
        if options.context:
            command += ["--context", options.context]
        if options.target_duration:
            command += ["--target-duration", options.target_duration]
        if options.output_dir:
            command += ["--output-dir", str(options.output_dir)]
        if options.skip_asr:
            command.append("--skip-asr")
        if options.burn_subtitles is True:
            command.append("--burn-subtitles")
        elif options.burn_subtitles is False:
            command.append("--no-burn-subtitles")
        if options.require_final_qc and options.edit_mode != "dub":
            command.append("--require-final-qc")
        if options.confirm_voice_rights:
            command.append("--confirm-voice-rights")
        return command

    def _run_pipeline(self, options: RecapOptions, log_path: Path) -> subprocess.CompletedProcess[str]:
        command = self._command(options)
        env = media_environment(os.environ)
        # Never serialize credentials. The bundled scripts read them from this process env.
        result = self.runner(command, cwd=REPO_ROOT, env=env, text=True, capture_output=True, check=False)
        log_text = f"$ {' '.join(command[:2])} <media args>\n{result.stdout or ''}{result.stderr or ''}"
        _atomic_write_text(log_path, log_text)
        return result

    def _write_bundle(self, work_dir: Path, bundle: Mapping[str, Any], keys: Sequence[str]) -> None:
        file_names = {
            "story_plan": "recap_story_plan.json",
            "visual_audio_board": "visual_audio_board.json",
            "style_card": "style_card.json",
            "packaging_plan": "packaging_plan.json",
            "narration": "narration.json",
            "clip_plan": "clip_plan.json",
        }
        for key in keys:
            if key in bundle:
                _write_json(work_dir / file_names[key], bundle[key])

    def produce(self, options: RecapOptions) -> RecapReceipt:
        if not options.videos:
            raise RecapAgentError("At least one source video is required")
        for video in options.videos:
            if not video.is_file():
                raise RecapAgentError(f"Source video is not readable: {video}")
        if options.edit_mode not in {"full", "cut", "dub"}:
            raise RecapAgentError("edit_mode must be full, cut or dub")
        if len(options.videos) > 1 and options.edit_mode != "cut":
            raise RecapAgentError("Multiple sources require cut mode")
        if options.edit_mode == "dub" and not options.confirm_voice_rights:
            raise RecapAgentError("Dub mode requires explicit confirmation of voice and media rights")
        if options.audio_mode != "narration" and options.edit_mode == "dub":
            raise RecapAgentError("Dub mode uses narration audio routing")
        options.work_dir.mkdir(parents=True, exist_ok=True)
        log_path = options.work_dir / "viral_hit_agent.log"
        phases: list[str] = []
        repairs = 0
        source_manifest = _read_json(options.work_dir / "multi_source_manifest.json", {})
        source_ids = {str(row.get("source_id")) for row in source_manifest.get("sources", []) if isinstance(row, dict)} if isinstance(source_manifest, dict) else set()

        # The deterministic pipeline has at most two creative pauses; the extra
        # iterations are bounded lint-repair passes, never an open-ended agent loop.
        for _ in range(7 + options.max_repairs):
            result = self._run_pipeline(options, log_path)
            final_qc = _read_json(options.work_dir / "final_qc.json")
            if result.returncode == 0 and isinstance(final_qc, dict):
                output_value = final_qc.get("metadata", {}).get("final_output", {}).get("path")
                output = Path(output_value) if output_value else None
                warnings = tuple(str(item.get("message", item)) for item in final_qc.get("metadata", {}).get("warnings", []) if item)
                receipt = RecapReceipt(options.work_dir, output, "completed", tuple(phases), warnings)
                _write_json(options.work_dir / "viral_hit_receipt.json", {**receipt.public, "llm": self.config.public})
                return receipt

            if options.audio_mode == "narration" and options.edit_mode != "dub":
                if options.edit_mode == "cut" and not (options.work_dir / "clip_plan.json").exists():
                    source_manifest = _read_json(options.work_dir / "multi_source_manifest.json", {})
                    source_ids = {str(row.get("source_id")) for row in source_manifest.get("sources", []) if isinstance(row, dict)} if isinstance(source_manifest, dict) else set()
                    bundle = self.planner.plan_cut(options.work_dir, options, source_ids)
                    self._write_bundle(options.work_dir, bundle, ("story_plan", "visual_audio_board", "style_card", "clip_plan"))
                    phases.append("creative:clip-plan")
                    continue
                if not (options.work_dir / "narration.json").exists():
                    if options.edit_mode == "cut" and (options.work_dir / "edited_source.mp4").exists():
                        bundle = self.planner.plan_cut_narration(options.work_dir, options)
                        self._write_bundle(options.work_dir, bundle, ("visual_audio_board", "packaging_plan", "narration"))
                        phases.append("creative:output-narration")
                    elif options.edit_mode == "full":
                        bundle = self.planner.plan_full(options.work_dir, options)
                        self._write_bundle(options.work_dir, bundle, ("story_plan", "visual_audio_board", "style_card", "packaging_plan", "narration"))
                        phases.append("creative:full-narration")
                    else:
                        raise RecapAgentError(f"Pipeline paused without a usable evidence bundle; see {log_path}")
                    continue

            lint = _read_json(options.work_dir / "narration_lint.json")
            if isinstance(lint, dict) and lint.get("ok") is False and repairs < options.max_repairs and (options.work_dir / "narration.json").exists():
                narration = self.planner.repair_narration(options.work_dir, options, lint)
                _write_json(options.work_dir / "narration.json", narration)
                repairs += 1
                phases.append(f"repair:narration-{repairs}")
                continue

            tail = ""
            try:
                tail = log_path.read_text(encoding="utf-8", errors="replace")[-5000:]
            except OSError:
                pass
            raise RecapAgentError(f"Recap pipeline failed with exit code {result.returncode}. See {log_path}\n{tail}")

        raise RecapAgentError("Creative repair limit reached; inspect the evidence and lint reports before retrying")


def produce_recap(options: RecapOptions, env: Mapping[str, str] | None = None) -> RecapReceipt:
    config = config_from_env(env)
    return RecapAgent(config).produce(options)
