import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createReadStream, existsSync } from "fs";
import { mkdir, open, readFile, realpath, rename, stat, unlink } from "fs/promises";
import { basename, extname, join, resolve } from "path";
import { randomUUID } from "crypto";
import { EventHub } from "./events";
import { LocalService } from "./service";
import { JobManager, type RecapJobInput } from "./jobs";
import { assertInside, isPathInside, loadLocalEnv, serverDataDir, serverRoot } from "./config";
import { localizeErrorMessage } from "../shared/french-errors";
import { describeSubtitleImportError } from "../shared/subtitle-import";
import { ERR_TAG_MODEL_DOWNLOAD, ERR_TAG_MODEL_LOAD, ERR_TAG_NO_AUDIO } from "../shared/transcribe-errors";

loadLocalEnv(serverRoot());

const hub = new EventHub();
const service = new LocalService(hub);
const jobs = new JobManager(hub);
const JSON_LIMIT = 36 * 1024 * 1024;
const UPLOAD_LIMIT = Math.max(1, Number(process.env.VIRALHIT_UPLOAD_LIMIT_GB || 50)) * 1024 ** 3;
const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".webm": "video/webm", ".flv": "video/x-flv", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".srt": "application/x-subrip", ".vtt": "text/vtt", ".json": "application/json", ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};
const UPLOAD_EXTENSIONS: Record<string, Set<string>> = {
  media: new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".flv", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]),
  asset: new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".png", ".jpg", ".jpeg", ".webp"]),
  data: new Set([".json", ".csv", ".srt", ".vtt", ".txt"]),
};

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function errorResponse(res: ServerResponse, error: unknown): void {
  const raw = error instanceof Error ? error.message : String(error);
  const status = /not found|ENOENT|introuvable/i.test(raw) ? 404 : /unknown local api|required|invalid|inside|only accesses|not readable|obligatoire|invalide|inconnue|non pris en charge|illisible/i.test(raw) ? 400 : 500;
  let message = localizeErrorMessage(describeSubtitleImportError(error));
  // Les marqueurs restent disponibles aux adaptateurs, mais le texte qui les suit
  // est français : ils ne servent plus de véhicule à une erreur native bilingue.
  const marker = [ERR_TAG_NO_AUDIO, ERR_TAG_MODEL_DOWNLOAD, ERR_TAG_MODEL_LOAD].find((tag) => raw.includes(tag))
    ?? raw.match(/qwen:[a-z0-9-]+/i)?.[0];
  if (marker && !message.includes(marker)) message = `${marker} ${message}`;
  json(res, status, { error: message.slice(0, 2000) });
}

async function bodyJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > JSON_LIMIT) throw new Error("La requête JSON dépasse la limite de sécurité de 36 Mio");
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Requête JSON invalide"); }
}

function mutationAllowed(request: IncomingMessage): boolean {
  const site = request.headers["sec-fetch-site"];
  if (site === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      return originHost === request.headers.host;
    } catch { return false; }
  }
  return true;
}

async function upload(request: IncomingMessage, url: URL): Promise<{ path: string }> {
  const kind = url.searchParams.get("kind") || "media";
  const allowed = UPLOAD_EXTENSIONS[kind];
  if (!allowed) throw new Error("Type de téléversement inconnu");
  const original = basename(url.searchParams.get("filename") || "upload").slice(0, 180);
  const extension = extname(original).toLowerCase();
  if (!allowed.has(extension)) throw new Error(`Extension de fichier ${kind} non prise en charge : ${extension || "absente"}`);
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > UPLOAD_LIMIT) throw new Error("Le téléversement dépasse la limite locale configurée");
  const directory = join(serverDataDir(), kind === "media" ? "uploads" : kind === "asset" ? "assets" : "imports");
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${randomUUID()}${extension}`);
  const temporary = `${destination}.part`;
  const handle = await open(temporary, "wx", 0o600);
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.byteLength;
      if (size > UPLOAD_LIMIT) throw new Error("Le téléversement dépasse la limite locale configurée");
      await handle.write(chunk);
    }
    if (!size) throw new Error("Le fichier téléversé est vide");
    await handle.close();
    await rename(temporary, destination);
    return { path: destination };
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function mediaPath(encoded: string): Promise<string> {
  let decoded: string;
  try { decoded = decodeURIComponent(encoded); } catch { throw new Error("Encodage du chemin média invalide"); }
  const candidate = assertInside(serverDataDir(), decoded);
  const canonical = await realpath(candidate);
  return assertInside(serverDataDir(), canonical);
}

async function serveMedia(request: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const raw = url.pathname.slice("/api/media/".length);
  const encoded = raw.startsWith("view/") ? raw.split("/").slice(2).join("/") : raw;
  const path = await mediaPath(encoded);
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Média introuvable");
  const contentType = MEDIA_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
  const range = request.headers.range;
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return;
    }
    if (match[1]) {
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    } else {
      const suffix = Number(match[2]); start = Math.max(0, info.size - suffix); end = info.size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
      res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return;
    }
    status = 206;
  }
  const headers: Record<string, string | number> = {
    "Content-Type": contentType, "Content-Length": end - start + 1, "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${basename(path).replace(/["\r\n]/g, "_")}"`;
  res.writeHead(status, headers);
  if (request.method === "HEAD") { res.end(); return; }
  const stream = createReadStream(path, { start, end });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

const MIME_STATIC: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const root = resolve(serverRoot(), "dist", "renderer");
  if (!existsSync(join(root, "index.html"))) return false;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(root, requested);
  if (!isPathInside(root, candidate)) return false;
  let path = candidate;
  if (!existsSync(path) || !(await stat(path)).isFile()) path = join(root, "index.html");
  const body = await readFile(path);
  res.writeHead(200, { "Content-Type": MIME_STATIC[extname(path)] || "application/octet-stream", "Content-Length": body.byteLength,
    "Cache-Control": path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  res.end(body);
  return true;
}

const server = createServer(async (request, res) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { name: "Viral Hit", version: "0.1.0", status: "ok", dataDir: serverDataDir(), jobs: jobs.list().filter((job) => job.status === "running").length }); return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(": viral-hit connected\n\n");
      const unsubscribe = hub.subscribe((event) => res.write(`event: ${event.channel}\ndata: ${JSON.stringify(event.data)}\n\n`));
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20_000);
      request.on("close", () => { clearInterval(heartbeat); unsubscribe(); }); return;
    }
    if (request.method === "GET" && url.pathname === "/api/jobs") { await jobs.load(); json(res, 200, { jobs: jobs.list() }); return; }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/api/media/")) { await serveMedia(request, res, url); return; }
    if (request.method !== "POST" && request.method !== "DELETE") {
      if (request.method === "GET" && await serveStatic(res, url.pathname)) return;
      json(res, 404, { error: "Ressource introuvable" }); return;
    }
    if (!mutationAllowed(request)) { json(res, 403, { error: "Les requêtes intersites ne sont pas autorisées" }); return; }
    if (request.method === "POST" && url.pathname === "/api/upload") { json(res, 201, await upload(request, url)); return; }
    if (request.method === "POST" && url.pathname === "/api/rpc") {
      const body = await bodyJson(request);
      if (typeof body.method !== "string" || !Array.isArray(body.args) || body.args.length > 24) throw new Error("Requête RPC invalide");
      json(res, 200, { result: await service.invoke(body.method, body.args) }); return;
    }
    if (request.method === "POST" && url.pathname === "/api/recap") {
      const input = await bodyJson(request) as RecapJobInput;
      json(res, 202, { job: await jobs.startRecap(input) }); return;
    }
    const cancel = /^\/api\/jobs\/([a-f0-9-]{36})\/cancel$/.exec(url.pathname);
    if (request.method === "POST" && cancel) {
      await jobs.load(); json(res, 200, { cancelled: await jobs.cancel(cancel[1]) }); return;
    }
    json(res, 404, { error: "Ressource introuvable" });
  } catch (error) {
    if (!res.headersSent) errorResponse(res, error); else res.destroy();
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60_000;
const port = Number(process.env.VIRALHIT_PORT || process.env.PORT || 8787);
const host = process.env.VIRALHIT_HOST || "127.0.0.1";
async function bootstrap(): Promise<void> {
  await jobs.load();
  server.listen(port, host, () => {
    console.log(`Serveur local Viral Hit à l’écoute sur http://${host}:${port}`);
    console.log(`Dossier des données : ${serverDataDir()}`);
    if (existsSync(resolve(serverRoot(), "dist", "renderer", "index.html"))) console.log("Interface navigateur de production disponible");
  });
}
void bootstrap().catch((error) => {
  console.error("Échec du démarrage du serveur Viral Hit", localizeErrorMessage(error));
  process.exitCode = 1;
});

function shutdown(): void {
  service.stop(); jobs.stop(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { server, service, jobs };
