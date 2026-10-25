# Viral Hit

**Agent vidéo local-first pour créer des shorts viraux et des récaps narrés**, depuis une interface unique, un CLI ou MCP.

Viral Hit réunit les quatre projets sources demandés — AutoClip, AICLIPS Studio, HotClip et Video Recap Skills — au lieu de demander de lancer quatre applications. Les médias, projets, caches, jobs et exports restent sur la machine. Seuls les textes nécessaires sont envoyés au fournisseur d’IA que vous configurez.

## Accès rapide

### Windows — raccourcis et mises à jour faciles

Ouvrez **Windows PowerShell**, copiez ces trois lignes, puis validez :

```powershell
$script = "$env:TEMP\Viral-Hit-Install.ps1"
Invoke-WebRequest "https://raw.githubusercontent.com/lordhur/Viral-Hit/refs/heads/arena/b4628d5e-viral-hit/scripts/windows/install.ps1" -OutFile $script -UseBasicParsing
powershell -NoProfile -ExecutionPolicy Bypass -File $script
```

L’installateur crée les raccourcis Bureau **Viral Hit** et **Mettre à jour Viral Hit**. Les mises à jour sont incrémentales et conservent les données, réglages et caches. Consultez le [guide Windows complet](docs/WINDOWS.md).

### Installation manuelle sur votre machine

Prérequis : **Node.js 22+**, Corepack, et **Python 3.10+** pour les récaps.

```bash
git clone https://github.com/lordhur/Viral-Hit.git
cd Viral-Hit
corepack pnpm install
cp .env.example .env       # Windows : copy .env.example .env
corepack pnpm setup:media  # FFmpeg moderne dans le cache local, hors Git
corepack pnpm start
```

Ouvrez ensuite **http://localhost:8787**. `start` construit l’interface et lance le serveur ; aucun second port ni second lanceur n’est nécessaire.

Pour le développement avec rechargement à chaud :

```bash
corepack pnpm dev:agent   # terminal 1, API sur :8787
corepack pnpm dev:web     # terminal 2, UI sur :5173 avec proxy API
```

Pour l’application desktop Electron :

```bash
corepack pnpm dev
# ou, après vérification des dépendances natives :
corepack pnpm dist
```

Le desktop et le serveur partagent le même répertoire de données Viral Hit. Python reste requis pour produire un récap depuis le desktop. Les commandes desktop installent explicitement le binaire Electron 43 au premier lancement ; cette étape nécessite un accès réseau aux artefacts Electron.

## Les deux workflows

### 1. Clips viraux

- Import MP4, MOV, MKV, WebM, FLV ou audio ; import d’URL et de sous-titres SRT/WebVTT.
- Transcription locale SenseVoice, Paraformer ou FireRedASR ; Qwen3-ASR via un service local ; ElevenLabs sur desktop.
- Détection de moments forts par LLM, preuves textuelles et audiovisuelles, référence de rythme, préférences et retours de performance.
- Révision avant export, montage multi-extraits, recadrage 9:16, suivi de visage, sous-titres, jump cut, nettoyage audio, musique, habillage de marque et variantes.
- Export MP4, couverture, SRT, timeline/EDL, brouillon Jianying, packs de publication et de série.
- Contrôle qualité : durée, noir, silence, gel, loudness, coupures de parole et alertes de contenu ; réparations bornées et consignées.

### 2. Récap vidéo narré

- Modes `full`, `cut` et `dub`, avec une ou plusieurs sources (`cut` pour multi-sources).
- Compréhension, scénario, narration, voix, assemblage et QC à partir des sept skills Video Recap conservés.
- Un planificateur structuré remplit les étapes créatives sans inventer de timecodes : les preuves et les validateurs déterministes restent autoritaires.
- Jobs persistants, annulation, reprise du répertoire de travail, prévisualisation et téléchargement.
- Confirmation explicite des droits sur le média et le clonage vocal pour le mode `dub`.

Le chemin Récap par défaut utilise les services MiMo configurés pour l’ASR/VLM/TTS. Aucun faux résultat n’est produit si un fournisseur n’est pas configuré : le job indique clairement ce qui manque.

## Configuration de l’IA

Copiez `.env.example` vers `.env`. Ne committez jamais ce fichier. Les valeurs `VIRALHIT_*` sont prioritaires ; les anciennes variables `HOTCLIP_LLM_*` restent acceptées pour le clipping.

Exemple local avec Ollama :

```dotenv
VIRALHIT_LLM_PROVIDER=ollama
VIRALHIT_LLM_BASE_URL=http://127.0.0.1:11434/v1
VIRALHIT_LLM_MODEL=qwen3:8b
VIRALHIT_LLM_API_KEY=
```

Fournisseurs pris en charge : `openai-compatible`, `openai`, `anthropic`, `gemini`, `mimo` et `ollama`. Pour un fournisseur cloud, définissez son endpoint, le modèle réellement disponible et `VIRALHIT_LLM_API_KEY`. Aucun nom de modèle n’est deviné à votre place.

Pour les récaps, configurez également les clés du chemin média choisi :

```dotenv
MIMO_API_KEY=
# Ou les clés séparées : MIMO_VIDEO_API_KEY, MIMO_ASR_API_KEY, MIMO_TTS_API_KEY
# FISH_API_KEY et TTS_PROVIDER sont également reconnus par les skills conservés.
```

Dans **Réglages**, l’UI accepte aussi une clé pour la session courante. **Les clés saisies dans l’UI ne sont plus enregistrées dans `localStorage`** ; seules les préférences non sensibles y persistent. La configuration durable de référence reste `.env` / l’environnement.

Vérification sans afficher de secret :

```bash
python3 -m agent doctor --json
```

## CLI unifié

```bash
# Diagnostic
python3 -m agent doctor --json

# Clips : transcription → moments forts → rendu → QC
python3 -m agent clip "/chemin/video.mp4" --max-clips 6 --out "/chemin/exports"

# Réutiliser des sous-titres existants au lieu de lancer l’ASR
python3 -m agent clip "/chemin/video.mp4" --subtitles "/chemin/video.srt"

# Récap narré, avec reprise dans un répertoire explicite
python3 -m agent recap "/chemin/video.mp4" \
  --edit-mode full --language fr \
  --style "Documentaire rythmé, narration naturelle" \
  --work-dir "/chemin/run-recap"

# Dub uniquement après confirmation des droits
python3 -m agent recap "/chemin/video.mp4" \
  --edit-mode dub --confirm-voice-rights
```

Le CLI TypeScript reste disponible pour les opérations de clipping avancées :

```bash
corepack pnpm cli transcribe "/chemin/video.mp4"
corepack pnpm cli highlights "/chemin/video.mp4" --max-clips 8 --json
corepack pnpm cli clip "/chemin/video.mp4" --no-vertical --no-captions --json
corepack pnpm cli doctor
```

## MCP

Lancez le serveur stdio depuis la racine :

```bash
corepack pnpm mcp
```

Exemple de configuration d’un hôte MCP :

```json
{
  "mcpServers": {
    "viral-hit": {
      "command": "corepack",
      "args": ["pnpm", "mcp"],
      "cwd": "/chemin/absolu/Viral-Hit"
    }
  }
}
```

Six outils sont exposés :

| Outil | Usage |
|---|---|
| `clip_video` | Pipeline complet de clipping et rendu QC |
| `detect_highlights` | Candidats et preuves, sans exporter |
| `transcribe_video` | ASR local ou import de sous-titres |
| `recap_video` | Démarrer un job de récap autonome |
| `production_jobs` | Lister les jobs et leurs artefacts |
| `cancel_production_job` | Annuler en conservant le travail reprenable |

Les chemins MCP sont des chemins locaux de confiance. En revanche, l’interface navigateur restreint les médias aux fichiers uploadés et aux artefacts gérés dans son espace de données.

## FFmpeg et FFprobe

Ordre de résolution :

1. `VIRALHIT_FFMPEG` / `FFMPEG_PATH` et `VIRALHIT_FFPROBE` / `FFPROBE_PATH` ;
2. le binaire moderne de `ffmpeg-static` lorsqu’il est installé ;
3. le cache `imageio-ffmpeg` installé par `corepack pnpm setup:media` ;
4. les paquets npm de secours, puis le `PATH`.

`setup:media` installe un binaire spécifique à la plateforme dans `.cache/media-python`, ignoré par Git. Les chemins explicites sont recommandés pour un poste de production disposant déjà d’une version validée de FFmpeg.

## Données et confidentialité

- Racine par défaut : répertoire utilisateur Viral Hit du système ; surcharge possible avec `VIRALHIT_DATA_DIR`.
- Uploads, projets, transcriptions, caches, jobs et exports restent locaux.
- Les recettes de jobs ne contiennent ni clé API ni contenu de secret.
- Les requêtes navigateur cross-site sont refusées ; les médias sont servis avec prise en charge des plages HTTP.
- Le mode démo déterministe existe uniquement avec `?demo=1`. Sans ce paramètre, l’UI utilise le backend réel.

## Limites explicites

- Le style de sous-titres **Bubble** nécessite le renderer offscreen Electron ; les autres styles natifs sont disponibles dans le navigateur.
- La transcription ElevenLabs, les dialogues de fichiers natifs et certaines automations desktop ne sont pas reproduits artificiellement dans le navigateur.
- Un fournisseur créatif est nécessaire pour la sélection par IA et le plan narratif. Un fournisseur ASR/VLM/TTS est nécessaire pour les étapes Récap correspondantes.
- Les exports sont **prêts à publier** ; Viral Hit ne publie pas automatiquement sur vos comptes sociaux.

## Origine des composants

- **HotClip (AGPL-3.0)** : moteur local de transcription, sélection, rendu, reframing, QA, desktop, CLI et MCP.
- **Video Recap Skills (MIT)** : sept skills et pipelines de compréhension, script, voix, montage, assemblage et QC.
- **AutoClip (MIT)** : inspiration pour l’orchestration de production, les exports et l’accès agent.
- **AICLIPS Studio (MIT)** : inspiration pour les workflows de création asynchrones, le suivi des jobs et la galerie.

Viral Hit est distribué sous **AGPL-3.0-only**. Les notices originales sont conservées dans `licenses/`.

## Vérifications

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:web
python3 -m unittest discover -s tests/agent -v
```

Le skill destiné aux agents se trouve dans [`skills/viral-hit/SKILL.md`](skills/viral-hit/SKILL.md).
