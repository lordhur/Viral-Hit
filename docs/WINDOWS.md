# Viral Hit sur Windows — installation et mises à jour faciles

Viral Hit s'installe dans votre profil Windows, sans droits administrateur pour l'agent lui-même. L'installation éventuelle des prérequis avec `winget` peut toutefois afficher une demande d'autorisation Windows. Les raccourcis ouvrent l'agent dans votre navigateur habituel, sur une adresse locale accessible uniquement depuis votre ordinateur.

## 1. Installation initiale

1. Ouvrez le menu Démarrer.
2. Tapez **PowerShell** et ouvrez **Windows PowerShell**.
3. Copiez ensemble les trois lignes suivantes dans PowerShell, puis validez avec Entrée :

```powershell
$script = "$env:TEMP\Viral-Hit-Install.ps1"
Invoke-WebRequest "https://raw.githubusercontent.com/lordhur/Viral-Hit/refs/heads/arena/b4628d5e-viral-hit/scripts/windows/install.ps1" -OutFile $script -UseBasicParsing
powershell -NoProfile -ExecutionPolicy Bypass -File $script
```

Le paramètre `ExecutionPolicy Bypass` s'applique uniquement au processus d'installation ; il ne modifie pas la politique générale de Windows.

### Ce que fait l'installateur

- vérifie **Git**, **Node.js 22+** et **Python 3.10+** ;
- utilise `winget` uniquement pour les prérequis manquants ;
- clone le projet une seule fois ;
- installe les dépendances et FFmpeg dans leurs caches ;
- construit l'interface ;
- crée deux raccourcis sur le Bureau et dans le menu Démarrer ;
- ouvre automatiquement Viral Hit dans votre navigateur.

L'installation peut prendre plusieurs minutes la première fois, selon votre connexion. Si Windows ou `winget` affiche une demande de confirmation, lisez-la puis acceptez le prérequis correspondant.

## 2. Ouvrir Viral Hit au quotidien

Double-cliquez sur **Viral Hit** sur le Bureau.

Le raccourci :

1. démarre le serveur local s'il n'est pas déjà actif ;
2. attend que l'API réponde ;
3. ouvre **http://localhost:8787** dans votre navigateur par défaut.

Vous pouvez fermer l'onglet du navigateur à la fin. Le prochain double-clic réutilisera le serveur déjà actif.

## 3. Mettre à jour sans tout retélécharger

Double-cliquez sur **Mettre à jour Viral Hit** sur le Bureau.

La mise à jour :

- arrête proprement l'ancien serveur ;
- exécute `git pull --ff-only` pour récupérer uniquement les changements ;
- réutilise le cache `pnpm` pour les dépendances inchangées ;
- ignore le téléchargement de FFmpeg si la version épinglée est déjà présente ;
- conserve vos projets, médias, modèles et réglages ;
- reconstruit l'interface et rouvre Viral Hit.

Pendant la pull request initiale, le dossier du code suit la branche validée `origin/arena/b4628d5e-viral-hit`. La commande `git pull --ff-only` utilise cette branche distante configurée par le clone ; elle ne réinitialise jamais le dossier et ne repart pas d'un téléchargement complet.

**N'effacez pas le dossier du programme entre deux mises à jour.** C'est précisément ce dossier et les caches qui permettent les mises à jour incrémentales.

Si vous avez modifié le code manuellement, le programme de mise à jour s'arrête au lieu d'écraser vos changements. Les fichiers `.env` et les données utilisateur ne sont pas concernés par cette protection.

## 4. Emplacement des fichiers

| Contenu | Emplacement par défaut |
|---|---|
| Code et scripts | `%LOCALAPPDATA%\Programs\ViralHit` |
| Projets, uploads, jobs et exports | `%LOCALAPPDATA%\ViralHit\Data` |
| Configuration des fournisseurs | `%LOCALAPPDATA%\Programs\ViralHit\.env` |
| Journaux du serveur | `%LOCALAPPDATA%\ViralHit\Data\logs` |
| Cache FFmpeg | `%LOCALAPPDATA%\Programs\ViralHit\.cache\media-python` |

Les modèles téléchargés ultérieurement restent dans l'espace de données Viral Hit et ne sont pas recréés par une mise à jour du code.

## 5. Configurer un fournisseur d'IA

Pour une utilisation ponctuelle, ouvrez **Réglages** dans Viral Hit et saisissez le fournisseur, l'endpoint, le modèle et la clé. Une clé saisie dans l'interface reste seulement en mémoire pendant la session.

Pour une configuration durable du CLI, de MCP et des récaps, ouvrez le fichier `.env` :

```powershell
notepad "$env:LOCALAPPDATA\Programs\ViralHit\.env"
```

Renseignez les valeurs sans guillemets inutiles, par exemple :

```dotenv
VIRALHIT_LLM_PROVIDER=ollama
VIRALHIT_LLM_BASE_URL=http://127.0.0.1:11434/v1
VIRALHIT_LLM_MODEL=qwen3:8b
VIRALHIT_LLM_API_KEY=
```

Pour un fournisseur cloud, utilisez son endpoint, un modèle disponible sur votre compte et votre propre clé. Ne partagez jamais ce fichier `.env`.

## 6. Dépannage

### `pnpm`, `git`, `node` ou `python` est introuvable

Fermez PowerShell, rouvrez-le et relancez le même bloc d'installation. Les installateurs de prérequis peuvent mettre à jour le `PATH` seulement pour les nouvelles fenêtres.

### Le raccourci signale que le serveur ne répond pas

Ouvrez les journaux :

```powershell
notepad "$env:LOCALAPPDATA\ViralHit\Data\logs\server.error.log"
notepad "$env:LOCALAPPDATA\ViralHit\Data\logs\server.out.log"
```

Copiez le message d'erreur final sans inclure de clé API.

### La page `localhost:8787` ne s'ouvre pas

Vérifiez d'abord que le raccourci **Viral Hit** a bien terminé son attente. Le serveur écoute sur `127.0.0.1`, donc aucune ouverture de port sur Internet ni règle de pare-feu publique n'est nécessaire.

### La mise à jour signale des modifications locales

Aucune donnée n'a été supprimée. Si vous n'avez pas volontairement modifié le code, copiez le message affiché avant de tenter une réparation. Le programme de mise à jour ne fait jamais de `git reset --hard` ni de `git clean`.
