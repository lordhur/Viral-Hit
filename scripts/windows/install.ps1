[CmdletBinding()]
param(
    [string]$Repository = "https://github.com/lordhur/Viral-Hit.git",
    [string]$Branch = "arena/b4628d5e-viral-hit",
    [string]$Destination = (Join-Path $env:LOCALAPPDATA "Programs\ViralHit")
)

$ErrorActionPreference = "Stop"

function Test-CommandAvailable([string]$Name) {
    return ($null -ne (Get-Command $Name -ErrorAction SilentlyContinue))
}

function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user;$env:APPDATA\npm"
}

function Test-NodeRuntime {
    if (-not (Test-CommandAvailable "node")) { return $false }
    try {
        $version = (& node --version).Trim().TrimStart("v")
        return ([int]$version.Split(".")[0] -ge 22)
    } catch { return $false }
}

function Test-PythonRuntime {
    foreach ($candidate in @(
        @{ Command = "python"; Prefix = @() },
        @{ Command = "py"; Prefix = @("-3") },
        @{ Command = "python3"; Prefix = @() }
    )) {
        if (-not (Test-CommandAvailable $candidate.Command)) { continue }
        try {
            $result = & $candidate.Command @($candidate.Prefix) -c "import sys; print(sys.version_info >= (3, 10))" 2>$null
            if ($result -eq "True") { return $true }
        } catch { }
    }
    return $false
}

function Install-WingetPackage([string]$Id, [string]$Label) {
    Write-Host "Installation de $Label avec winget…" -ForegroundColor Cyan
    & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "L'installation de $Label a échoué (code $LASTEXITCODE)." }
}

function Invoke-InstallStep([string]$Label, [scriptblock]$Command) {
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label a échoué (code $LASTEXITCODE)." }
}

function Show-InstallerError([string]$Message) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($Message, "Installation de Viral Hit") | Out-Null
    } catch { Write-Host $Message -ForegroundColor Red }
}

try {
    Write-Host "Viral Hit — installation dans votre profil Windows" -ForegroundColor Green
    Write-Host "Destination : $Destination"

    $needsGit = -not (Test-CommandAvailable "git")
    $needsNode = -not (Test-NodeRuntime)
    $needsPython = -not (Test-PythonRuntime)
    if (($needsGit -or $needsNode -or $needsPython) -and -not (Test-CommandAvailable "winget")) {
        throw "Certains prérequis manquent et winget n'est pas disponible. Installez Git (https://git-scm.com/download/win), Node.js 22+ (https://nodejs.org) et Python 3.10+ (https://python.org/downloads), puis relancez ce script."
    }
    if ($needsGit) { Install-WingetPackage "Git.Git" "Git" }
    if ($needsNode) { Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS" }
    if ($needsPython) { Install-WingetPackage "Python.Python.3.12" "Python 3.12" }
    Update-SessionPath

    if (-not (Test-CommandAvailable "git")) { throw "Git reste introuvable. Fermez et rouvrez PowerShell, puis relancez l'installation." }
    if (-not (Test-NodeRuntime)) { throw "Node.js 22+ reste introuvable. Fermez et rouvrez PowerShell, puis relancez l'installation." }
    if (-not (Test-PythonRuntime)) { throw "Python 3.10+ reste introuvable. Fermez et rouvrez PowerShell, puis relancez l'installation." }

    if (Test-CommandAvailable "corepack") {
        try { & corepack enable } catch { Write-Host "Corepack sera complété par l'installation npm de pnpm." }
    }
    Update-SessionPath
    if (-not (Test-CommandAvailable "pnpm")) {
        Invoke-InstallStep "Installation du gestionnaire pnpm" { & npm install --global pnpm }
        Update-SessionPath
    }

    $existingUpdate = Join-Path $Destination "scripts\windows\update.ps1"
    if ((Test-Path (Join-Path $Destination ".git")) -and (Test-Path $existingUpdate)) {
        Write-Host "Viral Hit existe déjà : lancement de sa mise à jour incrémentale…" -ForegroundColor Yellow
        $powerShell = Join-Path $PSHOME "powershell.exe"
        if (-not (Test-Path $powerShell)) { $powerShell = Join-Path $PSHOME "pwsh.exe" }
        & $powerShell -NoProfile -ExecutionPolicy Bypass -File $existingUpdate
        exit $LASTEXITCODE
    }
    if ((Test-Path $Destination) -and (Get-ChildItem $Destination -Force | Select-Object -First 1)) {
        throw "Le dossier $Destination existe et n'est pas vide. Choisissez une autre destination ou déplacez-le vous-même ; rien n'a été supprimé."
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null

    Invoke-InstallStep "Téléchargement initial du projet" { & git clone --branch $Branch --single-branch $Repository $Destination }
    Set-Location $Destination
    if (-not (Test-Path (Join-Path $Destination ".env"))) {
        Copy-Item (Join-Path $Destination ".env.example") (Join-Path $Destination ".env")
    }

    Invoke-InstallStep "Installation des dépendances (le cache sera réutilisé ensuite)" { & pnpm.cmd install }
    Invoke-InstallStep "Installation de FFmpeg dans le cache local" { & pnpm.cmd setup:media }
    Invoke-InstallStep "Construction de l'interface" { & pnpm.cmd build:web }

    . (Join-Path $Destination "scripts\windows\common.ps1")
    Initialize-ViralHitEnvironment
    Install-ViralHitShortcuts
    Write-Host "`nInstallation terminée. Les raccourcis sont sur le Bureau. Ouverture de Viral Hit…" -ForegroundColor Green
    & (Join-Path $Destination "scripts\windows\start.ps1")
} catch {
    Show-InstallerError "L'installation de Viral Hit s'est arrêtée.`n$($_.Exception.Message)`n`nAucune donnée existante n'a été supprimée."
    exit 1
}
