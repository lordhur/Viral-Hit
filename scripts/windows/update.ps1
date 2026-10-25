. (Join-Path $PSScriptRoot "common.ps1")

function Invoke-UpdateStep {
    param([string]$Label, [scriptblock]$Command)
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label a échoué (code $LASTEXITCODE)." }
}

try {
    Initialize-ViralHitEnvironment
    $root = Get-ViralHitRoot
    Set-Location $root

    & (Join-Path $PSScriptRoot "stop.ps1")
    $localChanges = & git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw "Impossible de lire l'état du dossier Viral Hit." }
    if ($localChanges) {
        throw "Des modifications locales du code sont présentes. Elles ont été conservées et la mise à jour a été annulée. Vos vidéos et réglages ne sont pas concernés."
    }

    Invoke-UpdateStep -Label "Téléchargement des seuls changements Git" -Command { & git pull --ff-only }
    Invoke-UpdateStep -Label "Mise à jour incrémentale des dépendances" -Command { & pnpm.cmd install }
    Invoke-UpdateStep -Label "Vérification de FFmpeg (sans retéléchargement si présent)" -Command { & pnpm.cmd setup:media }
    Invoke-UpdateStep -Label "Construction de l'interface" -Command { & pnpm.cmd build:web }

    . (Join-Path $PSScriptRoot "common.ps1")
    Install-ViralHitShortcuts
    Write-Host "`nMise à jour terminée. Ouverture de Viral Hit…" -ForegroundColor Green
    & (Join-Path $PSScriptRoot "start.ps1")
} catch {
    Show-ViralHitError -Message "La mise à jour de Viral Hit n'a pas abouti.`n$($_.Exception.Message)`n`nVos données n'ont pas été supprimées."
    exit 1
}
