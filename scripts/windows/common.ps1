Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ViralHitRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-ViralHitDataDir {
    if (-not [string]::IsNullOrWhiteSpace($env:VIRALHIT_DATA_DIR)) {
        return $env:VIRALHIT_DATA_DIR
    }
    return (Join-Path $env:LOCALAPPDATA "ViralHit\Data")
}

function Get-ViralHitPowerShell {
    $windowsPowerShell = Join-Path $PSHOME "powershell.exe"
    if (Test-Path $windowsPowerShell) { return $windowsPowerShell }
    return (Join-Path $PSHOME "pwsh.exe")
}

function Initialize-ViralHitEnvironment {
    $env:VIRALHIT_DATA_DIR = Get-ViralHitDataDir
    if ([string]::IsNullOrWhiteSpace($env:VIRALHIT_HOST)) { $env:VIRALHIT_HOST = "127.0.0.1" }
    if ([string]::IsNullOrWhiteSpace($env:VIRALHIT_PORT)) { $env:VIRALHIT_PORT = "8787" }
    if ([string]::IsNullOrWhiteSpace($env:VIRALHIT_PYTHON)) {
        foreach ($candidate in @(
            @{ Command = "python"; Prefix = @() },
            @{ Command = "py"; Prefix = @("-3") },
            @{ Command = "python3"; Prefix = @() }
        )) {
            if ($null -eq (Get-Command $candidate.Command -ErrorAction SilentlyContinue)) { continue }
            try {
                $executable = & $candidate.Command @($candidate.Prefix) -c "import sys; print(sys.executable if sys.version_info >= (3, 10) else '')" 2>$null
                if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($executable)) {
                    $env:VIRALHIT_PYTHON = $executable.Trim()
                    break
                }
            } catch { }
        }
    }
    New-Item -ItemType Directory -Force -Path $env:VIRALHIT_DATA_DIR | Out-Null
}

function Test-ViralHitServer {
    param([int]$Port = 8787)
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        return ($response.name -eq "Viral Hit")
    } catch {
        return $false
    }
}

function Wait-ViralHitServer {
    param([int]$Port = 8787, [int]$TimeoutSeconds = 90, [int]$ProcessId = 0)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-ViralHitServer -Port $Port) { return $true }
        if ($ProcessId -gt 0 -and $null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $false }
        Start-Sleep -Milliseconds 750
    }
    return $false
}

function Show-ViralHitError {
    param([string]$Message)
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            "Viral Hit",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    } catch {
        Write-Host $Message -ForegroundColor Red
    }
}

function Install-ViralHitShortcuts {
    $root = Get-ViralHitRoot
    $powerShell = Get-ViralHitPowerShell
    $icon = Join-Path $root "build\icon.ico"
    $desktop = [Environment]::GetFolderPath("Desktop")
    $programs = [Environment]::GetFolderPath("Programs")
    $startMenuFolder = Join-Path $programs "Viral Hit"
    New-Item -ItemType Directory -Force -Path $startMenuFolder | Out-Null

    $entries = @(
        @{ Name = "Viral Hit"; Script = "start.ps1"; Desktop = $true },
        @{ Name = "Mettre à jour Viral Hit"; Script = "update.ps1"; Desktop = $true }
    )
    $shell = New-Object -ComObject WScript.Shell
    foreach ($entry in $entries) {
        $script = Join-Path $root "scripts\windows\$($entry.Script)"
        $locations = @((Join-Path $startMenuFolder "$($entry.Name).lnk"))
        if ($entry.Desktop) { $locations += Join-Path $desktop "$($entry.Name).lnk" }
        foreach ($location in $locations) {
            $shortcut = $shell.CreateShortcut($location)
            $shortcut.TargetPath = $powerShell
            $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
            $shortcut.WorkingDirectory = $root
            $shortcut.IconLocation = $icon
            $shortcut.Description = "$($entry.Name) — agent vidéo local"
            $shortcut.Save()
        }
    }
}
