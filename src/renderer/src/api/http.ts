import type {
  DiagnosticsProgressEvent,
  ExportProgressEvent,
  HotClipApi,
  TranscribeProgressEvent,
  UrlImportProgressEvent,
  WatchEvent,
} from "../../../shared/api-types";

async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  const body = await response.json() as { result?: T; error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Local API failed (HTTP ${response.status})`);
  return body.result as T;
}

function command(method: string): void {
  void rpc(method).catch((error) => console.error(`Viral Hit command ${method} failed`, error));
}

async function upload(file: File, kind: "media" | "asset" | "data"): Promise<string> {
  const query = new URLSearchParams({ kind, filename: file.name });
  const response = await fetch(`/api/upload?${query}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  const body = await response.json() as { path?: string; error?: string };
  if (!response.ok || !body.path) throw new Error(body.error || "Upload failed");
  return body.path;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", () => { const file = input.files?.[0] ?? null; cleanup(); resolve(file); }, { once: true });
    input.addEventListener("cancel", () => { cleanup(); resolve(null); }, { once: true });
    input.click();
  });
}

async function pickAndUpload(accept: string, kind: "media" | "asset" | "data"): Promise<string | null> {
  const file = await pickFile(accept);
  return file ? upload(file, kind) : null;
}

type EventMap = {
  transcribe: TranscribeProgressEvent;
  export: ExportProgressEvent;
  "url-import": UrlImportProgressEvent;
  watch: WatchEvent;
  diagnostics: DiagnosticsProgressEvent;
};
const listeners: { [K in keyof EventMap]: Set<(value: EventMap[K]) => void> } = {
  transcribe: new Set(), export: new Set(), "url-import": new Set(), watch: new Set(), diagnostics: new Set(),
};
let events: EventSource | null = null;
function ensureEvents(): void {
  if (events) return;
  events = new EventSource("/api/events");
  for (const channel of Object.keys(listeners) as Array<keyof EventMap>) {
    events.addEventListener(channel, (message) => {
      const data = JSON.parse((message as MessageEvent).data) as never;
      listeners[channel].forEach((cb) => (cb as (value: never) => void)(data));
    });
  }
}
function subscribe<K extends keyof EventMap>(channel: K, cb: (value: EventMap[K]) => void): () => void {
  ensureEvents();
  listeners[channel].add(cb);
  return () => listeners[channel].delete(cb);
}

/** HTTP/SSE implementation of the same API used by Electron's preload bridge. */
export const httpApi: HotClipApi = {
  selectMedia: async (file?: unknown) => file instanceof File ? upload(file, "media") : pickAndUpload("video/*,audio/*,.mkv,.flv,.srt,.vtt", "media"),
  importMediaUrl: (url) => rpc("importMediaUrl", url),
  onUrlImportProgress: (cb) => subscribe("url-import", cb),
  cancelUrlImport: () => command("cancelUrlImport"),
  projectWorkspaceGet: () => rpc("projectWorkspaceGet"),
  projectCreate: (checkpoint, name) => rpc("projectCreate", checkpoint, name),
  projectOpen: (id) => rpc("projectOpen", id),
  projectSave: (id, checkpoint) => rpc("projectSave", id, checkpoint),
  projectRename: (id, name) => rpc("projectRename", id, name),
  projectDelete: (id) => rpc("projectDelete", id),
  projectRelink: (id, filePath) => rpc("projectRelink", id, filePath),
  projectClose: () => rpc("projectClose"),
  sessionCheckpointGet: () => rpc("sessionCheckpointGet"),
  sessionCheckpointSave: (checkpoint) => rpc("sessionCheckpointSave", checkpoint),
  sessionCheckpointClear: () => rpc("sessionCheckpointClear"),
  probeMedia: (filePath) => rpc("probeMedia", filePath),
  listAsrEngines: () => rpc("listAsrEngines"),
  transcribeMedia: (filePath, engineId, apiKey, options) => rpc("transcribeMedia", filePath, engineId, apiKey, options),
  cancelTranscribe: () => command("cancelTranscribe"),
  checkLocalSpeech: (url) => rpc("checkLocalSpeech", url),
  previewAlignment: (filePath, transcript, request) => rpc("previewAlignment", filePath, transcript, request),
  cancelAlignment: () => command("cancelAlignment"),
  importSubtitle: (filePath, text, format) => rpc("importSubtitle", filePath, text, format),
  onTranscribeProgress: (cb) => subscribe("transcribe", cb),
  detectHighlights: (transcript, llm, filePath, diarize, prefilter, vision, length, products, referencePath, genre, brief, scan) =>
    rpc("detectHighlights", transcript, llm, filePath, diarize, prefilter, vision, length, products, referencePath, genre, brief, scan),
  exportClips: (filePath, clips, options) => rpc("exportClips", filePath, clips, options),
  onExportProgress: (cb) => subscribe("export", cb),
  cancelExport: () => command("cancelExport"),
  revealClip: (path) => { window.open(`${mediaUrl(path, "download")}&download=1`, "_blank", "noopener,noreferrer"); },
  mediaUrl: (filePath, view = "main") => mediaUrl(filePath, view),
  selectImage: () => pickAndUpload("image/png,image/jpeg,image/webp", "asset"),
  selectAudio: () => pickAndUpload("audio/*", "asset"),
  generateBgm: (config, genreId) => rpc("generateBgm", config, genreId),
  getAudioPeaks: (filePath, startSec, endSec) => rpc("getAudioPeaks", filePath, startSec, endSec),
  timelineData: (filePath, durationSec) => rpc("timelineData", filePath, durationSec),
  contactSheet: (filePath, startSec, endSec) => rpc("contactSheet", filePath, startSec, endSec),
  listLlmModels: (baseUrl, apiKey, provider) => rpc("listLlmModels", baseUrl, apiKey, provider),
  recordReview: (video, kept, rejected) => rpc("recordReview", video, kept, rejected),
  performanceGet: () => rpc("performanceGet"),
  performanceImport: async () => {
    const path = await pickAndUpload(".csv,.json,text/csv,application/json", "data");
    return path ? rpc("performanceImport", path) : null;
  },
  performanceTemplate: () => rpc("performanceTemplate"),
  performanceClear: () => rpc("performanceClear"),
  diagnosticsRun: (llm, locale) => rpc("diagnosticsRun", llm, locale),
  diagnosticsClearRenderCache: (llm, locale) => rpc("diagnosticsClearRenderCache", llm, locale),
  diagnosticsClearEvidenceIndex: (llm, locale) => rpc("diagnosticsClearEvidenceIndex", llm, locale),
  diagnosticsPrepareModels: (llm, locale) => rpc("diagnosticsPrepareModels", llm, locale),
  onDiagnosticsProgress: (cb) => subscribe("diagnostics", cb),
  diagnosticsCancelRepair: () => command("diagnosticsCancelRepair"),
  selectDir: async () => null,
  defaultOutDir: () => rpc("defaultOutDir"),
  modelsInfo: () => rpc("modelsInfo"),
  moveModelsDir: (dir) => rpc("moveModelsDir", dir),
  openFolder: () => { /* Browsers cannot reveal a server-side directory. */ },
  watchStart: (dir, llm, outDir) => rpc("watchStart", dir, llm, outDir),
  watchStop: () => rpc("watchStop"),
  watchStatus: () => rpc("watchStatus"),
  automationTasksGet: () => rpc("automationTasksGet"),
  automationTaskRetry: (id, llm, outDir) => rpc("automationTaskRetry", id, llm, outDir),
  automationTaskCancel: (id) => rpc("automationTaskCancel", id),
  automationTasksClear: () => rpc("automationTasksClear"),
  webhookStart: (dir, llm, outDir, port, token) => rpc("webhookStart", dir, llm, outDir, port, token),
  webhookStop: () => rpc("webhookStop"),
  webhookStatus: () => rpc("webhookStatus"),
  onWatchEvent: (cb) => subscribe("watch", cb),
  checkUpdate: () => rpc("checkUpdate"),
  openUrl: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
  glossaryGet: () => rpc("glossaryGet"),
  glossarySet: (entries) => rpc("glossarySet", entries),
};

function mediaUrl(filePath: string, view: string): string {
  return `/api/media/view/${encodeURIComponent(view)}/${encodeURIComponent(filePath)}`;
}
