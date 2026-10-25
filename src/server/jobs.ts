import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import type { EventHub } from "./events";
import { assertInside, serverDataDir, serverRoot } from "./config";
import type { ProductionJob, RecapJobInput } from "../shared/production";

export type { ProductionJob, RecapJobInput } from "../shared/production";

interface StoredJobs { version: 1; jobs: ProductionJob[] }

function isLoopbackHttp(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Aucun fournisseur payant n'est contacté implicitement par le récap autonome. */
function freeRecapReady(input: RecapJobInput): boolean {
  const env = process.env;
  const provider = (env.VIRALHIT_LLM_PROVIDER ?? "").toLowerCase();
  const baseUrl = env.VIRALHIT_LLM_BASE_URL ?? env.HOTCLIP_LLM_BASE_URL;
  const localLlm = Boolean((env.VIRALHIT_LLM_MODEL ?? env.HOTCLIP_LLM_MODEL) && (provider === "ollama" || isLoopbackHttp(baseUrl)));
  const localTts = env.TTS_PROVIDER === "index-tts" && isLoopbackHttp(env.INDEX_TTS_ENDPOINT) && Boolean(env.INDEX_TTS_VOICE?.trim());
  // Le chemin MiMo ASR historique est cloud. Le mode gratuit exige donc soit
  // des preuves déjà présentes dans le dossier de reprise, soit --skip-asr.
  return localLlm && localTts && input.skipAsr === true;
}

function validJob(value: unknown): value is ProductionJob {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ProductionJob>;
  return typeof row.id === "string" && row.kind === "recap" && typeof row.status === "string" &&
    typeof row.workDir === "string" && Array.isArray(row.videos) && typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string" && typeof row.logPath === "string";
}

/** Durable metadata + supervised child processes for long narrated-recap runs. */
export class JobManager {
  private jobs = new Map<string, ProductionJob>();
  private children = new Map<string, ChildProcess>();
  private writes: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(private hub: EventHub) {}

  private file(): string { return join(serverDataDir(), "jobs.json"); }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.file(), "utf8")) as StoredJobs;
      if (raw.version !== 1 || !Array.isArray(raw.jobs)) return;
      for (const job of raw.jobs.filter(validJob).slice(0, 200)) {
        if (job.status === "running" || job.status === "queued") {
          job.status = "interrupted";
          job.error = "Le serveur local s’est arrêté avant la fin de cette production. Reprenez depuis son dossier de travail.";
          job.updatedAt = new Date().toISOString();
        }
        this.jobs.set(job.id, job);
      }
      await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  list(): ProductionJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): ProductionJob | null { return this.jobs.get(id) ?? null; }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({ version: 1, jobs: this.list() } satisfies StoredJobs);
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.file()), { recursive: true });
      const temp = `${this.file()}.tmp`;
      await writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temp, this.file());
    });
    await this.writes;
  }

  private async update(job: ProductionJob, patch: Partial<ProductionJob>): Promise<void> {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.hub.emit("job", { type: "update", job });
    await this.persist();
  }

  async startRecap(input: RecapJobInput, managedOnly = true): Promise<ProductionJob> {
    await this.load();
    if (!Array.isArray(input.videos) || input.videos.length < 1 || input.videos.length > 40 || input.videos.some((path) => typeof path !== "string" || !path.trim())) {
      throw new Error("Choisissez entre 1 et 40 vidéos sources");
    }
    const allowCloud = process.env.VIRALHIT_RECAP_ALLOW_CLOUD === "1";
    if (!allowCloud && !freeRecapReady(input)) throw new Error("recap:local-setup-required");
    const data = serverDataDir();
    const videos = input.videos.map((path) => managedOnly ? assertInside(data, path) : resolve(path));
    const id = randomUUID();
    const workDir = input.workDir ? (managedOnly ? assertInside(join(data, "runs"), input.workDir) : resolve(input.workDir)) : join(data, "runs", id);
    const outputDir = input.outputDir ? (managedOnly ? assertInside(join(data, "exports"), input.outputDir) : resolve(input.outputDir)) : join(data, "exports", id);
    await mkdir(workDir, { recursive: true });
    const now = new Date().toISOString();
    const job: ProductionJob = {
      id, kind: "recap", status: "queued", createdAt: now, updatedAt: now,
      workDir, videos, finalOutput: null, error: null, logPath: join(workDir, "server-job.log"),
      request: { ...input, videos, workDir, outputDir },
    };
    this.jobs.set(id, job);
    await this.persist();
    this.hub.emit("job", { type: "update", job });

    const args = ["-m", "agent", "recap", ...videos, "--work-dir", workDir,
      "--edit-mode", input.editMode ?? "full", "--audio-mode", input.audioMode ?? "narration",
      "--style", (input.style ?? "documentary").slice(0, 4000), "--language", (input.language ?? "fr").slice(0, 40)];
    if (input.context) args.push("--context", input.context.slice(0, 8000));
    if (input.targetDuration) args.push("--target-duration", input.targetDuration.slice(0, 30));
    if (outputDir) args.push("--output-dir", outputDir);
    if (input.skipAsr) args.push("--skip-asr");
    if (input.burnSubtitles === true) args.push("--burn-subtitles");
    if (input.burnSubtitles === false) args.push("--no-burn-subtitles");
    if (input.confirmVoiceRights) args.push("--confirm-voice-rights");
    const python = process.env.VIRALHIT_PYTHON || "python3";
    const childEnv = { ...process.env };
    if (!allowCloud) {
      // Un ancien MIMO_API_KEY/FISH_API_KEY présent dans l’environnement ne doit
      // pas réactiver un appel cloud dans un sous-script du pipeline local.
      for (const key of Object.keys(childEnv)) {
        if (/^(?:MIMO|FISH)_.*(?:API_KEY|KEY)$/.test(key) || ["MIMO_API_KEY", "FISH_API_KEY"].includes(key)) delete childEnv[key];
      }
    }
    const child = spawn(python, args, { cwd: serverRoot(), env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    this.children.set(id, child);
    const log = createWriteStream(job.logPath, { flags: "a", mode: 0o600 });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    await this.update(job, { status: "running" });

    child.on("error", (error) => {
      void this.update(job, { status: "failed", error: error.message }).finally(() => log.end());
      this.children.delete(id);
    });
    child.on("exit", (code, signal) => {
      this.children.delete(id);
      void (async () => {
        if (job.status === "cancelled") return;
        if (code === 0) {
          try {
            const receipt = JSON.parse(await readFile(join(workDir, "viral_hit_receipt.json"), "utf8")) as { final_output?: string };
            await this.update(job, { status: "completed", finalOutput: receipt.final_output ?? null, error: null });
          } catch {
            await this.update(job, { status: "failed", error: "Le pipeline s’est terminé sans produire son reçu de finalisation" });
          }
        } else {
          await this.update(job, { status: "failed", error: `Le récap s’est arrêté (${signal ?? `code ${code ?? "inconnu"}`}). Consultez le journal : ${job.logPath}` });
        }
      })().finally(() => log.end());
    });
    return job;
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    const child = this.children.get(id);
    if (!job || !child || (job.status !== "running" && job.status !== "queued")) return false;
    await this.update(job, { status: "cancelled", error: "Production annulée ; les artefacts terminés sont conservés pour reprendre" });
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    timer.unref();
    return true;
  }

  stop(): void {
    for (const child of this.children.values()) child.kill("SIGTERM");
  }
}
