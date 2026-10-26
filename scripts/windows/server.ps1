. (Join-Path $PSScriptRoot "common.ps1")

Initialize-ViralHitEnvironment
$root = Get-ViralHitRoot
Set-Location $root

# Installation and updates already build the UI. Only rebuild if it is missing.
if (-not (Test-Path (Join-Path $root "dist\renderer\index.html"))) {
    & pnpm.cmd build:web
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& pnpm.cmd start:web
exit $LASTEXITCODE
