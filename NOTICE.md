# Upstream notices

Viral Hit is a new unified application, not an upstream release. It includes modified code and preserved production skills from the following projects.

| Project | Source revision used | License | Use in Viral Hit |
|---|---|---|---|
| HotClip | `xixihhhh/hotclip` at `4f4347d12c8a989d16be46aaeed7455d1f35f992` | AGPL-3.0-only | Local clipping engine, transcription, visual evidence, captions, reframing, render QA, desktop/CLI/MCP foundations |
| Video Recap Skills | `zenstory-ai/video-recap-skills` at `9c88a98ac8401f9722daa5b2865d8e9c60bc6d2f` | MIT | Seven skills and deterministic recap pipelines under `recap/` |
| AutoClip | `zhouxiaoka/autoclip` at `3d3b5edf9ffa595a764b0919e6dbd4ce8acaca84` | MIT | Production orchestration, export and agent-access inspiration |
| AICLIPS Studio | `SamurAIGPT/ai-clipping-generator` at `e1448c915d8108bcca178e88a0d747b74579a2e9` | MIT | Asynchronous creation, job tracking and gallery-workflow inspiration |

The corresponding license texts are preserved in `licenses/`. No upstream project endorses Viral Hit.

## Viral Hit changes

The unified application adds a browser backend with managed uploads and SSE, persistent recap jobs shared by HTTP/IPC/MCP, a French interface, multi-provider creative adapters, evidence-bound autonomous recap planning, credential-free receipts, security boundaries, a unified CLI, a consolidated skill, and Viral Hit branding.

The original `HotClipApi` type, `hotclip` IPC channel names and selected legacy environment/storage keys remain as compatibility identifiers. They do not represent the product name or links to upstream update services.

## Bundled resources

- Source Han Sans SC Bold is distributed under SIL OFL 1.1; see `licenses/SOURCE-HAN-SANS-OFL-1.1.txt`.
- FFmpeg and FFprobe are resolved from separately distributed packages or user-provided installations; their package licenses remain with those distributions.
- The Viral Hit logo and generated build icon are original project assets.
