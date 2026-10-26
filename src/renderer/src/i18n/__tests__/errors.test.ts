import { describe, expect, it } from "vitest";
import { localizeErrorMessage } from "../errors";

describe("messages d’erreur français", () => {
  it("explique une vidéo privée sans promettre de contournement", () => {
    const message = localizeErrorMessage(new Error("url:download: Sign in to confirm you’re not a bot. Private video"));
    expect(message).toContain("exige une connexion");
    expect(message).toContain("ne contourne pas");
  });

  it("distingue un refus HTTP 403 et un lien invalide", () => {
    expect(localizeErrorMessage("url:download: HTTP Error 403: Forbidden")).toContain("HTTP 403");
    expect(localizeErrorMessage("url:invalid")).toContain("http://");
  });

  it("remplace le jeton 401 bilingue par le choix gratuit", () => {
    const message = localizeErrorMessage("LLM 请求失败 / LLM request failed (HTTP 401): invalid token");
    expect(message).toContain("moteur intégré");
    expect(message).not.toMatch(/invalid token|请求/);
  });

  it("distingue les erreurs du composant d’import de celles de la vidéo", () => {
    expect(localizeErrorMessage("url:tool-download HTTP 401")).toContain("composant d’import yt-dlp");
    expect(localizeErrorMessage("url:tool-download HTTP 404")).toContain("introuvable sur le serveur");
    expect(localizeErrorMessage("url:tool-download HTTP 429")).toContain("temporairement limité");
    expect(localizeErrorMessage("url:tool-download HTTP 503")).toContain("serveur de téléchargement");
    expect(localizeErrorMessage("url:download ERROR: HTTP Error 503")).toContain("site de la vidéo");
  });

  it("donne la procédure du service vocal local", () => {
    const message = localizeErrorMessage("qwen:unavailable");
    expect(message).toContain("qwen-speech-server.py");
    expect(message).toContain("py -m pip install");
  });

  it("ne laisse pas passer une erreur anglaise inconnue", () => {
    expect(localizeErrorMessage("Unexpected upstream failure")).not.toContain("upstream");
  });
});
