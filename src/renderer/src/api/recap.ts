import type { HotClipApi } from "../../../shared/api-types";
import type { ProductionJob, RecapJobInput } from "../../../shared/production";

type DesktopRecapApi = HotClipApi & Required<Pick<HotClipApi, "recapJobsList" | "recapStart" | "recapCancel" | "onRecapJob">>;

function desktopApi(): DesktopRecapApi | null {
  const api = typeof window !== "undefined" ? window.hotclip : undefined;
  return api?.recapJobsList && api.recapStart && api.recapCancel && api.onRecapJob ? api as DesktopRecapApi : null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Recap API failed (HTTP ${response.status})`);
  return body;
}

export async function listRecapJobs(): Promise<ProductionJob[]> {
  const desktop = desktopApi();
  if (desktop) return desktop.recapJobsList();
  return (await request<{ jobs: ProductionJob[] }>("/api/jobs")).jobs;
}

export async function startRecapJob(input: RecapJobInput): Promise<ProductionJob> {
  const desktop = desktopApi();
  if (desktop) return desktop.recapStart(input);
  return (await request<{ job: ProductionJob }>("/api/recap", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  })).job;
}

export async function cancelRecapJob(id: string): Promise<boolean> {
  const desktop = desktopApi();
  if (desktop) return desktop.recapCancel(id);
  return (await request<{ cancelled: boolean }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" })).cancelled;
}

export function subscribeRecapJobs(cb: (job: ProductionJob) => void): () => void {
  const desktop = desktopApi();
  if (desktop) return desktop.onRecapJob(cb);
  const events = new EventSource("/api/events");
  events.addEventListener("job", (message) => {
    const value = JSON.parse((message as MessageEvent).data) as { type: string; job: ProductionJob };
    if (value.type === "update") cb(value.job);
  });
  return () => events.close();
}

export function recapMediaUrl(path: string, download = false): string {
  const desktop = desktopApi();
  if (desktop) return desktop.mediaUrl(path, "recap");
  return `/api/media/view/recap/${encodeURIComponent(path)}${download ? "?download=1" : ""}`;
}
