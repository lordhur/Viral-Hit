. (Join-Path $PSScriptRoot "common.ps1")

$dataDir = Get-ViralHitDataDir
$pidFile = Join-Path $dataDir "server.pid"
if (-not (Test-Path $pidFile)) { exit 0 }

$serverPid = 0
if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$serverPid) -and $serverPid -gt 0) {
    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
        & taskkill.exe /PID $serverPid /T /F | Out-Null
    }
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
