. (Join-Path $PSScriptRoot "common.ps1")

try {
    Initialize-ViralHitEnvironment
    $root = Get-ViralHitRoot
    $port = [int]$env:VIRALHIT_PORT
    $url = "http://localhost:$port"

    if (Test-ViralHitServer -Port $port) {
        Start-Process $url
        exit 0
    }

    $logDir = Join-Path $env:VIRALHIT_DATA_DIR "logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $stdout = Join-Path $logDir "server.out.log"
    $stderr = Join-Path $logDir "server.error.log"
    $serverScript = Join-Path $root "scripts\windows\server.ps1"
    $powerShell = Get-ViralHitPowerShell
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$serverScript`""
    )
    $process = Start-Process `
        -FilePath $powerShell `
        -ArgumentList $arguments `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    Set-Content -Path (Join-Path $env:VIRALHIT_DATA_DIR "server.pid") -Value $process.Id -Encoding ascii

    if (Wait-ViralHitServer -Port $port -ProcessId $process.Id) {
        Start-Process $url
        exit 0
    }
    & (Join-Path $PSScriptRoot "stop.ps1")
    throw "Le serveur n'a pas répondu ou s'est arrêté. Consultez les journaux :`n$stdout`n$stderr"
} catch {
    Show-ViralHitError -Message "Viral Hit n'a pas pu démarrer.`n$($_.Exception.Message)"
    exit 1
}
