---
name: viral-hit
description: Local-first video production agent for viral short clips and narrated video recaps. Use when asked to clip a long video, find highlights, transcribe media, create vertical shorts, produce a narrated recap, resume or cancel a production job, or inspect render QC. Supports browser, desktop, CLI and six MCP tools with persistent local artefacts.
---

# Viral Hit — unified local video-production agent

Use the same local workspace for two workflows:

1. **Clips**: transcribe, find evidence-backed highlights, review, reframe, caption, render and QC short videos.
2. **Recaps**: plan from media evidence, narrate, assemble, run final QC, and persist/resume the production job.

Viral Hit is AGPL-3.0-only. It combines the HotClip clipping engine and the seven Video Recap skills, informed by AutoClip and AICLIPS Studio. Do not launch those upstream projects separately.

## Access and setup

From the repository root:

```bash
corepack pnpm install
cp .env.example .env
corepack pnpm setup:media
corepack pnpm start
```

Open `http://localhost:8787`. This is the easiest user-facing path: one command builds and serves the UI and API on one port.

For agent-only use, no UI is required. Load `.env` through the provided CLI/MCP launchers; never request, print or invent credentials. `VIRALHIT_LLM_*` configures the creative provider. Supported providers are OpenAI-compatible, OpenAI, Anthropic, Gemini, MiMo and Ollama. Recap media stages additionally need their configured ASR/VLM/TTS credentials, normally `MIMO_API_KEY` or the separated MiMo/Fish variables documented in `.env.example`.

Check without revealing secrets:

```bash
python3 -m agent doctor --json
```

## Choose the right interface

- **User working interactively**: use the browser UI at `:8787`; imports are uploaded into managed storage.
- **Coding agent with shell access**: use the unified Python CLI below.
- **MCP host**: register `corepack pnpm mcp` with the repository as working directory, then use the six tools.
- **Advanced clipping-only operations**: `corepack pnpm cli transcribe|highlights|clip|doctor` exposes the underlying TypeScript pipeline.

## CLI workflows

### Review highlights before rendering

```bash
corepack pnpm cli transcribe "/absolute/source.mp4"
corepack pnpm cli highlights "/absolute/source.mp4" --max-clips 8 --json
```

Show title, score, hook, start/end and review notes. Let the user choose when the request is not explicitly autonomous. Existing aligned SRT/WebVTT can skip ASR with `--subtitles`; estimated intra-sentence timings must be reviewed.

### Autonomous clips

```bash
python3 -m agent clip "/absolute/source.mp4" \
  --max-clips 6 --out "/absolute/exports"
```

Useful flags: `--reference`, `--subtitles`, `--no-vertical`, `--no-captions`, `--auto-enhance`, `--denoise basic|smart`.

### Narrated recap

```bash
python3 -m agent recap "/absolute/source.mp4" \
  --edit-mode full --language fr \
  --style "Documentary pacing and natural narration" \
  --work-dir "/absolute/resumable-run"
```

Use `--edit-mode cut` for multiple sources and `--target-duration 90s` when requested. `dub` requires `--confirm-voice-rights`; if the user has not confirmed media and speaker-cloning rights, ask rather than bypassing it.

## MCP tools

- `clip_video`: managed transcription → highlights → render/QC.
- `detect_highlights`: candidates only.
- `transcribe_video`: local ASR or subtitle import.
- `recap_video`: starts a durable recap job and returns its id.
- `production_jobs`: polls status, output, work directory and safe errors.
- `cancel_production_job`: cancels while preserving completed artefacts for resume.

After `recap_video`, poll `production_jobs`; do not claim completion while a job is queued/running. For failed/interrupted/cancelled jobs, resume using the stored request and `workDir`, not a fabricated output path.

## Evidence and quality rules

- **Never invent timestamps, quotes, people, visual facts or source ids.** Use transcript/evidence bundles and the pipeline validators.
- Do not hand-roll FFmpeg cuts when the clipping or recap pipeline covers the operation.
- Keep source media local. A configured creative provider receives the necessary text/evidence, not arbitrary credentials or unrelated files.
- Read `clips.json` and each clip's `qa` receipt. Surface every remaining `warn`; never silently ship a warned clip.
- Automatic repair is bounded and recorded. A repair is retained only when the subsequent check improves.
- Recap final QC is required by default. Do not disable it merely to obtain a success status.
- Tell the user the real absolute output paths only after verifying that the artefacts exist.
- Browser demo fixtures exist only under `?demo=1`; never present them as real production output.

## Security and limitations

- Browser media access is confined to managed uploads/exports; MCP local paths are trusted local inputs.
- API keys are environment configuration. UI-entered keys are session-only and must not be persisted in browser storage or receipts.
- Bubble captions require Electron; choose a native caption style in the browser.
- Missing provider configuration is an actionable error, not a reason to generate fake transcription, highlights, narration or QC.
